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

  const label = document.createElement("label");
  label.className = "tool-button accent-color-setting";
  label.title = "Choose the viewer accent color";

  const text = document.createElement("span");
  text.textContent = "Theme color";

  accentColorInput = document.createElement("input");
  accentColorInput.id = "theme-accent-color";
  accentColorInput.className = "accent-color-input";
  accentColorInput.type = "color";
  accentColorInput.value = color;
  accentColorInput.setAttribute("aria-label", "Theme color");

  accentColorInput.addEventListener("input", () => {
    applyAccentColor(accentColorInput.value);
  });

  accentColorInput.addEventListener("change", async () => {
    const nextColor = applyAccentColor(accentColorInput.value);
    await chrome.storage.local.set({ [ACCENT_COLOR_STORAGE_KEY]: nextColor });
  });

  label.append(text, accentColorInput);

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
    accentColorInput.value = color;
  }
});

void initializeAccentColor();
