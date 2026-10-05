const ACCENT_COLOR_STORAGE_KEY = "pdf-viewer-accent-color";
const DEFAULT_ACCENT_COLOR = "#43af49";
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

const accentStylesheet = document.createElement("link");
accentStylesheet.rel = "stylesheet";
accentStylesheet.href = new URL("./accent-color.css", import.meta.url).href;
document.head.append(accentStylesheet);

const root = document.documentElement;
const toolsMenu = document.querySelector("#tools-menu");
let accentColorInput;
let accentHexInput;

function normalizeAccentColor(value) {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value)
    ? value.toLowerCase()
    : DEFAULT_ACCENT_COLOR;
}

function applyAccentColor(value) {
  const color = normalizeAccentColor(value);
  root.style.setProperty("--accent", color);
  return color;
}

function createAccentColorSetting(color) {
  if (!toolsMenu) {
    return;
  }

  const label = document.createElement("div");
  label.className = "tool-button accent-color-setting";
  label.title = "Choose the viewer accent color";

  const text = document.createElement("span");
  text.textContent = "Theme color";

  accentColorInput = document.createElement("button");
  accentColorInput.id = "theme-accent-color";
  accentColorInput.className = "accent-color-input";
  accentColorInput.type = "button";
  accentColorInput.style.backgroundColor = color;
  accentColorInput.setAttribute("aria-label", "Edit theme color in HEX");
  accentColorInput.title = "Edit HEX color";

  accentColorInput.addEventListener("click", () => {
    accentHexInput.focus();
    accentHexInput.select();
  });

  accentHexInput = document.createElement("input");
  accentHexInput.type = "text";
  accentHexInput.className = "accent-hex-input";
  accentHexInput.value = color;
  accentHexInput.maxLength = 7;
  accentHexInput.pattern = "#[0-9a-fA-F]{6}";
  accentHexInput.setAttribute("aria-label", "Theme color HEX");
  accentHexInput.spellcheck = false;
  accentHexInput.addEventListener("input", () => {
    const valid = HEX_COLOR_PATTERN.test(accentHexInput.value);
    accentHexInput.setCustomValidity(valid ? "" : "Enter a HEX color such as #43af49");
    if (valid) {
      accentColorInput.style.backgroundColor = applyAccentColor(accentHexInput.value);
    }
  });
  accentHexInput.addEventListener("change", async () => {
    if (accentHexInput.checkValidity()) {
      await chrome.storage.local.set({ [ACCENT_COLOR_STORAGE_KEY]: applyAccentColor(accentHexInput.value) });
    }
  });
  label.append(text, accentHexInput, accentColorInput);

  const firstSetting = toolsMenu.querySelector(".tool-toggle");
  if (firstSetting) {
    toolsMenu.insertBefore(label, firstSetting);
  } else {
    toolsMenu.append(label);
  }
}

async function initializeAccentColor() {
  const stored = await chrome.storage.local.get(ACCENT_COLOR_STORAGE_KEY);
  const color = applyAccentColor(stored[ACCENT_COLOR_STORAGE_KEY]);
  createAccentColorSetting(color);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[ACCENT_COLOR_STORAGE_KEY]) {
    return;
  }

  const color = applyAccentColor(changes[ACCENT_COLOR_STORAGE_KEY].newValue);
  if (accentColorInput) {
    accentColorInput.style.backgroundColor = color;
    accentHexInput.value = color;
    accentHexInput.setCustomValidity("");
  }
});

void initializeAccentColor();
