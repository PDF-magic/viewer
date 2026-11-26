// Source metadata is shown separately from the viewer's formatted Sections.
const DERIVED_KEYS = new Set([
  "PDFFormatVersion", "Language", "EncryptFilterName", "IsLinearized",
  "IsAcroFormPresent", "IsXFAPresent", "IsCollectionPresent", "IsSignaturesPresent"
]);
function serialize(value) {
  const seen = new WeakSet();
  return JSON.stringify(value, (_key, v) => {
    if (typeof v === "bigint") return String(v);
    if (v && typeof v === "object") {
      if (seen.has(v)) return "[Circular]";
      seen.add(v);
    }
    return v;
  }, 2);
}
export function rawMetadataSections(payload) {
  if (!payload) return [];
  const info = payload.info && typeof payload.info === "object" ? payload.info : {};
  let parsed, xml;
  try { parsed = payload.metadata?.getAll?.(); } catch { /* unreadable XMP */ }
  try { xml = payload.metadata?.getRaw?.(); } catch { /* unreadable XMP */ }
  const hasActualInfo = Object.entries(info).some(([key,v]) =>
    !DERIVED_KEYS.has(key) && v !== null && v !== undefined && v !== "");
  const hasXmp = Boolean((parsed && Object.keys(parsed).length) || (typeof xml === "string" && xml.length));
  if (!hasActualInfo && !hasXmp) return [];
  const sections = [];
  if (Object.keys(info).length) sections.push({ title: "PDF Info dictionary", text: serialize(info) });
  if (parsed && Object.keys(parsed).length) sections.push({ title: "XMP parsed fields", text: serialize(parsed) });
  if (typeof xml === "string" && xml.length) sections.push({ title: "Raw XMP XML", text: xml });
  const response = {};
  if (payload.contentDispositionFilename != null) response.contentDispositionFilename = payload.contentDispositionFilename;
  if (payload.contentLength != null) response.contentLength = payload.contentLength;
  if (Object.keys(response).length) sections.push({ title: "PDF response metadata", text: serialize(response) });
  return sections;
}
export async function installRawMetadataViewer(pdfDocument, closeToolsMenu) {
  const button = document.querySelector("#view-raw-metadata");
  const dialog = document.querySelector("#raw-metadata-dialog");
  const content = document.querySelector("#raw-metadata-content");
  const close = document.querySelector("#raw-metadata-close");
  if (!button || !dialog || !content || !close) return;
  button.hidden = true;
  let sections;
  try { sections = rawMetadataSections(await pdfDocument.getMetadata()); } catch { return; }
  if (!sections.length) return;
  button.hidden = false;
  button.addEventListener("click", () => {
    closeToolsMenu();
    const fragment = document.createDocumentFragment();
    for (const { title, text } of sections) {
      const section = document.createElement("section");
      section.className = "raw-metadata-section";
      const heading = document.createElement("h3");
      heading.textContent = title;
      const pre = document.createElement("pre");
      pre.textContent = text; // Embedded metadata is never treated as HTML.
      section.append(heading, pre);
      fragment.append(section);
    }
    content.replaceChildren(fragment);
    dialog.showModal();
  });
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
}
