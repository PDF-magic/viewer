import { writeFile } from "node:fs/promises";

const escapeText = (text) => text.replace(/[\\()]/g, "\\$&");
const text = (value, x, y, size = 12) =>
  `BT /F1 ${size} Tf ${x} ${800 - y} Td (${escapeText(value)}) Tj ET`;
const rule = (x) => `0.5 w ${x} 160 m ${x + 100} 160 l S`;
const footer = (page) => [text(`Page ${page} of`, 266, 760, 8), text("2", 307, 760, 10)];
const heading = (page) => [
  text("Footnote across columns and pages", 60, 65, 18),
  text(`Page ${page}: select footnote 44, then scroll through its yellow highlight.`, 60, 92, 11),
];
const noteLine = (value, x, y) => text(value, x, y, 8);
const streams = [
  [
    ...heading(1),
    text("See", 60, 204), text("44", 82, 200, 6), text("the continuing footnote.", 94, 204),
    text("This is body text, outside the note.", 60, 228),
    text("Read the left note block first,", 324, 204),
    text("then the right note block.", 324, 228),
    text("The continuation reaches page 2.", 324, 252),
    rule(60), rule(324),
    text("44", 60, 666, 6),
    noteLine("START: page 1, left column.", 72, 670),
    noteLine("This is one footnote with three blocks.", 60, 686),
    noteLine("Its next block is in the right column.", 60, 702),
    noteLine("Continue reading to the right...", 60, 718),
    noteLine("MIDDLE: page 1, right column.", 324, 670),
    noteLine("This text still belongs to footnote 44.", 324, 686),
    noteLine("No new footnote number appears here.", 324, 702),
    noteLine("Continue on the following page...", 324, 718),
    ...footer(1),
  ].join("\n"),
  [
    ...heading(2),
    text("Main article resumes on this page.", 60, 204),
    text("Body text should stay unhighlighted.", 60, 228),
    text("Footnote 44 ends in the left column.", 324, 204),
    text("Footnote 45 is a separate note.", 324, 228),
    rule(60), rule(324),
    noteLine("END: page 2, left column.", 60, 660),
    noteLine("This completes the same footnote 44.", 60, 676),
    noteLine("The next numbered note is excluded.", 60, 692),
    text("45", 60, 714, 6),
    noteLine("Separate footnote: do not highlight", 72, 718),
    noteLine("this text when footnote 44 is selected.", 60, 734),
    ...footer(2),
  ].join("\n"),
];

const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
];
for (const [index, stream] of streams.entries()) {
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`);
  objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
}
let pdf = "%PDF-1.4\n";
const offsets = [];
for (const [index, object] of objects.entries()) {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
}
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
await writeFile(new URL("../tests/fixtures/footnote-columns-and-pages.pdf", import.meta.url), pdf);
