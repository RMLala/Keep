const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../cloud/appforge-cloud-sync.js');

function fixture({ remote = null, onInitialRemote, onConflict, isOnline = true } = {}) {
  const db = new Map();
  const calls = [];
  const local = { records: [{ id: 'a', value: 10 }] };
  let serverSnapshot = remote;
  let revision = remote ? 1 : 0;
  let online = isOnline;
  const store = { get: async k => db.get(k) ?? null, set: async (k,v) => db.set(k,v), remove: async k => db.delete(k) };
  const fetch = async (url, init = {}) => {
    const path = new URL(url).pathname + new URL(url).search;
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path, method: init.method || 'GET', body, headers: init.headers || {} });
    if (path.endsWith('/v1/activate')) return response({ token: 'license-signed', cloudAccess: { token: 'cloud-signed', expiresAt: new Date(Date.now()+3600000).toISOString() } });
    if (path.endsWith('/v1/cloud/token')) return response({ token: 'renewed-cloud', expiresAt: new Date(Date.now()+3600000).toISOString() });
    if (path.includes('/v1/cloud/snapshot') && (init.method || 'GET') === 'GET') return response({ revision, snapshot: serverSnapshot });
    if (path.includes('/v1/cloud/snapshot') && init.method === 'PUT') {
      if (body.expectedRevision !== revision) return response({ conflict: true, revision, snapshot: serverSnapshot }, 409);
      serverSnapshot = body.snapshot; revision += 1;
      return response({ revision });
    }
    throw new Error('Unexpected request: ' + path);
  };
  const client = create({
    apiBase: 'https://licenses.example.workers.dev',
    productId: 'DEMO_APP',
    store, fetch, isOnline: () => online,
    data: { getSnapshot: async () => local, applySnapshot: async data => Object.assign(local, data) },
    onInitialRemote, onConflict
  });
  return { client, calls, db, local, setOnline(value){online=value}, get serverSnapshot(){return serverSnapshot}, get revision(){return revision} };
}
function response(data, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => data }; }

test('activation provisions Cloud and uploads local data without account fields', async () => {
  const f = fixture();
  const activated = await f.client.activate('APF-ABCDE-ABCDE-ABCDE-ABCDE');
  assert.equal(activated.sync.state, 'synced');
  assert.equal(f.calls[0].path, '/v1/activate');
  assert.deepEqual(Object.keys(f.calls[0].body).sort(), ['code','installationId','productId']);
  assert.equal(f.calls.some(x => x.path.includes('login') || x.path.includes('session') || x.path.includes('organizations')), false);
  assert.equal(f.calls.at(-1).method, 'PUT');
  assert.equal(f.calls.at(-1).headers.Authorization, 'Bearer cloud-signed');
  assert.deepEqual(f.serverSnapshot, f.local);
});

test('existing server data is surfaced for a choice instead of overwriting local data', async () => {
  let choicePayload;
  const remote = { records: [{ id: 'remote', value: 99 }] };
  const f = fixture({ remote, onInitialRemote: async value => { choicePayload = value; return undefined; } });
  const activated = await f.client.activate('APF-ABCDE-ABCDE-ABCDE-ABCDE');
  assert.equal(activated.sync.state, 'remote-available');
  assert.equal(choicePayload.remote.records[0].id, 'remote');
  assert.equal(f.calls.some(x => x.method === 'PUT'), false);
  assert.equal(f.local.records[0].id, 'a');
});

test('concurrent local and remote changes report a conflict without writing', async () => {
  const f = fixture();
  await f.client.activate('APF-ABCDE-ABCDE-ABCDE-ABCDE');
  f.local.records.push({ id: 'local', value: 20 });
  f.calls.length = 0;
  // Another authorized device changed the server copy and revision.
  const originalFetch = f.client.fetcher;
  f.client.fetcher = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/v1/cloud/snapshot' && (init.method || 'GET') === 'GET') return response({ revision: 2, snapshot: { records: [{ id: 'other-device', value: 30 }] } });
    return originalFetch(url, init);
  };
  const result = await f.client.sync();
  assert.equal(result.state, 'conflict');
  assert.equal(f.calls.some(x => x.method === 'PUT'), false);
});

test('a write race offers the fresh server copy to the conflict handler', async () => {
  let prompted = false;
  const f = fixture({ onConflict: async ({ raced, remote }) => {
    prompted = raced === true && remote.records[0].id === 'newer-device';
    return 'remote';
  } });
  const originalFetch = f.client.fetcher;
  let firstWrite = true;
  f.client.fetcher = async (url, init = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/v1/cloud/snapshot' && init.method === 'PUT' && firstWrite) {
      firstWrite = false;
      return response({ conflict: true, revision: 1, snapshot: { records: [{ id: 'newer-device', value: 50 }] } }, 409);
    }
    return originalFetch(url, init);
  };
  const activated = await f.client.activate('APF-ABCDE-ABCDE-ABCDE-ABCDE');
  assert.equal(prompted, true);
  assert.equal(activated.sync.direction, 'download');
  assert.equal(f.local.records[0].id, 'newer-device');
});

test('offline activation keeps data local and sync resumes after reconnect', async () => {
  const f = fixture({ isOnline: false });
  const activated = await f.client.activate('APF-ABCDE-ABCDE-ABCDE-ABCDE');
  assert.equal(activated.sync.state, 'offline');
  assert.equal(f.calls.some(x => x.path.includes('/v1/cloud/snapshot')), false);
  assert.equal(f.serverSnapshot, null);
  f.setOnline(true);
  const resumed = await f.client.start();
  assert.equal(resumed.state, 'synced');
  assert.deepEqual(f.serverSnapshot, f.local);
});

test('an expired Cloud token is renewed before the authenticated snapshot request', async () => {
  const f = fixture();
  await f.client.activate('APF-ABCDE-ABCDE-ABCDE-ABCDE');
  const entitlementKey = 'appforge-cloud-entitlement-v1:DEMO_APP';
  const record = JSON.parse(f.db.get(entitlementKey));
  record.cloudExpiresAt = new Date(Date.now() - 1000).toISOString();
  f.db.set(entitlementKey, JSON.stringify(record));
  f.calls.length = 0;
  const result = await f.client.sync();
  assert.equal(result.state, 'synced');
  assert.ok(f.calls.some(x => x.path === '/v1/cloud/token'));
  const snapshot = f.calls.find(x => x.path.startsWith('/v1/cloud/snapshot'));
  assert.equal(snapshot.headers.Authorization, 'Bearer renewed-cloud');
});
