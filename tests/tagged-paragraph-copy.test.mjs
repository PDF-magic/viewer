import assert from "node:assert/strict";
import test from "node:test";
import {
  markdownFromRuns, structureContentOrder, markPdfTextStructure,
  selectionToMarkdown, installMarkdownCopy,
} from "../src/viewer/selection/markdown-copy.js";

const tree = {role:'Root', children:[
 {role:'Document',children:[
  {role:'P', children:[{type:'content',id:'p12_mc1'}, {type:'content',id:'p12_mc2'}]},
  {role:'P', children:[{type:'content',id:'p12_mc3'}]},
 ]}
]};

test('maps MCIDs into logical paragraph order despite content stream order',()=>{
 const order=structureContentOrder(tree);
 assert.deepEqual([...order].map(([id, x])=>[id,x.order,x.block,x.role]),[
 ['p12_mc1',0,0,'P'],['p12_mc2',1,0,'P'],['p12_mc3',2,1,'P']]);
});

test('marks children of PDF.js markedContent without touching unrelated spans',()=>{
 const a={dataset:{}}, b={dataset:{}}, c={dataset:{}};
 const wrappers=[
  {id:'p12_mc3',querySelectorAll:()=>[c]},
  {id:'p12_mc1',querySelectorAll:()=>[a]},
  {id:'p12_mc2',querySelectorAll:()=>[b]},
 ];
 assert.equal(markPdfTextStructure({querySelectorAll:()=>wrappers},tree),3);
 assert.deepEqual(a.dataset,{copyOrder:'0',copyBlock:'0',copyRole:'P'});
 assert.deepEqual(c.dataset,{copyOrder:'2',copyBlock:'1',copyRole:'P'});
});

test('joins printed lines within tagged paragraphs but separates distinct paragraphs',()=>{
 const runs=[
  {text:'The opening',role:'P',block:'0'},
  {text:'paragraph',role:'P',block:'0',newLine:true},
  {text:'Another one.',role:'P',block:'1',newLine:true},
 ];
 assert.equal(markdownFromRuns(runs),'The opening paragraph\n\nAnother one.');
 assert.equal(markdownFromRuns(runs,{markdown:false}),'The opening paragraph\n\nAnother one.');
 assert.equal(markdownFromRuns(runs,{reflow:false}),'The opening\nparagraph\nAnother one.');
});

test('does not join untagged lines or guess at hyphenation',()=>{
 assert.equal(markdownFromRuns([{text:'first'},{text:'second',newLine:true}]),'first\nsecond');
 assert.equal(markdownFromRuns([{text:'co-',role:'P',block:'1'},{text:'operate',newLine:true,role:'P',block:'1'}]),'co- operate');
});

test('preserves italic emphasis across soft printed line breaks',()=>{
 assert.equal(markdownFromRuns([
 {text:'A ',role:'P',block:'2'},
 {text:'lovely',italic:true,role:'P',block:'2'},
 {text:' little',italic:true,role:'P',block:'2',newLine:true},
 {text:'book.',role:'P',block:'2',newLine:true},
 ]),'A _lovely little_ book.');
});

test('copies tagged plain paragraphs in logical order with Markdown disabled',()=>{
 const page={};
 const layer={closest:(sel)=>sel==='.text-layer'?layer:null};
 const textNodes=['Part', 'ISBN:', 'disclaimer'].map(value=>({textContent:value,parentElement:layer}));
 const spans=[2,0,1].map(index=>({dataset:{markdownItem:'true',copyOrder:String(index),copyBlock:String(index),copyRole:'P'},node:textNodes[index],closest:sel=>sel==='.page'?page:null}));
 const selection={isCollapsed:false,rangeCount:1,anchorNode:textNodes[0],focusNode:textNodes[2],getRangeAt:()=>({intersectsNode:()=>true,startContainer:null,endContainer:null})};
 const root={contains:element=>element===layer,querySelectorAll:()=>spans};
 let handler;
 const doc={getSelection:()=>selection,addEventListener:(name,fn)=>{if(name==='copy')handler=fn;},createTreeWalker(span){return{currentNode:null,nextNode(){if(this.done)return false;this.done=true;this.currentNode=span.node;return true;}};}};
 const old=globalThis.NodeFilter;globalThis.NodeFilter={SHOW_TEXT:4};
 try {
  assert.equal(selectionToMarkdown(root,selection,doc,{markdown:false}),'Part\n\nISBN:\n\ndisclaimer');
  const markdown={checked:false},paragraph={checked:true};
  installMarkdownCopy(root,markdown,doc,paragraph);
  const result={};let prevented=0;
  const event={clipboardData:{setData:(k,v)=>result[k]=v},preventDefault:()=>prevented++};
  handler(event);
  assert.equal(result['text/plain'],'Part\n\nISBN:\n\ndisclaimer');
  assert.equal(result['text/markdown'],undefined);
  assert.equal(prevented,1);
  paragraph.checked=false;
  const subsequent={};
  handler({clipboardData:{setData:(k,v)=>subsequent[k]=v},preventDefault:()=>prevented++});
  assert.deepEqual(subsequent,{});
  assert.equal(prevented,1);
 }finally {if(old===undefined)delete globalThis.NodeFilter;else globalThis.NodeFilter=old;}
});
