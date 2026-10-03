import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const markup = readFileSync(new URL("../src/viewer.html", import.meta.url), "utf8");
const source = readFileSync(new URL("../src/viewer/loading-image-setting.js", import.meta.url), "utf8");

test("the tools menu supports persistent custom loading images", () => {
  assert.match(markup, /id="choose-loading-image"[\s\S]*?Custom loading image…/);
  assert.match(markup, /id="reset-loading-image"[\s\S]*?Use default loading image/);
  assert.match(markup, /id="custom-loading-image"[\s\S]*?accept="image\/png,image\/jpeg,image\/webp,image\/gif"/);
  assert.match(markup, /src="viewer\/loading-image-setting\.js"/);
  assert.match(source, /localStorage\.getItem\(IMAGE_STORAGE_KEY\)/);
  assert.match(source, /localStorage\.setItem\(IMAGE_STORAGE_KEY, dataUrl\)/);
  assert.match(source, /root\.style\.setProperty\("--loading-image"/);
  assert.match(source, /MAX_IMAGE_BYTES = 3 \* 1024 \* 1024/);
});
