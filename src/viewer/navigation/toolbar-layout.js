const TOOLBAR_ROW_BREAKPOINT = 900;
const TOOLBAR_HEIGHT = 52;
const PAGE_GAP = 24;

const twoRowToolbar = window.matchMedia(`(max-width: ${TOOLBAR_ROW_BREAKPOINT}px)`);
const pageNumberInput = document.querySelector("#page-number");
const viewer = document.querySelector("#viewer");
const searchControl = document.querySelector(".search-control");
const searchInput = document.querySelector("#search-input");
const searchCount = document.querySelector("#search-count");
const searchTextCanvas = document.createElement("canvas");
const searchTextContext = searchTextCanvas.getContext("2d");

function updateSearchCountVisibility() {
  searchControl.classList.remove("search-count-crowded");

  if (!searchInput.value || !searchCount.textContent.trim()) {
    return;
  }

  const inputStyle = getComputedStyle(searchInput);
  searchTextContext.font = inputStyle.font;

  const queryWidth = searchTextContext.measureText(searchInput.value).width;
  const clearButtonAllowance = 18;
  const queryNeedsCountSpace = queryWidth + clearButtonAllowance > searchInput.clientWidth;

  searchControl.classList.toggle("search-count-crowded", queryNeedsCountSpace);
}

// ResizeObserver callbacks run during layout. Defer DOM class changes until the
// next animation frame so changing the search control cannot resize it again in
// the same observer delivery cycle.
let searchCountUpdateFrame = 0;
function scheduleSearchCountVisibilityUpdate() {
  if (searchCountUpdateFrame) return;
  searchCountUpdateFrame = requestAnimationFrame(() => {
    searchCountUpdateFrame = 0;
    updateSearchCountVisibility();
  });
}

searchInput.addEventListener("input", scheduleSearchCountVisibilityUpdate);
new MutationObserver(scheduleSearchCountVisibilityUpdate).observe(searchCount, {
  childList: true,
  characterData: true,
  subtree: true,
});
new ResizeObserver(scheduleSearchCountVisibilityUpdate).observe(searchControl);

function updateToolbarRows() {
  document.documentElement.classList.toggle("toolbar-two-rows", twoRowToolbar.matches);
}

function directPageJump() {
  const pageNumber = Number.parseInt(pageNumberInput.value, 10);
  const pageMaximum = Number.parseInt(pageNumberInput.max, 10);
  if (!Number.isFinite(pageNumber) || !Number.isFinite(pageMaximum) || pageMaximum < 1) {
    return;
  }

  const targetPage = Math.min(Math.max(pageNumber, 1), pageMaximum);
  const pageElement = viewer.querySelector(`.page[data-page="${targetPage}"]`);
  if (!pageElement) {
    return;
  }

  // Keep typed jumps to the first page aligned with the toolbar, not centered.
  if (targetPage === 1) {
    window.scrollTo({ top: 0, behavior: "instant" });
    return;
  }

  const readableHeight = window.innerHeight - TOOLBAR_HEIGHT - PAGE_GAP * 2;
  const pageRect = pageElement.getBoundingClientRect();

  if (pageRect.height <= readableHeight) {
    pageElement.scrollIntoView({ behavior: "instant", block: "center" });
    return;
  }

  const pageTop = window.scrollY + pageRect.top;
  window.scrollTo({
    top: Math.max(0, pageTop - TOOLBAR_HEIGHT - PAGE_GAP),
    behavior: "instant",
  });
}

updateToolbarRows();
twoRowToolbar.addEventListener("change", updateToolbarRows);
pageNumberInput.addEventListener("change", directPageJump);
