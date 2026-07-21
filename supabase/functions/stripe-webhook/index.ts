// =====================================================================
//  AEM-CONSEIL — Edge Function : webhook Stripe (active l'offre payée)
//  Déploiement :  supabase functions deploy stripe-webhook --no-verify-jwt
//  Secrets requis :
//    STRIPE_SECRET_KEY=sk_live_...
//    STRIPE_WEBHOOK_SECRET=whsec_...   (donné par Stripe à la création du webhook)
//    PRICE_ESSENTIEL / PRICE_PRO / PRICE_PREMIUM=price_...
//    (SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement.)
//
//  Dans Stripe > Developers > Webhooks, pointez l'URL de cette fonction et
//  abonnez-vous aux événements : checkout.session.completed,
//  customer.subscription.updated, customer.subscription.deleted.
// =====================================================================
import Stripe from "https://esm.sh/stripe@16.12.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", { apiVersion: "2024-06-20" });
const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

const PRICE_TO_PLAN: Record<string, string> = {};
const map = (env: string, plan: string) => { const p = Deno.env.get(env); if (p) PRICE_TO_PLAN[p] = plan; };
map("PRICE_ESSENTIEL", "essentiel");
map("PRICE_PRO", "pro");
map("PRICE_PREMIUM", "premium");

async function setPlan(userId: string | null | undefined, plan: string) {
  if (!userId) return;
  await admin.from("profiles").update({ plan }).eq("id", userId);
}

// Enregistre un règlement de facture (paiement en ligne du client)
async function recordInvoicePayment(userId: string | null | undefined, invoiceId: string | null | undefined, amount: number) {
  if (!userId || !invoiceId || !(amount > 0)) return;
  const { data } = await admin.from("invoices").select("data").eq("id", invoiceId).eq("user_id", userId).maybeSingle();
  if (!data) return;
  const d: any = data.data || {};
  d.payments = Array.isArray(d.payments) ? d.payments : [];
  d.payments.push({ date: new Date().toISOString().slice(0, 10), amount, source: "stripe" });
  d.updated = Date.now();
  await admin.from("invoices").update({ data: d, updated_at: new Date().toISOString() }).eq("id", invoiceId).eq("user_id", userId);
}

Deno.serve(async (req) => {
  const sig = req.headers.get("stripe-signature");
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig ?? "", Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "");
  } catch (_e) {
    return new Response("Signature invalide", { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.metadata?.type === "invoice") {
        // Paiement en ligne d'une facture par le client
        await recordInvoicePayment(s.metadata?.user_id, s.metadata?.invoice_id, (s.amount_total ?? 0) / 100);
      } else {
        // Souscription à une offre
        const uid = (s.metadata?.user_id) ?? s.client_reference_id ?? null;
        const plan = s.metadata?.plan ?? "pro";
        await setPlan(uid, plan);
      }
    } else if (event.type === "customer.subscription.updated") {
      const sub = event.data.object as Stripe.Subscription;
      const priceId = sub.items?.data?.[0]?.price?.id ?? "";
      const plan = PRICE_TO_PLAN[priceId];
      const active = sub.status === "active" || sub.status === "trialing";
      await setPlan(sub.metadata?.user_id, active && plan ? plan : "free");
    } else if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      await setPlan(sub.metadata?.user_id, "free");
    }
  } catch (_e) {
    // On renvoie 200 pour éviter les renvois en boucle ; l'erreur est isolée.
  }

  return new Response("ok", { status: 200 });
});
