import { pdfDocumentSessionReady } from "../pdf-document-session.js";

const form = document.querySelector("#footnote-jump");
const footnoteInput = document.querySelector("#footnote-number");
const status = document.querySelector("#footnote-jump-status");
const pageNumberInput = document.querySelector("#page-number");

const pageCache = new Map();
let lookupRequestId = 0;

function median(values) {
  const ordered = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!ordered.length) {
    return 0;
  }

  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

function markerPattern(number) {
  return new RegExp(`^(?:\\[\\s*${number}\\s*\\]|\\(\\s*${number}\\s*\\)|${number}(?:[.)]|\\s|$))`);
}

function currentPageNumber() {
  return Math.max(1, Number.parseInt(pageNumberInput?.value, 10) || 1);
}

function setStatus(message, state = "") {
  if (!status) {
    return;
  }

  status.textContent = message;
  if (state) {
    status.dataset.state = state;
  } else {
    delete status.dataset.state;
  }
}

function pageCoordinates(item, viewport) {
  if (!item?.transform || item.transform.length < 6) {
    return null;
  }

  const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
  return {
    x,
    y,
    xRatio: viewport.width ? x / viewport.width : 0,
    yRatio: viewport.height ? y / viewport.height : 0,
  };
}

function candidateForPage(items, viewport, number, pageNumber, originPage) {
  const pattern = markerPattern(number);
  const textItems = items.filter((item) => typeof item.str === "string" && item.str.trim());
  const typicalHeight = median(textItems.map((item) => Math.abs(item.height || item.transform?.[3] || 0)));
  let best;

  for (let index = 0; index < textItems.length; index += 1) {
    const item = textItems[index];
    const text = item.str.trim();
    const match = text.match(pattern);
    if (!match) {
      continue;
    }

    const coordinates = pageCoordinates(item, viewport);
    if (!coordinates || coordinates.yRatio < 0.52 || coordinates.xRatio > 0.9) {
      continue;
    }

    const itemHeight = Math.abs(item.height || item.transform?.[3] || 0);
    const smallType = typicalHeight > 0 && itemHeight > 0 && itemHeight <= typicalHeight * 0.9;
    const remainder = text.slice(match[0].length).trim();
    const inlineText = remainder.length >= 3;

    const next = textItems[index + 1];
    const nextCoordinates = pageCoordinates(next, viewport);
    const sameLineThreshold = Math.max(0.012, typicalHeight / Math.max(viewport.height, 1) * 0.7);
    const adjacentText =
      Boolean(nextCoordinates) &&
      next.str.trim().length >= 3 &&
      nextCoordinates.xRatio >= coordinates.xRatio &&
      Math.abs(nextCoordinates.yRatio - coordinates.yRatio) <= sameLineThreshold;

    if (!smallType && coordinates.yRatio < 0.68 && !inlineText && !adjacentText) {
      continue;
    }

    let score = 0;
    if (inlineText) score += 4.5;
    if (adjacentText) score += 3.5;
    if (smallType) score += 2.5;
    if (coordinates.xRatio <= 0.45) score += 2;
    if (coordinates.yRatio >= 0.68) score += 1.5;
    if (coordinates.yRatio >= 0.8) score += 1.5;

    const looksLikeCenteredPageNumber =
      coordinates.xRatio >= 0.4 &&
      coordinates.xRatio <= 0.6 &&
      !inlineText &&
      !adjacentText;
    if (looksLikeCenteredPageNumber) {
      score -= 5;
    }

    score -= Math.min(Math.abs(pageNumber - originPage) * 0.015, 1.5);

    if (score < 5.5) {
      continue;
    }

    const candidate = {
      pageNumber,
      score,
      xRatio: coordinates.xRatio,
      yRatio: coordinates.yRatio,
      label: text,
    };

    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  }

  return best;
}

async function pageData(pdfDocument, pageNumber) {
  if (pageCache.has(pageNumber)) {
    return pageCache.get(pageNumber);
  }

  const page = await pdfDocument.getPage(pageNumber);
  const [textContent, viewport] = await Promise.all([
    page.getTextContent(),
    Promise.resolve(page.getViewport({ scale: 1 })),
  ]);
  const data = { items: textContent.items, viewport };
  pageCache.set(pageNumber, data);
  page.cleanup();
  return data;
}

async function findFootnoteTarget(pdfDocument, number, originPage, requestId) {
  let best;

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    if (requestId !== lookupRequestId) {
      return null;
    }

    const { items, viewport } = await pageData(pdfDocument, pageNumber);
    const candidate = candidateForPage(items, viewport, number, pageNumber, originPage);
    if (candidate && (!best || candidate.score > best.score)) {
      best = candidate;
    }
  }

  return best || null;
}

function scrollToTarget(target) {
  if (!pageNumberInput) {
    return;
  }

  pageNumberInput.value = String(target.pageNumber);
  pageNumberInput.dispatchEvent(new Event("change", { bubbles: true }));

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const page = document.querySelector(`.page[data-page="${target.pageNumber}"]`);
      if (!page) {
        return;
      }

      const toolbarHeight = document.querySelector(".toolbar")?.getBoundingClientRect().height || 52;
      const pageRect = page.getBoundingClientRect();
      const targetTop = window.scrollY + pageRect.top + pageRect.height * target.yRatio;
      const readableHeight = Math.max(1, window.innerHeight - toolbarHeight);
      window.scrollTo({
        top: Math.max(0, targetTop - toolbarHeight - readableHeight / 2),
        behavior: "smooth",
      });
    });
  });
}

async function jumpToFootnote(rawNumber) {
  const number = Number.parseInt(String(rawNumber).trim(), 10);
  if (!Number.isSafeInteger(number) || number <= 0) {
    setStatus("Enter a footnote number", "error");
    footnoteInput?.focus();
    footnoteInput?.select();
    return;
  }

  const requestId = ++lookupRequestId;
  setStatus(`Finding footnote ${number}…`, "searching");

  const session = await pdfDocumentSessionReady;
  if (requestId !== lookupRequestId) {
    return;
  }

  if (!session?.document) {
    setStatus("PDF is not ready", "error");
    return;
  }

  const target = await findFootnoteTarget(
    session.document,
    number,
    currentPageNumber(),
    requestId,
  );
  if (requestId !== lookupRequestId) {
    return;
  }

  if (!target) {
    setStatus(`Footnote ${number} not found`, "error");
    return;
  }

  scrollToTarget(target);
  setStatus(`Footnote ${number} · page ${target.pageNumber}`, "success");
}

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  void jumpToFootnote(footnoteInput?.value || "");
});

footnoteInput?.addEventListener("click", () => {
  footnoteInput.select();
});

footnoteInput?.addEventListener("input", () => {
  setStatus("");
});
