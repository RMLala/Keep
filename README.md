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

Google Drive remains a separate, optional encrypted backup.

## Licence activation

Licence activation is separate from AppForge Cloud synchronization. The app still has fields for a licence service endpoint and code. Connect those controls only to the existing AppForge licence API after confirming its client routes; this branch does not deploy or require a second Worker/D1. Local vault access remains available offline.

## Security

- The standalone HTML uses a local PIN and encrypted vault; browser biometrics are unavailable there.
- Android biometric authentication remains available through the native plugin.
- The cloud snapshot contains encrypted local vault data. AppForge Cloud account credentials and tokens are not written into the Passkeep settings.
