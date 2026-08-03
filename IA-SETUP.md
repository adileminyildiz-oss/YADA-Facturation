# Assistant IA (Claude / Anthropic) — installation

Le site propose quatre fonctionnalités d'intelligence artificielle :

1. **Création de facture par langage naturel** (module *Facturation* → « Décrire
   la facture ») : décrit une prestation en une phrase, l'IA propose les lignes.
2. **Relances progressives** (module *Mes documents* → « Rédiger la relance
   (IA) ») : rédige un e-mail de relance dont le ton s'adapte au nombre de
   relances déjà envoyées (courtois → ferme → formel).
3. **Assistant conversationnel** (bouton flottant de l'espace) : répond aux
   questions sur la facturation, le BTP, la TVA et l'e-facture.
4. **Contrôle avant émission** (module *Facturation* → « Vérifier (IA) ») :
   signale les mentions manquantes et les incohérences avant d'émettre.

La clé d'API ne se trouve **jamais** dans le site : tous les appels passent par
une seule fonction serveur (Edge Function Supabase) qui détient le secret.

## 1. Obtenir une clé d'API Anthropic

- Créez un compte sur [console.anthropic.com](https://console.anthropic.com).
- Générez une **clé d'API** (`sk-ant-...`).

## 2. Déployer la fonction

Avec la [CLI Supabase](https://supabase.com/docs/guides/cli) connectée à votre projet :

```bash
supabase functions deploy ai-assistant
```

## 3. Renseigner le secret

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
```

## 4. C'est prêt

Les quatre fonctionnalités deviennent actives immédiatement.

Tant que ce n'est pas configuré, **rien n'est cassé** : chaque fonctionnalité
bascule sur un repli (saisie manuelle, modèle de relance standard, message
« Assistant non activé »). L'utilisateur peut donc continuer à travailler.

## Modèle utilisé

Le connecteur appelle le modèle **`claude-sonnet-5`** (bon rapport
qualité / coût). Pour changer de modèle, modifiez la constante `MODEL` en tête
de `supabase/functions/ai-assistant/index.ts`.

## Confidentialité (RGPD)

- Les fonctionnalités IA transmettent à l'API Anthropic **le contenu nécessaire
  à la tâche demandée** : description saisie, lignes de facture, et — pour la
  relance et le contrôle — le **nom du client** et les montants. Aucune donnée
  n'est stockée par la fonction : elle relaie la requête et renvoie la réponse.
- Anthropic n'utilise pas les données d'API pour entraîner ses modèles.
- **Avant une mise en production**, informez vos utilisateurs de ce traitement
  (mention dans les CGU / politique de confidentialité) et, si nécessaire,
  encadrez-le contractuellement (DPA). Les réponses de l'assistant sont
  **indicatives et non contractuelles** ; elles ne remplacent pas l'avis d'un
  expert-comptable ou d'un juriste.
- La clé `ANTHROPIC_API_KEY` reste côté serveur (secret Supabase) et n'est
  jamais exposée dans le navigateur.
