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
w.happyDOM.abort();w.close();console.log('PASS drag: ordering, nesting, cycle rejection, cross-category subtree/traits, clone/undo, pointer drop, Escape and busy guard');
