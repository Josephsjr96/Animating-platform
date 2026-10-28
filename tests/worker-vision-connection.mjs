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
 assert.equal(input.reasoning_effort,'low');assert.equal(input.max_completion_tokens,4096);
 assert.deepEqual(input.response_format,{type:'json_object'});
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
for(const response of [{response:JSON.stringify({panels:[panel]})},{response:{panels:[panel]}},{panels:[panel]},{choices:[{message:{content:'```json\n'+JSON.stringify({panels:[panel]})+'\n```'}}]}]){
 const compatible=new vision.StoryboardService({},{...env,AI:{async run(){return response}}});
 const result=await compatible.analyze(image);assert.equal(result.status,200);assert.equal((await result.json()).panels[0].notes,'原画');
}
for(const [response,status,calls] of [[{choices:[{message:{content:'invalid'}}]},502,2],[{choices:[{finish_reason:'length',message:{content:JSON.stringify({panels:[panel]})}}]},502,2],[{choices:[{message:{content:'{"panels":[]}'}}]},422,1]]){
 let attempts=0;
 const failedVision=new vision.StoryboardService({},{...env,AI:{async run(){attempts++;return response}}});
 const result=await failedVision.analyze(image);assert.equal(result.status,status);assert.equal((await result.json()).review_required,true);
 assert.equal(attempts,calls);
}
for(const first of [{choices:[{message:{content:'{"panels":['}}]},{choices:[{finish_reason:'length',message:{content:JSON.stringify({panels:[panel]})}}]}]){
 const budgets=[];
 const recovering=new vision.StoryboardService({},{...env,AI:{async run(model,input){budgets.push(input.max_completion_tokens);assert.deepEqual(input.response_format,{type:'json_object'});return budgets.length===1?first:{choices:[{finish_reason:'stop',message:{content:JSON.stringify({panels:[panel]})}}]};}}});
 const result=await platform.fetch(request(),{...platformEnv,STORYBOARD_VISION:recovering});
 assert.equal(result.status,200);assert.equal((await result.json()).panels[0].notes,'原画');assert.deepEqual(budgets,[4096,8192]);
}
assert.equal(saved.length,3,'Retrying inference must persist each successful scan only once');
const geometry={width:490,height:743,frames:[{x:49,y:28,w:261,h:138},{x:49,y:172,w:261,h:137}]};
const bordered=new vision.StoryboardService({},{...env,AI:{async run(model,input){
 const prompt=input.messages[1].content[0].text;
 assert.ok(prompt.includes('490 by 743 pixels'));assert.ok(prompt.includes('frame_index'));
 assert.equal(input.response_format.type,'json_schema');assert.deepEqual(input.response_format.json_schema.schema.properties.panels.items.properties.frame_index.enum,[0,1]);
 // Deliberately wrong/model-reordered coordinates must never replace detected borders.
 return {response:JSON.stringify({panels:[{...panel,frame_index:1,bbox:{x:0,y:0,w:490,h:500}},{...panel,frame_index:0,bbox:{x:1,y:1,w:1,h:1}}]})};
}}});
const borderedResponse=await bordered.analyze(image,geometry);assert.equal(borderedResponse.status,200);
const borderedResult=await borderedResponse.json();assert.deepEqual(borderedResult.panels.map(p=>p.bbox),geometry.frames);assert.ok(borderedResult.panels.every(p=>p.bbox_source==='detected_border'));
const invalidGeometry={...geometry,frames:[{x:480,y:0,w:30,h:50}]};
assert.equal((await bordered.analyze(image,invalidGeometry)).status,400);
const missingMetadata=new vision.StoryboardService({},{...env,AI:{async run(){return {response:'{"panels":[]}'}}}});
const blanks=await (await missingMetadata.analyze(image,geometry)).json();assert.equal(blanks.panels.length,2);assert.equal(blanks.panels[0].number,'');assert.equal(blanks.panels[0].confidence,0);
const seven={width:490,height:743,frames:Array.from({length:7},(_,i)=>({x:49,y:10+i*100,w:261,h:80}))};
for(const mode of ['malformed','truncated','wrong-shape','unavailable']){
 let attempts=0;
 const recoveringFrames=new vision.StoryboardService({},{...env,AI:{async run(){
  attempts++;
  if(mode==='unavailable')throw new Error('inference unavailable');
  return {choices:[{finish_reason:mode==='truncated'?'length':'stop',message:{content:mode==='wrong-shape'?'[]':'{"panels":['}}]};
 }}});
 const response=await recoveringFrames.analyze(image,seven);assert.equal(response.status,200);
 const result=await response.json();assert.equal(attempts,2);assert.equal(result.metadata_status,'unavailable');
 assert.match(result.warning,/enter cut numbers and durations/);assert.equal(result.panels.length,7);
 assert.deepEqual(result.panels.map(p=>p.bbox),seven.frames);
 assert.ok(result.panels.every(p=>p.number===''&&p.duration===null&&p.confidence===0&&p.notes===''));
 const form=new FormData();form.append('file',new File([Buffer.from(image,'base64')],'seven.png',{type:'image/png'}));form.append('geometry',JSON.stringify(seven));
 const routed=await platform.fetch(new Request('https://platform/api/import/scan',{method:'POST',headers:{'X-Workspace-Key':platformEnv.WORKSPACE_ACCESS_KEY},body:form}),{...platformEnv,STORYBOARD_VISION:recoveringFrames});
 const savedResult=await routed.json();assert.equal(routed.status,200);assert.equal(savedResult.metadata_status,'unavailable');assert.equal(savedResult.panels.length,7);assert.match(savedResult.warning,/enter cut numbers/);
}
const sixMetadata=new vision.StoryboardService({},{...env,AI:{async run(){return {response:{panels:seven.frames.slice(0,6).map((bbox,frame_index)=>({...panel,bbox,frame_index}))}};}}});
const sevenResult=await (await sixMetadata.analyze(image,seven)).json();assert.equal(sevenResult.panels.length,7);assert.equal(sevenResult.panels[6].number,'');assert.equal(sevenResult.panels[6].duration,null);
const sixFrames={...seven,frames:seven.frames.slice(0,6)};
const discovered=new vision.StoryboardService({},{...env,AI:{async run(){return {response:{panels:sixFrames.frames.map((bbox,frame_index)=>({...panel,bbox,frame_index})),additional_panels:[
 {...panel,bbox:seven.frames[6],number:'C007'},
 {...panel,bbox:seven.frames[0]}, // Duplicate detected frame must be rejected.
 {...panel,bbox:{x:480,y:700,w:100,h:100}} // Off-page rectangle must be rejected.
]}};}}});
const discoveredResult=await (await discovered.analyze(image,sixFrames)).json();assert.equal(discoveredResult.panels.length,7);
assert.deepEqual(discoveredResult.panels.slice(0,6).map(p=>p.bbox),sixFrames.frames);
assert.equal(discoveredResult.panels[6].bbox_source,'model_estimate');assert.equal(discoveredResult.panels[6].number,'C007');
const textParts=new vision.StoryboardService({},{...env,AI:{async run(){return {choices:[{message:{content:[{type:'text',text:JSON.stringify({panels:[panel]})}]}}]};}}});
assert.equal((await textParts.analyze(image)).status,200);
// Verify geometry is forwarded by the platform route, with provenance intact.
const form=new FormData();form.append('file',new File([Buffer.from(image,'base64')],'page.png',{type:'image/png'}));form.append('geometry',JSON.stringify(geometry));
const withGeometry=await platform.fetch(new Request('https://platform/api/import/scan',{method:'POST',headers:{'X-Workspace-Key':platformEnv.WORKSPACE_ACCESS_KEY},body:form}),{...platformEnv,STORYBOARD_VISION:bordered});
assert.equal(withGeometry.status,200);const routed=await withGeometry.json();assert.deepEqual(routed.panels.map(p=>p.bbox),geometry.frames);assert.equal(routed.panels[0].bbox_source,'detected_border');
console.log('PASS: private vision routing, public authentication, platform authentication, preserved notes/timing, import persistence, upstream errors, health without inference');
