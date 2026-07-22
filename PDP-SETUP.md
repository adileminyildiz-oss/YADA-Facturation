# Brancher la PDP (Plateforme Agréée) — Pennylane

L'espace génère déjà le **Factur-X (EN 16931 / CII)** et gère les **statuts du
cycle de vie**. Pour transmettre réellement les factures, il se connecte à une
**PDP (Plateforme Agréée)** via une fonction serveur — le secret de la PDP n'est
**jamais** dans le site.

Ce guide utilise **Pennylane** (le choix retenu). La même fonction marche pour
une autre PDP en changeant les variables.

## 1. Créer le compte et récupérer la clé d'API

1. Ouvrir un compte **Pennylane** et activer l'option **Plateforme Agréée / e-invoicing**.
2. Renseigner le **SIREN/SIRET** d'AEM CONSEIL → Pennylane vous inscrit à l'**annuaire** (indispensable pour être retrouvé par vos clients).
3. Dans Pennylane → **Paramètres → API / Développeurs**, générer un **jeton d'API**.
4. Noter, depuis la doc API Pennylane :
   - l'**URL de base** de l'API (ex. `https://app.pennylane.com/api/external/v2`),
   - le **chemin d'émission** (envoi de vos factures clients),
   - le **chemin de réception** (import des factures fournisseurs — obligation **1er sept. 2026**),
   - demander un accès **bac à sable (sandbox)** pour tester avant la production.

> ⚠️ Les chemins exacts d'émission/réception doivent être **confirmés sur la doc
> Pennylane** et **testés en sandbox**. La fonction serveur les prend en
> paramètres, rien n'est figé dans le code.

## 2. Déployer la fonction serveur

Avec la [CLI Supabase](https://supabase.com/docs/guides/cli) connectée au projet :

```bash
supabase functions deploy pdp-transmit
```

## 3. Renseigner les secrets

```bash
supabase secrets set PDP_API_KEY=xxxxxxxx
supabase secrets set PDP_API_BASE=https://app.pennylane.com/api/external/v2
supabase secrets set PDP_EMIT_PATH=/customer_invoices/import          # à confirmer
supabase secrets set PDP_RECEIVE_PATH=/supplier_invoices/e_invoices/imports
# optionnel : schéma d'authentification, "Bearer" par défaut
supabase secrets set PDP_AUTH_SCHEME=Bearer
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` sont fournis automatiquement — ne pas les ajouter.

## 4. Utilisation

Dans **Espace → E-facture** :

1. Sélectionner une facture → vérifier les mentions → **Ajouter à transmettre**.
2. Dans la file de transmission, cliquer sur l'icône **Transmettre** (avion en papier).
3. Le Factur-X part vers la PDP ; le **statut du cycle de vie** se met à jour
   (Déposée → Mise à disposition → …). Vous pouvez aussi ajuster le statut à la main
   au fil des retours de la PDP.

Tant que les secrets ne sont pas renseignés, **rien n'est cassé** : le bouton
affiche simplement « PDP non branchée » et vous pouvez toujours **télécharger le
XML** pour un dépôt manuel sur le portail de la PDP.

## 5. À vérifier avant la production

- [ ] Statut **immatriculée à titre définitif** de la PDP sur [impots.gouv.fr](https://www.impots.gouv.fr/je-consulte-la-liste-des-plateformes-agreees).
- [ ] **Chemins émission/réception** exacts confirmés sur la doc Pennylane.
- [ ] **Format du corps** de la requête conforme à l'API Pennylane (la fonction
      envoie par défaut le fichier en base64 dans un JSON ; certaines API
      attendent un `multipart/form-data` — à ajuster dans `pdp-transmit/index.ts`).
- [ ] Test complet en **sandbox** (émission + réception) avant `sk_live`.

## Rappel du calendrier

| Échéance | Obligation | Concernés |
|---|---|---|
| **1er sept. 2026** | **Réception** de factures électroniques | Toutes les entreprises |
| **1er sept. 2027** | **Émission** + e-reporting | TPE / PME / micro (dont AEM CONSEIL) |
