const serviceWorkerPath = chrome.runtime.getManifest().background?.service_worker || "";
const sourcePrefix = serviceWorkerPath.startsWith("src/") ? "src/" : "";
const VIEWER_URL = chrome.runtime.getURL(`${sourcePrefix}viewer.html`);
const hasMimeHandler = Boolean(chrome.mimeHandler);

function isViewerUrl(url) {
  return typeof url === "string" && url.startsWith(VIEWER_URL);
}

function isLikelyPdfUrl(url) {
  if (!url || isViewerUrl(url)) {
    return false;
  }

  try {
    return /\.pdf$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function viewerUrlFor(pdfUrl) {
  return `${VIEWER_URL}?url=${encodeURIComponent(pdfUrl)}`;
}

async function openInViewer(tabId, pdfUrl) {
  if (tabId < 0 || !pdfUrl || isViewerUrl(pdfUrl)) {
    return;
  }

  try {
    await chrome.tabs.update(tabId, { url: viewerUrlFor(pdfUrl) });
  } catch {
    // The tab may have closed or navigated before the redirect completed.
  }
}

if (!hasMimeHandler) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (isLikelyPdfUrl(changeInfo.url)) {
      void openInViewer(tabId, changeInfo.url);
    }
  });

  chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
      if (details.tabId < 0 || isViewerUrl(details.url)) {
        return;
      }

      const contentType = details.responseHeaders?.find(
        (header) => header.name.toLowerCase() === "content-type",
      )?.value;

      if (contentType?.toLowerCase().includes("application/pdf")) {
        void openInViewer(details.tabId, details.url);
      }
    },
    { urls: ["<all_urls>"], types: ["main_frame"] },
    ["responseHeaders"],
  );
}

chrome.action.onClicked.addListener((tab) => {
  if (!hasMimeHandler && tab.id != null && isLikelyPdfUrl(tab.url)) {
    void openInViewer(tab.id, tab.url);
  }
});


// Relay one explicit PDF-summary request at a time, without storage quotas or
// exposing extension-private PDF bytes to a web page.
const pdfSummaryTransfers = new Map();
chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith("pdf-summary-")) return;
  const match = /^pdf-summary-(source|target):([0-9a-f-]{36})$/.exec(port.name);
  let origin;
  let protocol;
  let hostname;
  let pathname;
  let hash;
  try {
    const sender = new URL(port.sender?.url || port.sender?.tab?.url);
    origin = sender.origin;
    protocol = sender.protocol;
    hostname = sender.hostname;
    pathname = sender.pathname;
    hash = sender.hash;
  } catch { /* Reject invalid origins. */ }
  const allowed = match && (
    (match[1] === "source" &&
      protocol === "chrome-extension:" && hostname === chrome.runtime.id &&
      ["/src/viewer.html", "/viewer.html"].includes(pathname)) ||
    (match[1] === "target" && origin === "https://chatgpt.com" &&
      new URLSearchParams((hash || "").slice(1)).get("pdf-viewer-summary") === match[2])
  );
  if (!allowed) {
    port.disconnect();
    return;
  }
  const [, role, id] = match;
  const transfer = pdfSummaryTransfers.get(id) || { source: null, target: null, finished: false };
  if (transfer[role]) {
    port.disconnect();
    return;
  }
  transfer[role] = port;
  pdfSummaryTransfers.set(id, transfer);
  port.onMessage.addListener((message) => {
    if (!message || typeof message.type !== "string") return;
    const other = transfer[role === "source" ? "target" : "source"];
    if (role === "source" && ["begin", "chunk", "end", "error"].includes(message.type)) {
      other?.postMessage(message);
    } else if (role === "target" && ["ack", "finish", "cancel"].includes(message.type)) {
      if (message.type === "finish" || message.type === "cancel") transfer.finished = true;
      other?.postMessage(message);
    }
  });
  port.onDisconnect.addListener(() => {
    if (transfer[role] !== port) return;
    transfer[role] = null;
    if (!transfer.finished) {
      transfer.finished = true;
      try {
        transfer[role === "source" ? "target" : "source"]?.postMessage({
          type: "error", message: "PDF summary transfer interrupted",
        });
      } catch { /* Other endpoint already closed. */ }
    }
    if (!transfer.source && !transfer.target) pdfSummaryTransfers.delete(id);
  });
  if (transfer.source && transfer.target) {
    transfer.source.postMessage({ type: "start" });
  }
});

// The recovery helper is a classic worker script in both source and built layouts.
if (typeof importScripts === "function") {
  importScripts(chrome.runtime.getURL(sourcePrefix + "background/pdf-tab-recovery.js"));
}
