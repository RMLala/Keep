const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const now = () => new Date().toISOString();
function json(data, status = 200, origin = "*") {
  return new Response(JSON.stringify(data), { status, headers: {
    ...JSON_HEADERS, "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-max-age": "86400", "vary": "Origin"
  }});
}
async function digest(value, pepper) {
  const bytes = new TextEncoder().encode(pepper + ":" + value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, "0")).join("");
}
function validId(v) { return typeof v === "string" && /^[a-zA-Z0-9_-]{12,160}$/.test(v); }
function validApp(v) { return typeof v === "string" && /^[a-z0-9-]{2,32}$/.test(v); }
function corsOrigin(request, env) {
  const origin = request.headers.get("origin");
  if (!origin) return "*";
  const allowed = (env.ALLOWED_ORIGIN || "").split(",").map(x => x.trim()).filter(Boolean);
  if (!allowed.length) return "*";
  return allowed.includes(origin) ? origin : null;
}
async function limited(env, bucket, key, max = 30) {
  const hash = await digest(String(key || "unknown"), env.HASH_PEPPER);
  const start = Math.floor(Date.now() / 60000) * 60;
  await env.DB.prepare("INSERT INTO rate_limits(bucket,key_hash,window_start,count) VALUES(?,?,?,1) ON CONFLICT(bucket,key_hash,window_start) DO UPDATE SET count=count+1")
    .bind(bucket, hash, start).run();
  const row = await env.DB.prepare("SELECT count FROM rate_limits WHERE bucket=? AND key_hash=? AND window_start=?")
    .bind(bucket, hash, start).first();
  return (row?.count || 0) <= max;
}
function validCode(code) { return typeof code === "string" && /^[A-Z0-9-]{12,80}$/.test(code.trim().toUpperCase()); }
async function activateDevice(env, lic, deviceHash) {
  const known = await env.DB.prepare("SELECT 1 AS ok FROM devices WHERE license_id=? AND device_hash=?").bind(lic.id, deviceHash).first();
  if (!known) {
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM devices WHERE license_id=?").bind(lic.id).first();
    if ((count?.n || 0) >= lic.max_devices) return false;
    await env.DB.prepare("INSERT OR IGNORE INTO devices(license_id,device_hash,first_seen,last_seen) VALUES(?,?,?,?)")
      .bind(lic.id, deviceHash, now(), now()).run();
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM devices WHERE license_id=?").bind(lic.id).first();
    if ((after?.n || 0) > lic.max_devices) {
      await env.DB.prepare("DELETE FROM devices WHERE license_id=? AND device_hash=?").bind(lic.id, deviceHash).run();
      return false;
    }
  } else {
    await env.DB.prepare("UPDATE devices SET last_seen=? WHERE license_id=? AND device_hash=?").bind(now(), lic.id, deviceHash).run();
  }
  return true;
}
async function authorizedOwner(env, body, origin) {
  const appId = String(body.appId || ""), deviceId = body.deviceId;
  if (!validApp(appId) || !validId(deviceId)) return { error: json({ error: "Données invalides." }, 400, origin) };
  const deviceHash = await digest(deviceId, env.HASH_PEPPER);
  const code = String(body.code || "").trim().toUpperCase();
  if (validCode(code)) {
    const codeHash = await digest(code, env.HASH_PEPPER);
    const lic = await env.DB.prepare("SELECT id,license_type,status,expires_at,max_devices FROM licenses WHERE app_id=? AND code_hash=?")
      .bind(appId, codeHash).first();
    if (!lic || lic.status !== "active") return { error: json({ error: "Licence inconnue ou révoquée." }, 403, origin) };
    if (lic.expires_at && new Date(lic.expires_at) <= new Date()) return { error: json({ error: "Licence expirée." }, 403, origin) };
    if (!(await activateDevice(env, lic, deviceHash))) return { error: json({ error: "Nombre maximal d’appareils atteint." }, 403, origin) };
    return { ownerKey: "lic:" + lic.id, license: lic, deviceHash };
  }
  const trial = await env.DB.prepare("SELECT expires_at FROM trials WHERE app_id=? AND device_hash=?").bind(appId, deviceHash).first();
  if (!trial || new Date(trial.expires_at) <= new Date()) return { error: json({ error: "Une licence active est nécessaire pour synchroniser." }, 403, origin) };
  return { ownerKey: "trial:" + deviceHash, license: { license_type: "trial", expires_at: trial.expires_at, max_devices: 1 }, deviceHash };
}
function validEncryptedState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return false;
  if (typeof state.salt !== "string" || state.salt.length < 16 || state.salt.length > 128) return false;
  for (const key of ["store", "recovery", "wrap"]) {
    if (state[key] == null && key !== "store") continue;
    if (typeof state[key] !== "string" || state[key].length > 1900000) return false;
    let value; try { value = JSON.parse(state[key]); } catch { return false; }
    if (!value || typeof value.iv !== "string" || typeof value.data !== "string") return false;
  }
  return typeof state.authScheme === "string" && state.authScheme.length < 40;
}
async function syncRoute(request, env, body, url, origin) {
  const ip = request.headers.get("cf-connecting-ip") || body.deviceId || "unknown";
  if (!(await limited(env, "sync:" + url.pathname, ip, 90))) return json({ error: "Trop de synchronisations. Réessayez dans une minute." }, 429, origin);
  const auth = await authorizedOwner(env, body, origin);
  if (auth.error) return auth.error;
  const current = await env.DB.prepare("SELECT version,payload,updated_at FROM sync_vaults WHERE owner_key=? AND app_id=?")
    .bind(auth.ownerKey, body.appId).first();
  if (url.pathname === "/v1/sync/pull") {
    return json({ status: "active", type: auth.license.license_type, expiresAt: auth.license.expires_at,
      version: current?.version || 0, state: current ? JSON.parse(current.payload) : null, updatedAt: current?.updated_at || null }, 200, origin);
  }
  if (url.pathname !== "/v1/sync/push") return json({ error: "Route inconnue." }, 404, origin);
  const expected = Number(body.expectedVersion);
  if (!Number.isSafeInteger(expected) || expected < 0 || !validEncryptedState(body.state)) return json({ error: "État chiffré ou version invalide." }, 400, origin);
  const payload = JSON.stringify(body.state);
  if (new TextEncoder().encode(payload).byteLength > 1900000) return json({ error: "Le coffre dépasse la taille maximale de synchronisation (1,9 Mo)." }, 413, origin);
  if ((current?.version || 0) !== expected) return json({ error: "Conflit de synchronisation.", conflict: true, version: current?.version || 0, state: current ? JSON.parse(current.payload) : null, updatedAt: current?.updated_at || null }, 409, origin);
  const timestamp = now();
  const result = await env.DB.prepare("INSERT INTO sync_vaults(owner_key,app_id,payload,version,updated_at) VALUES(?,?,?,1,?) ON CONFLICT(owner_key) DO UPDATE SET payload=excluded.payload,version=sync_vaults.version+1,updated_at=excluded.updated_at WHERE sync_vaults.app_id=excluded.app_id AND sync_vaults.version=?")
    .bind(auth.ownerKey, body.appId, payload, timestamp, expected).run();
  if ((result.meta?.changes || 0) !== 1) {
    const latest = await env.DB.prepare("SELECT version,payload,updated_at FROM sync_vaults WHERE owner_key=? AND app_id=?").bind(auth.ownerKey, body.appId).first();
    return json({ error: "Conflit de synchronisation.", conflict: true, version: latest?.version || 0, state: latest ? JSON.parse(latest.payload) : null, updatedAt: latest?.updated_at || null }, 409, origin);
  }
  const next = await env.DB.prepare("SELECT version FROM sync_vaults WHERE owner_key=? AND app_id=?").bind(auth.ownerKey, body.appId).first();
  return json({ status: "synced", version: next.version, updatedAt: timestamp, type: auth.license.license_type }, 200, origin);
}
export default {
  async fetch(request, env) {
    const origin = corsOrigin(request, env);
    if (request.method === "OPTIONS") return origin
      ? new Response(null, { status: 204, headers: { "access-control-allow-origin": origin, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type, authorization", "access-control-max-age": "86400", "vary": "Origin" } })
      : new Response(null, { status: 403 });
    if (!origin) return json({ error: "Origine non autorisée." }, 403, "*");
    if (request.method !== "POST") return json({ error: "Méthode non autorisée." }, 405, origin);
    const url = new URL(request.url);
    if (!env.DB || !env.HASH_PEPPER || !env.ADMIN_TOKEN) return json({ error: "Service de licence incomplet." }, 503, origin);
    const length = Number(request.headers.get("content-length") || 0);
    if (length > 2200000) return json({ error: "Requête trop volumineuse." }, 413, origin);
    let body; try { body = await request.json(); } catch { return json({ error: "JSON invalide." }, 400, origin); }
    if (["/v1/sync/pull", "/v1/sync/push"].includes(url.pathname)) return syncRoute(request, env, body, url, origin);
    if (url.pathname === "/v1/trial" || url.pathname === "/v1/verify") {
      const appId = String(body.appId || ""), deviceId = body.deviceId;
      if (!validApp(appId) || !validId(deviceId)) return json({ error: "Données invalides." }, 400, origin);
      const ip = request.headers.get("cf-connecting-ip") || deviceId;
      if (!(await limited(env, url.pathname, ip, 20))) return json({ error: "Trop de tentatives. Réessayez plus tard." }, 429, origin);
      const deviceHash = await digest(deviceId, env.HASH_PEPPER);
      if (url.pathname === "/v1/trial") {
        const existing = await env.DB.prepare("SELECT expires_at FROM trials WHERE app_id=? AND device_hash=?").bind(appId, deviceHash).first();
        if (existing) return new Date(existing.expires_at) > new Date()
          ? json({ status: "active", expiresAt: existing.expires_at, type: "trial" }, 200, origin)
          : json({ error: "Cet essai a déjà été utilisé ou a expiré." }, 409, origin);
        const started = new Date(), expires = new Date(started.getTime() + 3 * 24 * 60 * 60 * 1000);
        await env.DB.prepare("INSERT INTO trials(app_id,device_hash,started_at,expires_at) VALUES(?,?,?,?)")
          .bind(appId, deviceHash, started.toISOString(), expires.toISOString()).run();
        return json({ status: "active", type: "trial", expiresAt: expires.toISOString() }, 201, origin);
      }
      const auth = await authorizedOwner(env, body, origin);
      if (auth.error) return auth.error;
      return json({ status: "active", type: auth.license.license_type, expiresAt: auth.license.expires_at }, 200, origin);
    }
    if (url.pathname.startsWith("/admin/")) {
      if (request.headers.get("authorization") !== "Bearer " + env.ADMIN_TOKEN) return json({ error: "Non autorisé." }, 401, origin);
      if (url.pathname === "/admin/licenses" && body.action === "create") {
        const appId = String(body.appId || "passkeep"), type = String(body.type || ""), maxDevices = Math.max(1, Math.min(20, Number(body.maxDevices) || 1));
        if (!validApp(appId) || !["monthly", "annual", "lifetime", "owner"].includes(type)) return json({ error: "Type ou application invalide." }, 400, origin);
        const code = crypto.randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase();
        const days = type === "monthly" ? 30 : type === "annual" ? 365 : 0;
        const expires = days ? new Date(Date.now() + days * 86400000).toISOString() : null;
        await env.DB.prepare("INSERT INTO licenses(id,app_id,code_hash,license_type,status,expires_at,max_devices,created_at) VALUES(?,?,?,?,?,?,?,?)")
          .bind(crypto.randomUUID(), appId, await digest(code, env.HASH_PEPPER), type, "active", expires, maxDevices, now()).run();
        return json({ code, type, expiresAt: expires, maxDevices }, 201, origin);
      }
      if (url.pathname === "/admin/licenses" && body.action === "revoke") {
        const code = String(body.code || "").trim().toUpperCase();
        if (!validCode(code)) return json({ error: "Code invalide." }, 400, origin);
        const result = await env.DB.prepare("UPDATE licenses SET status='revoked',revoked_at=? WHERE app_id=? AND code_hash=? AND status='active'")
          .bind(now(), String(body.appId || "passkeep"), await digest(code, env.HASH_PEPPER)).run();
        return json({ revoked: !!result.meta?.changes }, 200, origin);
      }
    }
    return json({ error: "Route inconnue." }, 404, origin);
  }
};
