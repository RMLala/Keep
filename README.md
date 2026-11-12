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

## Cloud licence and sync

Cloudflare Worker + D1 source and deployment steps are in `license-worker/README.md`. Cloud sync stores only the encrypted local snapshot, checks licence status, and uses version compare-and-swap. Conflicts do not overwrite data unless the user explicitly selects a restore or cloud replacement. No Cloudflare secret belongs in this repository or the client.

## Security

- The standalone HTML uses a local PIN and encrypted vault; browser biometrics are unavailable there.
- Android biometric authentication remains available through the native plugin.
- Cloud sync requires an active license or the one-time 3-day trial; local vault use remains offline and does not depend on Cloudflare.
