import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const detector = readFileSync(new URL("../src/content/plain-html-detection.js", import.meta.url), "utf8");
const handler = readFileSync(new URL("../src/content/sec-comment.js", import.meta.url), "utf8");
const settings = readFileSync(new URL("../src/viewer/viewer-settings.js", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const ctx=vm.createContext({ URL });
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

test("raw SEC EDGAR HTML qualifies despite extensive legacy styling", () => {
  const filing = "https://www.sec.gov/Archives/edgar/data/1761325/000119312522184158/filename1.htm";
  const legacy = page({complex:true, divs:100, styled:200, named:200});
  assert.equal(ctx.pdfMagicIsPlainHtmlDocument(legacy), false);
  assert.equal(ctx.pdfMagicIsRawEdgarHtmlDocument(legacy, filing), true);
  assert.equal(ctx.pdfMagicIsRawEdgarHtmlDocument(legacy, filing.replace(".htm", ".html")), true);
});

test("raw SEC EDGAR detection rejects lookalikes, other sites, and non-HTML", () => {
  const filing = "https://www.sec.gov/Archives/edgar/data/1761325/000119312522184158/filename1.htm";
  assert.equal(ctx.pdfMagicIsRawEdgarHtmlDocument(page(), filing), true);
  assert.equal(ctx.pdfMagicIsRawEdgarHtmlDocument(page(), filing.replace("www.sec.gov", "sec.gov.evil.example")), false);
  assert.equal(ctx.pdfMagicIsRawEdgarHtmlDocument(page(), filing.replace("https:", "http:")), false);
  assert.equal(ctx.pdfMagicIsRawEdgarHtmlDocument(page(), filing.replace(".htm", ".pdf")), false);
  assert.equal(ctx.pdfMagicIsRawEdgarHtmlDocument(page(), "https://www.sec.gov/Archives/edgar/data/1761325/"), false);
  assert.equal(ctx.pdfMagicIsRawEdgarHtmlDocument(page(), "https://www.sec.gov/ixviewer/doc.html"), false);
  assert.equal(ctx.pdfMagicIsRawEdgarHtmlDocument(page({type:"application/pdf"}), filing), false);
  assert.equal(ctx.pdfMagicIsRawEdgarHtmlDocument(page({text:" "}), filing), false);
  assert.equal(ctx.pdfMagicIsRawEdgarHtmlDocument(page(), "not-a-url"), false);
});

test("raw EDGAR filing colors follow the saved viewer theme and opt-out", async () => {
  const filing = "https://www.sec.gov/Archives/edgar/data/1761325/000119312522184158/filename1.htm";
  const doc = page({complex:true, styled:200, named:200});
  const nodes = new Map();
  const listeners = [];
  const stored = {"pdf-viewer-theme":"dark", "pdf-viewer-sec-comment-dark-mode":true};
  doc.head = {append(node) {nodes.set(node.id, node);}};
  doc.createElement = () => ({
    id:"", textContent:"",
    remove() {nodes.delete(this.id);}
  });
  doc.getElementById = (id) => nodes.get(id) || null;
  const chrome = {
    runtime:{getManifest:()=>({background:{service_worker:"src/background.js"}})},
    storage:{
      local:{get:async()=>({...stored})},
      onChanged:{addListener:(callback)=>listeners.push(callback)}
    }
  };
  const context = vm.createContext({URL, document:doc, window:{location:new URL(filing)}, chrome});
  vm.runInContext(detector, context);
  vm.runInContext(handler, context);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush();

  const darkId = "pdf-viewer-sec-comment-dark-style";
  assert.ok(nodes.has(darkId));
  assert.match(nodes.get(darkId).textContent, /body \*:not\(svg\):not\(svg \*\):not\(canvas\)/);
  assert.match(nodes.get(darkId).textContent, /body a:visited/);
  assert.equal(nodes.has("pdf-viewer-sec-chatgpt"), false);

  stored["pdf-viewer-theme"] = "light";
  listeners[0]({"pdf-viewer-theme":{newValue:"light"}}, "local");
  await flush();
  assert.equal(nodes.has(darkId), false);

  stored["pdf-viewer-theme"] = "dark";
  stored["pdf-viewer-sec-comment-dark-mode"] = false;
  listeners[0]({"pdf-viewer-theme":{newValue:"dark"}}, "local");
  await flush();
  assert.equal(nodes.has(darkId), false);

  stored["pdf-viewer-sec-comment-dark-mode"] = true;
  listeners[0]({"pdf-viewer-sec-comment-dark-mode":{newValue:true}}, "local");
  await flush();
  assert.equal(nodes.has(darkId), true);
});
