import encodeQR from "../../../node_modules/qr/index.js";

const qrButton = document.querySelector("#qr-file-url");
const qrDialog = document.querySelector("#qr-file-url-dialog");
const qrCloseButton = document.querySelector("#qr-file-url-close");
const qrCard = qrDialog.querySelector(".qr-file-url-card");
const qrTitle = document.querySelector("#qr-file-url-title");
const qrHelp = qrDialog.querySelector(".qr-file-url-help");
const qrGraphic = document.querySelector("#qr-file-url-graphic");
const qrUrl = document.querySelector("#qr-file-url-text");
const toolsButton = document.querySelector("#tools-button");
const toolsMenu = document.querySelector("#tools-menu");
const source = new URLSearchParams(window.location.search).get("url");
const TEMP_UPLOAD_ORIGIN = "https://transfer.sh";

let temporaryShare = null;

function classifiedDocumentUrl(value) {
  if (!value) {
    return { kind: "unsupported", url: null };
  }

  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return { kind: "remote", url: url.href };
    }
    if (url.protocol === "file:") {
      return { kind: "local", url: url.href };
    }
  } catch {
    // Treat malformed and non-URL sources as unavailable.
  }

  return { kind: "unsupported", url: null };
}

async function resolveOriginalFileUrl() {
  if (chrome.mimeHandler?.getStreamInfo) {
    try {
      const streamInfo = await chrome.mimeHandler.getStreamInfo();
      if (streamInfo?.originalUrl) {
        return classifiedDocumentUrl(streamInfo.originalUrl);
      }
    } catch {
      // Fall back to the explicit viewer URL below.
    }
  }

  return classifiedDocumentUrl(source);
}

function closeToolsMenu() {
  toolsMenu.hidden = true;
  toolsButton.setAttribute("aria-expanded", "false");
}

function closeDialog() {
  qrDialog.close();
  qrButton.focus();
}

function createDialogActions() {
  const actions = document.createElement("div");
  const cancelButton = document.createElement("button");
  const confirmButton = document.createElement("button");
  const deleteButton = document.createElement("button");

  actions.hidden = true;
  actions.style.display = "flex";
  actions.style.justifyContent = "flex-end";
  actions.style.gap = "8px";
  actions.style.marginTop = "14px";

  for (const button of [cancelButton, confirmButton, deleteButton]) {
    button.type = "button";
    button.style.minHeight = "34px";
    button.style.padding = "6px 12px";
    button.style.border = "1px solid var(--border)";
    button.style.borderRadius = "8px";
    button.style.background = "var(--control-bg)";
    button.style.color = "var(--text)";
    button.style.cursor = "pointer";
  }

  cancelButton.textContent = "Cancel";
  confirmButton.textContent = "Upload temporarily";
  deleteButton.textContent = "Delete now";
  deleteButton.hidden = true;

  cancelButton.addEventListener("click", closeDialog);
  actions.append(cancelButton, deleteButton, confirmButton);
  qrCard.append(actions);

  return { actions, cancelButton, confirmButton, deleteButton };
}

const dialogActions = createDialogActions();

function setDialogActions(mode, { canDelete = false } = {}) {
  const { actions, cancelButton, confirmButton, deleteButton } = dialogActions;
  actions.hidden = mode === "none";
  actions.style.display = mode === "none" ? "none" : "flex";
  cancelButton.textContent = mode === "temporary-link" ? "Close" : "Cancel";
  confirmButton.hidden = mode !== "confirm-upload";
  deleteButton.hidden = mode !== "temporary-link" || !canDelete;
}

function renderQrCode(fileUrl, { temporary = false } = {}) {
  qrTitle.textContent = temporary ? "Scan temporary PDF link" : "Scan file URL";
  qrHelp.textContent = temporary
    ? "One download only · automatic expiry if unused"
    : "Open this PDF on your phone";
  qrGraphic.innerHTML = encodeQR(fileUrl, "svg", {
    border: 4,
    ecc: "medium",
  });
  qrUrl.textContent = fileUrl;
  setDialogActions(temporary ? "temporary-link" : "none", {
    canDelete: Boolean(temporaryShare?.deleteUrl),
  });

  if (!qrDialog.open) {
    qrDialog.showModal();
  }
}

function showLocalShareConfirmation() {
  qrTitle.textContent = "Share this local PDF?";
  qrHelp.textContent = "This PDF has no URL your phone can open.";
  qrGraphic.replaceChildren();
  qrUrl.textContent =
    "Upload a temporary public-by-link copy to transfer.sh? Anyone with the link can access it. The link allows one download and expires after at most one day.";
  setDialogActions("confirm-upload");
  dialogActions.confirmButton.disabled = false;
  dialogActions.confirmButton.textContent = "Upload temporarily";

  if (!qrDialog.open) {
    qrDialog.showModal();
  }
}

function localFileName(fileUrl) {
  try {
    const url = new URL(fileUrl);
    return decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "document.pdf");
  } catch {
    return "document.pdf";
  }
}

async function uploadTemporaryLocalFile(fileUrl) {
  const localResponse = await fetch(fileUrl);
  if (!localResponse.ok) {
    throw new Error(`Could not read local PDF (${localResponse.status}).`);
  }

  const fileBlob = await localResponse.blob();
  const fileName = localFileName(fileUrl);
  const uploadUrl = `${TEMP_UPLOAD_ORIGIN}/${encodeURIComponent(fileName)}`;
  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/pdf",
      "Max-Downloads": "1",
      "Max-Days": "1",
    },
    body: fileBlob,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Temporary upload failed (${uploadResponse.status}).`);
  }

  const fileUrlText = (await uploadResponse.text()).trim();
  const uploadedUrl = new URL(fileUrlText);
  if (uploadedUrl.protocol !== "https:") {
    throw new Error("Temporary host returned an invalid share URL.");
  }

  const rawDeleteUrl = uploadResponse.headers.get("X-Url-Delete");
  let deleteUrl = null;
  if (rawDeleteUrl) {
    const parsedDeleteUrl = new URL(rawDeleteUrl);
    if (parsedDeleteUrl.protocol === "https:" && parsedDeleteUrl.origin === TEMP_UPLOAD_ORIGIN) {
      deleteUrl = parsedDeleteUrl.href;
    }
  }

  return { url: uploadedUrl.href, deleteUrl };
}

async function deleteTemporaryShare() {
  if (!temporaryShare?.deleteUrl) {
    temporaryShare = null;
    closeDialog();
    return;
  }

  dialogActions.deleteButton.disabled = true;
  dialogActions.deleteButton.textContent = "Deleting…";

  try {
    await fetch(temporaryShare.deleteUrl, { method: "DELETE" });
    temporaryShare = null;
    closeDialog();
  } catch {
    qrUrl.textContent = "Could not delete the temporary link yet. It will still expire automatically.";
  } finally {
    dialogActions.deleteButton.disabled = false;
    dialogActions.deleteButton.textContent = "Delete now";
  }
}

function setQrButtonAvailability(documentUrl) {
  const unavailable = documentUrl.kind === "unsupported";
  qrButton.disabled = unavailable;
  qrButton.style.opacity = unavailable ? "0.45" : "";
  qrButton.style.cursor = unavailable ? "default" : "";
  qrButton.title = unavailable
    ? "QR sharing requires a web URL or local file URL"
    : documentUrl.kind === "local"
      ? "Temporarily share this local PDF by QR"
      : "";
  return documentUrl;
}

qrButton.disabled = true;
const documentUrlPromise = resolveOriginalFileUrl().then(setQrButtonAvailability);

dialogActions.confirmButton.addEventListener("click", async () => {
  const documentUrl = await documentUrlPromise;
  if (documentUrl.kind !== "local" || !documentUrl.url) {
    return;
  }

  dialogActions.confirmButton.disabled = true;
  dialogActions.confirmButton.textContent = "Uploading…";
  qrUrl.textContent = "Creating a one-download temporary link…";

  try {
    temporaryShare = await uploadTemporaryLocalFile(documentUrl.url);
    renderQrCode(temporaryShare.url, { temporary: true });
  } catch (error) {
    qrUrl.textContent = `${error?.message || error} Make sure this extension is allowed to access local file URLs.`;
    dialogActions.confirmButton.disabled = false;
    dialogActions.confirmButton.textContent = "Try again";
  }
});

dialogActions.deleteButton.addEventListener("click", () => void deleteTemporaryShare());

qrButton.addEventListener("click", async () => {
  closeToolsMenu();

  const documentUrl = await documentUrlPromise;
  if (documentUrl.kind === "unsupported" || !documentUrl.url) {
    return;
  }

  try {
    if (documentUrl.kind === "local") {
      if (temporaryShare?.url) {
        renderQrCode(temporaryShare.url, { temporary: true });
      } else {
        showLocalShareConfirmation();
      }
      return;
    }

    renderQrCode(documentUrl.url);
  } catch {
    qrGraphic.replaceChildren();
    qrUrl.textContent = "Could not generate a QR code for this file URL.";
    setDialogActions("none");
    qrDialog.showModal();
  }
});

qrCloseButton.addEventListener("click", closeDialog);

qrDialog.addEventListener("click", (event) => {
  if (event.target === qrDialog) {
    closeDialog();
  }
});
