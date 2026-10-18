import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const detector = readFileSync(new URL("../src/content/plain-html-detection.js", import.meta.url), "utf8");
const handler = readFileSync(new URL("../src/content/sec-comment.js", import.meta.url), "utf8");
const settings = readFileSync(new URL("../src/viewer/viewer-settings.js", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const ctx=vm.createContext({});
vm.runInContext(detector,ctx);
function page({text="plain HTML text", type="text/html", complex=false, divs=0, styled=0, named=0}={}) {
  return { contentType:type, documentElement:{}, body:{textContent:text},
    querySelector:()=>complex ? {} : null,
    querySelectorAll:(selector)=>Array(
      selector==="div, section, article" ? divs : selector==="[style]" ? styled : selector==="[class], [id]" ? named : 0
    ).fill({}) };
}
test("plain HTML is eligible, but empty text and non-HTML are not",()=>{
  assert.equal(ctx.pdfMagicIsPlainHtmlDocument(page()),true);
  assert.equal(ctx.pdfMagicIsPlainHtmlDocument(page({text:" "})),false);
  assert.equal(ctx.pdfMagicIsPlainHtmlDocument(page({type:"application/pdf"})),false);
});
test("modern website structure is excluded",()=>{
  assert.equal(ctx.pdfMagicIsPlainHtmlDocument(page({complex:true})),false);
  assert.equal(ctx.pdfMagicIsPlainHtmlDocument(page({divs:13})),false);
  assert.equal(ctx.pdfMagicIsPlainHtmlDocument(page({styled:17})),false);
  assert.equal(ctx.pdfMagicIsPlainHtmlDocument(page({named:26})),false);
});
test("coverage and old preference survive, SEC ChatGPT stays SEC-only",()=>{
  assert.deepEqual(manifest.content_scripts[0].matches,["http://*/*","https://*/*"]);
  assert.deepEqual(manifest.content_scripts[0].js,["src/content/plain-html-detection.js","src/content/sec-comment.js"]);
  assert.match(handler,/setCommentActionVisible\(darkModeActive && isCommentPage\)/);
  assert.match(settings,/Darken basic HTML pages/);
  assert.match(settings,/pdf-viewer-sec-comment-dark-mode/);
});
