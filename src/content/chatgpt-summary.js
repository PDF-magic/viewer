const STORAGE_PREFIX = "pdf-viewer-chatgpt-summary:";
const HASH_PARAMETER = "pdf-viewer-summary";

const HANDOFF_STATUS_ID = "pdf-viewer-handoff-status";
let pendingStatus = null;
let statusReadyListenerAdded = false;

function showHandoffStatus(label, isError = false) {
  pendingStatus = { label, isError };
  if (!document.body) {
    if (!statusReadyListenerAdded) {
      statusReadyListenerAdded = true;
      document.addEventListener("DOMContentLoaded", () => {
        statusReadyListenerAdded = false;
        if (pendingStatus) showHandoffStatus(pendingStatus.label, pendingStatus.isError);
      }, { once: true });
    }
    return;
  }
  let status = document.getElementById(HANDOFF_STATUS_ID);
  if (!status) {
    status = document.createElement("div");
    status.id = HANDOFF_STATUS_ID;
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.style.cssText = [
      "position:fixed", "top:16px", "right:16px", "max-width:min(340px,calc(100vw - 32px))",
      "z-index:2147483647", "padding:12px 16px", "border-radius:12px",
      "font:500 13px/1.5 ui-sans-serif,system-ui,sans-serif",
      "background:#242428", "color:#f6f6f8", "border:1px solid #66666c",
      "box-shadow:0 6px 24px #0005", "pointer-events:none",
    ].join(";");
    document.body.appendChild(status);
  }
  status.textContent = label;
  status.style.borderColor = isError ? "#f59e9e" : "#66666c";
}

function clearHandoffStatus() {
  pendingStatus = null;
  document.getElementById(HANDOFF_STATUS_ID)?.remove();
}

function requestIdFromLocation() {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  return new URLSearchParams(hash).get(HASH_PARAMETER);
}

function findComposer() {
  const composer = (
    document.querySelector("#prompt-textarea") ||
    document.querySelector('[contenteditable="true"][data-lexical-editor="true"]') ||
    document.querySelector('[contenteditable="true"][role="textbox"]') ||
    document.querySelector("textarea")
  );
  if (!composer || !composer.isConnected || !composer.getClientRects().length) return null;
  if (composer instanceof HTMLTextAreaElement) {
    return !composer.disabled && !composer.readOnly ? composer : null;
  }
  return composer.isContentEditable ? composer : null;
}

function findSendButton() {
  return (
    document.querySelector('button[data-testid="send-button"]') ||
    Array.from(document.querySelectorAll("button")).find((button) =>
      /^send(?: message)?$/i.test(button.getAttribute("aria-label") || ""),
    )
  );
}

function setComposerText(composer, text) {
  composer.focus();

  if (composer instanceof HTMLTextAreaElement) {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (valueSetter) {
      valueSetter.call(composer, text);
    } else {
      composer.value = text;
    }
    composer.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }

  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(composer);
  selection.removeAllRanges();
  selection.addRange(range);

  const inserted = document.execCommand("insertText", false, text);
  if (!inserted || composer.textContent !== text) {
    composer.textContent = text;
    composer.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text,
      }),
    );
  }
}

function waitFor(getValue, timeoutMs) {
  return new Promise((resolve) => {
    let observer;
    let timeout;
    const finish = (value) => {
      observer?.disconnect();
      window.clearTimeout(timeout);
      resolve(value);
    };
    const check = () => {
      const value = getValue();
      if (value) finish(value);
    };
    observer = new MutationObserver(check);
    observer.observe(document, { childList: true, subtree: true, attributes: true });
    timeout = window.setTimeout(() => finish(null), timeoutMs);
    check();
  });
}

function clearRequestHash() {
  const url = new URL(window.location.href);
  url.hash = "";
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
}


function findPdfInput() {
  return Array.from(document.querySelectorAll('input[type="file"]')).find((input) => {
    const accepts = (input.accept || "").toLowerCase();
    return !input.disabled && (!accepts || accepts.includes("pdf") || accepts.includes("*"));
  });
}

function receivePdf(requestId, onProgress) {
  const port = chrome.runtime.connect({ name: "pdf-summary-target:" + requestId });
  return new Promise((resolve, reject) => {
    const chunks = [];
    let expected = -1;
    let received = 0;
    let lastPercent = -1;
    let filename = "document.pdf";
    let done = false;
    const fail = (error) => {
      if (done) return;
      done = true;
      port.disconnect();
      reject(new Error(error));
    };
    port.onDisconnect.addListener(() => fail("PDF transfer disconnected"));
    port.onMessage.addListener((message) => {
      if (done) return;
      try {
        if (message?.type === "begin") {
          if (!Number.isSafeInteger(message.byteLength) || message.byteLength < 1 ||
              message.byteLength > 512 * 1024 * 1024) throw new Error("Invalid PDF transfer size");
          expected = message.byteLength;
          onProgress?.("Transferring PDF into ChatGPT · 0%");
          filename = typeof message.filename === "string" && /\.pdf$/i.test(message.filename)
            ? message.filename.replace(/[\\/]/g, "_") : "document.pdf";
        } else if (message?.type === "chunk") {
          if (expected < 0 || typeof message.data !== "string") throw new Error("Unexpected PDF chunk");
          const bytes = Uint8Array.from(atob(message.data), (c) => c.charCodeAt(0));
          received += bytes.length;
          if (received > expected) throw new Error("PDF transfer exceeded declared size");
          chunks.push(bytes);
          const percent = Math.floor(100 * received / expected);
          if (percent !== lastPercent) {
            lastPercent = percent;
            onProgress?.(`Transferring PDF into ChatGPT · ${percent}%`);
          }
          port.postMessage({ type: "ack" });
        } else if (message?.type === "end") {
          if (received !== expected || chunks[0]?.[0] !== 37 ||
              chunks[0]?.[1] !== 80 || chunks[0]?.[2] !== 68 || chunks[0]?.[3] !== 70) {
            throw new Error("Incomplete or invalid PDF attachment");
          }
          done = true;
          resolve({ file: new File(chunks, filename, { type: "application/pdf" }), port });
        } else if (message?.type === "error") {
          fail(message.message || "PDF transfer failed");
        }
      } catch (error) {
        fail(error.message);
      }
    });
  });
}

async function attachPdf(file) {
  showHandoffStatus("Waiting for ChatGPT attachment control…");
  const input = await waitFor(findPdfInput, 20000);
  if (!input) throw new Error("ChatGPT attachment input unavailable");
  const data = new DataTransfer();
  data.items.add(file);
  input.files = data.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  showHandoffStatus("Uploading PDF in ChatGPT…");
  // An existing file selection is not enough: wait for ChatGPT's attachment
  // chip before allowing the summary to be submitted.
  const acknowledged = await waitFor(() => {
    const displayed = Array.from(document.querySelectorAll(
      '[data-testid*="attachment"], [data-testid*="file"], [title], [aria-label]',
    )).some((element) => (
      (element.textContent || "").includes(file.name) ||
      (element.getAttribute("title") || "").includes(file.name) ||
      (element.getAttribute("aria-label") || "").includes(file.name)
    ));
    return displayed && !document.querySelector('[role="progressbar"]');
  }, 90000);
  if (!acknowledged) throw new Error("ChatGPT did not confirm the PDF attachment");
}

async function submitPendingSummary() {
  const requestId = requestIdFromLocation();
  if (!requestId) return;
  showHandoffStatus("Preparing PDF for ChatGPT…");
  const storageKey = STORAGE_PREFIX + requestId;
  const stored = await chrome.storage.local.get(storageKey);
  const payload = stored[storageKey];
  if (!payload?.prompt) {
    clearHandoffStatus();
    return;
  }
  let composer = await waitFor(findComposer, 20000);
  if (!composer) {
    showHandoffStatus("Could not find ChatGPT composer.", true);
    window.setTimeout(clearHandoffStatus, 12000);
    await chrome.storage.local.remove(storageKey);
    clearRequestHash();
    return;
  }
  let port;
  let submitted = false;
  try {
    if (payload.attachmentRequired) {
      const pdf = await receivePdf(requestId, (message) => showHandoffStatus(message));
      port = pdf.port;
      await attachPdf(pdf.file);
    }
    showHandoffStatus("PDF attached. Preparing summary…");
    setComposerText(composer, payload.prompt);
    const sendButton = await waitFor(() => {
      const current = findComposer();
      if (!current) return null;
      if (current !== composer) {
        composer = current;
        setComposerText(composer, payload.prompt);
        return null;
      }
      const button = findSendButton();
      return button && !button.disabled && button.getClientRects().length ? button : null;
    }, 30000);
    if (!sendButton) throw new Error("ChatGPT send button unavailable");
    sendButton.click();
    submitted = true;
    port?.postMessage({ type: "finish" });
  } catch (error) {
    showHandoffStatus("Automatic attachment failed; attach the PDF manually.", true);
    port?.postMessage({ type: "cancel" });
    // Fail visibly and leave an unsent draft; never summarize just a file path.
    const draft = "PDF not attached automatically (" + error.message +
      "). Attach it manually before sending.\n\n" + payload.prompt;
    setComposerText(findComposer() || composer, draft);
  } finally {
    port?.disconnect();
    await chrome.storage.local.remove(storageKey);
    clearRequestHash();
    if (submitted) clearHandoffStatus();
    else window.setTimeout(clearHandoffStatus, 12000);
  }
}

void submitPendingSummary();
