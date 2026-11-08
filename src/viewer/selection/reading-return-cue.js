// Keep a visual reminder of the last PDF text the reader clicked when this
// window loses focus. The reminder is transient and never stores PDF text.
const viewer = typeof document === "undefined" ? null : document.querySelector("#viewer");
const HIGHLIGHT_CLASS = "reading-return-highlight";
const ARROW_CLASS = "reading-return-arrow";

export function closestReadingRectangle(rectangles, x, y) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const rect of rectangles) {
    if (!(rect.width > 0 && rect.height > 0)) continue;
    const dx = Math.max(rect.left - x, x - rect.right, 0);
    const dy = Math.max(rect.top - y, y - rect.bottom, 0);
    const distance = dx * dx + dy * dy;
    if (distance < nearestDistance) {
      nearest = rect;
      nearestDistance = distance;
    }
  }
  return nearest;
}

export function relativeReadingRectangle(page, text) {
  if (!(page.width > 0 && page.height > 0 && text.width > 0 && text.height > 0)) {
    return null;
  }
  const left = Math.max(page.left, text.left);
  const right = Math.min(page.right, text.right);
  const top = Math.max(page.top, text.top);
  const bottom = Math.min(page.bottom, text.bottom);
  if (right <= left || bottom <= top) return null;
  return {
    left: 100 * (left - page.left) / page.width,
    top: 100 * (top - page.top) / page.height,
    width: 100 * (right - left) / page.width,
    height: 100 * (bottom - top) / page.height,
  };
}

function readingRectangleAtClick(page, event) {
  const textLayer = page.querySelector(".text-layer");
  if (!textLayer) return null;

  // A drag may end outside the originating text span. Follow the selected
  // endpoint when possible, including selections spanning multiple PDF spans.
  const selection = document.getSelection();
  if (selection && !selection.isCollapsed && textLayer.contains(selection.focusNode)) {
    const bounds = page.getBoundingClientRect();
    const rects = [];
    for (let index = 0; index < selection.rangeCount; index += 1) {
      try {
        rects.push(...selection.getRangeAt(index).getClientRects());
      } catch {
        // PDF.js can replace selection nodes during a render.
      }
    }
    const withinPage = rects.filter(rect => relativeReadingRectangle(bounds, rect));
    const selected = closestReadingRectangle(withinPage, event.clientX, event.clientY);
    if (selected) return selected;
  }

  const span = event.target instanceof Element
    ? event.target.closest(".text-layer span") : null;
  if (!span || !textLayer.contains(span)) return null;

  // Highlight the word nearest the click rather than an entire PDF.js text
  // span, which may contain most of a paragraph or visual line.
  const caret = document.caretRangeFromPoint?.(event.clientX, event.clientY);
  const node = caret?.startContainer;
  if (node?.nodeType === Node.TEXT_NODE && span.contains(node)) {
    const text = node.textContent;
    let start = Math.min(caret.startOffset, text.length);
    let end = start;
    while (start > 0 && !/\s/u.test(text[start - 1])) start -= 1;
    while (end < text.length && !/\s/u.test(text[end])) end += 1;
    if (end > start) {
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      const word = closestReadingRectangle(range.getClientRects(), event.clientX, event.clientY);
      if (word) return word;
    }
  }
  return closestReadingRectangle(span.getClientRects(), event.clientX, event.clientY);
}

export function installReadingReturnCue() {
  if (!viewer) return;
  let lastLocation = null;
  let isShown = false;
  let pressedPage = null;

  function removeCue() {
    for (const cue of viewer.querySelectorAll("." + HIGHLIGHT_CLASS + ", ." + ARROW_CLASS)) {
      cue.remove();
    }
  }

  function drawCue() {
    removeCue();
    if (!isShown || !lastLocation) return;
    const page = [...viewer.querySelectorAll(".page")].find(
      element => element.dataset.page === lastLocation.page,
    );
    if (!page?.querySelector(".text-layer")) return;

    const highlight = document.createElement("span");
    highlight.className = HIGHLIGHT_CLASS;
    highlight.setAttribute("aria-hidden", "true");
    highlight.style.left = lastLocation.left + "%";
    highlight.style.top = lastLocation.top + "%";
    highlight.style.width = lastLocation.width + "%";
    highlight.style.height = lastLocation.height + "%";

    const arrow = document.createElement("span");
    arrow.className = ARROW_CLASS;
    arrow.setAttribute("aria-hidden", "true");
    arrow.style.top = (lastLocation.top + lastLocation.height / 2) + "%";
    page.append(highlight, arrow);
  }

  function resetLocation() {
    lastLocation = null;
    isShown = false;
    removeCue();
  }

  function revealLocation() {
    if (!lastLocation) return;
    isShown = true;
    drawCue();
  }

  viewer.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.pointerType === "touch") return;
    pressedPage = null;
    const page = event.target instanceof Element ? event.target.closest(".page") : null;
    if (!page || !viewer.contains(page)) return;
    // A new document click takes over the reading position and dismisses the
    // previous reminder, even if the click was in a blank area of the page.
    resetLocation();
    pressedPage = event.target.closest(".text-layer") ? page : null;
  });

  viewer.addEventListener("pointerup", (event) => {
    const page = pressedPage;
    pressedPage = null;
    if (!page || !page.isConnected || event.button !== 0) return;
    const rect = readingRectangleAtClick(page, event);
    if (!rect) return;
    const position = relativeReadingRectangle(page.getBoundingClientRect(), rect);
    if (position) lastLocation = { page: page.dataset.page, ...position };
  });

  viewer.addEventListener("pointercancel", () => {
    pressedPage = null;
  });

  // Browser blur covers switching to another application or Chrome window;
  // visibilitychange covers a tab switch where focus reporting differs.
  window.addEventListener("blur", revealLocation);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") revealLocation();
  });
  // Do not dismiss on refocus: the cue is specifically for finding your place.
  window.addEventListener("focus", () => {
    if (isShown) drawCue();
  });

  // A quarter-turn moves text to a different page-relative position. Forget
  // the old coordinates rather than pointing at unrelated text after rotation.
  document.querySelector("#rotate-left")?.addEventListener("click", resetLocation);
  document.querySelector("#rotate-right")?.addEventListener("click", resetLocation);

  // Render-window recycling uses page.replaceChildren(). Reattach the marker
  // once the anchored page is rendered again without observing our own spans.
  const observer = new MutationObserver((mutations) => {
    if (!isShown || !lastLocation) return;
    const pageChanged = mutations.some(mutation =>
      mutation.type === "childList" &&
      mutation.target instanceof Element &&
      mutation.target.matches(".page") &&
      [...mutation.addedNodes, ...mutation.removedNodes].some(node =>
        node instanceof Element &&
        !node.matches("." + HIGHLIGHT_CLASS + ", ." + ARROW_CLASS),
      ),
    );
    if (pageChanged) drawCue();
  });
  observer.observe(viewer, { childList: true, subtree: true });
}

if (viewer) installReadingReturnCue();
