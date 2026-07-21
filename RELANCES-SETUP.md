# Relances automatiques des impayés — installation

Une fonction serveur (`send-reminders`) parcourt chaque jour les factures
**en retard et non réglées**, et envoie un rappel par e-mail au client.
Elle réutilise Resend (voir `RESEND-SETUP.md`).

## Règles de relance (par défaut, modifiables)

| Réglage | Défaut | Rôle |
|---|---|---|
| `RELANCE_AFTER_DAYS` | 3 | jours de retard avant la 1ʳᵉ relance |
| `RELANCE_REPEAT_DAYS` | 7 | délai entre deux relances |
| `RELANCE_MAX` | 3 | nombre maximum de relances par facture |

Une facture est relancée si : c'est une **facture** (pas un devis), elle a une
**échéance dépassée**, un **reste dû > 0**, un **e-mail client**, et que le
plafond/délai de relance le permet.

## 1. Déployer la fonction

```bash
supabase functions deploy send-reminders --no-verify-jwt
```

## 2. Secrets

```bash
# déjà posés pour l'e-mail : RESEND_API_KEY, RESEND_FROM
supabase secrets set CRON_SECRET=un-secret-long-et-aleatoire
# optionnel : ajuster les règles
supabase secrets set RELANCE_AFTER_DAYS=3 RELANCE_REPEAT_DAYS=7 RELANCE_MAX=3
```

## 3. Planifier l'exécution quotidienne

Dans Supabase → **SQL Editor**, activez la planification (pg_cron + pg_net) :

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'relances-quotidiennes',
  '0 8 * * *',                      -- tous les jours à 08:00 UTC
  $$
  select net.http_post(
    url     := 'https://<votre-projet>.functions.supabase.co/send-reminders',
    headers := jsonb_build_object('x-cron-secret','un-secret-long-et-aleatoire'),
    body    := '{}'::jsonb
  );
  $$
);
```

Remplacez `<votre-projet>` et le secret par les vôtres.

## Fonctionnement & garde-fous

- Le `x-cron-secret` empêche tout appel public de la fonction.
- Chaque relance est **enregistrée sur la facture** (`reminders[]`), visible
  dans *Mes documents* (« Relances : N · dernière … »).
- En attendant l'automatisation, vous pouvez déjà **relancer manuellement**
  depuis le tiroir d'une facture en retard (bouton **Relancer**).
