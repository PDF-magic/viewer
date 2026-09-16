import { PDFPageProxy } from "../../../node_modules/pdfjs-dist/build/pdf.mjs";
import { mergeWrappedUrlTextItems } from "./search-text-normalization.js";

const originalGetTextContent = PDFPageProxy.prototype.getTextContent;

PDFPageProxy.prototype.getTextContent = async function getSearchableTextContent(...args) {
  const textContent = await originalGetTextContent.apply(this, args);
  textContent.items = mergeWrappedUrlTextItems(textContent.items);
  return textContent;
};

await import("../viewer.js");
