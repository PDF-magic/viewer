const IMAGE_STORAGE_KEY = "pdf-viewer-custom-loading-image";
const IMAGE_NAME_STORAGE_KEY = "pdf-viewer-custom-loading-image-name";
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const root = document.documentElement;
const toolsButton = document.querySelector("#tools-button");
const toolsMenu = document.querySelector("#tools-menu");
const chooseButton = document.querySelector("#choose-loading-image");
const resetButton = document.querySelector("#reset-loading-image");
const fileInput = document.querySelector("#custom-loading-image");
const toast = document.querySelector("#toast");
let toastTimer;

function applyLoadingImage(dataUrl) {
  if (dataUrl) {
    root.style.setProperty("--loading-image", `url("${dataUrl}")`);
  } else {
    root.style.removeProperty("--loading-image");
  }
  resetButton.hidden = !dataUrl;
}

function closeToolsMenu() {
  toolsMenu.hidden = true;
  toolsButton.setAttribute("aria-expanded", "false");
}

function showFeedback(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("visible");
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2400);
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result), { once: true });
    reader.addEventListener("error", () => reject(reader.error), { once: true });
    reader.readAsDataURL(file);
  });
}

applyLoadingImage(localStorage.getItem(IMAGE_STORAGE_KEY));

chooseButton.addEventListener("click", () => {
  fileInput.value = "";
  fileInput.click();
});

fileInput.addEventListener("change", async () => {
  const [file] = fileInput.files;
  if (!file) {
    return;
  }

  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
    showFeedback("Choose a PNG, JPEG, WebP, or GIF image.");
    return;
  }

  if (file.size > MAX_IMAGE_BYTES) {
    showFeedback("Loading images must be 3 MB or smaller.");
    return;
  }

  try {
    const dataUrl = await readAsDataUrl(file);
    localStorage.setItem(IMAGE_STORAGE_KEY, dataUrl);
    localStorage.setItem(IMAGE_NAME_STORAGE_KEY, file.name);
    applyLoadingImage(dataUrl);
    closeToolsMenu();
    showFeedback(`${file.name} will appear while PDFs load.`);
  } catch {
    showFeedback("Could not save that loading image.");
  }
});

resetButton.addEventListener("click", () => {
  localStorage.removeItem(IMAGE_STORAGE_KEY);
  localStorage.removeItem(IMAGE_NAME_STORAGE_KEY);
  applyLoadingImage(null);
  closeToolsMenu();
  showFeedback("Restored the default loading image.");
});
