import { matchingDocumentPageLabels, pageLabelIndexReady } from "./printed-page-index.js";

const form = document.querySelector("#printed-page-jump");
const input = document.querySelector("#printed-page-number");
const status = document.querySelector("#printed-page-status");
const physicalPage = document.querySelector("#page-number");
let index = null;
let requestId = 0;
let previousQuery = "";
let previousDestination = null;

function setStatus(message = "", state = "") {
  status.textContent = message;
  if (state) form.dataset.state = state;
  else delete form.dataset.state;
}

function currentPhysicalPage() {
  return Math.max(1, Number.parseInt(physicalPage.value, 10) || 1);
}

function updateCurrentPrintedPage(pageNumber = currentPhysicalPage()) {
  if (!index || document.activeElement === input) return;
  const label = index.getConfirmedLabels()[pageNumber - 1];
  input.value = label || "";
  input.title = label
    ? "Printed page " + label + " (PDF page " + pageNumber + ")"
    : "No verified printed page number on PDF page " + pageNumber;
}

export async function jumpToPrintedPage(rawQuery = input.value, notify = null) {
  const query = String(rawQuery).trim();
  const report = (message, state = "") => {
    setStatus(message, state);
    if (typeof notify === "function") notify(message);
  };
  if (!query || query.length > 48) {
    report("Enter a printed page label (e.g. 12, iv or A-2).", "error");
    return;
  }
  const id = ++requestId;
  report("Finding printed page " + query + "…", "searching");
  const pageIndex = await pageLabelIndexReady;
  if (id !== requestId) return;
  if (!pageIndex) {
    report("PDF is not ready.", "error");
    return;
  }
  // Searching works with page tabs and the minimap completely disabled.
  await pageIndex.scan();
  if (id !== requestId) return;
  const matches = matchingDocumentPageLabels(query, pageIndex.getConfirmedLabels());
  if (!matches.length) {
    report("Printed page " + query + " not found. Unreadable or scanned pages may lack labels.", "error");
    return;
  }
  const key = query.normalize("NFKC").toLocaleLowerCase("en");
  let destination;
  if (key === previousQuery && previousDestination !== null &&
    matches.includes(previousDestination)) {
    destination = matches[(matches.indexOf(previousDestination) + 1) % matches.length];
  } else {
    // Prefer the closest duplicate to the reader's current position.
    const current = currentPhysicalPage();
    destination = matches.reduce((best, page) =>
      Math.abs(page - current) < Math.abs(best - current) ? page : best, matches[0]);
  }
  previousQuery = key;
  previousDestination = destination;
  physicalPage.value = String(destination);
  physicalPage.dispatchEvent(new Event("change", { bubbles: true }));
  input.blur();
  updateCurrentPrintedPage(destination);
  report(
    "Printed " + query + " → PDF page " + destination +
      (matches.length > 1 ? " (" + matches.length + " matches; press Go again to cycle)" : ""),
    "success",
  );
}

window.addEventListener("pdf-viewer-printed-page-request", (event) => {
  void jumpToPrintedPage(event.detail?.query ?? "", (message) => {
    window.dispatchEvent(new CustomEvent("pdf-viewer-toast", { detail: { message } }));
  });
});

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  void jumpToPrintedPage();
});
input?.addEventListener("focus", () => input.select());
input?.addEventListener("input", () => {
  ++requestId;
  setStatus();
});
window.addEventListener("pdf-viewer-page-changed", (event) =>
  updateCurrentPrintedPage(event.detail?.pageNumber));
void pageLabelIndexReady.then(async (pageIndex) => {
  if (!pageIndex) return;
  index = pageIndex;
  index.subscribe(() => updateCurrentPrintedPage());
  await index.loadMetadata();
  updateCurrentPrintedPage();
});
