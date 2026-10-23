const STORAGE_PREFIX = "pdf-viewer-chatgpt-summary:";
const HASH_PARAMETER = "pdf-viewer-summary";

function requestIdFromLocation() {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  return new URLSearchParams(hash).get(HASH_PARAMETER);
}

function findComposer() {
  const candidates = [
    document.querySelector("#prompt-textarea"),
    document.querySelector('[contenteditable="true"][data-lexical-editor="true"]'),
    document.querySelector('[contenteditable="true"][role="textbox"]'),
    document.querySelector("textarea"),
  ].filter((composer) => composer && composer.isConnected && (
    composer instanceof HTMLTextAreaElement
      ? !composer.disabled && !composer.readOnly
      : composer.isContentEditable
  ));
  // The active tab has a visible editor. When the tab/window is backgrounded,
  // layout rects may not be available, but the connected editor is still usable.
  return candidates.find((composer) => composer.getClientRects().length) || candidates[0] || null;
}

function composerContainsPrompt(composer, prompt) {
  const value = composer instanceof HTMLTextAreaElement ? composer.value : composer.textContent;
  return value === prompt || (composer.innerText || "").replace(/\r\n/g, "\n") === prompt;
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
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      observer.disconnect();
      window.clearTimeout(timeout);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
      resolve(value);
    };
    const check = () => {
      if (finished) return;
      const value = getValue();
      if (value) finish(value);
    };
    const expire = () => {
      // A background tab can be throttled before ChatGPT hydrates. Do not
      // discard the pending prompt just because the user switched away.
      if (document.visibilityState === "hidden" || document.hasFocus?.() === false) {
        timeout = window.setTimeout(expire, timeoutMs);
      } else {
        finish(null);
      }
    };
    observer = new MutationObserver(check);
    observer.observe(document, { childList: true, subtree: true, attributes: true });
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    timeout = window.setTimeout(expire, timeoutMs);
    check();
  });
}

function clearRequestHash() {
  const url = new URL(window.location.href);
  url.hash = "";
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
}


function currentConversationUrl() {
  const url = new URL(window.location.href);
  return url.origin === "https://chatgpt.com" && /^\/c\/[a-z0-9-]+\/?$/i.test(url.pathname)
    ? url.origin + url.pathname.replace(/\/$/, "") : null;
}

// A fresh ChatGPT conversation obtains its /c/ URL after send. Record it only
// once it exists; subsequent summary requests reuse the attached PDF there.
async function rememberConversation(conversationKey) {
  const url = await new Promise((resolve) => {
    let elapsed = 0;
    const check = () => {
      const found = currentConversationUrl();
      if (found || elapsed >= 60000) {
        clearInterval(interval);
        resolve(found);
      }
    };
    const interval = setInterval(() => {
      elapsed += 500;
      check();
    }, 500);
    check();
  });
  if (url) {
    await chrome.storage.local.set({
      [conversationKey]: { status: "complete", url, updatedAt: Date.now() },
    });
  } else {
    // Do not leave an indefinitely pending entry after navigation fails.
    const stored = await chrome.storage.local.get(conversationKey);
    if (stored[conversationKey]?.status === "pending") {
      await chrome.storage.local.remove(conversationKey);
    }
  }
}

function findPdfInput() {
  return Array.from(document.querySelectorAll('input[type="file"]')).find((input) => {
    const accepts = (input.accept || "").toLowerCase();
    return !input.disabled && (!accepts || accepts.includes("pdf") || accepts.includes("*"));
  });
}

function receivePdf(requestId) {
  const port = chrome.runtime.connect({ name: "pdf-summary-target:" + requestId });
  return new Promise((resolve, reject) => {
    const chunks = [];
    let expected = -1;
    let received = 0;
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
          filename = typeof message.filename === "string" && /\.pdf$/i.test(message.filename)
            ? message.filename.replace(/[\\/]/g, "_") : "document.pdf";
        } else if (message?.type === "chunk") {
          if (expected < 0 || typeof message.data !== "string") throw new Error("Unexpected PDF chunk");
          const bytes = Uint8Array.from(atob(message.data), (c) => c.charCodeAt(0));
          received += bytes.length;
          if (received > expected) throw new Error("PDF transfer exceeded declared size");
          chunks.push(bytes);
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
  const input = await waitFor(findPdfInput, 20000);
  if (!input) throw new Error("ChatGPT attachment input unavailable");
  const data = new DataTransfer();
  data.items.add(file);
  input.files = data.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  // Wait only until ChatGPT registers the attachment. Its upload can remain
  // in progress: ChatGPT queues the message and sends it once the PDF is ready.
  // Restrict this check to attachment UI, not arbitrary labels or prompt text.
  const acknowledged = await waitFor(() => Array.from(document.querySelectorAll(
    '[data-testid*="attachment"], [data-testid*="file"]',
  )).some((element) => (
    (element.textContent || "").includes(file.name) ||
    (element.getAttribute("title") || "").includes(file.name) ||
    (element.getAttribute("aria-label") || "").includes(file.name)
  )), 90000);
  if (!acknowledged) throw new Error("ChatGPT did not register the PDF attachment");
}

async function submitPendingSummary() {
  const requestId = requestIdFromLocation();
  if (!requestId) return;
  const storageKey = STORAGE_PREFIX + requestId;
  const stored = await chrome.storage.local.get(storageKey);
  const payload = stored[storageKey];
  if (!payload?.prompt) return;
  let composer;
  let port;
  try {
    composer = await waitFor(findComposer, 90000);
    if (!composer) throw new Error("ChatGPT composer unavailable");
    // Compose immediately, before transferring the PDF or waiting for its
    // upload. A backgrounded or hydrated page must not lose the prompt.
    setComposerText(composer, payload.prompt);
    if (payload.attachmentRequired) {
      const pdf = await receivePdf(requestId);
      port = pdf.port;
      await attachPdf(pdf.file);
    }
    const sendButton = await waitFor(() => {
      const current = findComposer();
      if (!current) return null;
      if (current !== composer || !composerContainsPrompt(current, payload.prompt)) {
        composer = current;
        setComposerText(composer, payload.prompt);
        return null;
      }
      const button = findSendButton();
      return button && !button.disabled && button.isConnected !== false &&
        (button.getClientRects().length || document.visibilityState === "hidden")
        ? button : null;
    }, 90000);
    if (!sendButton) throw new Error("ChatGPT send button unavailable");
    sendButton.click();
    if (payload.attachmentRequired && payload.conversationKey) {
      void rememberConversation(payload.conversationKey).catch(() => {});
    }
    port?.postMessage({ type: "finish" });
  } catch (error) {
    port?.postMessage({ type: "cancel" });
    if (payload.attachmentRequired && payload.conversationKey) {
      const current = await chrome.storage.local.get(payload.conversationKey);
      if (current[payload.conversationKey]?.status === "pending") {
        await chrome.storage.local.remove(payload.conversationKey);
      }
    }
    // Fail visibly and leave an unsent draft; never summarize just a file path.
    const draft = "PDF not attached automatically (" + error.message +
      "). Attach it manually before sending.\n\n" + payload.prompt;
    const failedComposer = findComposer() || composer;
    if (failedComposer) setComposerText(failedComposer, draft);
  } finally {
    port?.disconnect();
    await chrome.storage.local.remove(storageKey);
    clearRequestHash();
  }
}

void submitPendingSummary();
