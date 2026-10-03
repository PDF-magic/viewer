import { resolveDocumentReferenceUrl } from "../document-reference-url.js";

const copyFileUrlButton = document.querySelector("#copy-file-url");
const defaultTitle = copyFileUrlButton.title;
let titleResetTimer;

copyFileUrlButton.addEventListener("click", async () => {
  try {
    const fileUrl = await resolveDocumentReferenceUrl();
    if (!fileUrl) {
      throw new Error("File URL unavailable");
    }
    await navigator.clipboard.writeText(fileUrl);
    clearTimeout(titleResetTimer);
    copyFileUrlButton.title = "Copied file URL";
    copyFileUrlButton.setAttribute("aria-label", copyFileUrlButton.title);
    titleResetTimer = setTimeout(() => {
      copyFileUrlButton.title = defaultTitle;
      copyFileUrlButton.setAttribute("aria-label", defaultTitle);
    }, 1400);
  } catch {
    clearTimeout(titleResetTimer);
    copyFileUrlButton.title = "Could not copy file URL. Try again.";
    copyFileUrlButton.setAttribute("aria-label", copyFileUrlButton.title);
  }
});
