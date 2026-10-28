import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import platform from '../workers/platform/worker.mjs';
const source = (await readFile(new URL('../workers/storyboard-vision/worker.mjs',import.meta.url),'utf8')).replace('import { WorkerEntrypoint } from "cloudflare:workers";', 'class WorkerEntrypoint { constructor(ctx, env) { this.env = env; } }');
const vision = await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
let inference=0;
const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const panel={bbox:{x:1,y:2,w:20,h:30},number:'C001',notes:'原画',dialogue:'台詞',duration:null};
const env={VISION_API_TOKEN:'test-vision-secret',AI:{async run(model,input){inference++; assert.equal(model,'@cf/qwen/qwen3.8-27b');
 assert.equal(input.image,undefined);
 const content=input.messages.find(message=>message.role==='user').content;
 assert.ok(content.find(part=>part.type==='text').text.includes('ORIGINAL IMAGE PIXELS'));
 assert.equal(content.find(part=>part.type==='image_url').image_url.url,'data:image/png;base64,'+image);
 assert.equal(input.reasoning_effort,'low');assert.equal(input.max_completion_tokens,2400);
 return {choices:[{message:{content:JSON.stringify({panels:[panel]})}}]};}}};
const service=new vision.StoryboardService({},env);
assert.equal((await vision.default.fetch(new Request('https://vision/analyze',{method:'POST',body:'{}'}),env)).status,401);
assert.equal((await service.health()).service,'animating-storyboard-vision');
assert.equal((await service.health()).model,'@cf/qwen/qwen3.8-27b');
assert.equal((await service.analyze('bad')).status,400);
assert.equal(inference,0);
const saved=[];
const platformEnv={WORKSPACE_ACCESS_KEY:'fixture-workspace-key-32-characters-long',STORYBOARD_VISION:service,DB:{prepare(sql){assert.ok(sql.startsWith('INSERT INTO imports'));return {bind(...values){saved.push(values);return {async run(){return {success:true}}}}}}}};
function request(key=platformEnv.WORKSPACE_ACCESS_KEY){const form=new FormData();form.append('file',new File([Buffer.from(image,'base64')],'storyboard.png',{type:'image/png'}));return new Request('https://platform/api/import/scan',{method:'POST',headers:{'X-Workspace-Key':key,Origin:'https://josephsjr96.github.io'},body:form});}
assert.equal((await platform.fetch(request('wrong'),platformEnv)).status,401);
assert.equal(inference,0);
const result=await platform.fetch(request(),platformEnv);
assert.equal(result.status,200);
assert.equal(result.headers.get('access-control-allow-origin'),'https://josephsjr96.github.io');
const body=await result.json();assert.equal(body.source,'animating-storyboard-vision');assert.equal(body.panels[0].notes,'原画');assert.equal(body.panels[0].duration,null);assert.equal(saved.length,1);assert.equal(inference,1);
const failed={...platformEnv,STORYBOARD_VISION:{async analyze(){return Response.json({error:'Manual review required'},{status:422})}}};
assert.equal((await platform.fetch(request(),failed)).status,422);assert.equal(saved.length,1);
const health=await (await platform.fetch(new Request('https://platform/healthz'),platformEnv)).json();assert.equal(health.vision.service,'animating-storyboard-vision');assert.equal(inference,1);
for(const response of [{response:JSON.stringify({panels:[panel]})},{choices:[{message:{content:'```json\n'+JSON.stringify({panels:[panel]})+'\n```'}}]}]){
 const compatible=new vision.StoryboardService({},{...env,AI:{async run(){return response}}});
 const result=await compatible.analyze(image);assert.equal(result.status,200);assert.equal((await result.json()).panels[0].notes,'原画');
}
for(const [response,status] of [[{choices:[{message:{content:'invalid'}}]},502],[{choices:[{message:{content:'{"panels":[]}'}}]},422]]){
 const failedVision=new vision.StoryboardService({},{...env,AI:{async run(){return response}}});
 const result=await failedVision.analyze(image);assert.equal(result.status,status);assert.equal((await result.json()).review_required,true);
}
console.log('PASS: private vision routing, public authentication, platform authentication, preserved notes/timing, import persistence, upstream errors, health without inference');
