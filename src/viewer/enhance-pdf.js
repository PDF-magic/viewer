import { resolveDocumentReferenceUrl } from "./document-reference-url.js";
import { resolvePdfSource } from "./pdf-source.js";
import { pdfDocumentSessionReady } from "./pdf-document-session.js";
import { downloadSetupZip } from "./enhancer-setup-download.js";

const NATIVE_HOST = "org.pdfmagic.enhancer";
const enhanceNav = document.querySelector("#enhance-nav");
const enhanceButton = document.querySelector("#enhance-pdf");
const sectionEnhanceButton = document.querySelector("#section-enhance-pdf");
const sectionPopover = document.querySelector("#section-popover");
const sectionToggle = document.querySelector("#section-toggle");
const enhanceButtons = [enhanceButton, sectionEnhanceButton];
const setupDialog = document.querySelector("#enhancer-setup-dialog");
const setupForm = document.querySelector("#enhancer-setup-form");
const setupRepository = document.querySelector("#enhancer-repository-url");
const setupCheckout = document.querySelector("#enhancer-checkout-path");
const setupStatus = document.querySelector("#enhancer-setup-status");
const setupMenuButton = document.querySelector("#open-enhancer-setup");
const SETUP_PREF_KEY = "pdfmagic-enhancer-setup";
const MODEL_PREF_KEY = "pdfmagic-enhancer-models";
const modelPopover = document.querySelector("#enhancer-model-popover");
const modelForm = document.querySelector("#enhancer-model-form");
const extractModel = document.querySelector("#enhancer-extract-model");
const reviewModel = document.querySelector("#enhancer-review-model");
const modelStatus = document.querySelector("#enhancer-model-status");
const modelStart = document.querySelector("#enhancer-model-start");
const modelRefresh = document.querySelector("#enhancer-model-refresh");
const modelDownload = document.querySelector("#enhancer-model-download");
const modelName = document.querySelector("#enhancer-model-name");
let installedModels = [];
let modelsBusy = false;
let preferredModels = {};
const sectionNav = document.querySelector("#section-nav");
const pageNumberInput = document.querySelector("#page-number");
const toast = document.querySelector("#toast");
const progressContainer = document.querySelector("#enhance-progress");
const progressBar = document.querySelector("#enhance-progress-bar");
const progressLabel = document.querySelector("#enhance-progress-label");
const progressPercentage = document.querySelector("#enhance-progress-percentage");
const errorNotice = document.querySelector("#enhance-error-notice");
const errorMessage = document.querySelector("#enhance-error-message");
const copyErrorButton = document.querySelector("#enhance-copy-error");
const dismissErrorButton = document.querySelector("#enhance-dismiss-error");
const saveNotice = document.querySelector("#enhance-save-notice");
const saveMessage = document.querySelector("#enhance-save-message");
const saveCopyButton = document.querySelector("#enhance-save-copy");
const defaultTitle = enhanceButton.title;
let titleResetTimer;
let toastTimer;
let lastEnhancementStage = "preparing";
let pendingSave;

function isMissingNativeHost(message) {
  return /native.*(?:host|messag)|host.*(?:not found|not configured)|enhancer script not found|enhancer-host[.]json|native.*exited/i.test(message);
}

async function offerEnhancerSetup() {
  setupStatus.textContent = "";
  try {
    const preferences = (await chrome.storage.local.get(SETUP_PREF_KEY))[SETUP_PREF_KEY] || {};
    setupRepository.value = preferences.repositoryUrl || "https://github.com/PDF-magic/enhancer";
    setupCheckout.value = preferences.checkoutPath || "";
  } catch {
    setupRepository.value = "https://github.com/PDF-magic/enhancer";
    setupCheckout.value = "";
  }
  if (!setupDialog.open) setupDialog.showModal();
}

document.querySelector("#enhancer-setup-close").addEventListener("click", () => setupDialog.close());
setupDialog.addEventListener("click", (event) => {
  if (event.target === setupDialog) setupDialog.close();
});
setupMenuButton.addEventListener("click", () => {
  document.querySelector("#tools-menu").hidden = true;
  document.querySelector("#tools-button").setAttribute("aria-expanded", "false");
  void offerEnhancerSetup();
});
setupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const repositoryUrl = setupRepository.value.trim();
  const checkoutPath = setupCheckout.value.trim();
  setupStatus.textContent = "";
  try {
    downloadSetupZip({ extensionId: chrome.runtime.id, repositoryUrl, checkoutPath });
    await chrome.storage.local.set({
      [SETUP_PREF_KEY]: { repositoryUrl, checkoutPath },
    });
    setupStatus.textContent = "Setup ZIP requested. Extract it and open Install PDF Magic.command, then try Enhance again.";
  } catch (error) {
    setupStatus.textContent = error?.message || "Could not prepare PDF Enhancer setup";
  }
});


function updateEnhancementProgress(stage, completed, total) {
  lastEnhancementStage = stage;
  progressContainer.hidden = false;
  document.documentElement.classList.add("enhancement-active");
  const labels = {
    preparing: "Preparing enhancement…",
    queued: "Waiting for another PDF enhancement…",
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

async function enhanceLoadedPdf(sourceUrl, referenceUrl, models) {
  if (new URL(sourceUrl).protocol === "file:") {
    try {
      return await requestEnhancement(sourceUrl, referenceUrl, true, models);
    } catch (error) {
      // macOS can let the browser open a file while denying its native helper
      // access to the same path. Retry with the bytes already in the viewer.
      if (lastEnhancementStage !== "preparing" || !/^\[Errno (?:1|13)\] /.test(error.message)) {
        throw error;
      }
    }
  }
  return await requestEnhancement(sourceUrl, referenceUrl, false, models);
}

async function requestEnhancement(sourceUrl, referenceUrl, useLocalPath, models) {
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
    const enhancementMode = "light";
    if (useLocalPath) {
      return await request({ action: "enhance-pdf", sourceUrl, referenceUrl, enhancementMode, ...models, progress: true });
    }
    const session = await pdfDocumentSessionReady;
    const pdfDocument = session?.document;
    if (!pdfDocument) throw new Error("PDF has not finished loading");
    const data = await pdfDocument.getData();
    updateEnhancementProgress("upload", 0, data.length);
    await request({ action: "enhance-pdf-start", sourceUrl, referenceUrl, byteLength: data.length, enhancementMode, ...models, progress: true });
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

function showEnhancementFailure(message) {
  const stageLabels = {
    preparing: "Preparing the document",
    queued: "Waiting for the enhancer",
    upload: "Sending PDF bytes",
    ocr: "Running OCR",
    review: "Reviewing text",
    finalizing: "Saving the enhanced PDF",
  };
  const stage = stageLabels[lastEnhancementStage] || "Enhancing PDF";
  errorMessage.textContent = `${stage}: ${message}`;
  errorNotice.hidden = false;
}

copyErrorButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(errorMessage.textContent || "PDF enhancement failed");
    showToast("Enhancement error copied");
  } catch {
    showToast("Could not copy enhancement error");
  }
});

dismissErrorButton.addEventListener("click", () => {
  errorNotice.hidden = true;
});

function setEnhanceTitle(title) {
  for (const button of enhanceButtons) {
    button.title = title;
    button.setAttribute("aria-label", title);
  }
}

function showTemporaryTitle(title) {
  clearTimeout(titleResetTimer);
  setEnhanceTitle(title);
  titleResetTimer = setTimeout(() => setEnhanceTitle(defaultTitle), 2200);
}

async function replaceCurrentTab(outputUrl) {
  // MIME-handler tabs retain the original HTTPS URL in the address bar;
  // appending ?url= to that URL would re-request the source from the site.
  const destination = new URL(chrome.runtime.getURL("src/viewer.html"));
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

function waitForSavedCopy(id) {
  return new Promise((resolve, reject) => {
    async function check() {
      try {
        const [item] = await chrome.downloads.search({ id });
        if (!item || item.state === "interrupted") {
          if (item?.error === "USER_CANCELED") resolve(null);
          else reject(new Error(item?.error || "The browser could not save the file"));
        } else if (item.state === "complete") {
          resolve(item.filename);
        } else {
          return;
        }
      } catch (error) {
        reject(error);
      }
      chrome.downloads.onChanged.removeListener(onChanged);
    }
    function onChanged(change) {
      if (change.id === id && change.state) void check();
    }
    chrome.downloads.onChanged.addListener(onChanged);
    void check();
  });
}

saveCopyButton.addEventListener("click", async () => {
  if (!pendingSave || saveCopyButton.disabled) return;
  const { outputUrl, prompt } = pendingSave;
  saveCopyButton.disabled = true;
  saveMessage.textContent = prompt;
  try {
    const filename = decodeURIComponent(new URL(outputUrl).pathname.split("/").pop());
    const id = await chrome.downloads.download({ url: outputUrl, filename, saveAs: true });
    const savedPath = await waitForSavedCopy(id);
    if (!savedPath) return;
    const savedUrl = `file://${savedPath.split("/").map(encodeURIComponent).join("/")}`;
    pendingSave = undefined;
    saveNotice.hidden = true;
    await replaceCurrentTab(savedUrl);
  } catch (error) {
    if (pendingSave) {
      saveMessage.textContent = `${error.message}. ${prompt}`;
    } else {
      showToast("Enhanced copy saved. Open it from the browser’s downloads.");
    }
  } finally {
    saveCopyButton.disabled = false;
  }
});

async function enhanceCurrentPdf(models = {}) {
  if (pendingSave) {
    saveCopyButton.focus();
    return;
  }
  errorNotice.hidden = true;
  for (const button of enhanceButtons) button.disabled = true;
  setEnhanceTitle("Enhancing PDF…");
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

    const original = source.originalUrl;
    const response = await enhanceLoadedPdf(original.href, referenceUrl, models);

    if (!response?.ok || !response.outputUrl) {
      throw new Error(response?.error || "PDF enhancer did not return a local copy");
    }

    if (original.protocol === "file:") {
      const sourceDirectory = new URL(".", original);
      const outputDirectory = new URL(".", response.outputUrl);
      if (decodeURIComponent(sourceDirectory.href) !== decodeURIComponent(outputDirectory.href)) {
        const folder = decodeURIComponent(sourceDirectory.pathname);
        const prompt = `Choose the original PDF’s folder (${folder}) to save the enhanced copy beside it.`;
        pendingSave = { outputUrl: response.outputUrl, prompt };
        saveMessage.textContent = prompt;
        saveNotice.hidden = false;
        return;
      }
    }

    showToast("Enhanced PDF ready");
    updateEnhancementProgress("complete", 1, 1);
    await replaceCurrentTab(response.outputUrl);
  } catch (error) {
    const message = error?.message || "Could not enhance PDF";
    showEnhancementFailure(message);
    showToast("PDF enhancement failed");
    if (isMissingNativeHost(message)) {
      await offerEnhancerSetup();
    } else {
      showTemporaryTitle("Could not enhance PDF");
    }
  } finally {
    progressContainer.hidden = true;
    document.documentElement.classList.remove("enhancement-active");
    for (const button of enhanceButtons) button.disabled = false;
    if (enhanceButton.title === "Enhancing PDF…") {
      setEnhanceTitle(defaultTitle);
    }
  }
}

new MutationObserver(syncEnhancerSlot).observe(sectionNav, {
  attributes: true,
  attributeFilter: ["hidden"],
});
syncEnhancerSlot();

function modelRequest(message, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connectNative(NATIVE_HOST);
    let settled = false;
    function finish(callback, value) {
      if (settled) return;
      settled = true;
      callback(value);
      port.disconnect();
    }
    port.onMessage.addListener((response) => {
      if (response?.type === "model-progress") {
        onProgress(response);
        return;
      }
      if (response?.ok) finish(resolve, response);
      else finish(reject, new Error(response?.error || "Ollama request failed"));
    });
    port.onDisconnect.addListener(() => {
      if (!settled) finish(reject, new Error(chrome.runtime.lastError?.message || "PDF enhancer disconnected"));
    });
    try {
      port.postMessage(message);
    } catch (error) {
      finish(reject, error);
    }
  });
}

function syncModelControls() {
  extractModel.disabled = reviewModel.disabled = modelRefresh.disabled = modelDownload.disabled = modelName.disabled = modelsBusy;
  modelStart.disabled = modelsBusy || !installedModels.includes(extractModel.value) || !installedModels.includes(reviewModel.value);
}

function fillModelSelect(select, wanted) {
  const placeholder = installedModels.includes(wanted) ? "Choose a model" : (wanted ? `Not installed: ${wanted}` : "Choose a model");
  select.replaceChildren(new Option(placeholder, ""), ...installedModels.map(name => new Option(name, name)));
  select.value = installedModels.includes(wanted) ? wanted : "";
}

async function refreshModels() {
  if (modelsBusy) return;
  const previous = { extractModel: extractModel.value, reviewModel: reviewModel.value };
  modelsBusy = true;
  syncModelControls();
  modelStatus.textContent = "Detecting installed Ollama models…";
  try {
    const result = await modelRequest({ action: "list-ollama-models" });
    installedModels = Array.isArray(result.models) ? result.models.filter(name => typeof name === "string") : [];
    fillModelSelect(extractModel, previous.extractModel || preferredModels.extractModel || result.defaultExtractModel);
    fillModelSelect(reviewModel, previous.reviewModel || preferredModels.reviewModel || result.defaultReviewModel);
    modelStatus.textContent = installedModels.length
      ? `${installedModels.length} installed model(s). Choose image-capable models for OCR.`
      : "No Ollama models found. Download a model below.";
  } catch (error) {
    installedModels = [];
    fillModelSelect(extractModel, "");
    fillModelSelect(reviewModel, "");
    const message = error?.message || "Unable to detect Ollama models";
    modelStatus.textContent = `${message}. Make sure Ollama is running, then refresh.`;
    if (isMissingNativeHost(message)) {
      modelPopover.hidePopover();
      await offerEnhancerSetup();
    }
  } finally {
    modelsBusy = false;
    syncModelControls();
  }
}

async function openEnhancementOptions(anchor) {
  if (pendingSave) {
    saveCopyButton.focus();
    return;
  }
  const rect = anchor.getBoundingClientRect();
  modelPopover.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 368))}px`;
  modelPopover.style.top = `${Math.max(8, rect.bottom + 6)}px`;
  modelPopover.showPopover();
  try {
    preferredModels = (await chrome.storage.local.get(MODEL_PREF_KEY))[MODEL_PREF_KEY] || {};
  } catch { /* Session selections still work without storage. */ }
  await refreshModels();
}

modelRefresh.addEventListener("click", refreshModels);
extractModel.addEventListener("change", syncModelControls);
reviewModel.addEventListener("change", syncModelControls);
modelName.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    if (!modelsBusy) modelDownload.click();
  }
});
modelDownload.addEventListener("click", async () => {
  const model = modelName.value.trim();
  if (!model || modelsBusy) return;
  modelsBusy = true;
  syncModelControls();
  modelStatus.textContent = `Downloading ${model}…`;
  try {
    await modelRequest({ action: "pull-ollama-model", model }, (event) => {
      const percent = Number.isFinite(event.completed) && event.total > 0
        ? ` · ${Math.min(100, Math.round(event.completed / event.total * 100))}%` : "";
      modelStatus.textContent = `${event.status || "Downloading"}${percent}`;
    });
    modelName.value = "";
  } catch (error) {
    modelStatus.textContent = error?.message || "Model download failed";
    return;
  } finally {
    modelsBusy = false;
    syncModelControls();
  }
  await refreshModels();
});
modelForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (modelStart.disabled || modelsBusy) return;
  const models = { extractModel: extractModel.value, reviewModel: reviewModel.value };
  modelPopover.hidePopover();
  preferredModels = models;
  try {
    await chrome.storage.local.set({ [MODEL_PREF_KEY]: models });
  } catch { /* Preferences are optional. */ }
  await enhanceCurrentPdf(models);
});
document.querySelector("#enhancer-model-close").addEventListener("click", () => modelPopover.hidePopover());
enhanceButton.addEventListener("click", () => openEnhancementOptions(enhanceButton));
sectionEnhanceButton.addEventListener("click", () => {
  sectionPopover.hidden = true;
  sectionToggle.setAttribute("aria-expanded", "false");
  return openEnhancementOptions(sectionToggle);
});
