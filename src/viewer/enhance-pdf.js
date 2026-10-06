import { resolveDocumentReferenceUrl } from "./document-reference-url.js";
import { resolvePdfSource } from "./pdf-source.js";
import { pdfDocumentSessionReady } from "./pdf-document-session.js";

const NATIVE_HOST = "org.pdfmagic.enhancer";
const enhanceNav = document.querySelector("#enhance-nav");
const enhanceButton = document.querySelector("#enhance-pdf");
const installLink = document.querySelector("#install-enhancer");
const sectionNav = document.querySelector("#section-nav");
const pageNumberInput = document.querySelector("#page-number");
const toast = document.querySelector("#toast");
const progressContainer = document.querySelector("#enhance-progress");
const progressBar = document.querySelector("#enhance-progress-bar");
const progressLabel = document.querySelector("#enhance-progress-label");
const progressPercentage = document.querySelector("#enhance-progress-percentage");
const defaultTitle = enhanceButton.title;
let titleResetTimer;
let toastTimer;

const BORN_DIGITAL_SOURCE = /(?:microsoft(?:®)? word|libreoffice|google docs|apple pages|\bpages\b|latex|\btex\b|prince|weasyprint|wkhtmltopdf|chrom(?:e|ium)|pdfkit|reportlab)/i;

async function enhancementModeFor(pdfDocument) {
  try {
    const metadata = await pdfDocument?.getMetadata?.();
    const info = metadata?.info || {};
    const source = [info.Creator, info.Producer]
      .filter((value) => typeof value === "string")
      .join(" ");
    if (!BORN_DIGITAL_SOURCE.test(source) || typeof pdfDocument?.getPage !== "function") {
      return "deep";
    }

    const pageCount = Number(pdfDocument.numPages);
    if (!Number.isInteger(pageCount) || pageCount < 1) return "deep";
    const samplePages = [...new Set([1, Math.ceil(pageCount / 2), pageCount])];
    let characters = 0;
    for (const pageNumber of samplePages) {
      const page = await pdfDocument.getPage(pageNumber);
      const textContent = await page.getTextContent();
      for (const item of textContent?.items || []) {
        if (typeof item?.str === "string") {
          characters += item.str.replace(/\s/g, "").length;
        }
      }
    }

    const minimumCharacters = samplePages.length === 1 ? 40 : 80;
    return characters >= minimumCharacters ? "light" : "deep";
  } catch {
    return "deep";
  }
}

function updateEnhancementProgress(stage, completed, total) {
  progressContainer.hidden = false;
  document.documentElement.classList.add("enhancement-active");
  const labels = {
    preparing: "Preparing enhancement…",
    upload: "Sending PDF for enhancement…",
    ocr: "Checking text and structure…",
    review: "Enhancing…",
    finalizing: "Building sections and saving PDF…",
    complete: "Enhanced PDF ready",
  };
  let label = labels[stage] || labels.preparing;
  if (Number.isFinite(completed) && Number.isFinite(total) && total > 0) {
    const percentage = Math.round(Math.min(1, Math.max(0, completed / total)) * 100);
    progressBar.value = percentage;
    progressContainer.style.setProperty("--enhance-progress-position", `${percentage}%`);
    progressPercentage.textContent = `${percentage}%`;
    progressPercentage.hidden = false;
    label = stage === "review"
      ? `Enhancing · ${completed} of ${total} pages`
      : label;
  } else {
    progressBar.removeAttribute("value");
    progressPercentage.hidden = true;
  }
  progressLabel.textContent = label;
}

async function enhanceLoadedPdf(sourceUrl, referenceUrl) {
  const port = chrome.runtime.connectNative(NATIVE_HOST);
  let pending;
  let disconnected = false;
  let disconnectMessage;
  port.onMessage.addListener((response) => {
    if (response?.type === "progress") {
      updateEnhancementProgress(response.stage, response.completed, response.total);
      return;
    }
    const request = pending;
    pending = null;
    if (!response?.ok) {
      request?.reject(new Error(response?.error || "PDF enhancer failed"));
    } else {
      request?.resolve(response);
    }
  });
  port.onDisconnect.addListener(() => {
    disconnected = true;
    disconnectMessage = chrome.runtime.lastError?.message || "PDF enhancer disconnected";
    pending?.reject(new Error(disconnectMessage));
    pending = null;
  });
  function request(message) {
    if (disconnected) return Promise.reject(new Error(disconnectMessage));
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      try {
        port.postMessage(message);
      } catch (error) {
        pending = null;
        reject(error);
      }
    });
  }
  try {
    const session = await pdfDocumentSessionReady;
    const pdfDocument = session?.document;
    const enhancementMode = await enhancementModeFor(pdfDocument);
    if (new URL(sourceUrl).protocol === "file:") {
      return await request({ action: "enhance-pdf", sourceUrl, referenceUrl, enhancementMode, progress: true });
    }
    if (!pdfDocument) throw new Error("PDF has not finished loading");
    const data = await pdfDocument.getData();
    updateEnhancementProgress("upload", 0, data.length);
    await request({ action: "enhance-pdf-start", sourceUrl, referenceUrl, byteLength: data.length, enhancementMode, progress: true });
    // Acknowledge each chunk so large PDFs do not fill the native-message queue.
    const chunkSize = 256 * 1024;
    for (let offset = 0; offset < data.length; offset += chunkSize) {
      const chunk = data.subarray(offset, offset + chunkSize);
      let binary = "";
      for (let index = 0; index < chunk.length; index += 8192) {
        binary += String.fromCharCode(...chunk.subarray(index, index + 8192));
      }
      await request({ action: "enhance-pdf-chunk", data: btoa(binary) });
      updateEnhancementProgress("upload", Math.min(offset + chunkSize, data.length), data.length);
    }
    updateEnhancementProgress("ocr");
    return await request({ action: "enhance-pdf-finish" });
  } finally {
    port.disconnect();
  }
}

function syncEnhancerSlot() {
  enhanceNav.hidden = !sectionNav.hidden;
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("visible");
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2600);
}

function showTemporaryTitle(title) {
  clearTimeout(titleResetTimer);
  enhanceButton.title = title;
  enhanceButton.setAttribute("aria-label", title);
  titleResetTimer = setTimeout(() => {
    enhanceButton.title = defaultTitle;
    enhanceButton.setAttribute("aria-label", defaultTitle);
  }, 2200);
}

async function replaceCurrentTab(outputUrl) {
  const destination = new URL(window.location.href);
  destination.search = "";
  destination.hash = "";
  destination.searchParams.set("url", outputUrl);
  const pageNumber = Number.parseInt(pageNumberInput?.value || "", 10);
  if (Number.isFinite(pageNumber) && pageNumber > 1) {
    destination.hash = `page=${pageNumber}`;
  }

  const tab = await chrome.tabs.getCurrent();
  if (tab?.id != null) {
    await chrome.tabs.update(tab.id, { url: destination.href });
    return;
  }

  window.location.replace(destination.href);
}

async function enhanceCurrentPdf() {
  enhanceButton.disabled = true;
  enhanceButton.title = "Enhancing PDF…";
  enhanceButton.setAttribute("aria-label", enhanceButton.title);
  showToast("Enhancing PDF…");
  updateEnhancementProgress("preparing");

  try {
    const [source, referenceUrl] = await Promise.all([
      resolvePdfSource(),
      resolveDocumentReferenceUrl(),
    ]);

    if (!source?.originalUrl?.href || !referenceUrl) {
      throw new Error("PDF source URL unavailable");
    }

    const response = await enhanceLoadedPdf(source.originalUrl.href, referenceUrl);

    if (!response?.ok || !response.outputUrl) {
      throw new Error(response?.error || "PDF enhancer did not return a local copy");
    }

    showToast("Enhanced PDF ready");
    updateEnhancementProgress("complete", 1, 1);
    await replaceCurrentTab(response.outputUrl);
  } catch (error) {
    const message = error?.message || "Could not enhance PDF";
    showToast(message);
    if (/native.*(?:host|messag)|host.*(?:not found|not configured)/i.test(message)) {
      enhanceButton.hidden = true;
      installLink.hidden = false;
    } else {
      showTemporaryTitle("Could not enhance PDF");
    }
  } finally {
    progressContainer.hidden = true;
    document.documentElement.classList.remove("enhancement-active");
    enhanceButton.disabled = false;
    if (enhanceButton.title === "Enhancing PDF…") {
      enhanceButton.title = defaultTitle;
      enhanceButton.setAttribute("aria-label", defaultTitle);
    }
  }
}

new MutationObserver(syncEnhancerSlot).observe(sectionNav, {
  attributes: true,
  attributeFilter: ["hidden"],
});
syncEnhancerSlot();

enhanceButton.addEventListener("click", () => void enhanceCurrentPdf());
