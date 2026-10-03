const viewer = document.querySelector("#viewer");
const searchCount = document.querySelector("#search-count");
const ARROW_CLASS = "search-line-arrow";
const ACTIVE_CLASS = "search-highlight-active";

let arrowFrame;
let lastScrolledMatchKey = "";

function parseSearchPosition() {
  const match = searchCount.textContent.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
  if (!match) {
    return null;
  }

  const position = Number.parseInt(match[1], 10);
  const total = Number.parseInt(match[2], 10);
  if (position < 1 || total < 1 || position > total) {
    return null;
  }

  return { position, total };
}

function removeSearchCues() {
  for (const highlight of viewer.querySelectorAll(`.${ACTIVE_CLASS}`)) {
    highlight.classList.remove(ACTIVE_CLASS);
  }

  for (const arrow of viewer.querySelectorAll(`.${ARROW_CLASS}`)) {
    arrow.remove();
  }
}

function refreshActiveSearchCue() {
  arrowFrame = undefined;

  const searchPosition = parseSearchPosition();
  const page = viewer.querySelector(".page.search-match-page");
  const highlights = page ? [...page.querySelectorAll(".search-highlight")] : [];
  const activeOrdinal = Number.parseInt(page?.dataset.searchMatchOrdinal ?? "", 10);

  removeSearchCues();

  if (!searchPosition || !page) {
    lastScrolledMatchKey = "";
    return;
  }

  if (!highlights[activeOrdinal]) {
    return;
  }

  const activeHighlight = highlights[activeOrdinal];
  const scrollKey = `${page.dataset.page ?? ""}:${activeOrdinal}:${searchPosition.position}/${searchPosition.total}`;
  activeHighlight.classList.add(ACTIVE_CLASS);

  if (scrollKey !== lastScrolledMatchKey) {
    lastScrolledMatchKey = scrollKey;
    activeHighlight.scrollIntoView({
      behavior: "instant",
      block: "center",
      inline: "nearest",
    });
  }

  const pageRect = page.getBoundingClientRect();
  const rect = activeHighlight.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    const arrow = document.createElement("span");
    arrow.className = ARROW_CLASS;
    arrow.style.top = `${rect.top - pageRect.top + rect.height / 2}px`;
    arrow.setAttribute("aria-hidden", "true");
    page.append(arrow);
  }
}

function scheduleSearchCueRefresh() {
  if (arrowFrame) {
    return;
  }

  arrowFrame = requestAnimationFrame(refreshActiveSearchCue);
}

function nodeContainsSearchHighlight(node) {
  return (
    node instanceof Element &&
    (node.matches(".text-layer, .search-highlight") ||
      Boolean(node.querySelector(".text-layer, .search-highlight")))
  );
}

const viewerObserver = new MutationObserver((mutations) => {
  const searchCueChanged = mutations.some((mutation) => {
    if (mutation.type === "attributes") {
      return mutation.target instanceof Element && mutation.target.matches(".page");
    }

    if (mutation.type !== "childList") {
      return false;
    }

    if (mutation.target instanceof Element && mutation.target.closest(".text-layer")) {
      return true;
    }

    return [...mutation.addedNodes, ...mutation.removedNodes].some(nodeContainsSearchHighlight);
  });

  if (searchCueChanged) {
    scheduleSearchCueRefresh();
  }
});

viewerObserver.observe(viewer, {
  attributes: true,
  attributeFilter: ["class", "data-search-match-ordinal"],
  childList: true,
  subtree: true,
});

const countObserver = new MutationObserver(scheduleSearchCueRefresh);
countObserver.observe(searchCount, { childList: true, characterData: true, subtree: true });

window.addEventListener("resize", scheduleSearchCueRefresh);
scheduleSearchCueRefresh();