'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const Base = require('../inventory-base');
const M = require('../project');

const from = (nodes) => Base.normalize({ format:Base.format,nodes });
const cat = (id,name,children) => ({ id,name,kind:'category',children });
const trait = (id,name,kind='layer',extra={}) => ({ id,name,kind,...extra });

test('the dripd base has its confirmed thumbnails, folders and separate planned items', () => {
  const source = Base.normalize(JSON.parse(fs.readFileSync(__dirname+'/../inventory-dripd.json','utf8')));
  const flatten = nodes => nodes.flatMap(node => [node,...flatten(node.children || [])]);
  const all = flatten(source.nodes);
  assert.equal(source.nodes.length,13);
  assert.equal(all.filter(item => item.kind === 'layer' && item.image).length,97);
  assert.equal(all.filter(item => item.kind === 'folder').length,21);
  assert.equal(all.filter(item => item.kind === 'plan').length,117);
  assert.equal(all.filter(item => item.name === 'FireLook').length,2);
});

test('imports preserve notes, edited names, decisions and distinct same-name layers', () => {
  const base = from([cat('eyes','EYES',[
    trait('planned','FireLook','plan',{ note:'Doplnit',decision:'todo' }),trait('extra','FireLook'),
  ])]);
  const project = from([cat('project-eyes','EYES',[
    trait('p-1','FireLook','layer',{ sources:['project:p-1'],image:'data:image/png;base64,AA==' }),
    trait('p-2','FireLook','layer',{ sources:['project:p-2'] }),
  ])]);
  assert.deepEqual(Base.merge(base.nodes,project.nodes),{added:0,matched:3});
  const first=base.nodes[0].children[0];
  assert.equal(first.kind,'layer'); assert.equal(first.decision,'todo'); assert.equal(first.note,'Doplnit');
  Base.applyEdit(base.nodes,{ id:first.id,name:'Fialový FireLook',note:'Můj název',kind:'layer' });
  Base.setField(base.nodes,[first.id],'fin',true);
  assert.deepEqual(Base.merge(base.nodes,project.nodes),{added:0,matched:3});
  assert.equal(first.name,'Fialový FireLook'); assert.equal(first.note,'Můj název'); assert.equal(first.fin,true);
  assert.equal(base.nodes[0].children.length,2);
});

test('project and document inventories retain group hierarchy and strip arbitrary image URLs', () => {
  const state=M.empty(); state.cats=[{ id:'cats',name:'HAIRS',traits:[{ id:'a',name:'Afro',data:'png' }] }];
  state.organizer.cats={ folders:[{ id:'folder',name:'Afro',parentId:null }],assignments:{ a:'folder' } };
  const [category]=Base.projectTree(M,state,{ includeData:true });
  assert.equal(category.children[0].children[0].data,'png');
  const document=Base.fromDocument([{ id:'grp',name:'HAIRS',group:true,children:[{ id:'leaf',name:'Afro' }] }],'project.psd');
  assert.equal(document.nodes[0].children[0].name,'Afro');
  document.nodes[0].children[0].image='https://example.com/track';
  assert.equal(Base.normalize(document).nodes[0].children[0].image,undefined);
});
