# Inscription & vérification d'identité — réglages

Le parcours d'inscription de l'espace :

1. **Créer un compte** : prénom, nom, e-mail, **téléphone mobile** et mot de passe.
2. **Vérification d'identité** au choix :
   - **Par e-mail** : un lien de confirmation est envoyé (natif Supabase) ;
   - **Par SMS** : un code à 6 chiffres est envoyé sur le mobile.
3. **Profil société** : un formulaire recueille les informations de l'entreprise
   (raison sociale, forme, SIRET, TVA, RCS, capital, adresse, e-mail, IBAN/BIC).
   Elles alimentent l'émetteur des factures/devis.
4. **Mot de passe oublié** : réinitialisation par e-mail (déjà en place) — l'utilisateur
   reçoit un lien, puis définit un nouveau mot de passe.

## Vérification par e-mail (par défaut)

Rien à faire : activez simplement **Confirm email** dans
Supabase → **Authentication → Providers → Email**. Le lien de confirmation
et le renvoi (« Renvoyer l'e-mail ») fonctionnent nativement.

## Vérification par SMS (optionnelle — nécessite un fournisseur)

La vérification par SMS utilise l'**OTP téléphone** de Supabase, qui exige un
**fournisseur SMS** (Twilio, MessageBird, Vonage, Textlocal…) :

1. Supabase → **Authentication → Providers → Phone** : activez le provider et
   renseignez les identifiants du fournisseur (ex. Twilio Account SID / Auth
   Token / Messaging Service SID).
2. Vérifiez le **format international** des numéros (l'espace normalise déjà les
   numéros français `06…`/`07…` en `+33…`).

Tant que ce n'est pas configuré, **rien n'est cassé** : le bouton « Par SMS »
affiche un message invitant à utiliser l'e-mail, et la vérification par e-mail
reste pleinement fonctionnelle.

## Données recueillies

Prénom, nom, téléphone et nom complet sont stockés dans les **métadonnées
utilisateur** (`user_metadata`) à l'inscription. Le profil société est
enregistré par compte (localStorage `aem_fact_emit` + miroir cloud
`user_settings.emit`, isolé par RLS).
