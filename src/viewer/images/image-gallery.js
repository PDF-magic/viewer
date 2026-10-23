import { pdfDocumentSessionReady } from "../pdf-document-session.js";
import { imageCropPixels, imageRegionsFromCoordinates } from "./image-gallery-utils.js";

const menu = document.querySelector("#tools-menu");
const menuToggle = document.querySelector("#tools-button");
if (menu && menuToggle) {
  installImageGallery(menu, menuToggle);
}

function installImageGallery(toolsMenu, toolsButton) {
  const openButton = document.createElement("button");
  openButton.id = "open-image-gallery";
  openButton.type = "button";
  openButton.className = "tool-button";
  openButton.setAttribute("role", "menuitem");
  openButton.textContent = "▧  Browse document images";
  toolsMenu.insertBefore(openButton, toolsMenu.querySelector("#qr-file-url"));

  const dialog = document.createElement("dialog");
  dialog.className = "image-gallery-dialog";
  dialog.setAttribute("aria-labelledby", "image-gallery-title");
  dialog.innerHTML = [
    '<section class="image-gallery-panel">',
    '<header class="image-gallery-header">',
    '<div><h2 id="image-gallery-title">Document images</h2><p class="image-gallery-status" role="status" aria-live="polite"></p></div>',
    '<button type="button" class="image-gallery-close" aria-label="Close image gallery" title="Close">×</button>',
    '</header>',
    '<div class="image-gallery-stage">',
    '<button type="button" class="image-gallery-previous" aria-label="Previous image" title="Previous image (Left arrow)">‹</button>',
    '<div class="image-gallery-picture"><img alt="" hidden /><p class="image-gallery-empty">Finding images in this document…</p></div>',
    '<button type="button" class="image-gallery-next" aria-label="Next image" title="Next image (Right arrow)">›</button>',
    '</div>',
    '<footer class="image-gallery-footer">',
    '<span class="image-gallery-caption" aria-live="polite"></span>',
    '<button type="button" class="image-gallery-jump" disabled>Go to page</button>',
    '</footer>',
    '<div class="image-gallery-thumbnails" role="group" aria-label="Document image thumbnails"></div>',
    '</section>',
  ].join("");
  document.body.append(dialog);

  const status = dialog.querySelector(".image-gallery-status");
  const picture = dialog.querySelector(".image-gallery-picture img");
  const empty = dialog.querySelector(".image-gallery-empty");
  const previous = dialog.querySelector(".image-gallery-previous");
  const next = dialog.querySelector(".image-gallery-next");
  const caption = dialog.querySelector(".image-gallery-caption");
  const jump = dialog.querySelector(".image-gallery-jump");
  const thumbnails = dialog.querySelector(".image-gallery-thumbnails");
  const close = dialog.querySelector(".image-gallery-close");

  const entries = [];
  let pdfDocument = null;
  let nextPageToScan = 1;
  let scannedPages = 0;
  let failedPages = 0;
  let scanJob = null;
  let scanController = null;
  let scanTask = null;
  let selectionTask = null;
  let selectionVersion = 0;
  let selectedIndex = -1;
  let selectedUrl = null;

  function updateScanStatus() {
    if (!pdfDocument) return;
    const finished = nextPageToScan > pdfDocument.numPages;
    status.textContent = finished
      ? entries.length + " images on " + pdfDocument.numPages + " pages" +
        (failedPages ? " (" + failedPages + " pages could not be scanned)" : "")
      : "Scanning page " + Math.min(nextPageToScan, pdfDocument.numPages) +
        " of " + pdfDocument.numPages + " · " + entries.length + " images found";
    if (selectedIndex === -1) {
      empty.textContent = finished
        ? "No embedded images found. Vector drawings and scanned page backgrounds are not included."
        : "Searching for embedded images…";
    }
  }

  function select(index) {
    if (index < 0 || index >= entries.length || !dialog.open) return;
    selectedIndex = index;
    const entry = entries[index];
    caption.textContent = "Image " + (index + 1) + " of " + entries.length + " · PDF page " + entry.pageNumber;
    previous.disabled = index === 0;
    next.disabled = index === entries.length - 1;
    jump.disabled = false;
    for (const [itemIndex, item] of entries.entries()) {
      item.button.setAttribute("aria-pressed", String(itemIndex === index));
    }
    entry.button.scrollIntoView({ block: "nearest", inline: "nearest" });
    selectionVersion += 1;
    const version = selectionVersion;
    selectionTask?.cancel();
    selectionTask = null;
    picture.hidden = true;
    empty.hidden = false;
    empty.textContent = "Rendering image…";
    void renderSelection(entry, version);
  }

  async function renderSelection(entry, version) {
    let page;
    let canvas;
    let url;
    try {
      page = await pdfDocument.getPage(entry.pageNumber);
      if (version !== selectionVersion || !dialog.open) return;
      const base = page.getViewport({ scale: 1, rotation: 0 });
      const maximumScale = Math.min(
        4,
        Math.sqrt(16_000_000 / Math.max(1, base.width * base.height)),
        8192 / Math.max(base.width, base.height),
      );
      const scale = Math.max(0.05, Math.min(maximumScale, 1200 / Math.max(1, base.width * entry.region.width)));
      const viewport = page.getViewport({ scale, rotation: 0 });
      canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const task = page.render({
        canvasContext: canvas.getContext("2d", { alpha: false }),
        viewport,
      });
      selectionTask = task;
      await task.promise;
      if (selectionTask === task) selectionTask = null;
      if (version !== selectionVersion || !dialog.open) return;
      url = await encodeCrop(canvas, entry.region, 1800, 1800);
      if (version !== selectionVersion || !dialog.open) return;
      if (selectedUrl) URL.revokeObjectURL(selectedUrl);
      selectedUrl = url;
      url = null;
      picture.src = selectedUrl;
      picture.alt = "Embedded image " + (selectedIndex + 1) + ", PDF page " + entry.pageNumber;
      picture.hidden = false;
      empty.hidden = true;
    } catch (error) {
      if (version === selectionVersion && dialog.open) {
        picture.src = entry.thumbnailUrl;
        picture.alt = "Image preview from PDF page " + entry.pageNumber;
        picture.hidden = false;
        empty.hidden = true;
      }
    } finally {
      if (url) URL.revokeObjectURL(url);
      if (canvas) { canvas.width = 0; canvas.height = 0; }
      // PDF.js defers cleanup while other rendering tasks still use the page.
      page?.cleanup();
    }
  }

  async function encodeCrop(source, region, limitWidth, limitHeight) {
    const crop = imageCropPixels(region, source.width, source.height);
    const ratio = Math.min(1, limitWidth / crop.width, limitHeight / crop.height);
    const output = document.createElement("canvas");
    output.width = Math.max(1, Math.round(crop.width * ratio));
    output.height = Math.max(1, Math.round(crop.height * ratio));
    output.getContext("2d", { alpha: false }).drawImage(
      source, crop.x, crop.y, crop.width, crop.height,
      0, 0, output.width, output.height,
    );
    try {
      const blob = await new Promise((resolve, reject) => {
        output.toBlob((value) => value ? resolve(value) : reject(new Error("Image encoding failed")), "image/webp", 0.9);
      });
      return URL.createObjectURL(blob);
    } finally {
      output.width = 0;
      output.height = 0;
    }
  }

  function addImage(pageNumber, region, thumbnailUrl) {
    const entry = { pageNumber, region, thumbnailUrl };
    const index = entries.length;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "image-gallery-thumb";
    button.setAttribute("aria-label", "Image " + (index + 1) + " on PDF page " + pageNumber);
    button.setAttribute("aria-pressed", "false");
    const img = document.createElement("img");
    img.src = thumbnailUrl;
    img.alt = "";
    img.loading = "lazy";
    const label = document.createElement("span");
    label.textContent = "p. " + pageNumber;
    button.append(img, label);
    button.addEventListener("click", () => select(index));
    entry.button = button;
    entries.push(entry);
    thumbnails.append(button);
    if (selectedIndex === -1) {
      select(0);
    } else {
      caption.textContent = "Image " + (selectedIndex + 1) + " of " + entries.length +
        " · PDF page " + entries[selectedIndex].pageNumber;
      next.disabled = selectedIndex === entries.length - 1;
    }
  }

  async function scanPage(pageNumber, signal) {
    let page;
    let canvas;
    const prepared = [];
    try {
      page = await pdfDocument.getPage(pageNumber);
      if (signal.aborted) return false;
      const base = page.getViewport({ scale: 1, rotation: 0 });
      const scale = Math.min(1, 650 / base.width, 900 / base.height);
      const viewport = page.getViewport({ scale, rotation: 0 });
      canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      page.imageCoordinates = null;
      const task = page.render({
        canvasContext: canvas.getContext("2d", { alpha: false }),
        viewport,
        recordImages: true,
      });
      scanTask = task;
      await task.promise;
      if (scanTask === task) scanTask = null;
      if (signal.aborted) return false;
      const regions = imageRegionsFromCoordinates(page.imageCoordinates, base.width, base.height);
      for (const region of regions) {
        if (signal.aborted) return false;
        const thumbnailUrl = await encodeCrop(canvas, region, 150, 110);
        prepared.push({ region, thumbnailUrl });
      }
      if (signal.aborted) return false;
      for (const { region, thumbnailUrl } of prepared) addImage(pageNumber, region, thumbnailUrl);
      return true;
    } finally {
      if (signal.aborted) {
        for (const item of prepared) URL.revokeObjectURL(item.thumbnailUrl);
      }
      if (scanTask && signal.aborted) {
        scanTask.cancel();
        scanTask = null;
      }
      if (canvas) { canvas.width = 0; canvas.height = 0; }
      page?.cleanup();
    }
  }

  async function runScan(controller) {
    while (dialog.open && !controller.signal.aborted && nextPageToScan <= pdfDocument.numPages) {
      const pageNumber = nextPageToScan;
      try {
        if (!(await scanPage(pageNumber, controller.signal))) break;
      } catch (error) {
        if (controller.signal.aborted) break;
        failedPages += 1; // One damaged PDF page must not block later images.
      }
      if (controller.signal.aborted) break;
      nextPageToScan = pageNumber + 1;
      scannedPages += 1;
      updateScanStatus();
      await new Promise((resolve) => setTimeout(resolve, 16)); // Keep the reader responsive.
    }
    updateScanStatus();
  }

  function startScan() {
    if (!dialog.open || !pdfDocument || scanJob || nextPageToScan > pdfDocument.numPages) return;
    const controller = new AbortController();
    scanController = controller;
    scanJob = runScan(controller).finally(() => {
      if (scanController === controller) scanController = null;
      scanJob = null;
      if (dialog.open && nextPageToScan <= pdfDocument.numPages) startScan();
    });
  }

  function goToSourcePage() {
    const entry = entries[selectedIndex];
    if (!entry) return;
    dialog.close();
    const pageInput = document.querySelector("#page-number");
    if (pageInput) {
      pageInput.value = String(entry.pageNumber);
      pageInput.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  openButton.addEventListener("click", async () => {
    toolsMenu.hidden = true;
    toolsButton.setAttribute("aria-expanded", "false");
    dialog.showModal();
    close.focus();
    if (!pdfDocument) {
      const session = await pdfDocumentSessionReady;
      if (!session?.document) {
        empty.textContent = "This PDF is not available.";
        return;
      }
      pdfDocument = session.document;
    }
    if (!dialog.open) return;
    if (selectedIndex >= 0) select(selectedIndex);
    updateScanStatus();
    startScan();
  });
  close.addEventListener("click", () => dialog.close());
  previous.addEventListener("click", () => select(selectedIndex - 1));
  next.addEventListener("click", () => select(selectedIndex + 1));
  jump.addEventListener("click", goToSourcePage);
  dialog.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      select(selectedIndex + (event.key === "ArrowRight" ? 1 : -1));
    }
  });
  dialog.addEventListener("close", () => {
    scanController?.abort();
    scanTask?.cancel();
    selectionVersion += 1;
    selectionTask?.cancel();
    selectionTask = null;
    if (selectedUrl) URL.revokeObjectURL(selectedUrl);
    selectedUrl = null;
    picture.removeAttribute("src");
    picture.hidden = true;
    toolsButton.focus();
  });
  window.addEventListener("pagehide", () => {
    if (dialog.open) dialog.close();
    for (const entry of entries) URL.revokeObjectURL(entry.thumbnailUrl);
    entries.length = 0;
    thumbnails.replaceChildren();
    selectedIndex = -1;
    nextPageToScan = 1;
  });
}
