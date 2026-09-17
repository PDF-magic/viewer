import { formatMetadataDate } from "./metadata-date.js";

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

    const formatted = formatMetadataDate(description.textContent);
    if (formatted !== description.textContent) {
      description.textContent = formatted;
    }
  }
}

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
