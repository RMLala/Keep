const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const now = () => new Date().toISOString();
const json = (data, status = 200, origin = '*') => new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type, authorization' } });
async function digest(value, pepper) {
  const bytes = new TextEncoder().encode(`${pepper}:${value}`);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function validId(v) { return typeof v === 'string' && /^[a-zA-Z0-9_-]{12,160}$/.test(v); }
async function limited(env, bucket, key, max = 30) {
  const hash = await digest(key, env.HASH_PEPPER);
  const start = Math.floor(Date.now() / 60000) * 60;
  await env.DB.prepare(`INSERT INTO rate_limits(bucket,key_hash,window_start,count) VALUES(?,?,?,1) ON CONFLICT(bucket,key_hash,window_start) DO UPDATE SET count=count+1`).bind(bucket, hash, start).run();
  const row = await env.DB.prepare('SELECT count FROM rate_limits WHERE bucket=? AND key_hash=? AND window_start=?').bind(bucket, hash, start).first();
  return (row?.count || 0) <= max;
}
function originFor(request, env) {
  const origin = request.headers.get('origin') || '';
  return env.ALLOWED_ORIGIN && env.ALLOWED_ORIGIN.split(',').map(x => x.trim()).includes(origin) ? origin : 'null';
}
export default {
 async fetch(request, env) {
  const origin = originFor(request, env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type, authorization', 'access-control-max-age': '86400' } });
  if (request.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405, origin);
  if (origin === 'null' && request.headers.has('origin')) return json({ error: 'Origine non autorisée.' }, 403, origin);
  if (!env.DB || !env.HASH_PEPPER || !env.ADMIN_TOKEN) return json({ error: 'Service de licence incomplet.' }, 503, origin);
  const url = new URL(request.url);
  let body; try { body = await request.json(); } catch { return json({ error: 'JSON invalide.' }, 400, origin); }
  if (url.pathname === '/v1/trial' || url.pathname === '/v1/verify') {
   const appId = String(body.appId || ''); const deviceId = body.deviceId;
   if (!/^[a-z0-9-]{2,32}$/.test(appId) || !validId(deviceId)) return json({ error: 'Données invalides.' }, 400, origin);
   if (!(await limited(env, url.pathname, deviceId, 20))) return json({ error: 'Trop de tentatives. Réessayez plus tard.' }, 429, origin);
   const deviceHash = await digest(deviceId, env.HASH_PEPPER);
   if (url.pathname === '/v1/trial') {
    const existing = await env.DB.prepare('SELECT expires_at FROM trials WHERE app_id=? AND device_hash=?').bind(appId, deviceHash).first();
    if (existing) return new Date(existing.expires_at) > new Date() ? json({ status: 'active', expiresAt: existing.expires_at, type: 'trial' }, 200, origin) : json({ error: 'Cet essai a déjà été utilisé ou a expiré.' }, 409, origin);
    const started = new Date(), expires = new Date(started.getTime() + 24 * 60 * 60 * 1000);
    await env.DB.prepare('INSERT INTO trials(app_id,device_hash,started_at,expires_at) VALUES(?,?,?,?)').bind(appId, deviceHash, started.toISOString(), expires.toISOString()).run();
    return json({ status: 'active', type: 'trial', expiresAt: expires.toISOString() }, 201, origin);
   }
   const code = String(body.code || '').trim().toUpperCase();
   if (!/^[A-Z0-9-]{12,80}$/.test(code)) return json({ error: 'Code de licence invalide.' }, 400, origin);
   const codeHash = await digest(code, env.HASH_PEPPER);
   const lic = await env.DB.prepare('SELECT id,license_type,status,expires_at,max_devices,revoked_at FROM licenses WHERE app_id=? AND code_hash=?').bind(appId, codeHash).first();
   if (!lic || lic.status !== 'active') return json({ error: 'Licence inconnue ou révoquée.' }, 403, origin);
   if (lic.expires_at && new Date(lic.expires_at) <= new Date()) return json({ error: 'Licence expirée.' }, 403, origin);
   const known = await env.DB.prepare('SELECT 1 AS ok FROM devices WHERE license_id=? AND device_hash=?').bind(lic.id, deviceHash).first();
   if (!known) {
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM devices WHERE license_id=?').bind(lic.id).first();
    if ((count?.n || 0) >= lic.max_devices) return json({ error: 'Nombre maximal d’appareils atteint.' }, 403, origin);
    await env.DB.prepare('INSERT INTO devices(license_id,device_hash,first_seen,last_seen) VALUES(?,?,?,?)').bind(lic.id, deviceHash, now(), now()).run();
   } else await env.DB.prepare('UPDATE devices SET last_seen=? WHERE license_id=? AND device_hash=?').bind(now(), lic.id, deviceHash).run();
   return json({ status: 'active', type: lic.license_type, expiresAt: lic.expires_at }, 200, origin);
  }
  if (url.pathname.startsWith('/admin/')) {
   if (request.headers.get('authorization') !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: 'Non autorisé.' }, 401, origin);
   if (url.pathname === '/admin/licenses' && body.action === 'create') {
    const appId=String(body.appId||'passkeep'), type=String(body.type||''), maxDevices=Math.max(1,Math.min(20,Number(body.maxDevices)||1));
    if (!/^[a-z0-9-]{2,32}$/.test(appId) || !['annual','lifetime','owner'].includes(type)) return json({error:'Type ou application invalide.'},400,origin);
    const code=crypto.randomUUID().replaceAll('-','').slice(0,20).toUpperCase();
    const expires=type==='annual'?new Date(Date.now()+365*24*60*60*1000).toISOString():null;
    await env.DB.prepare('INSERT INTO licenses(id,app_id,code_hash,license_type,status,expires_at,max_devices,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),appId,await digest(code,env.HASH_PEPPER),type,'active',expires,maxDevices,now()).run();
    return json({code,type,expiresAt:expires,maxDevices},201,origin);
   }
   if (url.pathname === '/admin/licenses' && body.action === 'revoke') {
    const code=String(body.code||'').trim().toUpperCase(); if(!/^[A-Z0-9-]{12,80}$/.test(code)) return json({error:'Code invalide.'},400,origin);
    const result=await env.DB.prepare("UPDATE licenses SET status='revoked',revoked_at=? WHERE app_id=? AND code_hash=? AND status='active'").bind(now(),String(body.appId||'passkeep'),await digest(code,env.HASH_PEPPER)).run();
    return json({revoked:!!result.meta?.changes},200,origin);
   }
  }
  return json({ error: 'Route inconnue.' }, 404, origin);
 }
};
