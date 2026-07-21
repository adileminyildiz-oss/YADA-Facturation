// =====================================================================
//  AEM-CONSEIL — Edge Function : lien de paiement d'une facture (Stripe)
//  Génère un lien de paiement (montant = reste dû) que le client règle
//  sans compte. Le webhook stripe-webhook marque ensuite la facture payée.
//  Déploiement :  supabase functions deploy create-invoice-payment
//  Secret requis : STRIPE_SECRET_KEY (déjà posé pour les abonnements).
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "Non authentifié" }, 401);
    if (!Deno.env.get("STRIPE_SECRET_KEY")) return json({ error: "Paiement non configuré." }, 400);

    const { invoiceId, amount, number, emitName, clientEmail, origin } = await req.json().catch(() => ({}));
    const cents = Math.round(Number(amount) * 100);
    if (!invoiceId || !(cents > 0)) return json({ error: "Montant à régler invalide." }, 400);
    const base = (typeof origin === "string" && origin.startsWith("http")) ? origin : "https://yada.aemconseil.eu";

    const meta = { type: "invoice", invoice_id: String(invoiceId), user_id: user.id };
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{
        price_data: {
          currency: "eur",
          unit_amount: cents,
          product_data: { name: `Facture ${number || ""} — ${emitName || ""}`.trim() },
        },
        quantity: 1,
      }],
      customer_email: clientEmail || undefined,
      metadata: meta,
      payment_intent_data: { metadata: meta },
      success_url: `${base}/?facture_payee=1`,
      cancel_url: `${base}/?facture_annulee=1`,
    });

    return json({ url: session.url });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
