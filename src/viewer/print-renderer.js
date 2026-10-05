const POINTS_PER_INCH = 72;

export const PRINT_DPI = 300;

export function printPageMetrics(baseViewport, dpi = PRINT_DPI) {
  const scale = dpi / POINTS_PER_INCH;

  return {
    scale,
    pixelWidth: Math.max(1, Math.ceil(baseViewport.width * scale)),
    pixelHeight: Math.max(1, Math.ceil(baseViewport.height * scale)),
    cssWidth: `${baseViewport.width}pt`,
  };
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Could not encode a print page."));
      }
    }, "image/png");
  });
}

function waitForImage(image) {
  if (typeof image.decode === "function") {
    return image.decode();
  }

  if (image.complete) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", reject, { once: true });
  });
}

export async function preparePrintDocument({
  pdfDocument,
  rotation = 0,
  onProgress = () => {},
  host = document.body,
  createCanvas = () => document.createElement("canvas"),
  createImage = () => document.createElement("img"),
  urls = URL,
} = {}) {
  if (!pdfDocument) {
    throw new Error("A PDF document is required for printing.");
  }

  const printDocument = document.createElement("div");
  printDocument.className = "print-document";
  printDocument.setAttribute("aria-hidden", "true");
  const objectUrls = [];
  host.append(printDocument);

  const cleanup = () => {
    printDocument.remove();
    for (const url of objectUrls) {
      urls.revokeObjectURL(url);
    }
  };

  try {
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      onProgress(pageNumber, pdfDocument.numPages);
      const page = await pdfDocument.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1, rotation });
      const metrics = printPageMetrics(baseViewport);
      const viewport = page.getViewport({ scale: metrics.scale, rotation });
      const canvas = createCanvas();

      canvas.width = metrics.pixelWidth;
      canvas.height = metrics.pixelHeight;

      try {
        await page.render({
          canvasContext: canvas.getContext("2d", { alpha: false }),
          viewport,
          intent: "print",
          background: "#fff",
        }).promise;

        const blob = await canvasBlob(canvas);
        const objectUrl = urls.createObjectURL(blob);
        const image = createImage();
        objectUrls.push(objectUrl);

        image.className = "print-page";
        image.alt = "";
        image.setAttribute("aria-hidden", "true");
        image.style.width = metrics.cssWidth;
        image.src = objectUrl;
        printDocument.append(image);
        await waitForImage(image);
      } finally {
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
      }
    }

    return cleanup;
  } catch (error) {
    cleanup();
    throw error;
  }
}
