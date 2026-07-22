// =====================================================================
//  AEM-CONSEIL — Edge Function : transmission d'une facture à la PDP
//  (Plateforme Agréée). Exemple par défaut : Pennylane.
//
//  Le SECRET de la PDP n'est JAMAIS dans le site : il vit ici, côté serveur.
//
//  Déploiement :  supabase functions deploy pdp-transmit
//  Secrets requis :
//    supabase secrets set PDP_API_KEY=xxxxxxxx           # jeton d'API fourni par la PDP
//    supabase secrets set PDP_API_BASE=https://app.pennylane.com/api/external/v2
//    supabase secrets set PDP_EMIT_PATH=/customer_invoices/import        # à confirmer sur la doc PDP
//    supabase secrets set PDP_RECEIVE_PATH=/supplier_invoices/e_invoices/imports
//    # optionnel :
//    supabase secrets set PDP_AUTH_SCHEME=Bearer         # "Bearer" (défaut) ou "Token"
//
//  ⚠️ Les chemins d'émission/réception ci-dessus doivent être VÉRIFIÉS sur la
//     documentation de votre PDP et testés en bac à sable (sandbox) avant la
//     mise en production. Cette fonction est un connecteur générique : elle
//     transmet le Factur-X (XML) au point d'accès configuré, avec le jeton.
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

function b64(s: string) {
  return btoa(unescape(encodeURIComponent(s)));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    // 1) L'appelant doit être un utilisateur authentifié de l'espace.
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "Non authentifié" }, 401);

    // 2) Configuration PDP (secrets serveur).
    const KEY = Deno.env.get("PDP_API_KEY");
    const BASE = Deno.env.get("PDP_API_BASE");
    if (!KEY || !BASE) {
      return json({ error: "PDP non configurée (PDP_API_KEY / PDP_API_BASE manquants)." }, 400);
    }
    const scheme = Deno.env.get("PDP_AUTH_SCHEME") || "Bearer";

    // 3) Charge utile envoyée par l'espace.
    const body = await req.json().catch(() => ({}));
    const mode = body?.mode === "receive" ? "receive" : "emit";
    const xml = String(body?.xml ?? "");
    const number = String(body?.number ?? "");
    if (!xml || !/CrossIndustryInvoice|Invoice/.test(xml)) {
      return json({ error: "Facture (XML Factur-X) manquante ou invalide." }, 400);
    }

    const path = mode === "receive"
      ? (Deno.env.get("PDP_RECEIVE_PATH") || "/supplier_invoices/e_invoices/imports")
      : (Deno.env.get("PDP_EMIT_PATH") || "/customer_invoices/import");
    const url = BASE.replace(/\/+$/, "") + path;

    // 4) Corps adapté au format le plus courant : le fichier Factur-X en base64.
    //    À AJUSTER selon la doc exacte de votre PDP (certaines attendent un
    //    multipart/form-data plutôt qu'un JSON base64).
    const payload = {
      filename: `facturx-${number.replace(/[^\w-]+/g, "_") || "facture"}.xml`,
      file: b64(xml),
      format: "factur-x",
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `${scheme} ${KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      return json({ error: (out as any)?.message || (out as any)?.error || `PDP a refusé la transmission (${res.status}).`, detail: out }, 502);
    }
    return json({ ok: true, mode, id: (out as any)?.id ?? (out as any)?.uuid ?? null, status: (out as any)?.status ?? "deposited" });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
