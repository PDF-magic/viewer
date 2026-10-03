import { pdfDocumentSessionReady } from "./pdf-document-session.js";

const PDF_MAGIC_SOURCE_KEY = "PDFMagicSourceURL";

function normalizedUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return new URL(value.trim()).href;
  } catch {
    return null;
  }
}

export function referenceUrlFromPdfMetadata(info, metadata) {
  const candidates = [
    info?.Custom?.[PDF_MAGIC_SOURCE_KEY],
    info?.[PDF_MAGIC_SOURCE_KEY],
    metadata?.get?.("pdfmagic:sourceurl"),
    metadata?.get?.(PDF_MAGIC_SOURCE_KEY),
  ];

  for (const candidate of candidates) {
    const url = normalizedUrl(candidate);
    if (url) return url;
  }
  return null;
}

async function metadataReferenceUrl() {
  const session = await pdfDocumentSessionReady;
  if (!session?.document) return null;

  try {
    const { info, metadata } = await session.document.getMetadata();
    return referenceUrlFromPdfMetadata(info, metadata);
  } catch {
    return null;
  }
}

async function runtimeOriginalUrl() {
  if (globalThis.chrome?.mimeHandler?.getStreamInfo) {
    try {
      const streamInfo = await chrome.mimeHandler.getStreamInfo();
      const originalUrl = normalizedUrl(streamInfo?.originalUrl);
      if (originalUrl) return originalUrl;
    } catch {
      // Fall through to an explicit viewer URL.
    }
  }

  const explicitSource = new URLSearchParams(window.location.search).get("url");
  return normalizedUrl(explicitSource);
}

export async function resolveDocumentReferenceUrl() {
  return (await metadataReferenceUrl()) || (await runtimeOriginalUrl());
}
