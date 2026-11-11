# Passkeep License Worker + D1

Source de service licence Cloudflare. Types pris en charge: essai 24 h (une fois par appareil), annuel (365 jours), à vie, éditeur. Association multi-appareils limitée selon `max_devices`; révocation vérifiée lors des appels de validation. Le Worker n’entrepose que des empreintes de code et d’appareil (HMAC-like SHA-256 avec secret serveur), jamais le contenu du coffre.

## Déploiement

1. Créer une base D1 et renseigner `database_id` dans `wrangler.toml`.
2. `npm install` puis `npx wrangler d1 execute passkeep-licenses --remote --file=./schema.sql`.
3. Ajouter des secrets Cloudflare `HASH_PEPPER` (long aléatoire) et `ADMIN_TOKEN` (long aléatoire).
4. Définir `ALLOWED_ORIGIN` en variable Worker pour l’origine exacte de l’application web. Pour l’application locale Android, régler la politique d’origine selon le schéma Capacitor du projet et tester depuis l’émulateur/appareil.
5. `npm run deploy`, puis saisir l’URL `/` du Worker dans la section Licence de Passkeep.

## Administration

POST `/admin/licenses` avec Bearer `ADMIN_TOKEN`, JSON `{ "action":"create", "appId":"passkeep", "type":"annual|lifetime|owner", "maxDevices":1 }`. Le code brut n’est rendu qu’une fois. Pour le révoquer: même route, `{ "action":"revoke", "appId":"passkeep", "code":"..." }`.

Le Worker applique une limite simple par fenêtre d’une minute. Les protections d’essai basées sur un identifiant d’installation local ne peuvent empêcher un utilisateur techniquement avancé d’effacer les données de l’application; une activation commerciale stricte nécessite aussi une identité serveur ou une intégrité de plateforme. La licence n’est pas un mécanisme de chiffrement du coffre.
