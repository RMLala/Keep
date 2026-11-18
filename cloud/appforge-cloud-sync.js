/*
 * AppForge Cloud client bridge
 * No customer account, email, password, or organization is used.
 * The entitlement is issued by /v1/activate or /v1/trial and scoped by the Worker.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AppForgeCloudSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 1;
  const jsonClone = value => JSON.parse(JSON.stringify(value));
  const stable = value => {
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
    return JSON.stringify(value);
  };
  const base64 = bytes => {
    let binary = '';
    for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
    return btoa(binary);
  };
  async function fingerprint(value) {
    if (!globalThis.crypto?.subtle) throw new Error('Le chiffrement WebCrypto requis pour la synchronisation est indisponible.');
    return base64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(value))));
  }
  function randomId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    return Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
  }
  function localStorageAdapter(storage) {
    return {
      get: async key => storage.getItem(key),
      set: async (key, value) => storage.setItem(key, value),
      remove: async key => storage.removeItem(key)
    };
  }

  class AppForgeCloudSync {
    constructor(options = {}) {
      const productId = String(options.productId || '').trim().toUpperCase();
      if (!/^[A-Z0-9_-]{3,40}$/.test(productId)) throw new Error('Identifiant produit AppForge invalide.');
      const apiBase = String(options.apiBase || '').trim().replace(/\/$/, '');
      if (!/^https:\/\//i.test(apiBase)) throw new Error('L’URL HTTPS du Worker AppForge Licence est requise.');
      this.productId = productId;
      this.apiBase = apiBase;
      this.fetcher = options.fetch || globalThis.fetch?.bind(globalThis);
      if (!this.fetcher) throw new Error('Fetch est indisponible dans cet environnement.');
      this.store = options.store || localStorageAdapter(options.storage || globalThis.localStorage);
      if (!this.store?.get || !this.store?.set) throw new Error('Fournis un stockage persistant avec get/set (Keystore Android recommandé).');
      this.isOnline = options.isOnline || (() => globalThis.navigator?.onLine !== false);
      this.installKey = options.installKey || 'appforge-install-v1:' + productId;
      this.entitlementKey = options.entitlementKey || 'appforge-cloud-entitlement-v1:' + productId;
      this.hooks = options.data || null;
      this.onStatus = options.onStatus || (() => {});
      this.onInitialRemote = options.onInitialRemote || null;
      this.onConflict = options.onConflict || null;
      this.debounceMs = Math.max(250, Number(options.debounceMs) || 1200);
      this.pending = null;
      this.started = false;
      this._online = () => { if (this.started) this.sync().catch(error => this._status({ state: 'error', error: error.message })); };
    }

    _status(value) { try { this.onStatus(value); } catch (error) { console.warn('AppForge Cloud status handler:', error); } }
    _resource(resource) {
      const value = String(resource || 'default');
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(value)) throw new Error('Nom de ressource Cloud invalide.');
      return value;
    }
    async _installationId() {
      let id = await this.store.get(this.installKey);
      if (!id) { id = randomId(); await this.store.set(this.installKey, id); }
      if (id.length < 16 || id.length > 120) throw new Error('Identifiant local de cette installation invalide.');
      return id;
    }
    async _record() {
      try { return JSON.parse(await this.store.get(this.entitlementKey) || 'null') || { version: VERSION, revisions: {}, fingerprints: {} }; }
      catch { throw new Error('Les informations d’accès Cloud locales sont illisibles. Réactive la licence ou restaure une sauvegarde.'); }
    }
    async _save(record) { record.version = VERSION; await this.store.set(this.entitlementKey, JSON.stringify(record)); }
    async _request(path, options = {}, bearer = '') {
      const response = await this.fetcher(this.apiBase + path, {
        ...options,
        headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}), ...(options.headers || {}) }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data.error || 'Le Worker AppForge a répondu HTTP ' + response.status + '.');
        error.status = response.status;
        error.data = data;
        throw error;
      }
      return data;
    }
    async _acceptEntitlement(data) {
      if (!data?.token || !data?.cloudAccess?.token) throw new Error('Activation acceptée sans jeton Cloud. Vérifie la version déployée du Worker.');
      const record = await this._record();
      record.licenseToken = data.token;
      record.cloudToken = data.cloudAccess.token;
      record.cloudExpiresAt = data.cloudAccess.expiresAt || null;
      record.activatedAt = new Date().toISOString();
      record.revisions ||= {};
      record.fingerprints ||= {};
      await this._save(record);
      return record;
    }
    async activate(code) {
      const value = String(code || '').trim().toUpperCase();
      if (!value) throw new Error('Saisis le code de licence.');
      this._status({ state: 'activating' });
      const data = await this._request('/v1/activate', { method: 'POST', body: JSON.stringify({ productId: this.productId, code: value, installationId: await this._installationId() }) });
      await this._acceptEntitlement(data);
      this._status({ state: 'licensed', expiresAt: data.expiresAt || null, cloud: 'ready' });
      let sync = { state: 'ready' };
      if (this.hooks) sync = await this.sync();
      return { ...data, sync };
    }
    async startTrial() {
      const data = await this._request('/v1/trial', { method: 'POST', body: JSON.stringify({ productId: this.productId, installationId: await this._installationId() }) });
      await this._acceptEntitlement(data);
      this._status({ state: 'trial', expiresAt: data.expiresAt, cloud: 'ready' });
      let sync = { state: 'ready' };
      if (this.hooks) sync = await this.sync();
      return { ...data, sync };
    }
    async _cloudToken(force = false) {
      let record = await this._record();
      if (!record.licenseToken) throw new Error('Active d’abord une licence AppForge ou un essai.');
      const expires = Date.parse(record.cloudExpiresAt || '');
      if (!force && record.cloudToken && Number.isFinite(expires) && expires > Date.now() + 60000) return record.cloudToken;
      const renewed = await this._request('/v1/cloud/token', {
        method: 'POST',
        body: JSON.stringify({ productId: this.productId, installationId: await this._installationId(), licenseToken: record.licenseToken })
      });
      if (!renewed.token) throw new Error('Le Worker n’a pas retourné de jeton Cloud.');
      record = await this._record();
      record.cloudToken = renewed.token;
      record.cloudExpiresAt = renewed.expiresAt || null;
      await this._save(record);
      return renewed.token;
    }
    async _read(resource, token) {
      return this._request('/v1/cloud/snapshot?resource=' + encodeURIComponent(resource), {}, token);
    }
    async _write(resource, snapshot, expectedRevision, token) {
      const payload = JSON.stringify({ expectedRevision, snapshot });
      if (new TextEncoder().encode(payload).byteLength > 440000) throw new Error('La sauvegarde dépasse 440 Ko. Réduis les données ou les pièces jointes avant la synchronisation.');
      return this._request('/v1/cloud/snapshot?resource=' + encodeURIComponent(resource), { method: 'PUT', body: payload }, token);
    }
    async sync(options = {}) {
      const hooks = options.data || this.hooks;
      if (!hooks?.getSnapshot || !hooks?.applySnapshot) throw new Error('Déclare data.getSnapshot et data.applySnapshot pour relier les données de cette application.');
      const resource = this._resource(options.resource || 'default');
      if (!this.isOnline()) return { state: 'offline' };
      this._status({ state: 'syncing', resource });
      let token = await this._cloudToken();
      let remote;
      try { remote = await this._read(resource, token); }
      catch (error) {
        if (error.status === 401) { token = await this._cloudToken(true); remote = await this._read(resource, token); }
        else throw error;
      }
      const local = await hooks.getSnapshot();
      if (!local || typeof local !== 'object' || Array.isArray(local)) throw new Error('data.getSnapshot doit renvoyer un objet JSON.');
      const localHash = await fingerprint(local);
      const record = await this._record();
      const known = record.fingerprints?.[resource] || null;
      const knownRevision = Number(record.revisions?.[resource] || 0);
      if (!remote.snapshot) {
        return this._upload(resource, local, localHash, Number(remote.revision || 0), token, hooks);
      }
      const remoteHash = await fingerprint(remote.snapshot);
      if (!known) {
        if (!this.onInitialRemote) {
          this._status({ state: 'choice-required', resource, revision: remote.revision });
          return { state: 'remote-available', resource, revision: remote.revision, snapshot: jsonClone(remote.snapshot) };
        }
        const choice = await this.onInitialRemote({ resource, local: jsonClone(local), remote: jsonClone(remote.snapshot), revision: remote.revision });
        return this._resolveChoice(choice, { resource, local, localHash, remote, remoteHash, token, hooks });
      }
      const localChanged = localHash !== known;
      const remoteChanged = remoteHash !== known;
      if (Number(remote.revision) === knownRevision && !localChanged) {
        this._status({ state: 'synced', resource, revision: remote.revision, direction: 'none' });
        return { state: 'synced', direction: 'none', revision: remote.revision };
      }
      if (!localChanged && remoteChanged) {
        await hooks.applySnapshot(jsonClone(remote.snapshot));
        await this._remember(resource, remoteHash, remote.revision);
        this._status({ state: 'synced', resource, revision: remote.revision, direction: 'download' });
        return { state: 'synced', direction: 'download', revision: remote.revision };
      }
      if (localChanged && !remoteChanged && Number(remote.revision) === knownRevision) {
        return this._upload(resource, local, localHash, Number(remote.revision), token, hooks);
      }
      if (localChanged && !remoteChanged && Number(remote.revision) > knownRevision) {
        return this._upload(resource, local, localHash, Number(remote.revision), token, hooks);
      }
      if (!localChanged && !remoteChanged && Number(remote.revision) > knownRevision) {
        await this._remember(resource, remoteHash, remote.revision);
        this._status({ state: 'revision-changed', resource, revision: remote.revision });
        return { state: 'synced', direction: 'none', revision: remote.revision };
      }
      if (this.onConflict) {
        const choice = await this.onConflict({ resource, local: jsonClone(local), remote: jsonClone(remote.snapshot), localRevision: knownRevision, remoteRevision: remote.revision });
        return this._resolveChoice(choice, { resource, local, localHash, remote, remoteHash, token, hooks });
      }
      this._status({ state: 'conflict', resource, localRevision: knownRevision, remoteRevision: remote.revision });
      return { state: 'conflict', resource, localRevision: knownRevision, remoteRevision: remote.revision };
    }
    async _resolveChoice(choice, ctx) {
      if (choice === 'remote') {
        await ctx.hooks.applySnapshot(jsonClone(ctx.remote.snapshot));
        await this._remember(ctx.resource, ctx.remoteHash, ctx.remote.revision);
        this._status({ state: 'synced', resource: ctx.resource, revision: ctx.remote.revision, direction: 'download' });
        return { state: 'synced', direction: 'download', revision: ctx.remote.revision };
      }
      const selected = choice === 'local' ? ctx.local : choice && typeof choice === 'object' ? choice : null;
      if (!selected) {
        this._status({ state: 'choice-required', resource: ctx.resource, revision: ctx.remote.revision });
        return { state: 'remote-available', resource: ctx.resource, revision: ctx.remote.revision };
      }
      const hash = await fingerprint(selected);
      return this._upload(ctx.resource, selected, hash, Number(ctx.remote.revision), ctx.token, ctx.hooks);
    }
    async _upload(resource, snapshot, hash, revision, token, hooks = this.hooks, allowConflictCallback = true) {
      try {
        const written = await this._write(resource, snapshot, revision, token);
        await this._remember(resource, hash, written.revision);
        this._status({ state: 'synced', resource, revision: written.revision, direction: 'upload' });
        return { state: 'synced', direction: 'upload', revision: written.revision };
      } catch (error) {
        if (error.status === 409) {
          if (allowConflictCallback && this.onConflict && error.data?.snapshot && hooks?.applySnapshot) {
            const latestRevision = Number(error.data.revision || 0);
            const choice = await this.onConflict({ resource, local: jsonClone(snapshot), remote: jsonClone(error.data.snapshot), localRevision: Number(revision), remoteRevision: latestRevision, raced: true });
            if (choice === 'remote') {
              await hooks.applySnapshot(jsonClone(error.data.snapshot));
              await this._remember(resource, await fingerprint(error.data.snapshot), latestRevision);
              this._status({ state: 'synced', resource, revision: latestRevision, direction: 'download' });
              return { state: 'synced', direction: 'download', revision: latestRevision };
            }
            const selected = choice === 'local' ? snapshot : choice && typeof choice === 'object' ? choice : null;
            if (selected) return this._upload(resource, selected, await fingerprint(selected), latestRevision, token, hooks, false);
          }
          this._status({ state: 'conflict', resource, remoteRevision: error.data?.revision });
          return { state: 'conflict', resource, remoteRevision: error.data?.revision };
        }
        throw error;
      }
    }
    async _remember(resource, hash, revision) {
      const record = await this._record();
      record.fingerprints ||= {};
      record.revisions ||= {};
      record.fingerprints[resource] = hash;
      record.revisions[resource] = Number(revision || 0);
      await this._save(record);
    }
    async chooseRemote(resource = 'default') {
      const token = await this._cloudToken(), remote = await this._read(this._resource(resource), token);
      if (!remote.snapshot) return { state: 'empty' };
      if (!this.hooks?.applySnapshot) throw new Error('Déclare data.applySnapshot avant de restaurer le Cloud.');
      await this.hooks.applySnapshot(jsonClone(remote.snapshot));
      await this._remember(resource, await fingerprint(remote.snapshot), remote.revision);
      this._status({ state: 'synced', resource, revision: remote.revision, direction: 'download' });
      return { state: 'synced', direction: 'download', revision: remote.revision };
    }
    async chooseLocal(resource = 'default') {
      if (!this.hooks?.getSnapshot) throw new Error('Déclare data.getSnapshot avant d’envoyer les données locales.');
      const token = await this._cloudToken(), key = this._resource(resource), remote = await this._read(key, token), local = await this.hooks.getSnapshot();
      if (!local || typeof local !== 'object' || Array.isArray(local)) throw new Error('data.getSnapshot doit renvoyer un objet JSON.');
      return this._upload(key, local, await fingerprint(local), Number(remote.revision || 0), token, this.hooks);
    }
    start() {
      if (!this.hooks?.getSnapshot || !this.hooks?.applySnapshot) throw new Error('Configure les adaptateurs de données avant start().');
      if (!this.started) { this.started = true; globalThis.addEventListener?.('online', this._online); }
      return this.sync();
    }
    notifyLocalChange(resource = 'default') {
      if (!this.started || !this.isOnline()) return;
      clearTimeout(this.pending);
      this.pending = setTimeout(() => this.sync({ resource }).catch(error => this._status({ state: 'error', error: error.message })), this.debounceMs);
    }
    stop() {
      this.started = false;
      clearTimeout(this.pending);
      globalThis.removeEventListener?.('online', this._online);
    }
  }

  return Object.freeze({ create: options => new AppForgeCloudSync(options), AppForgeCloudSync });
});
