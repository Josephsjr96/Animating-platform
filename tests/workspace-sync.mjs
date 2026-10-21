import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {test} from 'node:test';

const source = await readFile(new URL('../static/workspace-sync.js', import.meta.url), 'utf8');
const fixture = () => ({project:{name:'Production'},shots:[{id:'shot1',number:'SH010'}],stages:[],people:[],cells:{}});
const deferred = () => {let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function setup(overrides={}) {
  const storage=new Map();
  const label={textContent:'',className:'',title:''};
  const body={inert:false,setAttribute(){},removeAttribute(){}};
  const context=vm.createContext({
    LS_KEY:'production-workspace-v1',backendOK:false,state:fixture(),
    loadState(){},saveState(){},seed:fixture,
    API:{getWorkspace:async()=>fixture(),saveWorkspace:async()=>({ok:true}),commit:async()=>({ok:true,workspace:fixture()}),...overrides},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    document:{body,getElementById:()=>label},window:{addEventListener(){}},console:{warn(){}},
  });
  vm.runInContext(source,context);
  return {context,storage,label,body};
}

test('load uses the existing cloud client without writing or seeding sample shots',async()=>{
  let writes=0;
  const {context}=setup({saveWorkspace:async()=>{writes++;return {ok:true};}});
  assert.equal((await context.loadState()).shots[0].id,'shot1');
  assert.equal(context.backendOK,true);assert.equal(writes,0);
  context.API.getWorkspace=async()=>({empty:true});
  assert.equal((await context.loadState()).shots.length,0);assert.equal(writes,0);
});

test('queued saves use ordered immutable snapshots',async()=>{
  const gate=deferred();const seen=[];
  const {context,storage}=setup({saveWorkspace:async workspace=>{seen.push(workspace.project.name);if(seen.length===1)await gate.promise;return {ok:true};}});
  await context.loadState();
  context.state.project.name='First';const first=context.saveState();
  context.state.project.name='Second';const second=context.saveState();
  context.state.project.name='Unqueued';
  await Promise.resolve();assert.deepEqual(seen,['First']);
  gate.resolve();assert.equal(await first,true);assert.equal(await second,true);
  assert.deepEqual(seen,['First','Second']);assert.equal(storage.has('production-workspace-v1-unsynced'),false);
});

test('failed saves retain a backup, stop later cloud writes and block import',async()=>{
  let writes=0,commits=0;
  const {context,storage,body}=setup({saveWorkspace:async()=>{writes++;throw new Error('Network unavailable');},commit:async()=>{commits++;return {ok:true};}});
  await context.loadState();context.state.project.name='Local work';
  assert.equal(await context.saveState(),false);
  context.state.project.name='Later local work';await context.saveState();
  assert.equal(writes,1);assert.equal(JSON.parse(storage.get('production-workspace-v1-unsynced')).project.name,'Later local work');
  await assert.rejects(context.API.commit('import1',{}),/not synced/);assert.equal(commits,0);assert.equal(body.inert,false);
  // A successful subsequent cloud read must not discard the separate failed-edit backup.
  await context.loadState();assert.equal(JSON.parse(storage.get('production-workspace-v1-unsynced')).project.name,'Later local work');
});

test('import waits for saves and adopts the server workspace before releasing the UI',async()=>{
  const gate=deferred(),order=[];
  const imported=fixture();imported.shots.push({id:'imported',number:'SH020'});
  const {context,body,storage}=setup({saveWorkspace:async()=>{order.push('save-start');await gate.promise;order.push('save-end');return {ok:true};},commit:async()=>{order.push('commit');return {ok:true,workspace:imported};}});
  await context.loadState();context.saveState();
  const result=context.API.commit('import1',{});assert.equal(body.inert,true);
  await Promise.resolve();assert.deepEqual(order,['save-start']);
  gate.resolve();await result;
  assert.deepEqual(order,['save-start','save-end','commit']);assert.equal(body.inert,false);
  assert.equal(context.state.shots.at(-1).id,'imported');assert.equal(JSON.parse(storage.get('production-workspace-v1')).shots.at(-1).id,'imported');
});

test('authentication and invalid cloud responses fall back without uploading cached work',async()=>{
  let writes=0;
  const {context,storage}=setup({getWorkspace:async()=>{throw new Error('Unauthorized');},saveWorkspace:async()=>{writes++;return {ok:true};}});
  const cached=fixture();cached.project.name='Offline production';storage.set('production-workspace-v1',JSON.stringify(cached));
  assert.equal((await context.loadState()).project.name,'Offline production');assert.equal(context.backendOK,false);
  await context.saveState();assert.equal(writes,0);
  context.API.getWorkspace=async()=>({shots:[]});assert.equal((await context.loadState()).project.name,'Production');assert.equal(context.backendOK,false);
});
