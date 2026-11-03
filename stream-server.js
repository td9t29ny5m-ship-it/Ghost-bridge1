// Ghost Stream cloud dashboard API. Video ingest/compositing is deliberately not claimed here.
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const PORT = Number(process.env.PORT || 10000);
const HOST = '0.0.0.0';
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const PASSWORD = String(process.env.ADMIN_PASSWORD || '');
const sessions = new Map();
const attempts = new Map();
let cloudState = null;
const startedAt = Date.now();
const MAX_BODY = 96 * 1024;
const MIME = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
function send(res, code, obj, headers={}) { const body=JSON.stringify(obj); res.writeHead(code, {'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}); res.end(body); }
function cookie(req, name) { const raw=req.headers.cookie||''; for(const part of raw.split(';')) { const i=part.indexOf('='); if(i>0 && part.slice(0,i).trim()===name) return decodeURIComponent(part.slice(i+1).trim()); } return ''; }
function readBody(req) { return new Promise((resolve,reject)=>{ let s=''; req.on('data',c=>{s+=c; if(Buffer.byteLength(s)>MAX_BODY){reject(new Error('Request too large'));req.destroy();}}); req.on('end',()=>{try{resolve(s?JSON.parse(s):{});}catch{reject(new Error('Invalid JSON'));}}); req.on('error',reject); }); }
function validState(s) { return !!s && typeof s==='object' && !Array.isArray(s) && Buffer.byteLength(JSON.stringify(s))<=MAX_BODY && Array.isArray(s.scenes) && s.scenes.length<=20 && typeof s.activeSceneId==='string'; }
function authenticated(req) { const token=cookie(req,'ghost_session'); const expiry=sessions.get(token); if(!token||!expiry||expiry<Date.now()){sessions.delete(token);return false;} return true; }
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET' && url.pathname==='/healthz') return send(res,200,{ok:true,service:'ghost-stream',uptimeSeconds:Math.floor((Date.now()-startedAt)/1000),mode:'dashboard-control-plane',videoIngest:false,overlayCompositing:false,ps5NativeBroadcastIntegration:false});
  if(req.method==='GET' && url.pathname==='/api/status') return send(res,200,{ok:true,service:'Ghost Stream',uptimeSeconds:Math.floor((Date.now()-startedAt)/1000),authenticated:authenticated(req),features:{sceneEditor:true,goals:true,textOverlays:true,alerts:true,cloudState:true},streaming:{ps5Connected:false,videoIngestReady:false,compositorReady:false,outputConnected:false,limitation:'The PS5 native broadcast does not expose a general third-party video feed or overlay injection endpoint.'}});
  if(req.method==='POST' && url.pathname==='/api/login') {
    const ip=req.headers['x-forwarded-for']?.split(',')[0]?.trim()||req.socket.remoteAddress||'unknown'; const a=attempts.get(ip)||{count:0,until:0};
    if(Date.now()<a.until) return send(res,429,{error:'Too many attempts. Try again in one minute.'});
    if(!PASSWORD) return send(res,503,{error:'The studio password is not configured. Set ADMIN_PASSWORD in the Render service environment.'});
    let body; try{body=await readBody(req);}catch(e){return send(res,400,{error:e.message});}
    const given=Buffer.from(String(body.password||'')); const real=Buffer.from(PASSWORD); const ok=given.length===real.length&&crypto.timingSafeEqual(given,real);
    if(!ok){a.count++;if(a.count>=6){a.count=0;a.until=Date.now()+60000;}attempts.set(ip,a);return send(res,401,{error:'Incorrect password.'});}
    attempts.delete(ip); const token=crypto.randomBytes(32).toString('hex'); sessions.set(token,Date.now()+7*24*60*60*1000);
    return send(res,200,{ok:true},{'set-cookie':`ghost_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`});
  }
  if(req.method==='POST' && url.pathname==='/api/logout'){const t=cookie(req,'ghost_session');sessions.delete(t);return send(res,200,{ok:true},{'set-cookie':'ghost_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'});}
  if(url.pathname.startsWith('/api/')) {
    if(!authenticated(req)) return send(res,401,{error:'Sign in to Ghost Stream first.'});
    if(req.method==='GET' && url.pathname==='/api/state') return send(res,200,{ok:true,state:cloudState,hasCloudState:!!cloudState});
    if(req.method==='PUT' && url.pathname==='/api/state') {let body;try{body=await readBody(req);}catch(e){return send(res,400,{error:e.message});} if(!validState(body.state)) return send(res,400,{error:'Invalid studio state.'}); cloudState=body.state; return send(res,200,{ok:true,savedAt:new Date().toISOString()});}
    return send(res,404,{error:'API route not found.'});
  }
  let target=url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname);
  if(target.includes('..')) return send(res,400,{error:'Invalid path.'});
  const file=path.join(PUBLIC,target);
  fs.readFile(file,(err,data)=>{if(err)return send(res,404,{error:'Not found.'});res.writeHead(200,{'content-type':MIME[path.extname(file)]||'application/octet-stream','cache-control':path.extname(file)==='.html'?'no-cache':'public, max-age=3600','x-content-type-options':'nosniff','referrer-policy':'same-origin'});res.end(data);});
});
server.listen(PORT,HOST,()=>console.log(`Ghost Stream dashboard listening on ${HOST}:${PORT}`));
