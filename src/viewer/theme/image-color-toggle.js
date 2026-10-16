import "./accent-color.js";

const PRESERVE_IMAGE_COLORS_STORAGE_KEY = "pdf-viewer-preserve-image-colors";
const preserveImageColorsToggle = document.querySelector("#preserve-image-colors");

function savedPreference() {
  const stored = localStorage.getItem(PRESERVE_IMAGE_COLORS_STORAGE_KEY);
  return stored === null ? true : stored === "true";
}

function applyPreference(enabled) {
  preserveImageColorsToggle.checked = enabled;
  document.documentElement.dataset.preserveImageColors = String(enabled);
}

applyPreference(savedPreference());

preserveImageColorsToggle.addEventListener("change", () => {
  const enabled = preserveImageColorsToggle.checked;
  localStorage.setItem(PRESERVE_IMAGE_COLORS_STORAGE_KEY, String(enabled));
  applyPreference(enabled);
});
