const THEME_STORAGE_KEY = "pdf-viewer-theme";
const SEC_COMMENT_DARK_MODE_KEY = "pdf-viewer-sec-comment-dark-mode";
const STUDIO_GREEN = "#43af49";

const toolsMenu = document.querySelector("#tools-menu");

function currentTheme() {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function syncThemePreference() {
  void chrome.storage.local.set({ [THEME_STORAGE_KEY]: currentTheme() });
}

function styleSettingCheckbox(input) {
  input.style.position = "static";
  input.style.width = "16px";
  input.style.height = "16px";
  input.style.margin = "0";
  input.style.opacity = "1";
  input.style.pointerEvents = "auto";
  input.style.accentColor = STUDIO_GREEN;
  input.style.cursor = "pointer";

  const customSwitch = input.nextElementSibling;
  if (customSwitch?.classList.contains("toggle-switch")) {
    customSwitch.hidden = true;
  }

  input.closest(".tool-toggle")?.classList.add("tool-button");
}

async function addSecCommentSetting() {
  if (!toolsMenu) {
    return;
  }

  const stored = await chrome.storage.local.get(SEC_COMMENT_DARK_MODE_KEY);
  const preserveImageColorsToggle = toolsMenu.querySelector("#preserve-image-colors");
  let enabled = stored[SEC_COMMENT_DARK_MODE_KEY] !== false;

  if (preserveImageColorsToggle instanceof HTMLInputElement) {
    styleSettingCheckbox(preserveImageColorsToggle);
  }

  const label = document.createElement("label");
  label.className = "tool-button tool-toggle";
  label.title = "Darken SEC HTML comments when the viewer uses dark mode";

  const text = document.createElement("span");
  text.textContent = "Darken SEC HTML comments";

  const input = document.createElement("input");
  input.id = "sec-comment-dark-mode";
  input.className = "toggle-input";
  input.type = "checkbox";
  input.checked = enabled;
  input.setAttribute("aria-label", text.textContent);
  styleSettingCheckbox(input);

  input.addEventListener("change", async () => {
    enabled = input.checked;
    await chrome.storage.local.set({ [SEC_COMMENT_DARK_MODE_KEY]: enabled });
  });

  label.append(text, input);

  if (!preserveImageColorsToggle) {
    const separator = document.createElement("div");
    separator.className = "menu-separator";
    separator.setAttribute("role", "separator");
    toolsMenu.append(separator);
  }

  toolsMenu.append(label);
}

const themeObserver = new MutationObserver((mutations) => {
  if (mutations.some((mutation) => mutation.attributeName === "data-theme")) {
    syncThemePreference();
  }
});

themeObserver.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["data-theme"],
});

syncThemePreference();
void addSecCommentSetting();

const TOOLBAR_HEIGHT = 52;
const PAGE_HORIZONTAL_GUTTER = 32;
const PAGE_VERTICAL_GUTTER = 48;
const DEFAULT_MAX_PAGE_WIDTH = 1100;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.1;

let zoomMode = "custom";
let zoomScale = 1;
let zoomRenderTimer;
let zoomResizeTimer;

function addZoomStyles() {
  const style = document.createElement("style");
  style.textContent = `
    .zoom-control {
      display: flex;
      flex: 0 0 auto;
      align-items: center;
      height: 34px;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--control-bg);
      color: var(--text);
    }

    .zoom-button,
    .zoom-level {
      height: 32px;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--text);
      cursor: pointer;
    }

    .zoom-button {
      width: 34px;
      font-size: 18px;
      line-height: 1;
    }

    .zoom-level {
      width: 46px;
      color: var(--muted);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      cursor: default;
    }

    .fit-height-button,
    .fit-width-button {
      width: 36px;
    }

    .fit-height-button {
      border-right: 1px solid var(--border);
    }

    .fit-width-button {
      border-left: 1px solid var(--border);
    }

    .fit-icon {
      width: 19px;
      height: 19px;
      vertical-align: middle;
    }

    .zoom-button:hover:not(:disabled),
    .fit-height-button[aria-pressed="true"],
    .fit-width-button[aria-pressed="true"] {
      background: var(--control-hover);
      color: var(--text);
    }

    .zoom-button:disabled,
    .zoom-level:disabled {
      cursor: default;
      opacity: 0.45;
    }

    .zoom-button:focus-visible,
    .zoom-level:focus-visible {
      position: relative;
      z-index: 1;
      outline: 2px solid var(--search-focus-border);
      outline-offset: -2px;
    }

    .viewer {
      width: max-content;
      min-width: 100%;
    }

    .page {
      flex: 0 0 auto;
      width: var(--page-width, min(1100px, calc(100vw - 32px)));
      max-width: none;
    }

    @media (max-width: 720px) {
      .zoom-button {
        width: 30px;
      }

      .fit-height-button,
      .fit-width-button {
        width: 32px;
      }

      .zoom-level {
        width: 42px;
      }
    }

    @media print {
      .viewer {
        width: auto;
        min-width: 0;
      }

      .page {
        width: 100% !important;
      }
    }
  `;
  document.head.append(style);
}

function fitHeightIcon() {
  return `
    <svg class="fit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M7 3h10" />
      <path d="M7 21h10" />
      <path d="M12 6v12" />
      <path d="m9 9 3-3 3 3" />
      <path d="m9 15 3 3 3-3" />
    </svg>
  `;
}

function fitWidthIcon() {
  return `
    <svg class="fit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 7v10" />
      <path d="M21 7v10" />
      <path d="M6 12h12" />
      <path d="m9 9-3 3 3 3" />
      <path d="m15 9 3 3-3 3" />
    </svg>
  `;
}

function createZoomControls() {
  const nextPageButton = document.querySelector("#next-page");
  if (!nextPageButton) {
    return null;
  }

  const control = document.createElement("div");
  control.className = "zoom-control";
  control.setAttribute("role", "group");
  control.setAttribute("aria-label", "Zoom controls");

  const fitHeightButton = document.createElement("button");
  fitHeightButton.id = "fit-height";
  fitHeightButton.className = "zoom-button fit-height-button";
  fitHeightButton.type = "button";
  fitHeightButton.innerHTML = fitHeightIcon();
  fitHeightButton.title = "Fit page height to viewport";
  fitHeightButton.setAttribute("aria-label", "Fit page height to viewport");
  fitHeightButton.setAttribute("aria-pressed", "false");

  const zoomOutButton = document.createElement("button");
  zoomOutButton.id = "zoom-out";
  zoomOutButton.className = "zoom-button";
  zoomOutButton.type = "button";
  zoomOutButton.textContent = "−";
  zoomOutButton.title = "Zoom out";
  zoomOutButton.setAttribute("aria-label", "Zoom out");

  const zoomLevel = document.createElement("span");
  zoomLevel.id = "zoom-level";
  zoomLevel.className = "zoom-level";
  zoomLevel.textContent = "100%";
  zoomLevel.setAttribute("aria-label", "Zoom 100%");

  const zoomInButton = document.createElement("button");
  zoomInButton.id = "zoom-in";
  zoomInButton.className = "zoom-button";
  zoomInButton.type = "button";
  zoomInButton.textContent = "+";
  zoomInButton.title = "Zoom in";
  zoomInButton.setAttribute("aria-label", "Zoom in");

  const fitWidthButton = document.createElement("button");
  fitWidthButton.id = "fit-width";
  fitWidthButton.className = "zoom-button fit-width-button";
  fitWidthButton.type = "button";
  fitWidthButton.innerHTML = fitWidthIcon();
  fitWidthButton.title = "Fit page width to viewport";
  fitWidthButton.setAttribute("aria-label", "Fit page width to viewport");
  fitWidthButton.setAttribute("aria-pressed", "false");

  control.append(
    fitHeightButton,
    zoomOutButton,
    zoomLevel,
    zoomInButton,
    fitWidthButton,
  );
  nextPageButton.insertAdjacentElement("afterend", control);

  return {
    control,
    fitHeightButton,
    zoomOutButton,
    zoomLevel,
    zoomInButton,
    fitWidthButton,
  };
}

function fitWidthBase() {
  return Math.max(
    160,
    Math.min(DEFAULT_MAX_PAGE_WIDTH, window.innerWidth - PAGE_HORIZONTAL_GUTTER),
  );
}

function viewportPageWidth() {
  const root = document.documentElement;
  const minimapShell = document.querySelector("#minimap-shell");
  const minimapWidth =
    !root.classList.contains("minimap-disabled") &&
    !root.classList.contains("minimap-collapsed")
      ? minimapShell?.getBoundingClientRect().width || 0
      : 0;

  return Math.max(160, window.innerWidth - minimapWidth - PAGE_HORIZONTAL_GUTTER);
}

function viewportPageHeight() {
  return Math.max(160, window.innerHeight - TOOLBAR_HEIGHT - PAGE_VERTICAL_GUTTER);
}

function pageRatio(pageElement) {
  const rect = pageElement.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    return rect.width / rect.height;
  }

  const [width, height] = getComputedStyle(pageElement)
    .aspectRatio.split("/")
    .map((value) => Number.parseFloat(value.trim()));

  if (Number.isFinite(width) && Number.isFinite(height) && height > 0) {
    return width / height;
  }

  return 8.5 / 11;
}

function targetPageWidth(pageElement) {
  const baseWidth = fitWidthBase();

  if (zoomMode === "fit-height") {
    return viewportPageHeight() * pageRatio(pageElement);
  }

  if (zoomMode === "custom") {
    return baseWidth * zoomScale;
  }

  return viewportPageWidth();
}

function applyPageZoom(pageElement) {
  pageElement.style.setProperty("--page-width", `${Math.max(160, targetPageWidth(pageElement))}px`);
}

function applyZoomLayout() {
  for (const pageElement of document.querySelectorAll(".page")) {
    applyPageZoom(pageElement);
  }
}

function currentRelativeScale() {
  const currentPage = document.querySelector(".page[aria-label='Page " + document.querySelector("#page-number")?.value + "']")
    || document.querySelector(".page");

  if (!currentPage) {
    return zoomMode === "custom" ? zoomScale : 1;
  }

  return currentPage.getBoundingClientRect().width / fitWidthBase();
}

const zoomControls = createZoomControls();

function syncZoomControls() {
  if (!zoomControls) {
    return;
  }

  const scale = Math.max(0, currentRelativeScale());
  const percentage = Math.round(scale * 100);

  zoomControls.zoomLevel.textContent = `${percentage}%`;
  zoomControls.zoomLevel.setAttribute("aria-label", `Zoom ${percentage}%`);
  zoomControls.zoomOutButton.disabled = scale <= MIN_ZOOM + 0.001;
  zoomControls.zoomInButton.disabled = scale >= MAX_ZOOM - 0.001;
  zoomControls.fitHeightButton.setAttribute("aria-pressed", String(zoomMode === "fit-height"));
  zoomControls.fitWidthButton.setAttribute("aria-pressed", String(zoomMode === "fit-width"));
}

function forceViewerRerender() {
  const page = document.querySelector(".page");
  const rotateRightButton = document.querySelector("#rotate-right");
  const rotateLeftButton = document.querySelector("#rotate-left");

  if (!page || !rotateRightButton || !rotateLeftButton) {
    return;
  }

  rotateRightButton.click();
  rotateLeftButton.click();
}

function scheduleViewerRerender() {
  clearTimeout(zoomRenderTimer);
  zoomRenderTimer = setTimeout(() => {
    forceViewerRerender();
    requestAnimationFrame(syncZoomControls);
  }, 80);
}

function setCustomZoom(scale) {
  zoomMode = "custom";
  zoomScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
  applyZoomLayout();
  syncZoomControls();
  scheduleViewerRerender();
}

function zoomBy(delta) {
  const currentScale = zoomMode === "custom" ? zoomScale : currentRelativeScale();
  const nextScale = Math.round((currentScale + delta) * 10) / 10;
  setCustomZoom(nextScale);
}

function fitWidth() {
  zoomMode = "fit-width";
  zoomScale = 1;
  applyZoomLayout();
  syncZoomControls();
  scheduleViewerRerender();
}

function fitHeight() {
  zoomMode = "fit-height";
  applyZoomLayout();
  syncZoomControls();
  scheduleViewerRerender();
}

if (zoomControls) {
  addZoomStyles();
  zoomControls.fitHeightButton.addEventListener("click", fitHeight);
  zoomControls.zoomOutButton.addEventListener("click", () => zoomBy(-ZOOM_STEP));
  zoomControls.zoomInButton.addEventListener("click", () => zoomBy(ZOOM_STEP));
  zoomControls.fitWidthButton.addEventListener("click", fitWidth);

  document.addEventListener(
    "keydown",
    (event) => {
      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }

      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        event.stopPropagation();
        zoomBy(ZOOM_STEP);
      } else if (event.key === "-") {
        event.preventDefault();
        event.stopPropagation();
        zoomBy(-ZOOM_STEP);
      } else if (event.key === "0") {
        event.preventDefault();
        event.stopPropagation();
        fitWidth();
      }
    },
    true,
  );

  const viewer = document.querySelector("#viewer");
  if (viewer) {
    const pageObserver = new MutationObserver((mutations) => {
      let addedPage = false;

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement && node.matches(".page")) {
            applyPageZoom(node);
            addedPage = true;
          }
        }
      }

      if (addedPage) {
        requestAnimationFrame(syncZoomControls);
      }
    });

    pageObserver.observe(viewer, { childList: true });
  }

  window.addEventListener("resize", () => {
    clearTimeout(zoomResizeTimer);
    zoomResizeTimer = setTimeout(() => {
      applyZoomLayout();
      syncZoomControls();
      scheduleViewerRerender();
    }, 120);
  });

  applyZoomLayout();
  syncZoomControls();
}
