const PREVIEW_WIDTH = 768;
const MAX_PREVIEW_PIXELS = 1024 * 1024;
const MAX_PREVIEW_BYTES = 128 * 1024 * 1024;
const PREVIEW_RADIUS = 8;

// Keep encoded images, not canvases or decoded ImageBitmaps. Image-heavy
// documents fall back to an LRU cache rather than consuming unlimited RAM.
export class PreviewCache {
  constructor(maxBytes = MAX_PREVIEW_BYTES, onEvict = () => {}) {
    this.maxBytes = maxBytes;
    this.onEvict = onEvict;
    this.entries = new Map();
    this.bytes = 0;
  }

  get(key) {
    const entry = this.entries.get(key);
    if (entry) {
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    return entry;
  }

  set(key, entry) {
    if (this.entries.has(key)) this.delete(key);
    if (entry.blob.size > this.maxBytes) return;
    this.entries.set(key, entry);
    this.bytes += entry.blob.size;
    while (this.bytes > this.maxBytes) {
      this.delete(this.entries.keys().next().value);
    }
  }

  delete(key) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.bytes -= entry.blob.size;
    this.onEvict(key);
  }

  clear() {
    for (const key of this.entries.keys()) this.delete(key);
  }
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Preview encoding failed")), "image/webp", 0.8);
  });
}

async function encodeCanvas(canvas, targetBytes, createCanvas) {
  let blob = await canvasBlob(canvas);
  let reduced;
  let width = canvas.width;
  try {
    // Adapt preview resolution to the document's page count. Reserve headroom
    // so the complete set usually fits even when individual pages vary in size.
    for (let attempt = 0; blob.size > targetBytes && width > 160 && attempt < 4; attempt += 1) {
      width = Math.max(160, Math.floor(width * Math.min(0.85, Math.sqrt(targetBytes / blob.size) * 0.9)));
      reduced ||= createCanvas();
      reduced.width = width;
      reduced.height = Math.max(1, Math.floor(canvas.height * width / canvas.width));
      reduced.getContext("2d", { alpha: false }).drawImage(canvas, 0, 0, reduced.width, reduced.height);
      blob = await canvasBlob(reduced);
    }
    return blob;
  } finally {
    if (reduced) { reduced.width = 0; reduced.height = 0; }
  }
}

export class PagePreviews {
  constructor({ pdfDocument, pages, isSharp, waitForForeground,
    yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 16)),
    createCanvas = () => document.createElement("canvas"),
    createImage = () => document.createElement("img"),
    urls = URL, maxBytes = MAX_PREVIEW_BYTES }) {
    Object.assign(this, { pdfDocument, pages, isSharp, waitForForeground, yieldToBrowser, createCanvas, createImage, urls });
    this.images = new Map();
    this.cache = new PreviewCache(maxBytes, (pageNumber) => this.hide(pageNumber));
    this.targetBytes = Math.max(4096, Math.floor(maxBytes * 0.85 / pdfDocument.numPages));
    this.pending = new Set();
    this.failed = new Set();
    this.generation = 0;
    this.center = 1;
    this.nextPage = 1;
    this.rotation = 0;
    this.stopped = true;
  }

  start(rotation = 0, center = this.center) {
    this.generation += 1;
    this.stopped = false;
    this.rotation = rotation;
    this.center = center;
    this.nextPage = 1;
    this.pending.clear();
    this.failed.clear();
    this.clearImages();
    this.cache.clear();
    this.update(center);
  }

  nearby(pageNumber) {
    return Math.abs(pageNumber - this.center) <= PREVIEW_RADIUS;
  }

  update(center) {
    this.center = center;
    for (const pageNumber of this.images.keys()) {
      if (!this.nearby(pageNumber) || this.isSharp(pageNumber)) this.hide(pageNumber);
    }
    this.pending.clear();
    for (let distance = 0; distance <= PREVIEW_RADIUS; distance += 1) {
      for (const pageNumber of new Set([center + distance, center - distance])) {
        if (pageNumber < 1 || pageNumber > this.pdfDocument.numPages) continue;
        if (this.cache.entries.has(pageNumber)) this.show(pageNumber);
        else if (!this.failed.has(pageNumber)) this.pending.add(pageNumber);
      }
    }
    this.pump();
  }

  show(pageNumber) {
    if (this.stopped || !this.nearby(pageNumber) || this.isSharp(pageNumber) || this.images.has(pageNumber)) return;
    const entry = this.cache.get(pageNumber);
    if (!entry) return;
    const image = this.createImage();
    const url = this.urls.createObjectURL(entry.blob);
    image.className = "page-preview";
    image.alt = "";
    image.setAttribute("aria-hidden", "true");
    image.decoding = "async";
    image.src = url;
    this.images.set(pageNumber, { image, url });
    const container = this.pages[pageNumber - 1];
    container.style.aspectRatio = `${entry.width} / ${entry.height}`;
    container.append(image);
    container.classList.add("previewed");
  }

  hide(pageNumber) {
    const entry = this.images.get(pageNumber);
    if (!entry) return;
    entry.image.removeAttribute("src");
    entry.image.remove();
    this.urls.revokeObjectURL(entry.url);
    this.images.delete(pageNumber);
    this.pages[pageNumber - 1].classList.remove("previewed");
  }

  clearImages() {
    for (const pageNumber of this.images.keys()) this.hide(pageNumber);
  }

  stop() {
    this.stopped = true;
    this.generation += 1;
    this.pending.clear();
    this.clearImages();
    this.cache.clear();
  }

  takeNextPage() {
    while (this.pending.size) {
      const pageNumber = this.pending.values().next().value;
      this.pending.delete(pageNumber);
      if (!this.cache.entries.has(pageNumber) && !this.failed.has(pageNumber)) return pageNumber;
    }
    while (this.nextPage <= this.pdfDocument.numPages) {
      const pageNumber = this.nextPage++;
      if (!this.cache.entries.has(pageNumber) && !this.failed.has(pageNumber)) return pageNumber;
    }
    return undefined;
  }

  pump() {
    if (this.running || this.stopped) return;
    const generation = this.generation;
    this.running = this.preparePages(generation).finally(() => {
      this.running = undefined;
      if (!this.stopped && (generation !== this.generation || this.pending.size)) this.pump();
    });
  }

  async preparePages(generation) {
    while (!this.stopped && generation === this.generation) {
      // Give sharp rendering precedence, and let input/paint run between pages.
      await this.yieldToBrowser();
      await this.waitForForeground();
      if (this.stopped || generation !== this.generation) return;
      const pageNumber = this.takeNextPage();
      if (pageNumber === undefined) return;
      let page;
      let canvas;
      try {
        page = await this.pdfDocument.getPage(pageNumber);
        if (this.stopped || generation !== this.generation) return;
        const base = page.getViewport({ scale: 1, rotation: this.rotation });
        const scale = Math.min(PREVIEW_WIDTH / base.width, Math.sqrt(MAX_PREVIEW_PIXELS / (base.width * base.height)));
        const viewport = page.getViewport({ scale, rotation: this.rotation });
        canvas = this.createCanvas();
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        await page.render({ canvasContext: canvas.getContext("2d", { alpha: false }), viewport }).promise;
        const blob = await encodeCanvas(canvas, this.targetBytes, this.createCanvas);
        if (this.stopped || generation !== this.generation) return;
        this.cache.set(pageNumber, { blob, width: viewport.width, height: viewport.height });
        this.show(pageNumber);
      } catch {
        // One bad page or a failed encoding must not stop preparing the rest.
        if (generation === this.generation) this.failed.add(pageNumber);
      } finally {
        if (canvas) { canvas.width = 0; canvas.height = 0; }
        page?.cleanup();
      }
    }
  }
}
