const assert = require('node:assert/strict'), P = require('../psd-core');
let id=0;
const nodes=Array.from({length:601},(_,j)=>({id:'n'+j,name:'L'+j,supported:true,warnings:[]}));
const plan=P.plan({tree:nodes},nodes.map(n=>n.id),'layers',()=> 'id'+ ++id);
const state={cats:[],organizer:{},selected:{}};
let checkpoints=0;
for(let offset=0;offset<nodes.length;offset+=8){
 const jobs=plan.jobs.slice(offset,offset+8);
 for(const j of jobs) plan.cats.find(c=>c.id===j.categoryId).traits[0].data='data:image/png;base64,test';
 P.applyBatch(state,plan,jobs,'layers');
 const persisted=JSON.parse(JSON.stringify(state));
 assert.equal(persisted.cats.length,Math.min(offset+8,601));
 P.applyBatch(state,plan,jobs,'layers');
 assert.equal(state.cats.length,persisted.cats.length);
 checkpoints++;
}
assert.deepEqual(state.cats.map(c=>c.name),nodes.map(n=>n.name));
assert.equal(checkpoints,76);
console.log('601 layers: 76 complete checkpoints, stable order, no duplicate retry.');
