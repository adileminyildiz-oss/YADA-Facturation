// =====================================================================
//  AEM-CONSEIL — Edge Function : réception & cycle de vie via la PDP
//  (Plateforme Agréée). Complète pdp-transmit (émission) par :
//    - action "list"       : relève des factures reçues (flux entrant)
//    - action "get_status" : statut cycle de vie d'une facture émise
//    - action "set_status" : renvoi d'un statut par le destinataire
//                            (obligation « réception » de la réforme :
//                             mise à disposition / approuvée / refusée /
//                             encaissée…).
//
//  Le SECRET de la PDP n'est JAMAIS dans le site : il vit ici, côté serveur.
//
//  Déploiement :  supabase functions deploy pdp-inbox
//  Secrets (partagés avec pdp-transmit) :
//    supabase secrets set PDP_API_KEY=xxxxxxxx
//    supabase secrets set PDP_API_BASE=https://app.pennylane.com/api/external/v2
//    # chemins à VÉRIFIER sur la doc de votre PDP (valeurs par défaut indicatives) :
//    supabase secrets set PDP_INBOX_PATH=/supplier_invoices          # GET liste entrante
//    supabase secrets set PDP_STATUS_PATH=/e_invoices/{id}/status    # GET/POST statut
//    supabase secrets set PDP_AUTH_SCHEME=Bearer                     # "Bearer" (défaut) ou "Token"
//
//  ⚠️ Connecteur générique : ADAPTEZ le mapping des réponses (champs, chemins,
//     éventuel multipart) au contrat exact de votre PDP, et testez en sandbox
//     avant la production.
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

const str = (v: unknown) => String(v ?? "").trim();

// Statuts cycle de vie normalisés (alignés sur le module e-facture du site).
const ALLOWED_STATUS = new Set(["deposited", "received", "approved", "rejected", "refused", "paid", "disputed"]);

// Essaie de retrouver un champ parmi plusieurs noms possibles (contrats PDP variés).
function pick(obj: any, names: string[]): string {
  for (const n of names) {
    if (obj && obj[n] != null && obj[n] !== "") return String(obj[n]);
  }
  return "";
}

// Normalise une facture entrante renvoyée par la PDP en un objet stable.
function normalizeIncoming(raw: any): any {
  const xml = pick(raw, ["xml", "file", "content", "cii", "ubl", "document"]);
  return {
    extId: pick(raw, ["id", "uuid", "external_id", "reference"]),
    number: pick(raw, ["number", "invoice_number", "reference", "label"]),
    seller: pick(raw, ["seller", "supplier_name", "issuer", "vendor", "from"]),
    date: pick(raw, ["date", "issue_date", "issued_at", "created_at"]),
    ttc: Number(pick(raw, ["total_ttc", "amount_ttc", "total", "grand_total"])) || 0,
    xml,
    status: pick(raw, ["status", "state", "lifecycle"]) || "received",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "Non authentifié" }, 401);

    const KEY = Deno.env.get("PDP_API_KEY");
    const BASE = Deno.env.get("PDP_API_BASE");
    if (!KEY || !BASE) {
      return json({ error: "PDP non configurée (PDP_API_KEY / PDP_API_BASE manquants).", notConfigured: true }, 400);
    }
    const scheme = Deno.env.get("PDP_AUTH_SCHEME") || "Bearer";
    const base = BASE.replace(/\/+$/, "");
    const authH = { "Authorization": `${scheme} ${KEY}`, "Accept": "application/json" };

    const body = await req.json().catch(() => ({}));
    const action = str(body?.action) || "list";

    // ---- Relève des factures reçues (flux entrant) --------------------
    if (action === "list") {
      const path = Deno.env.get("PDP_INBOX_PATH") || "/supplier_invoices";
      const res = await fetch(base + path, { method: "GET", headers: authH });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) return json({ error: (out as any)?.message || `Relève PDP refusée (${res.status}).`, detail: out }, 502);
      // La liste peut être un tableau direct, ou sous une clé (items/data/invoices…).
      const arr = Array.isArray(out) ? out
        : (Array.isArray((out as any)?.items) ? (out as any).items
        : (Array.isArray((out as any)?.data) ? (out as any).data
        : (Array.isArray((out as any)?.invoices) ? (out as any).invoices : [])));
      const invoices = arr.map(normalizeIncoming);
      return json({ ok: true, invoices });
    }

    // ---- Statut cycle de vie d'une facture émise ----------------------
    if (action === "get_status") {
      const extId = str(body?.extId);
      if (!extId) return json({ error: "Identifiant PDP manquant." }, 400);
      const tpl = Deno.env.get("PDP_STATUS_PATH") || "/e_invoices/{id}/status";
      const path = tpl.replace("{id}", encodeURIComponent(extId));
      const res = await fetch(base + path, { method: "GET", headers: authH });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) return json({ error: (out as any)?.message || `Statut PDP indisponible (${res.status}).`, detail: out }, 502);
      const status = pick(out, ["status", "state", "lifecycle"]) || "deposited";
      return json({ ok: true, status });
    }

    // ---- Renvoi d'un statut par le destinataire -----------------------
    if (action === "set_status") {
      const extId = str(body?.extId);
      const status = str(body?.status);
      if (!extId) return json({ error: "Identifiant PDP manquant." }, 400);
      if (!ALLOWED_STATUS.has(status)) return json({ error: `Statut inconnu : ${status || "(vide)"}` }, 400);
      const tpl = Deno.env.get("PDP_STATUS_PATH") || "/e_invoices/{id}/status";
      const path = tpl.replace("{id}", encodeURIComponent(extId));
      const res = await fetch(base + path, {
        method: "POST",
        headers: { ...authH, "Content-Type": "application/json" },
        body: JSON.stringify({ status, reason: str(body?.reason) || undefined }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) return json({ error: (out as any)?.message || `Envoi du statut refusé (${res.status}).`, detail: out }, 502);
      return json({ ok: true, status: pick(out, ["status", "state"]) || status });
    }

    return json({ error: `Action inconnue : ${action}` }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
