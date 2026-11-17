# Passkeep Android — v1.0.0

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

Signed Release needs GitHub secrets `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, and `KEY_PASSWORD`. The signing key is not included. `versionName` remains 1.0.0; Actions increments `versionCode` per run.

## AppForge Cloud synchronization

Passkeep uses the existing AppForge Cloud service; it does not need a Passkeep-specific Worker or D1 database.

- Default service: `https://appforge-cloud-api.appforge-licences-mg.workers.dev`
- Authentication: `POST /v1/auth/login` with the AppForge account. The session token stays in memory and the password is cleared after login.
- The user selects an organization. Passkeep uses the stable snapshot ID `passkeep-v1`.
- Snapshot route: `/v1/organizations/{orgId}/apps/passkeep-v1/snapshot`
- Read: `GET`; write: `PUT` with `{expectedRevision, snapshot}`. Revision conflicts (HTTP 409) keep local data and require an explicit choice.
- Only the locally encrypted vault envelope is uploaded. The PIN and plaintext entries are never sent. Automatic sync is available after the local and cloud copies are linked.
- The app caps the request at 450 KB to stay below the AppForge API's 500 KB snapshot limit.
- The Cloud Worker enforces the `APP_ORIGINS` allow-list. Add the exact HTTPS origin used to host Passkeep. A standalone file opened as `file://` remains local and cannot use Cloud sync.

Google Drive is a separate, optional encrypted backup. Passkeep does not request a Drive OAuth client or store a Google token: on Android, use the native share sheet to save the encrypted backup to Drive; restore by choosing the backup file from Drive in the Android file picker. The HTML standalone downloads the encrypted file through the browser.

## AppForge licence activation

Passkeep uses the existing service at `https://appforge-license-api.appforge-licences-mg.workers.dev`. No Passkeep-specific Worker or D1 database is deployed or required.

- AppForge product ID: `PASSKEEP`. It must be registered and active in the existing License API.
- Activation: `POST /v1/activate` with `{productId, code, installationId}`.
- Trial: `POST /v1/trial` with `{productId, installationId}`. The service applies its configured one-time trial period.
- Online status/revocation check: `POST /v1/status` with `{productId, token, installationId}`.
- The service returns an ECDSA P-256 signed proof. Passkeep verifies it locally with the currently pinned public key and checks it online when connected. The licence code is not saved; no admin token or signing secret is included in the client.
- The local vault remains available offline. AppForge Cloud synchronization requires a valid signed licence or trial.

If the AppForge signing key is rotated, update the public key pinned in Passkeep before issuing builds that must accept new proofs.

## Security

- The standalone HTML uses a local PIN and encrypted vault; browser biometrics are unavailable there.
- Android biometric authentication remains available through the native plugin.
- The cloud snapshot contains encrypted local vault data. AppForge Cloud account credentials and tokens are not written into the Passkeep settings.

## AppForge V3 checks

The repository keeps the V3 central workflow inherited from `main` and runs `npm test` on every pull request. The static tests parse the app script and guard the backup/share, licensing routes, and no-PWA/no-Drive-API requirements. These checks do not replace Android device tests, biometric tests, real Drive picker tests, or AppForge Cloud/D1 integration tests.

## Support

The app includes an À propos & Support page with current local status, a consent-gated diagnostic email that excludes vault content and credentials, and a GitHub release check. Publisher legal identity and official AppForge Studio logo asset must be confirmed before commercial publication.
