const previousButton = document.querySelector("#previous-page");
const nextButton = document.querySelector("#next-page");
const pageNumberInput = document.querySelector("#page-number");
const viewer = document.querySelector("#viewer");

const RAPID_NAVIGATION_WINDOW_MS = 350;

let requestedPage = null;
let resetTimer;

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function parsedPage(value) {
  const page = Number.parseInt(value, 10);
  return Number.isFinite(page) ? page : null;
}

function maximumPage() {
  return Math.max(1, parsedPage(pageNumberInput.max) || 1);
}

function displayedPage() {
  return clamp(parsedPage(pageNumberInput.value) || 1, 1, maximumPage());
}

function scrollToPageImmediately(pageNumber) {
  const pageElement = viewer.querySelector(`.page[data-page="${pageNumber}"]`);
  if (!pageElement) {
    return;
  }

  if (pageNumber === 1) {
    window.scrollTo({ top: 0, behavior: "auto" });
    return;
  }

  const toolbarHeight = document.querySelector(".toolbar")?.getBoundingClientRect().height ?? 52;
  const progressHeight = document.querySelector("#enhance-progress")?.getBoundingClientRect().height ?? 0;
  const pageTop = window.scrollY + pageElement.getBoundingClientRect().top;
  window.scrollTo({
    top: Math.max(0, pageTop - toolbarHeight - progressHeight),
    behavior: "auto",
  });
}

function navigateBy(delta) {
  if (requestedPage === null) {
    requestedPage = displayedPage();
  }

  requestedPage = clamp(requestedPage + delta, 1, maximumPage());
  pageNumberInput.value = String(requestedPage);
  pageNumberInput.dispatchEvent(new Event("change", { bubbles: true }));
  scrollToPageImmediately(requestedPage);

  clearTimeout(resetTimer);
  resetTimer = setTimeout(() => {
    requestedPage = null;
  }, RAPID_NAVIGATION_WINDOW_MS);
}

function interceptPageButton(event, delta) {
  event.preventDefault();
  event.stopImmediatePropagation();
  navigateBy(delta);
}

previousButton.addEventListener("click", (event) => interceptPageButton(event, -1), true);
nextButton.addEventListener("click", (event) => interceptPageButton(event, 1), true);
