const pageNumberInput = document.querySelector("#page-number");
const pageCountButton = document.querySelector("#page-count");

pageNumberInput?.addEventListener("click", () => {
  pageNumberInput.select();
});

pageCountButton?.addEventListener("click", () => {
  const lastPage = Number.parseInt(pageNumberInput.max, 10);
  if (!Number.isFinite(lastPage) || lastPage < 1) return;

  // Reuse the normal page-field change path to update navigation and scrolling.
  pageNumberInput.value = String(lastPage);
  pageNumberInput.dispatchEvent(new Event("change", { bubbles: true }));
});
