// =====================================================================
//  AEM-CONSEIL — Edge Function : création d'une session de paiement Stripe
//  Déploiement :  supabase functions deploy create-checkout
//  Secrets requis (jamais dans le site) :
//    supabase secrets set STRIPE_SECRET_KEY=sk_live_...
//    supabase secrets set PRICE_ESSENTIEL=price_... PRICE_PRO=price_... PRICE_PREMIUM=price_...
//  (SUPABASE_URL et SUPABASE_ANON_KEY sont fournis automatiquement.)
// =====================================================================
import Stripe from "https://esm.sh/stripe@16.12.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", { apiVersion: "2024-06-20" });
const PRICES: Record<string, string | undefined> = {
  essentiel: Deno.env.get("PRICE_ESSENTIEL"),
  pro: Deno.env.get("PRICE_PRO"),
  premium: Deno.env.get("PRICE_PREMIUM"),
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    // 1) Authentifier l'utilisateur via son jeton de session
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "Non authentifié" }, 401);

    // 2) Récupérer l'offre demandée
    const { plan, origin } = await req.json().catch(() => ({}));
    const price = PRICES[plan as string];
    if (!price) return json({ error: "Offre inconnue ou tarif non configuré." }, 400);
    if (!Deno.env.get("STRIPE_SECRET_KEY")) return json({ error: "Paiement non configuré." }, 400);

    const base = (typeof origin === "string" && origin.startsWith("http")) ? origin : "https://yada.aemconseil.eu";

    // 3) Créer la session de paiement (abonnement mensuel)
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price, quantity: 1 }],
      customer_email: user.email ?? undefined,
      client_reference_id: user.id,
      metadata: { user_id: user.id, plan },
      subscription_data: { metadata: { user_id: user.id, plan } },
      allow_promotion_codes: true,
      success_url: `${base}/?paid=1`,
      cancel_url: `${base}/#abonnement`,
    });

    return json({ url: session.url });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
