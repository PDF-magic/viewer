import {
  groupSectionReferences,
  outlinedSectionHeadings,
  scanSectionReferencesForPage,
} from "./section-cross-references.js";
import { pdfDocumentSessionReady } from "../pdf-document-session.js";

const openButton = document.querySelector("#section-cross-reference-notes");
const dialog = document.querySelector("#section-cross-reference-dialog");
const closeButton = document.querySelector("#section-cross-reference-close");
const copyButton = document.querySelector("#section-cross-reference-copy");
const status = document.querySelector("#section-cross-reference-status");
const list = document.querySelector("#section-cross-reference-list");
let scanPromise;
let scanResult;

function setStatus(message) {
  status.textContent = message;
}

function openSource(reference) {
  dialog.close();
  window.dispatchEvent(new CustomEvent("pdf-viewer-footnote-jump", {
    detail: { ...reference, searchResult: true },
  }));
}

function openHeading(heading) {
  dialog.close();
  window.dispatchEvent(new CustomEvent("pdf-viewer-section-cross-reference-target", {
    detail: heading.item,
  }));
}

function makeButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function addSourceRows(container, references) {
  for (const reference of references) {
    const row = document.createElement("li");
    row.className = "section-cross-reference-source";
    row.append(makeButton(`Page ${reference.pageNumber}`, "section-cross-reference-page", () => openSource(reference)));
    const excerpt = document.createElement("span");
    excerpt.className = "section-cross-reference-excerpt";
    excerpt.textContent = reference.text;
    row.append(excerpt);
    container.append(row);
  }
}

function renderResults(result) {
  list.replaceChildren();
  const { sections, groups, unresolved } = result;
  const count = groups.reduce((sum, group) => sum + group.references.length, 0);
  copyButton.disabled = count + unresolved.length === 0;
  if (!sections.length) {
    setStatus("No numbered, navigable section headings found in this PDF's outline.");
    return;
  }
  setStatus(`${count} cross-references to ${groups.length} section headings` +
    (unresolved.length ? ` · ${unresolved.length} unresolved` : "") + ".");

  for (const { heading, references } of groups) {
    const item = document.createElement("li");
    item.className = "section-cross-reference-group";
    const headingButton = makeButton(
      `${heading.title}${heading.pageNumber ? ` · page ${heading.pageNumber}` : ""}`,
      "section-cross-reference-heading", () => openHeading(heading),
    );
    headingButton.title = `Jump to section ${heading.reference}`;
    const countLabel = document.createElement("span");
    countLabel.className = "section-cross-reference-count";
    countLabel.textContent = `${references.length} reference${references.length === 1 ? "" : "s"}`;
    const row = document.createElement("div");
    row.className = "section-cross-reference-group-title";
    row.append(headingButton, countLabel);
    const sources = document.createElement("ol");
    sources.className = "section-cross-reference-sources";
    addSourceRows(sources, references);
    item.append(row, sources);
    list.append(item);
  }
  if (unresolved.length) {
    const item = document.createElement("li");
    item.className = "section-cross-reference-group";
    const heading = document.createElement("h3");
    heading.textContent = "Unresolved section references";
    heading.className = "section-cross-reference-unresolved-title";
    const sources = document.createElement("ol");
    sources.className = "section-cross-reference-sources";
    for (const ref of unresolved) {
      const row = document.createElement("li");
      row.className = "section-cross-reference-source";
      row.append(makeButton(`Page ${ref.pageNumber}`, "section-cross-reference-page", () => openSource(ref)));
      const excerpt = document.createElement("span");
      excerpt.className = "section-cross-reference-excerpt";
      excerpt.textContent = `${ref.text} — ${ref.reason} (${ref.reference})`;
      row.append(excerpt);
      sources.append(row);
    }
    item.append(heading, sources);
    list.append(item);
  }
}

async function resolveHeadingPage(document, heading) {
  try {
    const raw = heading.item.dest;
    const destination = typeof raw === "string" ? await document.getDestination(raw) : raw;
    if (!Array.isArray(destination) || !destination.length) return null;
    const ref = destination[0];
    const index = Number.isInteger(ref) ? ref : await document.getPageIndex(ref);
    return Number.isInteger(index) && index >= 0 && index < document.numPages ? index + 1 : null;
  } catch {
    return null;
  }
}

async function scanDocument() {
  const session = await pdfDocumentSessionReady;
  if (!session?.document) throw new Error("PDF is not ready");
  const pdf = session.document;
  const outline = await pdf.getOutline();
  const sections = outlinedSectionHeadings(outline);
  if (!sections.length) return { sections, groups: [], unresolved: [] };
  await Promise.all(sections.map(async (heading) => {
    heading.pageNumber = await resolveHeadingPage(pdf, heading);
  }));
  const occurrences = [];
  const titles = new Set(sections.map((heading) => heading.title.replace(/\s+/g, " ").trim().toLowerCase()));
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    let page;
    try {
      page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      occurrences.push(...scanSectionReferencesForPage(content.items, viewport, pageNumber)
        .filter((reference) => !titles.has(reference.text.replace(/\s+/g, " ").trim().toLowerCase())));
    } catch (error) {
      console.warn(`Could not index section references on page ${pageNumber}`, error);
    } finally {
      page?.cleanup();
    }
    if (pageNumber === 1 || pageNumber % 10 === 0 || pageNumber === pdf.numPages) {
      setStatus(`Scanning section references… ${pageNumber} / ${pdf.numPages} pages`);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { sections, ...groupSectionReferences(sections, occurrences) };
}

async function openDialog() {
  document.querySelector("#tools-menu").hidden = true;
  document.querySelector("#tools-button").setAttribute("aria-expanded", "false");
  dialog.showModal();
  if (scanResult) {
    renderResults(scanResult);
    return;
  }
  setStatus("Scanning section references…");
  if (!scanPromise) scanPromise = scanDocument();
  try {
    scanResult = await scanPromise;
    renderResults(scanResult);
  } catch (error) {
    scanPromise = null;
    setStatus(`Could not scan section references: ${error?.message || error}`);
  }
}

openButton?.addEventListener("click", () => void openDialog());
closeButton?.addEventListener("click", () => dialog.close());
copyButton?.addEventListener("click", async () => {
  if (!scanResult) return;
  const parts = scanResult.groups.map(({ heading, references }) =>
    `${heading.title}${heading.pageNumber ? ` (page ${heading.pageNumber})` : ""}\n` +
    references.map((reference) => `  Page ${reference.pageNumber}: ${reference.text}`).join("\n"),
  );
  if (scanResult.unresolved.length) {
    parts.push("Unresolved section references\n" + scanResult.unresolved.map((reference) =>
      `  Page ${reference.pageNumber}: ${reference.text} — ${reference.reason} (${reference.reference})`).join("\n"));
  }
  try {
    await navigator.clipboard.writeText(parts.join("\n\n"));
    copyButton.textContent = "Copied!";
  } catch {
    setStatus("Could not copy section references to clipboard.");
  }
});
dialog?.addEventListener("close", () => { copyButton.textContent = "Copy list"; });
