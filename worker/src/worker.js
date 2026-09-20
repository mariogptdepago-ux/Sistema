const enc = new TextEncoder();
const dec = new TextDecoder();

export default {
  async fetch(request, env) {
    try {
      if (request.method === "OPTIONS") return withCors(request, env, new Response(null, {status:204}));
      const url = new URL(request.url), p = url.pathname;
      let response;
      if (request.method === "GET" && p === "/api/health") response = json({ok:true, service:"html-access-control"});
      else if (request.method === "GET" && p === "/api/apps") response = await publicApps(env);
      else if (request.method === "GET" && p.startsWith("/api/apps/")) response = await publicApp(env, decodeURIComponent(p.slice("/api/apps/".length)));
      else if (request.method === "POST" && p === "/api/auth/login") response = await userLogin(request, env);
      else if (request.method === "POST" && p === "/api/auth/verify") response = await verifyUserAccess(request, env);
      else if (request.method === "POST" && p === "/api/admin/login") response = await adminLogin(request, env);
      else if (request.method === "POST" && p === "/api/admin/sync-apps") response = await syncApps(request, env);
      else if (p.startsWith("/api/admin/")) response = await adminRoutes(request, env, p);
      else response = json({error:"Ruta no encontrada."},404);
      return withCors(request, env, response);
    } catch (err) {
      return withCors(request, env, json({error:"Error interno del servicio.", detail:String(err?.message || err)},500));
    }
  }
};

function json(data,status=200,headers={}) {
  return new Response(JSON.stringify(data), {status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...headers}});
}
function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin"); if (!origin) return "";
  const list = String(env.ALLOWED_ORIGINS || "").split(",").map(x=>x.trim()).filter(Boolean);
  if (list.includes("*") || list.includes(origin)) return origin;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return origin;
  return "";
}
function withCors(request, env, response) {
  const h = new Headers(response.headers), origin = allowedOrigin(request, env);
  if (origin) {
    h.set("Access-Control-Allow-Origin", origin); h.set("Vary","Origin");
    h.set("Access-Control-Allow-Headers","Content-Type, Authorization, X-Sync-Secret");
    h.set("Access-Control-Allow-Methods","GET, POST, PUT, DELETE, OPTIONS");
  }
  h.set("X-Content-Type-Options","nosniff"); h.set("Referrer-Policy","no-referrer");
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers:h});
}
async function body(request) { try { return await request.json(); } catch { throw new Error("JSON inválido."); } }
function normUser(v) { return String(v||"").trim().toLowerCase(); }
function appKey(id){return "app:"+id} function userKey(u){return "user:"+normUser(u)}
async function readJSON(kv,key){const x=await kv.get(key);return x?JSON.parse(x):null}
async function putJSON(kv,key,obj){await kv.put(key,JSON.stringify(obj))}
function b64u(bytes){let s="";for(const b of new Uint8Array(bytes))s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")}
function fromB64u(s){s=s.replace(/-/g,"+").replace(/_/g,"/");while(s.length%4)s+="=";const raw=atob(s),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out}
async function hmacKey(secret,usage){return crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,usage)}
async function signToken(payload, secret) {
  const head=b64u(enc.encode(JSON.stringify({alg:"HS256",typ:"JWT"}))), data=b64u(enc.encode(JSON.stringify(payload)));
  const key=await hmacKey(secret,["sign"]),sig=await crypto.subtle.sign("HMAC",key,enc.encode(head+"."+data));
  return head+"."+data+"."+b64u(sig);
}
async function verifyToken(token, secret) {
  const parts=String(token||"").split(".");if(parts.length!==3)return null;
  const key=await hmacKey(secret,["verify"]),ok=await crypto.subtle.verify("HMAC",key,fromB64u(parts[2]),enc.encode(parts[0]+"."+parts[1]));if(!ok)return null;
  const payload=JSON.parse(dec.decode(fromB64u(parts[1])));if(!payload.exp||Date.now()>=payload.exp*1000)return null;return payload;
}
function bearer(request){const h=request.headers.get("Authorization")||"";return /^Bearer /i.test(h)?h.slice(7).trim():""}
function timingEqual(a,b){const x=enc.encode(String(a||"")),y=enc.encode(String(b||""));let d=x.length^y.length;const n=Math.max(x.length,y.length);for(let i=0;i<n;i++)d|=(x[i%x.length]||0)^(y[i%y.length]||0);return d===0}
function toB64(bytes){let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s)}
function fromB64(s){const raw=atob(s),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out}
async function hashPassword(password,saltB64=null,iterations=210000){
  const salt=saltB64?fromB64(saltB64):crypto.getRandomValues(new Uint8Array(16));
  const km=await crypto.subtle.importKey("raw",enc.encode(password),"PBKDF2",false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt,iterations},km,256);
  return {salt:toB64(salt),hash:toB64(new Uint8Array(bits)),iterations};
}
async function checkPassword(password, record){const h=await hashPassword(password,record.salt,Number(record.iterations||210000));return timingEqual(h.hash,record.hash)}
function availability(app) {
  if (!app || app.present === false) return {available:false,reason:"La aplicación no está publicada actualmente."};
  if (app.enabled !== true) return {available:false,reason:"La aplicación está desactivada por el administrador."};
  const now=Date.now();
  if(app.startAt && now<Date.parse(app.startAt))return {available:false,reason:"La ventana de acceso todavía no ha comenzado."};
  if(app.endAt && now>Date.parse(app.endAt))return {available:false,reason:"La ventana de acceso ya finalizó."};
  return {available:true,reason:"Disponible"};
}
async function listPrefix(kv,prefix){
  let cursor,out=[];do{const page=await kv.list({prefix,cursor});for(const k of page.keys){const obj=await readJSON(kv,k.name);if(obj)out.push(obj)}cursor=page.list_complete?undefined:page.cursor}while(cursor);return out;
}
function publicView(app){const a=availability(app);return {id:app.id,title:app.title,file:app.file,present:app.present!==false,enabled:app.enabled===true,startAt:app.startAt||null,endAt:app.endAt||null,...a}}
async function publicApps(env){const apps=await listPrefix(env.STATE,"app:");return json({apps:apps.filter(a=>a.present!==false).map(publicView).sort((a,b)=>a.title.localeCompare(b.title))})}
async function publicApp(env,id){const app=await readJSON(env.STATE,appKey(id));if(!app)return json({error:"Aplicación no registrada.",available:false},404);return json(publicView(app))}

async function userLogin(request,env){
  const x=await body(request),id=String(x.appId||""),username=normUser(x.username),password=String(x.password||"");
  if(!id||!username||!password)return json({error:"Faltan credenciales."},400);
  const [app,user]=await Promise.all([readJSON(env.STATE,appKey(id)),readJSON(env.STATE,userKey(username))]);
  const av=availability(app);if(!av.available)return json({error:av.reason},403);
  if(!user||user.enabled===false||!user.password)return json({error:"Usuario o contraseña incorrectos."},403);
  const permitted=(user.apps||[]).includes("*")||(user.apps||[]).includes(id);if(!permitted)return json({error:"El usuario no tiene permiso para esta aplicación."},403);
  if(!(await checkPassword(password,user.password)))return json({error:"Usuario o contraseña incorrectos."},403);
  const exp=Math.floor(Date.now()/1000)+8*3600,token=await signToken({role:"user",sub:username,appId:id,exp},env.SESSION_SECRET);
  return json({token,username,displayName:user.displayName||username,expiresAt:new Date(exp*1000).toISOString()});
}
async function verifyUserAccess(request,env){
  const x=await body(request),id=String(x.appId||""),p=await verifyToken(bearer(request),env.SESSION_SECRET);
  if(!p||p.role!=="user"||p.appId!==id)return json({error:"Sesión inválida."},401);
  const [app,user]=await Promise.all([readJSON(env.STATE,appKey(id)),readJSON(env.STATE,userKey(p.sub))]);
  const av=availability(app);if(!av.available)return json({error:av.reason},403);
  if(!user||user.enabled===false)return json({error:"Usuario desactivado."},403);
  const permitted=(user.apps||[]).includes("*")||(user.apps||[]).includes(id);if(!permitted)return json({error:"Permiso revocado."},403);
  return json({ok:true});
}
async function adminLogin(request,env){
  const x=await body(request);
  if(!env.ADMIN_PASSWORD||!env.SESSION_SECRET)return json({error:"Secrets del Worker incompletos."},500);
  if(!timingEqual(String(x.password||""),env.ADMIN_PASSWORD))return json({error:"Contraseña de administrador incorrecta."},403);
  const exp=Math.floor(Date.now()/1000)+4*3600,token=await signToken({role:"admin",sub:"admin",exp},env.SESSION_SECRET);
  return json({token,expiresAt:new Date(exp*1000).toISOString()});
}
async function requireAdmin(request,env){const p=await verifyToken(bearer(request),env.SESSION_SECRET);return p&&p.role==="admin"?p:null}
async function syncApps(request,env){
  const supplied=request.headers.get("X-Sync-Secret")||"";
  if(!env.SYNC_SECRET||!timingEqual(supplied,env.SYNC_SECRET))return json({error:"Sync no autorizado."},401);
  const x=await body(request),incoming=Array.isArray(x.apps)?x.apps:[],current=await listPrefix(env.STATE,"app:"),incomingIds=new Set();
  for(const item of incoming){
    const id=String(item.id||"").trim();if(!id)continue;incomingIds.add(id);
    const old=await readJSON(env.STATE,appKey(id));
    const next={id,title:String(item.title||id),file:String(item.file||""),sourceFile:String(item.sourceFile||""),present:true,
      enabled:old?.enabled===true,startAt:old?.startAt||null,endAt:old?.endAt||null,createdAt:old?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
    await putJSON(env.STATE,appKey(id),next);
  }
  for(const old of current){if(!incomingIds.has(old.id)){old.present=false;old.enabled=false;old.updatedAt=new Date().toISOString();await putJSON(env.STATE,appKey(old.id),old)}}
  return json({ok:true,received:incoming.length,message:"Manifest sincronizado. Las apps nuevas permanecen desactivadas."});
}
async function adminRoutes(request,env,p){
  if(!(await requireAdmin(request,env)))return json({error:"Sesión de administrador inválida."},401);
  if(request.method==="GET"&&p==="/api/admin/apps"){const apps=await listPrefix(env.STATE,"app:");return json({apps:apps.sort((a,b)=>(a.title||a.id).localeCompare(b.title||b.id))})}
  if(request.method==="PUT"&&p.startsWith("/api/admin/apps/")){
    const id=decodeURIComponent(p.slice("/api/admin/apps/".length)),old=await readJSON(env.STATE,appKey(id));if(!old)return json({error:"Aplicación no encontrada."},404);
    const x=await body(request);old.enabled=x.enabled===true;old.startAt=x.startAt||null;old.endAt=x.endAt||null;old.updatedAt=new Date().toISOString();
    if(old.startAt&&!Number.isFinite(Date.parse(old.startAt)))return json({error:"Fecha de inicio inválida."},400);
    if(old.endAt&&!Number.isFinite(Date.parse(old.endAt)))return json({error:"Fecha de fin inválida."},400);
    if(old.startAt&&old.endAt&&Date.parse(old.startAt)>=Date.parse(old.endAt))return json({error:"La fecha de fin debe ser posterior al inicio."},400);
    await putJSON(env.STATE,appKey(id),old);return json({ok:true,app:old});
  }
  if(request.method==="GET"&&p==="/api/admin/users"){
    const users=await listPrefix(env.STATE,"user:");return json({users:users.map(u=>({username:u.username,displayName:u.displayName,enabled:u.enabled!==false,apps:u.apps||[]})).sort((a,b)=>a.username.localeCompare(b.username))});
  }
  if(request.method==="POST"&&p==="/api/admin/users"){
    const x=await body(request),username=normUser(x.username);
    if(!/^[a-z0-9._@+-]{2,80}$/.test(username))return json({error:"Usuario inválido."},400);
    if(await readJSON(env.STATE,userKey(username)))return json({error:"El usuario ya existe."},409);
    if(String(x.password||"").length<10)return json({error:"La contraseña debe tener al menos 10 caracteres."},400);
    const password=await hashPassword(String(x.password));
    const user={username,displayName:String(x.displayName||username).trim(),enabled:x.enabled!==false,apps:Array.isArray(x.apps)?x.apps.map(String):[],password,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    await putJSON(env.STATE,userKey(username),user);return json({ok:true});
  }
  if(request.method==="PUT"&&p.startsWith("/api/admin/users/")){
    const username=normUser(decodeURIComponent(p.slice("/api/admin/users/".length))),user=await readJSON(env.STATE,userKey(username));if(!user)return json({error:"Usuario no encontrado."},404);
    const x=await body(request);user.displayName=String(x.displayName||user.displayName||username).trim();user.enabled=x.enabled!==false;user.apps=Array.isArray(x.apps)?x.apps.map(String):(user.apps||[]);
    if(x.password){if(String(x.password).length<10)return json({error:"La contraseña debe tener al menos 10 caracteres."},400);user.password=await hashPassword(String(x.password))}
    user.updatedAt=new Date().toISOString();await putJSON(env.STATE,userKey(username),user);return json({ok:true});
  }
  if(request.method==="DELETE"&&p.startsWith("/api/admin/users/")){
    const username=normUser(decodeURIComponent(p.slice("/api/admin/users/".length)));await env.STATE.delete(userKey(username));return json({ok:true});
  }
  return json({error:"Ruta administrativa no encontrada."},404);
}
