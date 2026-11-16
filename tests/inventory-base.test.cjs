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

test('approvals preserve the matched item, update its name and move it into the chosen folder', () => {
  const planned=trait('planned','Red','plan',{ note:'Moje poznámka',decision:'todo' });
  const folder={ id:'ready',name:'Ready',kind:'folder',children:[] };
  const base=from([cat('skin','SKIN',[planned,folder])]);
  Base.includeSuggestions(base,[{ id:'p',name:'Red',kind:'layer',parentId:'skin',targetId:'planned' }]);
  assert.equal(Base.approveSuggestion(base,'p',{name:'Red new',parentId:'ready',targetId:'planned'}),'planned');
  assert.equal(Base.locate(base.nodes,'planned').parent.id,'ready');
  assert.equal(Base.locate(base.nodes,'planned').item.note,'Moje poznámka');
  assert.equal(Base.locate(base.nodes,'planned').item.name,'Red new');
  assert.equal(Base.normalize(base).suggestions[0].status,'approved');
  assert.throws(()=>Base.approveSuggestion(base,'p',{name:'Red new',parentId:'ready',targetId:'planned'}),/vyřízen/);
});

test('a fixed folder layout keeps subfolders and distinct names while skipping plan sections', () => {
  const group=(id,name,children=[])=>({ id,name,kind:'group',children });
  const base=from([cat('h','HAIRS',[group('afro','Afro',[group('basic','Basic')]),group('draft','Z plánu · další')]),cat('l1','Leafs',[]),cat('l2','Leafs',[])]);
  assert.deepEqual(Base.folderLayout(base.nodes,value=>value),[
    {name:'HAIRS',path:'HAIRS',folders:['Afro','Afro/Basic']},
    {name:'Leafs',path:'Leafs',folders:[]},{name:'Leafs 2',path:'Leafs 2',folders:[]},
  ]);
});

test('text copies retain paths, repeated layer names and manual additions after re-import', () => {
  let base = Base.normalize({ format:Base.format,nodes:[],textItems:['SKINS','-MOSAIC','- WATER','Dokreslit oči'] });
  const nodes = [cat('glasses','Glasses',[
    { id:'rounded',name:'Rounded',kind:'folder',children:[trait('fl-1','FireLook'), trait('fl-2','FireLook')] },
    trait('solo','Solo','layer',{ note:'Poznámka',image:'data:image/png;base64,AA==' }),
  ])];
  const [skins] = base.textGroups;
  Base.addTextItem(base,skins.id,'Red');
  assert.deepEqual(skins.children.map(item => item.name),['MOSAIC','WATER','Red']);
  assert.deepEqual(base.textItems,['Dokreslit oči']);
  const first = Base.copyToText(base,nodes,'fl-1','project');
  assert.equal(first.name,'Glasses');
  assert.equal(first.added,1);
  Base.addTextItem(base,first.id,'Ručně');
  assert.equal(Base.copyToText(base,nodes,'glasses','project').added,2);
  base = Base.normalize(JSON.parse(JSON.stringify(base)));
  assert.equal(Base.copyToText(base,nodes,'glasses','project').added,0);
  const glasses = base.textGroups[1];
  assert.deepEqual(glasses.children[0].children.map(item => item.name),['FireLook','FireLook']);
  assert.deepEqual(glasses.children.map(item => item.name),['Rounded','Ručně','Solo']);
  assert(!JSON.stringify(glasses).includes('Poznámka'));
  assert.equal(Base.mergeTextGroups(base.textGroups,base.textGroups),0);
});

test('text edits persist on legacy and imported groups without changing their layer sources', () => {
  const legacy = { format:Base.format,nodes:[],textItems:['Poznámka','SKINS','- WATER','- GOLD'] };
  const base = Base.normalize(legacy);
  const [skins] = base.textGroups;
  const source = [cat('chains','CHAINS',[trait('first','China'),trait('second','China')])];
  Base.copyToText(base,source,'chains','project');
  const chains = base.textGroups[1];
  Base.editTextItem(base,chains.id,'up');
  Base.editTextItem(base,chains.id,'rename','Řetězy');
  Base.editTextItem(base,chains.children[1].id,'rename','China 2');
  Base.editTextItem(base,skins.children[0].id,'delete');
  Base.editTextItem(base,0,'rename','Upravená poznámka');
  const folder = Base.addTextItem(base,skins.id,'Nová složka',true);
  Base.addTextItem(base,folder,'Red');
  const saved = Base.normalize(JSON.parse(JSON.stringify(base)));
  assert.deepEqual(saved.textGroups.map(item => item.name),['Řetězy','SKINS']);
  assert.equal(Base.copyToText(saved,source,'chains','project').added,0);
  assert.deepEqual(saved.textGroups[0].children.map(item => item.name),['China','China 2']);
  assert.deepEqual(saved.textGroups[1].children.map(item => item.name),['GOLD','Nová složka']);
  assert.deepEqual(saved.textItems,['Upravená poznámka']);
  assert.equal(source[0].name,'CHAINS');
  assert.equal(source[0].children[1].name,'China');
  Base.editTextItem(saved,skins.id,'delete');
  assert.deepEqual(saved.textGroups.map(item => item.name),['Řetězy']);
});
