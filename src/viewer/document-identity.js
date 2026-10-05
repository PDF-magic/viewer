import { formatMetadataDate, formatRelativeMetadataDate } from "./metadata-date.js";

const RELATIVE_DATES_KEY = "pdf-viewer-relative-dates";
const relativeDatesToggle = document.querySelector("#relative-metadata-dates");
let relativeDates = localStorage.getItem(RELATIVE_DATES_KEY) === "true";
const originalDates = new WeakMap();

const params = new URLSearchParams(window.location.search);
const explicitSource = params.get("url");

function fileNameFromUrl(value) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    const encodedName = url.pathname.split("/").filter(Boolean).pop();
    if (!encodedName) {
      return null;
    }

    let fileName = decodeURIComponent(encodedName);
    if (!fileName.toLowerCase().endsWith(".pdf")) {
      fileName += ".pdf";
    }

    return fileName;
  } catch {
    return null;
  }
}

async function resolveOriginalUrl() {
  if (chrome.mimeHandler?.getStreamInfo) {
    try {
      const streamInfo = await chrome.mimeHandler.getStreamInfo();
      if (streamInfo?.originalUrl) {
        return streamInfo.originalUrl;
      }
    } catch {
      // Fall through to the explicit viewer URL when MIME stream info is unavailable.
    }
  }

  return explicitSource;
}

function formatVisibleMetadataDates() {
  const metadataList = document.querySelector("#section-metadata-list");
  if (!metadataList) {
    return;
  }

  for (const row of metadataList.querySelectorAll(".section-metadata-row")) {
    const label = row.querySelector("dt")?.textContent?.trim();
    if (label !== "Created" && label !== "Modified") {
      continue;
    }

    const description = row.querySelector("dd");
    if (!description) {
      continue;
    }

    if (!originalDates.has(description)) {
      originalDates.set(description, description.textContent);
    }
    const original = originalDates.get(description);
    const formatted = relativeDates
      ? formatRelativeMetadataDate(original)
      : formatMetadataDate(original);
    description.title = formatMetadataDate(original);
    if (formatted !== description.textContent) {
      description.textContent = formatted;
    }
  }
}

if (relativeDatesToggle) {
  relativeDatesToggle.checked = relativeDates;
  relativeDatesToggle.addEventListener("change", () => {
    relativeDates = relativeDatesToggle.checked;
    localStorage.setItem(RELATIVE_DATES_KEY, String(relativeDates));
    formatVisibleMetadataDates();
  });
}

window.addEventListener("storage", (event) => {
  if (event.key === RELATIVE_DATES_KEY) {
    relativeDates = event.newValue === "true";
    if (relativeDatesToggle) relativeDatesToggle.checked = relativeDates;
    formatVisibleMetadataDates();
  }
});
setInterval(() => {
  if (relativeDates && !document.hidden) formatVisibleMetadataDates();
}, 60_000);

const metadataList = document.querySelector("#section-metadata-list");
if (metadataList) {
  new MutationObserver(formatVisibleMetadataDates).observe(metadataList, {
    childList: true,
    subtree: true,
  });
  formatVisibleMetadataDates();
}

const fileName = fileNameFromUrl(await resolveOriginalUrl());
if (fileName) {
  document.title = fileName;
}
