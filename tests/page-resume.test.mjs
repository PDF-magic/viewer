import assert from "node:assert/strict";
import test from "node:test";

import { readResumedPage, saveResumedPage } from "../src/viewer/page-resume.js";

function storageFixture() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    setRaw(value) { values.set("pdf-viewer-resume-page", value); },
  };
}

test("refresh restores the latest physical page of the same PDF in its tab", () => {
  const storage = storageFixture();
  const source = new URL("https://example.org/report.pdf");
  assert.equal(readResumedPage(storage, source), null);
  saveResumedPage(storage, source, "", 8);
  saveResumedPage(storage, source, "", 37);
  assert.equal(readResumedPage(storage, source), 37);
});

test("resume state is isolated by original PDF, including local documents", () => {
  const storage = storageFixture();
  saveResumedPage(storage, new URL("file:///docs/first.pdf"), "", 42);
  assert.equal(readResumedPage(storage, new URL("file:///docs/first.pdf")), 42);
  assert.equal(readResumedPage(storage, new URL("file:///docs/second.pdf")), null);
});

test("the same incoming page fragment resumes but a different link starts fresh", () => {
  const storage = storageFixture();
  const linkedSource = new URL("https://example.org/report.pdf#page=5");
  saveResumedPage(storage, linkedSource, "", 26);
  assert.equal(readResumedPage(storage, linkedSource), 26);
  assert.equal(readResumedPage(storage, new URL("https://example.org/report.pdf#page=7")), null);
  assert.equal(readResumedPage(storage, new URL("https://example.org/report.pdf")), null);
});

test("viewer URL fragments cannot inherit a previous link's resume state", () => {
  const storage = storageFixture();
  const source = new URL("https://example.org/report.pdf");
  saveResumedPage(storage, source, "#page=3", 22);
  assert.equal(readResumedPage(storage, source, "#page=3"), 22);
  assert.equal(readResumedPage(storage, source, "#page=9"), null);
});

test("corrupt or unavailable session storage falls back safely", () => {
  const storage = storageFixture();
  const source = new URL("https://example.org/report.pdf");
  storage.setRaw("{bad");
  assert.equal(readResumedPage(storage, source), null);
  storage.setRaw('{"document":"https://example.org/report.pdf","sourceHash":"","viewerHash":"","page":-2}');
  assert.equal(readResumedPage(storage, source), null);

  const unavailable = {
    getItem() { throw new Error("storage blocked"); },
    setItem() { throw new Error("storage blocked"); },
  };
  assert.equal(readResumedPage(unavailable, source), null);
  assert.doesNotThrow(() => saveResumedPage(unavailable, source, "", 4));
});
