# Paiement en ligne (Stripe) — installation

Le module **Abonnement** peut lancer un vrai paiement récurrent via Stripe.
Le secret Stripe ne se trouve **jamais** dans le site : tout passe par deux
fonctions serveur (Edge Functions Supabase). Voici les étapes.

## 1. Créer les produits et tarifs dans Stripe

Dans le tableau de bord Stripe → **Produits**, créez 3 tarifs **récurrents (mensuels)** :

| Offre | Prix | Note l'ID du tarif |
|-------|------|--------------------|
| Essentiel | 14,99 € / mois | `price_...` |
| Pro | 44,99 € / mois | `price_...` |
| Premium | 149,99 € / mois | `price_...` |

## 2. Déployer les fonctions

Avec la [CLI Supabase](https://supabase.com/docs/guides/cli) connectée à votre projet :

```bash
supabase functions deploy create-checkout
supabase functions deploy stripe-webhook --no-verify-jwt
```

## 3. Renseigner les secrets

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_live_xxx
supabase secrets set PRICE_ESSENTIEL=price_xxx PRICE_PRO=price_xxx PRICE_PREMIUM=price_xxx
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY` sont fournis
automatiquement par Supabase — ne les ajoutez pas.

## 4. Configurer le webhook Stripe

Dans Stripe → **Développeurs → Webhooks → Ajouter un endpoint** :

- **URL** : celle de la fonction `stripe-webhook`
  (`https://<projet>.functions.supabase.co/stripe-webhook`).
- **Événements** : `checkout.session.completed`,
  `customer.subscription.updated`, `customer.subscription.deleted`.

Stripe affiche alors une **clé de signature** (`whsec_...`) :

```bash
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxx
```

## 5. C'est prêt

Dans l'espace, le bouton **Choisir** d'une offre redirige vers le paiement
sécurisé Stripe. Après paiement, le webhook active automatiquement l'offre du
compte (colonne « Offre » dans l'Admin, débloquant les modules correspondants).

Tant que ces étapes ne sont pas faites, **rien n'est cassé** : le bouton
« Choisir » bascule simplement sur une **demande par e-mail**, et vous pouvez
attribuer l'offre manuellement depuis le panneau **Administration**.

## Paiement en ligne des factures (par le client)

En plus des abonnements, le client peut régler **une facture** en ligne.

```bash
supabase functions deploy create-invoice-payment
```

Aucun secret supplémentaire : `STRIPE_SECRET_KEY` suffit. Le webhook
`stripe-webhook` (déjà déployé, événement `checkout.session.completed`
déjà abonné) reconnaît les paiements de facture et **enregistre le
règlement** sur la facture (statut « Payée »).

Utilisation : dans *Mes documents* → facture non soldée → **Générer un
lien de paiement**. Le lien est copiable et automatiquement ajouté à
l'e-mail « Payer en ligne ».

## Notes

- Testez d'abord en mode **Test** de Stripe (clés `sk_test_` / `price_` de test,
  cartes de test) avant de passer en `sk_live_`.
- La résiliation d'un abonnement (webhook `subscription.deleted`) repasse le
  compte en « Gratuit » automatiquement.
