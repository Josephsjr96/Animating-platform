import { WorkerEntrypoint } from "cloudflare:workers";
/**
 * Japanese e-konte image interpreter. Dedicated Worker; never edits the DeepSeek chat proxy.
 * POST /analyze {image_b64, template} -> {panels:[{bbox,number,description,notes,dialogue,duration,confidence}]}
 * Requires VISION_API_TOKEN secret. Returns review-required guesses, never final shots.
 */
const MODEL='@cf/meta/llama-3.2-11b-vision-instruct';
const LIMIT=3*1024*1024;
const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const prompt=`Inspect this Japanese animation storyboard (絵コンテ / e-konte) as an image, not as English OCR.
There may be printed headers above, a narrow left column with cut numbers, a central column of stacked framed DRAWINGS and handwritten Japanese production notes on the right.
Find drawing rectangles only, not columns of text. Return bounding boxes in ORIGINAL IMAGE PIXELS {x,y,w,h}, arranged TOP TO BOTTOM.
Neighboring drawn panels can belong to the same cut; repeat a cut number ONLY when unambiguous.
Transcribe Japanese notes/dialogue in Japanese if clearly legible. Never invent cut numbers, durations, dialogue, Japanese transcription or translations.
Return null for unreadable or missing numbers/durations and empty strings for missing text.
Output ONLY JSON: {"panels":[{"bbox":{"x":0,"y":0,"w":0,"h":0},"number":null,"description":"","notes":"","dialogue":"","duration":null,"confidence":0.3}]}.
Confidence is conservative 0 to 1. Each panel must have its own rectangle. No markdown.`;
function parseJson(value){
 const raw=typeof value==='string'?value:String(value?.response??value?.result??'');
 try{return JSON.parse(raw)}catch{}
 const start=raw.indexOf('{'),end=raw.lastIndexOf('}');
 if(start>=0&&end>start){try{return JSON.parse(raw.slice(start,end+1))}catch{}}
 return null;
}
function normalize(value){
 const input=Array.isArray(value?.panels)?value.panels:[];
 return input.slice(0,25).map(p=>{
   const b=p?.bbox||{},coords=['x','y','w','h'].map(k=>Number(b[k]));
   if(coords.some(n=>!Number.isFinite(n))||coords[0]<0||coords[1]<0||coords[2]<=0||coords[3]<=0)return null;
   const number=p.number==null?'':String(p.number).slice(0,60);
   const duration=Number(p.duration);
   return {bbox:{x:coords[0],y:coords[1],w:coords[2],h:coords[3]},
    number,description:String(p.description??'').slice(0,800),
    notes:String(p.notes??'').slice(0,2000),dialogue:String(p.dialogue??'').slice(0,1000),
    duration:p.duration==null||p.duration===''||!Number.isFinite(duration)||duration<=0?null:duration,
    confidence:Math.max(0,Math.min(1,Number(p.confidence)||0)),needs_review:true};
 }).filter(Boolean).sort((a,b)=>a.bbox.y-b.bbox.y);
}
const visionWorker = {
 async fetch(request,env){
  const url=new URL(request.url);
  if(request.method==='GET'&&url.pathname==='/healthz')return reply({ok:true,service:'animating-storyboard-vision',model:MODEL,modelConfigured:Boolean(env.AI),authenticationConfigured:Boolean(env.VISION_API_TOKEN)});
  if(url.pathname!=='/analyze')return reply({error:'Not found'},404);
  if(request.method!=='POST')return reply({error:'Method not allowed'},405);
  if(!env.VISION_API_TOKEN)return reply({error:'Service authentication is not configured'},503);
  const auth=request.headers.get('authorization')||'';
  if(auth!==`Bearer ${env.VISION_API_TOKEN}`)return reply({error:'Unauthorized'},401);
  if(!env.AI)return reply({error:'Workers AI binding missing'},503);
  const length=Number(request.headers.get('content-length')||0);
  if(length>LIMIT*1.4+1024)return reply({error:'Image request too large'},413);
  let body;
  try{const text=await request.text();if(text.length>LIMIT*1.4+1024)return reply({error:'Request too large'},413);body=JSON.parse(text)}
  catch{return reply({error:'Expected JSON body'},400)}
  const image=body?.image_b64;
  if(typeof image!=='string'||!(/^[A-Za-z0-9+/]+={0,2}$/.test(image))||image.length>Math.ceil(LIMIT*4/3)+8||image.length<24)return reply({error:'Expected base64-encoded image (max 3 MB)'},400);
  const magic=atob(image.slice(0,48));
  const png=magic.startsWith('\x89PNG\r\n\x1a\n');
  const jpeg=magic.startsWith('\xff\xd8\xff');
  const webp=magic.slice(0,4)==='RIFF'&&magic.slice(8,12)==='WEBP';
  if(!png&&!jpeg&&!webp)return reply({error:'Only PNG, JPEG, and WebP are supported'},415);
  try{
   const dataUri='data:image/'+(png?'png':jpeg?'jpeg':'webp')+';base64,'+image;
   const response=await env.AI.run(MODEL,{messages:[{role:'system',content:'You produce cautious JSON about Japanese storyboards. Do not hallucinate text.'},{role:'user',content:prompt}],image:dataUri});
   const parsed=parseJson(response);
   if(!parsed)return reply({error:'Vision model did not return structured JSON. Retry or use manual review.',review_required:true},502);
   const panels=normalize(parsed);
   if(!panels.length)return reply({error:'No usable artwork boxes found; manual cropping required.',review_required:true},422);
   return reply({panels,panel_count:panels.length,source:'cloudflare-workers-ai',needs_review:true,model:MODEL});
  }catch(e){console.error('Vision inference failed',e?.message||String(e));return reply({error:'Vision inference unavailable; check Workers AI model/license and usage limits.'},502)}
 }
};


export default visionWorker;

// Only Workers with an explicit binding to this entrypoint can invoke these methods.
// Public /analyze continues to require the existing VISION_API_TOKEN.
export class StoryboardService extends WorkerEntrypoint {
  async health() {
    return (await visionWorker.fetch(new Request('https://vision.internal/healthz'), this.env)).json();
  }
  async analyze(image_b64) {
    return visionWorker.fetch(new Request('https://vision.internal/analyze', {
      method: 'POST',
      headers: {'content-type':'application/json', authorization:`Bearer ${this.env.VISION_API_TOKEN}`},
      body: JSON.stringify({image_b64})
    }), this.env);
  }
}
