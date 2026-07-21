# Envoi des factures par e-mail (Resend) — installation

Le module *Mes documents* peut envoyer une facture par e-mail au client.
La clé d'e-mail ne se trouve **jamais** dans le site : l'envoi passe par une
fonction serveur (Edge Function Supabase).

## 1. Créer un compte Resend

- Créez un compte sur [resend.com](https://resend.com) (gratuit pour démarrer).
- **Vérifiez votre domaine d'envoi** (ex. `aemconseil.eu`) dans Resend →
  *Domains* (ajout d'enregistrements DNS). C'est indispensable pour que les
  e-mails partent au nom du cabinet et n'arrivent pas en spam.
- Récupérez une **clé API** (`re_...`).

## 2. Déployer la fonction

Avec la [CLI Supabase](https://supabase.com/docs/guides/cli) connectée à votre projet :

```bash
supabase functions deploy send-invoice
```

## 3. Renseigner les secrets

```bash
supabase secrets set RESEND_API_KEY=re_xxxxxxxx
supabase secrets set RESEND_FROM="AEM-CONSEIL <facturation@aemconseil.eu>"
```

L'adresse `RESEND_FROM` doit utiliser le **domaine vérifié** à l'étape 1.

## 4. C'est prêt

Dans *Mes documents* → ouvrir une facture → **Envoyer au client**.
Le client reçoit un e-mail récapitulatif ; la facture est marquée *Envoyée le…*.

Tant que ce n'est pas configuré, **rien n'est cassé** : le bouton bascule sur
un e-mail pré-rempli dans votre messagerie (repli). Vous pouvez donc déjà
envoyer manuellement en attendant.

## Notes

- Le destinataire est l'**e-mail du client** renseigné sur la fiche.
  S'il est vide, l'envoi ouvre directement votre messagerie.
- Le `reply-to` est l'e-mail de l'émetteur (vos réponses reviennent chez vous).
- Étape suivante prévue : joindre le **PDF / Factur-X** et automatiser les
  **relances** des impayés.
