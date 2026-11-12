# Passkeep Cloudflare Worker et synchronisation chiffrée

Le Worker vérifie les licences et conserve une version chiffrée du coffre dans Cloudflare D1. Le navigateur chiffre le coffre avec AES-GCM avant l’envoi. Le Worker ne reçoit ni le PIN maître, ni une clé dérivée, ni des mots de passe en clair. L’accès au coffre local reste hors ligne ; licence active ou essai requis pour les opérations cloud.

## Licences

- Essai unique de 3 jours par installation (non renouvelable).
- Licence mensuelle (30 jours), annuelle (365 jours), à vie ou éditeur.
- Nombre d’appareils configuré à l’émission de chaque licence.
- Les révocations et expirations sont vérifiées lors de chaque appel cloud ; l’expiration suspend la synchronisation, sans effacer le coffre local.

## Déployer

1. Créez un Worker Cloudflare et une base D1 `passkeep-licenses`.
2. Remplacez `database_id` dans `wrangler.toml`.
3. Depuis `license-worker/`, exécutez `npm install`, puis `npm run db:init` et `npm run deploy`.
4. Ajoutez les secrets `HASH_PEPPER` et `ADMIN_TOKEN` au Worker avec `npx wrangler secret put ...`. Générez deux valeurs longues et aléatoires ; elles ne doivent pas apparaître dans le dépôt ni dans l’application.
5. Réglez la variable `ALLOWED_ORIGIN` pour l’origine exacte de l’application Web. Testez CORS depuis l’APK ; pour un schéma Capacitor local sans origine Web standard, adaptez la liste après test, sans placer de secret côté client.
6. Copiez l’URL du Worker dans Passkeep → Licence. Saisissez un code valide ou démarrez l’essai, puis allez à Sauvegardes → Synchronisation chiffrée.

Pour Android, la configuration CORS dépend du schéma/origine utilisé par Capacitor. Ne publiez pas une configuration restrictive avant d’avoir vérifié l’origine effective dans l’APK.

## Routes publiques

- `POST /v1/trial` : démarre ou vérifie l’essai unique de 72 h.
- `POST /v1/verify` : vérifie une licence et associe l’appareil.
- `POST /v1/sync/pull` : retourne la version et le snapshot chiffré.
- `POST /v1/sync/push` : compare `expectedVersion` puis écrit une nouvelle version. Si un autre appareil a avancé, répond `409` ; aucune copie n’est écrasée automatiquement.

L’application présente trois choix explicites en cas de divergence : restaurer le cloud, remplacer le cloud depuis l’appareil courant, ou garder les données locales et vérifier ensuite. Le remplacement est une action distincte avec confirmation. L’essai est limité à l’appareil qui l’a démarré ; utilisez une licence pour la synchronisation multi-appareils.

## Créer/révoquer une licence

`POST /admin/licenses` avec `Authorization: Bearer <ADMIN_TOKEN>` et JSON :

```json
{"action":"create","appId":"passkeep","type":"monthly","maxDevices":2}
```

`type` accepte `monthly`, `annual`, `lifetime` ou `owner`. Révocation :

```json
{"action":"revoke","appId":"passkeep","code":"CODE-CLIENT"}
```

Le code brut n’est renvoyé qu’à la création. D1 conserve son empreinte salée.

## Migration D1 existante

Si la table `licenses` provient de l’ancien schéma sans `monthly`, appliquer une migration D1 qui recrée la table avec le `CHECK` mis à jour avant d’émettre des licences mensuelles. Sauvegardez la base, copiez les lignes vers une table temporaire, recréez `licenses` avec la contrainte `monthly`, restaurez les lignes, puis exécutez le SQL de `schema.sql` pour créer `sync_vaults`. Le nouveau schéma n’efface pas une base existante.

Le contenu des coffres existants n’est pas migré vers D1 automatiquement. Une première synchronisation crée une version distante. Sur un nouvel appareil, utilisez la restauration et le même PIN maître.
