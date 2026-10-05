# PDF Viewer

A Chrome Manifest V3 extension that replaces the normal PDF tab with a local PDF.js viewer and makes the current page shareable.

## Features

- On Chrome 151+, registers as the PDF MIME handler so the original `https://…pdf` URL stays in the address bar while the extension renders the document.
- Uses Chrome's already-received PDF stream instead of re-requesting the document URL.
- Falls back to the older extension-page redirect flow on Chrome versions that do not expose the MIME handler API.
- Renders PDFs locally with bundled PDF.js assets; no remotely hosted executable code is used.
- Supports dark and light viewing modes, remembers the selected theme, and shows Celestia in dark mode and Luna in light mode.
- Tracks the page currently centered in the viewport.
- Copies the original document URL as `#page=<current page>` silently when the mark is clicked.
- Honors an existing `#page=N` fragment when opening a document.
- Places Download beside the page-link icon and keeps rotate left/right and print in the **More tools** menu.
- Keeps the More tools menu open across repeated rotate actions.
- Prepares compressed previews of every page in the background for fast scrolling, while keeping sharp rendering and selectable text near the current page.
- Shows a PDF Enhancer button in the top-left section slot when a document has no section navigator; enhanced local copies retain the original web reference URL for link copying and ChatGPT summaries.

## Load directly in Chrome

Install dependencies once:

```sh
npm install
```

Then:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the repository root — the folder containing `manifest.json`.

The root manifest points directly at the source files and local `node_modules`, so a separate build step is not required for normal local development.

## PDF enhancer integration

The viewer can hand the current PDF to the local PDF-magic/enhancer workflow: https://github.com/PDF-magic/enhancer. The enhancer button occupies the top-left section-control slot only when the PDF has no section navigator.

Chrome and Brave extensions cannot start local processes directly, so register the included native-messaging host after loading the unpacked extension. Copy the extension ID from `chrome://extensions` or `brave://extensions`, then run:

```sh
./native/install-host.sh CHROME_EXTENSION_ID /path/to/PDF-magic/enhancer
```

If the native host is unavailable, the enhancer control becomes a link to these setup instructions. After installation, reload the PDF tab to retry enhancement.

The installer registers the host for both Chrome and Brave. The host locates Homebrew tools even when the browser is launched from Finder and keeps OCR logs separate from native-messaging responses.

For web PDFs, the viewer sends the already-loaded document to the host in acknowledged chunks. Enhancement does not make another HTTP download, so it can use PDFs that the browser loaded from sites that reject standalone requests. Local PDFs are read directly from disk. Update the enhancer checkout as well: Enhance passes `--force-ocr --ai-review` to rebuild the text on every page, then run the local DeepSeek and SEC OCR review models and apply their reviewed text and structure tags. Existing searchable text is replaced in the enhanced copy. Force OCR rasterizes each page; the original PDF is preserved.

Enhanced web copies are saved under `~/Library/Application Support/PDF Magic/Enhanced` on macOS or `~/.local/share/pdf-magic/enhanced` on Linux. This lets browser-launched helpers finish tagging without needing to replace files in the protected Downloads folder. Enhanced local copies are saved beside their source PDF.

Enhancement requests are deduplicated by the PDF's SHA-256 content hash, including requests from separate tabs and different URLs or filenames. Duplicate requests share the running job's progress and result. Completed results are reused only while their output hash still matches; submitting an unchanged enhanced PDF also reuses that result. Changed or missing outputs are regenerated, and failed or interrupted jobs can be retried. Job records are stored in `.jobs` under the enhanced web-copy directory. Jobs already started by an older native host continue independently.

The host runs `ocr-scanned-pdf.sh`, uses the OCR tagging report to name the new local `*-enhanced-ocr.pdf` copy from the document's recognized title when a credible title is available, and falls back to the source URL filename otherwise. It also stamps the original reference URL into the PDF's XMP metadata as a `pdfmagic:href` tag. The current tab is replaced with the enhanced local copy. Copy File URL, Copy Page Link, and Summarize with ChatGPT then use the preserved reference URL instead of the local `file://` path. Older enhanced copies with `PDFMagicSourceURL` document-info metadata remain supported.

Recognized H1–H6 headings are also written as nested PDF bookmarks with page destinations. The enhanced copy shows the § section navigator in place of Enhance when it contains these sections.

Enable **Allow access to file URLs** for the unpacked extension in Chrome or Brave so the enhanced local PDF reopens in this viewer.

## Build a standalone extension folder

```sh
npm run build
```

The standalone unpacked extension is written to `dist/`. You can also select `dist/` with **Load unpacked** if you want the packaged build instead of the source tree.

## Source layout

- `src/background.js`: extension background worker.
- `src/viewer.html`: viewer entry point; `src/loading-preview.html`: loading-state preview.
- `src/viewer/`: PDF rendering, settings, networking, and viewer styles.
- `src/viewer/navigation/`, `search/`, `selection/`, `sharing/`, and `theme/`: viewer features with their scripts and styles together.
- `src/content/`: scripts injected into SEC and ChatGPT pages.
- `src/assets/`: shared images and icons.

The build preserves the source directory structure in `dist/`, bundles the viewer and QR modules, and adds the PDF.js runtime assets.

## Usage

Open a PDF normally. On Chrome 151+, the extension renders the intercepted PDF stream in place while Chrome keeps the original document URL visible in the address bar. Scroll to a page and click the page-link icon to copy a link such as:

```text
https://example.com/document.pdf#page=42
```

On older Chrome versions, the extension retains the previous `chrome-extension://…?url=…` redirect as a compatibility fallback.

The toolbar also supports previous/next page navigation, direct page entry, theme switching, page-link copying, download, and a compact More tools menu for rotate and print.

Page previews load progressively without delaying the first readable pages. The viewer keeps compressed WebP previews rather than full-size canvases for distant pages, and attaches previews only within eight pages of the current page. Preview resolution adapts to the document's page count to help the complete set fit in memory. Sharp canvases, text selection, and links render within three pages after scrolling settles. The compressed preview cache has a 128 MiB limit; documents that exceed it retain recently used previews and regenerate missing ones as needed. Printing still prepares sharp versions of all pages.
