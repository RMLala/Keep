# Passkeep Android — v1.0.1

HTML standalone plus Capacitor 7 Android wrapper. GitHub Actions packages the standalone HTML and builds Debug plus signed Release APKs for API 23 and API 29 when the four signing secrets are present.

## Local build

Requires Node.js 22, Java 21, Android SDK/platform tools.

```sh
npm install
npm run build
npx cap add android
npx cap sync android
node scripts/configure-android.mjs
cd android && ./gradlew assembleApi23Debug assembleApi29Debug
```

The standalone deliverable is `Passkeep-Standalone.html`. It embeds SheetJS, so Excel import, export and the template work offline. Android uses the native share sheet to save exports and encrypted backups to Downloads or another chosen app. Web downloads use the browser's download location.

Signed Release needs GitHub secrets `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, and `KEY_PASSWORD`. The signing key is not included. `versionName` is 1.0.1; Actions increments `versionCode` per run.

## AppForge Cloud synchronization — automatic, no customer account

Passkeep uses the shared AppForge License Worker and its Cloudflare D1 snapshot routes. The customer does not create a Cloud account, enter an email/password, or select an organization. After an eligible licence or trial is activated, the app obtains a short-lived device-bound Cloud token and starts syncing automatically.

- API base (fixed default): `https://appforge-license-api.lalainaadclick.workers.dev`
- Configuration/key refresh: `GET /v1/config` using the `appforge-license-v1` protocol.
- Activation/trial: `POST /v1/activate` or `POST /v1/trial`; eligible responses include `cloudAccess`.
- Token renewal: `POST /v1/cloud/token` with the product, installation ID and signed licence proof.
- Snapshot: `GET/PUT /v1/cloud/snapshot?resource=default`; writes include `expectedRevision`, and concurrent writes return HTTP 409 without overwriting local data.
- Every remote request must be rechecked by the Worker for licence, device, expiry, revocation, entitlement and quota. D1 isolates snapshots by product, licence and resource.
- Android stores the SDK entitlement and Cloud token through the native secure-storage plugin. In HTML standalone, credentials remain in memory only; the signed offline licence proof remains local as before.
- The vault snapshot is already AES-GCM encrypted locally; the PIN and plaintext vault entries are never sent to the Worker. Offline edits remain on this device and the SDK retries when network returns. If startup finds a different remote snapshot, Passkeep asks before replacing either copy.
- The client is fail-closed for Cloud: a missing/invalid token or Worker error leaves the local vault available and never displays a connected/synced state.

The live Worker was checked on 2026-11-19: `/health` and `/v1/config` returned HTTP 200; `GET /v1/cloud/snapshot?resource=default` returned HTTP 401 with “Jeton Cloud invalide ou expiré.” This confirms that the new host has the snapshot route and rejects unauthenticated access. It does not prove a successful authenticated sync.

Google Drive remains a separate optional encrypted backup, not automatic sync. On Android, use the native share sheet to save encrypted backups to Drive and choose a Drive file in the Android picker to restore. The standalone HTML downloads the encrypted file through the browser.

## AppForge licence activation

Passkeep uses the shared service at `https://appforge-license-api.lalainaadclick.workers.dev`. The endpoint is fixed in the app; old `licenseEndpoint` preferences are overwritten on startup, and the endpoint is not requested from the customer.

- Product ID currently sent by this client: `PASSKEEP` (preserved from the prior implementation). Confirm its exact active spelling in production D1 before issuing or testing licences. The repository migration seed only proves `PROMPTI-V1`; it does not establish Passkeep’s production product row. No admin token is embedded in the app.
- Activation: `POST /v1/activate` with `{productId, code, installationId}`.
- Trial: `POST /v1/trial` with `{productId, installationId}`. The service applies its configured one-time trial period.
- Online status/revocation check: `POST /v1/status` with `{productId, token, installationId}`.
- The service returns an ECDSA P-256 signed proof. Passkeep refreshes the public verification key from `/v1/config` online and retains legacy public keys for offline proof validation. The licence code is not saved; no admin token or signing secret is included in the client.
- The local vault remains available offline. AppForge Cloud synchronization requires a valid signed licence or trial.

The Passkeep app accepts the key returned over HTTPS by the central Worker and keeps the prior public verification key so an existing offline proof is not discarded during migration.

## Security

- The standalone HTML uses a local PIN and encrypted vault; browser biometrics are unavailable there.
- Android biometric authentication remains available through the native plugin.
- The cloud snapshot contains encrypted local vault data. AppForge Cloud account credentials and tokens are not written into the Passkeep settings.

## Langues et identité\n\nL’interface propose le français et le malagasy pour la navigation et les libellés principaux. Le panneau À propos & Support reprend l’icône officielle AppForge Studio et la signature Made in Madagascar.\n\n## AppForge V3 checks

The repository keeps the V3 central workflow inherited from `main` and runs `npm test` on every pull request. The static tests parse the app script and guard the backup/share, licensing routes, and no-PWA/no-Drive-API requirements. These checks do not replace Android device tests, biometric tests, real Drive picker tests, or AppForge Cloud/D1 integration tests.

## Support

The app includes an À propos & Support page with current local status, a consent-gated diagnostic email that excludes vault content and credentials, and a GitHub release check. Publisher legal identity and official AppForge Studio logo asset must be confirmed before commercial publication.
