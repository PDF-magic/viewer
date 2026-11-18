import assert from 'node:assert/strict';
import test from 'node:test';
import { paragraphAtSpan, paragraphCopyText, installParagraphDoubleClick } from '../src/viewer/selection/paragraph-double-click.js';

function span(text, x, y, width = text.length * 6, dataset = {}, height = 12) {
  return { textContent: text, dataset, getBoundingClientRect: () => ({
    left: x, right: x + width, top: y, bottom: y + height, width, height,
  }) };
}

test('selects all wrapped lines but stops at a new paragraph indent', () => {
  const a = span('This is a paragraph', 20, 20, 160);
  const b = span('continued on line two', 20, 35, 150);
  const c = span('with a third line.', 20, 50, 140);
  const d = span('A separate paragraph', 48, 65, 180);
  const e = span('continues here', 20, 80, 130);
  assert.deepEqual(paragraphAtSpan([a,b,c,d,e],b).spans, [a,b,c]);
  assert.equal(paragraphCopyText(paragraphAtSpan([a,b,c,d,e],b).lines),
    'This is a paragraph continued on line two with a third line.');
  assert.deepEqual(paragraphAtSpan([a,b,c,d,e],e).spans, [d,e]);
});

test('uses semantic tags instead of visual guesses when available', () => {
  const a = span('Tagged paragraph line one',20,20,175,{copyBlock:'5',copyRole:'P'});
  const b = span('line two',20,35,80,{copyBlock:'5',copyRole:'P'});
  const c = span('Different block',20,50,150,{copyBlock:'6',copyRole:'P'});
  assert.deepEqual(paragraphAtSpan([a,b,c],b).spans,[a,b]);
});

test('excludes other columns and detached headings', () => {
  const left1 = span('Left column line one',20,20,155);
  const left2 = span('Left column line two',20,35,150);
  const right1 = span('Right column line one',220,20,155);
  const right2 = span('Right column line two',220,35,150);
  const heading = span('Heading',20,0,55,{},20);
  const items=[heading,right2,left1,right1,left2];
  assert.deepEqual(paragraphAtSpan(items,left1).spans,[left1,left2]);
  assert.deepEqual(paragraphAtSpan(items,right1).spans,[right1,right2]);
});

test('reflows split font runs using the existing Markdown formatter', () => {
  const a = span('Hello',20,20,35,{markdownBold:'true'});
  const b = span('world.',60,20,40,{markdownItalic:'true'});
  const c = span('Again.',20,35,60);
  const p=paragraphAtSpan([a,b,c],b);
  assert.deepEqual(p.spans,[a,b,c]);
  assert.equal(paragraphCopyText(p.lines,true),'**Hello** _world._ Again.');
});

test('double-click highlights and copies; unrelated clicks are untouched', async () => {
  const first=span('Hello world',20,20,100);
  const second=span('from the PDF.',20,35,100);
  const spans=[first,second];
  const layer={querySelectorAll:()=>spans};
  for (const s of spans) s.closest=selector=>selector==='.text-layer'?layer:null;
  const selection={removeAllRanges(){this.ranges=[];},addRange(r){this.ranges.push(r);}};
  const handlers={}, clipboard={};
  const doc={
    addEventListener(type,handler){handlers[type]=handler;},
    createRange(){return {setStartBefore(s){this.start=s;},setEndAfter(s){this.end=s;}};},
    getSelection(){return selection;},
    execCommand(command){
      assert.equal(command,'copy');
      handlers.copy({clipboardData:{setData(type,value){clipboard[type]=value;}},preventDefault(){}});
      return true;
    },
  };
  const events=[];
  const view={dispatchEvent(e){events.push(e);},CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail;}}};
  installParagraphDoubleClick({contains:()=>true},{checked:false},doc,view);
  const target={closest(selector){
    if(selector.startsWith('a,'))return null;
    if(selector.startsWith('.text-layer'))return second;
    return null;
  }};
  await handlers.dblclick({button:0,target,preventDefault(){}});
  assert.equal(clipboard['text/plain'],'Hello world from the PDF.');
  assert.equal(selection.ranges[0].start,first);
  assert.equal(selection.ranges[0].end,second);
  assert.equal(events[0].detail.message,'Copied paragraph');
});
