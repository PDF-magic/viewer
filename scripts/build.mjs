import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const outdir = "dist";

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await cp("src", outdir, { recursive: true });

const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
manifest.background.service_worker = "background.js";
manifest.mime_types_handler["application/pdf"].handler_url = "viewer.html";
manifest.icons = Object.fromEntries(
  Object.entries(manifest.icons).map(([size, icon]) => [size, icon.replace("src/", "")]),
);
manifest.action.default_icon = manifest.action.default_icon.replace("src/", "");

for (const contentScript of manifest.content_scripts || []) {
  contentScript.js = contentScript.js?.map((script) => script.replace(/^src\//, ""));
  contentScript.css = contentScript.css?.map((stylesheet) => stylesheet.replace(/^src\//, ""));
}

await Promise.all([
  build({
    entryPoints: [
      "src/viewer/viewer.js",
      "src/viewer/navigation/minimap.js",
    ],
    bundle: true,
    splitting: true,
    format: "esm",
    target: "chrome130",
    outdir,
    outbase: "src",
    chunkNames: "viewer/chunks/[name]-[hash]",
    minify: false,
    sourcemap: false,
  }),
  build({
    entryPoints: ["src/viewer/sharing/qr-file-url.js"],
    bundle: true,
    format: "esm",
    target: "chrome130",
    outfile: `${outdir}/viewer/sharing/qr-file-url.js`,
    minify: false,
    sourcemap: false,
  }),
  writeFile(`${outdir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`),
  cp("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", `${outdir}/pdf.worker.min.mjs`),
  cp("node_modules/pdfjs-dist/cmaps", `${outdir}/cmaps`, { recursive: true }),
  cp("node_modules/pdfjs-dist/standard_fonts", `${outdir}/standard_fonts`, { recursive: true }),
  cp("node_modules/pdfjs-dist/wasm", `${outdir}/wasm`, { recursive: true }),
]);

console.log("Built Chrome extension in dist/");
