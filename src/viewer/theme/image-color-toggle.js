import "./accent-color.js";

const PRESERVE_IMAGE_COLORS_STORAGE_KEY = "pdf-viewer-preserve-image-colors";
const IMAGE_CORNER_RADIUS_CSS_PX = 8;
const preserveImageColorsToggle = document.querySelector("#preserve-image-colors");

function savedPreference() {
  const stored = localStorage.getItem(PRESERVE_IMAGE_COLORS_STORAGE_KEY);
  return stored === null ? true : stored === "true";
}

function applyPreference(enabled) {
  preserveImageColorsToggle.checked = enabled;
  document.documentElement.dataset.preserveImageColors = String(enabled);
}

function visibleCanvasBounds(canvas, context) {
  const { width, height } = canvas;
  const { data } = context.getImageData(0, 0, width, height);
  const alphaAt = (x, y) => data[(y * width + x) * 4 + 3];

  let top = 0;
  topSearch: for (; top < height; top += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alphaAt(x, top)) {
        break topSearch;
      }
    }
  }

  if (top === height) {
    return null;
  }

  let bottom = height - 1;
  bottomSearch: for (; bottom > top; bottom -= 1) {
    for (let x = 0; x < width; x += 1) {
      if (alphaAt(x, bottom)) {
        break bottomSearch;
      }
    }
  }

  let left = 0;
  leftSearch: for (; left < width; left += 1) {
    for (let y = top; y <= bottom; y += 1) {
      if (alphaAt(left, y)) {
        break leftSearch;
      }
    }
  }

  let right = width - 1;
  rightSearch: for (; right > left; right -= 1) {
    for (let y = top; y <= bottom; y += 1) {
      if (alphaAt(right, y)) {
        break rightSearch;
      }
    }
  }

  return { top, right, bottom, left };
}

function roundImageOverlay(overlay) {
  if (!(overlay instanceof HTMLCanvasElement) || overlay.dataset.cornersRounded === "true") {
    return;
  }

  overlay.dataset.cornersRounded = "true";

  if (!overlay.width || !overlay.height) {
    return;
  }

  const context = overlay.getContext("2d", { alpha: true, willReadFrequently: true });
  if (!context) {
    return;
  }

  const bounds = visibleCanvasBounds(overlay, context);
  if (!bounds) {
    return;
  }

  const cssWidth = Number.parseFloat(overlay.style.width) || overlay.width;
  const cssHeight = Number.parseFloat(overlay.style.height) || overlay.height;
  const scaleX = overlay.width / cssWidth;
  const scaleY = overlay.height / cssHeight;
  const top = bounds.top / scaleY;
  const right = (overlay.width - bounds.right - 1) / scaleX;
  const bottom = (overlay.height - bounds.bottom - 1) / scaleY;
  const left = bounds.left / scaleX;
  const visibleWidth = cssWidth - left - right;
  const visibleHeight = cssHeight - top - bottom;
  const radius = Math.min(IMAGE_CORNER_RADIUS_CSS_PX, visibleWidth / 2, visibleHeight / 2);

  overlay.style.clipPath = `inset(${top}px ${right}px ${bottom}px ${left}px round ${radius}px)`;
}

function roundImageOverlaysIn(node) {
  if (!(node instanceof Element)) {
    return;
  }

  if (node.matches(".page-image-overlay")) {
    roundImageOverlay(node);
  }

  for (const overlay of node.querySelectorAll(".page-image-overlay")) {
    roundImageOverlay(overlay);
  }
}

applyPreference(savedPreference());

document.querySelectorAll(".page-image-overlay").forEach(roundImageOverlay);

const imageOverlayObserver = new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      roundImageOverlaysIn(node);
    }
  }
});
imageOverlayObserver.observe(document.documentElement, { childList: true, subtree: true });

preserveImageColorsToggle.addEventListener("change", () => {
  const enabled = preserveImageColorsToggle.checked;
  localStorage.setItem(PRESERVE_IMAGE_COLORS_STORAGE_KEY, String(enabled));
  applyPreference(enabled);
});
