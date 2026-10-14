// Isolated Cloudflare staging API. The existing DeepSeek Worker is never modified.
// Writes are disabled unless explicitly configured with a browser session architecture.
const json = (value, status=200, headers={}) => new Response(JSON.stringify(value), {status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}});
const cors = (origin, allowed) => origin && allowed.split(',').map(s=>s.trim()).includes(origin) ? {'access-control-allow-origin':origin,'vary':'Origin','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'Content-Type'} : {};
const error = (message,status=400,headers={})=>json({error:message},status,headers);
const validOrigin=(origin,env)=>Boolean(origin&&env.ALLOWED_ORIGINS?.split(',').map(s=>s.trim()).includes(origin));
const limits = {image: 4*1024*1024, panels:30};
function normalize(data) {
  if (!data || !Array.isArray(data.panels)) return [];
  return data.panels.slice(0,limits.panels).map((p,i)=>({
    number:String(p.number??'').slice(0,60),
    description:String(p.description??'').slice(0,1000),
    notes:String(p.notes??'').slice(0,2000),
    dialogue:String(p.dialogue??'').slice(0,1000),
    duration:Number.isFinite(Number(p.duration))&&Number(p.duration)>0?Number(p.duration):null,
    bbox:p.bbox??null,
    confidence:Number.isFinite(Number(p.confidence))?Math.min(1,Math.max(0,Number(p.confidence))):0,
    thumbnail_b64:'',
    include:true,_idx:i
  })).filter(p=>p.bbox && [p.bbox.x,p.bbox.y,p.bbox.w,p.bbox.h].every(x=>Number.isFinite(Number(x))) && Number(p.bbox.w)>0 && Number(p.bbox.h)>0);
}
export default {
 async fetch(request, env) {
  const url=new URL(request.url),origin=request.headers.get('origin')||'';
  const headers=cors(origin,env.ALLOWED_ORIGINS||'');
  if(request.method==='OPTIONS')return validOrigin(origin,env)?new Response(null,{status:204,headers}):error('Origin denied',403);
  if(url.pathname==='/healthz')return json({ok:true,service:'animating-platform-staging',visionConfigured:Boolean(env.VISION_AGENT_URL),databaseConfigured:Boolean(env.DB)},200,headers);
  if(!validOrigin(origin,env))return error('Origin denied',403,headers);
  if(!env.DB)return error('Database is not configured',503,headers);
  if(request.method==='GET'&&url.pathname==='/api/workspace'){
   const row=await env.DB.prepare('SELECT payload FROM workspace WHERE id=1').first();
   return json(row?JSON.parse(row.payload):{empty:true},200,headers);
  }
  // This staging endpoint deliberately does not enable anonymous writes.
  // To make it usable by the production browser, add real user authentication first.
  if(request.method!=='GET')return error('Writes disabled in staging until authentication is configured',403,headers);
  return error('Not found',404,headers);
 }
};
