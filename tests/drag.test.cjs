'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const M=require('../project.js');
const {Window}=require('happy-dom');
const png=require('@napi-rs/canvas').createCanvas(1,1).toDataURL('image/png');
const fixture=()=>M.normalize({version:2,name:'Drag',cats:[{id:'a',name:'A',traits:[{id:'t',name:'T',data:png}]},{id:'b',name:'B',traits:[{id:'u',name:'U',data:png}]}],selected:{a:'t',b:'u'},rules:[],snapshots:[],organizer:{a:{folders:[{id:'f',name:'Parent',parentId:null},{id:'child',name:'Child',parentId:'f'},{id:'sibling',name:'Sibling',parentId:null}],assignments:{t:'child'}},b:{folders:[{id:'dest',name:'Destination',parentId:null}],assignments:{u:'dest'}}}});
{
 const p=fixture(),original=JSON.stringify(p);
 assert.equal(M.moveFolder(p,'a','f','a','child','inside'),false);assert.equal(JSON.stringify(p),original);
 assert.equal(M.moveFolder(p,'a','f','a','f','after'),false);
 assert.equal(M.moveFolder(p,'a','sibling','a','f','before'),true);assert.equal(p.organizer.a.folders[0].id,'sibling');
 assert(M.moveFolder(p,'a','sibling','a','child','inside'));assert.equal(p.organizer.a.folders.find(f=>f.id==='sibling').parentId,'child');
 assert(M.moveFolder(p,'a','sibling','a',null,'inside'));assert.equal(p.organizer.a.folders.find(f=>f.id==='sibling').parentId,null);
 const before=M.clone(p);assert(M.moveFolder(p,'a','f','b','dest','inside'));
 assert.equal(p.cats[0].traits.length,0);assert.equal(p.cats[1].traits.length,2);assert.equal(p.organizer.b.assignments.t,'child');
 assert.equal(p.organizer.b.folders.find(f=>f.id==='f').parentId,'dest');assert.equal(p.organizer.b.folders.find(f=>f.id==='child').parentId,'f');
 assert.equal(before.cats[0].traits.length,1);assert.equal(before.organizer.a.folders.find(f=>f.id==='f').parentId,null);
 assert.doesNotThrow(()=>M.normalize(p));
 assert(M.moveCategory(p,'a','b',true));assert.deepEqual(p.cats.map(c=>c.id),['b','a']);assert.equal(M.moveCategory(p,'a','b',true),false);
}
const w=new Window({settings:{disableJavaScriptFileLoading:true,disableJavaScriptEvaluation:true}});
w.document.write('<div id="dragStatus"></div><div class="drop-row" data-drop-kind="category" data-drop-id="a" data-category="a"><button class="drag-handle" data-drag-kind="category" data-drag-id="a" data-category="a">Drag</button><span class="category-name">A</span></div><div id="target" class="drop-row" data-drop-kind="category" data-drop-id="b" data-category="b">B</div>');
w.__state=fixture();w.M=M;w.$=id=>w.document.getElementById(id);w.ready=true;w.busy=false;w.state=w.__state;
w.organizerFolders=id=>w.state.organizer[id];w.organizerDescendants=()=>new Set();w.organizerExpanded={};w.organizerSelection={};w.active='a';
let changes=0;w.change=fn=>{fn();changes++};
const target=w.document.getElementById('target');target.getBoundingClientRect=()=>({top:100,bottom:150,height:50});
w.document.elementFromPoint=()=>target;
w.eval(fs.readFileSync(__dirname+'/../drag.js','utf8'));
const handle=w.document.querySelector('.drag-handle');
function pointer(type,x,y){handle.dispatchEvent(new w.PointerEvent(type,{bubbles:true,cancelable:true,pointerId:1,button:0,clientX:x,clientY:y}));}
pointer('pointerdown',10,10);pointer('pointermove',20,140);assert(w.document.querySelector('.drag-ghost'));assert(target.classList.contains('drop-after'));
pointer('pointerup',20,140);assert.deepEqual(w.state.cats.map(c=>c.id),['b','a']);assert.equal(changes,1);assert(!w.document.querySelector('.drag-ghost'));
pointer('pointerdown',10,10);pointer('pointermove',20,110);w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));pointer('pointerup',20,110);assert.equal(changes,1);
w.busy=true;pointer('pointerdown',10,10);pointer('pointermove',20,110);assert(!w.document.querySelector('.drag-ghost'));
// Controlled animation clock: depth controls velocity, time controls distance.
w.busy=false;let scheduled=null,scrolls=[];
w.requestAnimationFrame=cb=>{scheduled=cb;return 1;};w.cancelAnimationFrame=()=>{scheduled=null;};w.scrollBy=(x,y)=>scrolls.push(y);
Object.defineProperty(w,'innerHeight',{value:800,configurable:true});
function tick(t){const cb=scheduled;scheduled=null;if(cb)cb(t);}
pointer('pointerdown',10,10);pointer('pointermove',20,705);tick(0);const slow=scrolls.pop();
pointer('pointermove',20,790);tick(16.67);const fast=scrolls.pop();assert(slow>0&&fast>slow*4,'speed grows toward bottom edge');
scrolls=[];pointer('pointermove',20,400);tick(33.34);assert.equal(scrolls.length,0,'center does not scroll');
pointer('pointermove',20,5);tick(50);assert(scrolls.pop()<0,'top scrolls upward');
pointer('pointercancel',20,5);assert.equal(scheduled,null,'cancel stops frame loop');
const dock=w.document.createElement('div');dock.id='workspaceDock';w.document.body.append(dock);
dock.getBoundingClientRect=()=>({top:740,bottom:800,height:60});
scrolls=[];
pointer('pointerdown',10,10);pointer('pointermove',20,655);tick(70);
assert(scrolls.pop()>0,'the lower auto-scroll zone starts above the visible dock');
pointer('pointercancel',20,655);dock.hidden=true;
// A full inner scroller hands scrolling to the page instead of trapping the drag.
const panel=w.document.createElement('div');panel.style.overflowY='auto';target.before(panel);panel.append(target);
Object.defineProperty(panel,'scrollHeight',{value:1000});Object.defineProperty(panel,'clientHeight',{value:300});panel.scrollTop=700;
panel.getBoundingClientRect=()=>({top:100,bottom:400,height:300});scrolls=[];
pointer('pointerdown',10,10);pointer('pointermove',20,395);tick(100);assert(scrolls.pop()>0,'saturated nested list passes movement to outer page');
pointer('pointercancel',20,395);
panel.scrollTop=200;scrolls=[];pointer('pointerdown',10,10);pointer('pointermove',20,395);tick(120);assert(panel.scrollTop>200);assert.equal(scrolls.length,0,'inner scroller gets priority');
pointer('pointerup',20,395);assert.equal(scheduled,null,'drop stops loop');
// Trait drag stays in one folder and changes the real saved order.
const cat=M.category(w.state,'a');
cat.traits.push({id:'t2',name:'T2',data:png},{id:'other',name:'Other',data:png});
w.state.organizer.a.assignments.t2='child';
w.document.body.insertAdjacentHTML('beforeend', `<div id="traitSource" class="drop-row" data-drop-kind="trait" data-drop-id="t" data-category="a" data-parent="child"><button class="layer-drag-row" data-drag-kind="trait" data-drag-id="t" data-category="a"><span class="layer-tree-label">T</span></button></div><div id="traitTarget" class="drop-row" data-drop-kind="trait" data-drop-id="t2" data-category="a" data-parent="child">T2</div><div id="otherTarget" class="drop-row" data-drop-kind="trait" data-drop-id="other" data-category="a" data-parent="">Other</div>`);
const traitButton=w.document.querySelector('#traitSource .layer-drag-row');
const targetTrait=w.document.getElementById('traitTarget'), otherTarget=w.document.getElementById('otherTarget');
for(const row of [targetTrait,otherTarget]) row.getBoundingClientRect=()=>({top:100,bottom:150,height:50});
const traitPointer=(type,y)=>traitButton.dispatchEvent(new w.PointerEvent(type,{bubbles:true,cancelable:true,pointerId:2,pointerType:'mouse',button:0,clientX:16,clientY:y}));
w.document.elementFromPoint=()=>otherTarget;
traitPointer('pointerdown',10);traitPointer('pointermove',140);assert(!otherTarget.classList.contains('drop-after'));traitPointer('pointerup',140);
assert.deepEqual(cat.traits.map(t=>t.id),['t','t2','other']);
w.document.elementFromPoint=()=>targetTrait;
traitPointer('pointerdown',10);traitPointer('pointermove',140);assert(targetTrait.classList.contains('drop-after'));traitPointer('pointerup',140);
assert.deepEqual(cat.traits.map(t=>t.id),['t2','t','other']);
// Swiping a row scrolls normally. Holding it first enables the same drag engine.
const rowButton = w.document.querySelector('.drag-handle');
rowButton.className = 'layer-drag-row';
let hold;
const setTimeout = w.setTimeout.bind(w), clearTimeout = w.clearTimeout.bind(w);
w.setTimeout = (run,delay) => { if (delay === 300) { hold = run; return -1; } return setTimeout(run,delay); };
w.clearTimeout = id => { if (id === -1) hold = null; else clearTimeout(id); };
function touchRow(type,x,y) {
 const event = new w.Event(type,{bubbles:true,cancelable:true});
 const touches = [{identifier:3,clientX:x,clientY:y}];
 Object.defineProperties(event,{touches:{value:type==='touchend'?[]:touches},changedTouches:{value:touches}});
 rowButton.dispatchEvent(event);
 return event;
}
w.document.elementFromPoint=()=>target;
touchRow('touchstart',10,10);
assert(!touchRow('touchmove',10,30).defaultPrevented);
assert.equal(hold,null);
assert(!touchRow('touchend',10,30).defaultPrevented);
touchRow('touchstart',10,10);
assert(!touchRow('touchend',10,10).defaultPrevented);
assert.equal(hold,null);
touchRow('touchstart',10,10);
hold();
assert(w.document.querySelector('.drag-ghost'));
assert.equal(scheduled,null,'holding near an edge waits for the first drag movement');
assert(touchRow('touchmove',10,110).defaultPrevented);
assert(target.classList.contains('drop-before'));
assert(touchRow('touchend',10,110).defaultPrevented);
assert.deepEqual(w.state.cats.map(c=>c.id),['a','b']);
w.happyDOM.abort();w.close();console.log('PASS drag: ordering, nesting, cycle rejection, cross-category subtree/traits, clone/undo, pointer drop, Escape and busy guard');
