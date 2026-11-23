import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import platform from '../workers/platform/worker.mjs';

const source=(await readFile(new URL('../workers/storyboard-vision/worker.mjs',import.meta.url),'utf8'))
 .replace('import { WorkerEntrypoint } from "cloudflare:workers";', 'class WorkerEntrypoint { constructor(ctx,env) { this.env=env; } }');
const vision=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const seed=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const panel={bbox:{x:0,y:0,w:1,h:1},number:'C001',notes:'原画',duration:null};
// PNG trailing data makes a deterministic large transport fixture, not an accuracy benchmark.
for(const size of [16*1024*1024+1,25*1024*1024+2]){
 const original=Buffer.alloc(size,73);seed.copy(original);
 let calls=0,saves=0;
 const service=new vision.StoryboardService({},{AI:{async run(model,input){
  calls++;
  const url=input.messages[1].content.find(p=>p.type==='image_url').image_url.url;
  assert.deepEqual(Buffer.from(url.split(',')[1],'base64'),original,'Inference must receive every original byte');
  return {response:{panels:[panel]}};
 }}});
 const env={WORKSPACE_ACCESS_KEY:'fixture-workspace-key-32-characters-long',STORYBOARD_VISION:service,DB:{prepare(){return {bind(){return {async run(){saves++;}}}}}}};
 const form=new FormData();form.append('file',new File([original],'large.png',{type:'image/png'}));
 const response=await platform.fetch(new Request('https://platform/api/import/scan',{method:'POST',headers:{'X-Workspace-Key':env.WORKSPACE_ACCESS_KEY},body:form}),env);
 assert.equal(response.status,200);assert.equal((await response.json()).panels[0].notes,'原画');
 assert.equal(calls,1);assert.equal(saves,1);
}
// Base64 encoding must work across arbitrary stream boundaries, including single bytes.
for(const stride of [1,2,7,12289]){
 const original=Buffer.concat([seed,Buffer.alloc(30001,57)]);
 const service=new vision.StoryboardService({},{AI:{async run(model,input){
  const url=input.messages[1].content.find(p=>p.type==='image_url').image_url.url;
  assert.deepEqual(Buffer.from(url.split(',')[1],'base64'),original);
  return {response:{panels:[panel]}};
 }}});
 const stream=new ReadableStream({start(controller){for(let i=0;i<original.length;i+=stride)controller.enqueue(original.subarray(i,i+stride));controller.close();}});
 assert.equal((await service.analyzeStream(stream)).status,200);
}
console.log('PASS: uploads above 16 and 25 MiB preserve every byte through inference; uneven stream boundaries preserve base64 encoding.');
