import { pageLabelIndexReady } from "./printed-page-index.js";

const rail = document.querySelector("#page-tabs");
const pageInput = document.querySelector("#page-number");
const root = document.documentElement;
let tabs = [];
let labels = [];
let selectedPage = 0;

function isVisible() {
  return root.classList.contains("minimap-page-tabs") &&
    !root.classList.contains("minimap-disabled") &&
    !root.classList.contains("minimap-collapsed") &&
    window.innerWidth > 700;
}

function keepSelectedTabVisible(tab) {
  if (!tab || !isVisible()) return;
  const top = tab.offsetTop - rail.offsetTop;
  if (top < rail.scrollTop) rail.scrollTop = top;
  else if (top + tab.offsetHeight > rail.scrollTop + rail.clientHeight) {
    rail.scrollTop = top + tab.offsetHeight - rail.clientHeight;
  }
}

function selectPage(pageNumber) {
  if (!tabs.length || !Number.isInteger(pageNumber)) return;
  const page = Math.min(Math.max(pageNumber, 1), tabs.length);
  if (page === selectedPage && tabs[page - 1]?.getAttribute("aria-current") === "page") return;
  if (selectedPage > 0) tabs[selectedPage - 1]?.removeAttribute("aria-current");
  selectedPage = page;
  tabs[page - 1].setAttribute("aria-current", "page");
  keepSelectedTabVisible(tabs[page - 1]);
}

function navigateToPage(pageNumber) {
  pageInput.value = String(pageNumber);
  pageInput.dispatchEvent(new Event("change", { bubbles: true }));
  selectPage(pageNumber);
}

function renderLabels(nextLabels) {
  for (let index = 0; index < tabs.length; index += 1) {
    const label = nextLabels[index];
    if (labels[index] === label) continue;
    const tab = tabs[index];
    tab.textContent = label;
    tab.title = label === String(index + 1)
      ? "PDF page " + (index + 1)
      : "Document page " + label + " (PDF page " + (index + 1) + ")";
    tab.setAttribute("aria-label", "Go to document page " + label + ", PDF page " + (index + 1));
  }
  labels = nextLabels;
}

async function scanVisiblePageNumbers() {
  if (!isVisible()) return;
  const index = await pageLabelIndexReady;
  if (index && isVisible()) await index.scan(isVisible);
}

function updateVisibility() {
  const visible = isVisible();
  rail.setAttribute("aria-hidden", String(!visible));
  rail.inert = !visible;
  if (visible) {
    keepSelectedTabVisible(tabs[selectedPage - 1]);
    void scanVisiblePageNumbers();
  }
}

window.addEventListener("pdf-viewer-page-changed", (event) => selectPage(event.detail?.pageNumber));
window.addEventListener("pdf-viewer-page-tabs-mode-change", updateVisibility);
window.addEventListener("resize", updateVisibility);
rail.addEventListener("click", (event) => {
  const tab = event.target.closest(".page-tab");
  if (tab && rail.contains(tab)) navigateToPage(Number(tab.dataset.page));
});
rail.addEventListener("keydown", (event) => {
  const tab = event.target.closest(".page-tab");
  if (!tab) return;
  const page = Number(tab.dataset.page);
  const target = event.key === "ArrowUp" ? page - 1 :
    event.key === "ArrowDown" ? page + 1 :
    event.key === "Home" ? 1 : event.key === "End" ? tabs.length : null;
  if (target === null || target < 1 || target > tabs.length) return;
  event.preventDefault();
  tabs[target - 1].focus();
  navigateToPage(target);
});

async function initialize() {
  const index = await pageLabelIndexReady;
  if (!index) return;
  const count = index.getLabels().length;
  const fragment = document.createDocumentFragment();
  tabs = Array.from({ length: count }, (_, pageIndex) => {
    const tab = document.createElement("button");
    tab.className = "page-tab";
    tab.type = "button";
    tab.dataset.page = String(pageIndex + 1);
    fragment.append(tab);
    return tab;
  });
  rail.replaceChildren(fragment);
  index.subscribe(renderLabels);
  selectPage(Number(pageInput.value) || 1);
  updateVisibility();
  await index.loadMetadata();
  void scanVisiblePageNumbers();
}
void initialize();
