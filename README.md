# Passkeep Android — v1.0.0

Standalone HTML app plus Capacitor 7 Android wrapper. API 23 and API 29 variants are configured by GitHub Actions. Capacitor 7 is selected because Capacitor 8 requires API 24 and cannot produce the requested API 23 variant.

## Build locally

1. Install Node.js 22, Java 17, Android SDK and platform tools.
2. `npm install`
3. `npm run build`
4. `npx cap add android && npx cap sync android`
5. `node scripts/configure-android.mjs`
6. `cd android && ./gradlew assembleApi23Debug assembleApi29Debug`

Release builds require the signing keystore, which is not included. Add GitHub Actions secrets `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, and `KEY_PASSWORD`. Do not put the keystore or passwords in source control. Workflow artifacts contain Debug builds and, when all secrets exist, signed API23/API29 Release APKs. The version name remains 1.0.0; Release versionCode uses the GitHub run number.

## Security notes

- The HTML standalone mode is local-only and uses a PIN; it cannot access native biometric authentication.
- The Android wrapper exposes native biometric prompt and encrypted Android Keystore-backed storage. Biometrics gates the app UI, and secure storage encrypts data at rest; this does not recover a forgotten PIN.
- Recovery key must be saved separately. Do not promise email recovery without a backend that can verify identity without storing vault plaintext.
- The HTML Drive backup uses the user's OAuth client ID and `drive.appdata`; configure OAuth consent/origin in Google Cloud. The backup file is encrypted before upload.
- Excel import/export can contain plaintext credentials. Export is confirmation-gated; treat such files as sensitive.
- Set no API secrets in the HTML. Deploy the separate Cloudflare Worker/D1 license service and configure its URL in the app to activate trial/license checks.

The separate license package includes draft terms to complete with the publisher’s legal identity, jurisdiction, pricing and refund terms before commercial distribution.

## Import Excel

Le modèle vierge se trouve dans `assets/Passkeep_Modele_Import.xlsx`. Les colonnes minimales à renseigner sont « Site / service » et « Mot de passe ». Les mots de passe du classeur sont en clair : ne pas le partager et le supprimer après import.

## Licence

Le code du Cloudflare Worker et le schéma D1 sont dans `license-worker/`. Le service doit être déployé et configuré avant d’activer les essais ou licences dans l’application. Renseigner l’identifiant D1 et les secrets Cloudflare dans le tableau de bord Cloudflare; ne pas enregistrer de secrets dans ce dépôt.

## Builds

Le workflow `Android` compile deux variantes Debug et, si les secrets de signature sont disponibles dans GitHub Actions, deux APK Release signées: API 23 et API 29. Le HTML autonome reste disponible à la racine.
