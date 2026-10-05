const INITIAL_FIT_WIDTH_ASPECT_TOLERANCE = 1.4;

function pageAspectRatio(pageElement) {
  const [width, height] = pageElement.style
    .getPropertyValue("--page-ratio")
    .split("/")
    .map((value) => Number.parseFloat(value.trim()));

  if (Number.isFinite(width) && Number.isFinite(height) && height > 0) {
    return width / height;
  }

  const rect = pageElement.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    return rect.width / rect.height;
  }

  return 8.5 / 11;
}

function shouldStartFitWidth(pageElement) {
  if (window.innerWidth <= 0 || window.innerHeight <= 0) {
    return false;
  }

  const viewportRatio = window.innerWidth / window.innerHeight;
  const documentRatio = pageAspectRatio(pageElement);
  const aspectDistance = Math.max(
    viewportRatio / documentRatio,
    documentRatio / viewportRatio,
  );

  return aspectDistance <= INITIAL_FIT_WIDTH_ASPECT_TOLERANCE;
}

const viewer = document.querySelector("#viewer");
const fitWidthButton = document.querySelector("#fit-width");
let initialZoomResolved = false;

function resolveInitialZoom() {
  if (initialZoomResolved || !viewer || !fitWidthButton) {
    return initialZoomResolved;
  }

  const firstPage = viewer.querySelector(".page");
  if (!firstPage) {
    return false;
  }

  initialZoomResolved = true;
  if (shouldStartFitWidth(firstPage)) {
    fitWidthButton.click();
  }

  return true;
}

if (!resolveInitialZoom() && viewer && fitWidthButton) {
  const observer = new MutationObserver(() => {
    if (resolveInitialZoom()) {
      observer.disconnect();
    }
  });

  observer.observe(viewer, { childList: true });
}
