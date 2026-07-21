// =====================================================================
//  AEM-CONSEIL — Edge Function : envoi d'une facture par e-mail (Resend)
//  Déploiement :  supabase functions deploy send-invoice
//  Secrets requis (jamais dans le site) :
//    supabase secrets set RESEND_API_KEY=re_xxx
//    supabase secrets set RESEND_FROM="AEM-CONSEIL <facturation@votre-domaine.fr>"
//  (le domaine d'envoi doit être vérifié dans Resend)
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

function esc(s: unknown) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}
function eur(n: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(n) || 0);
}
function fmtDate(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

function renderEmail(inv: any) {
  const lines = (inv.lines || []).map((l: any) =>
    `<tr>
       <td style="padding:7px 0;border-bottom:1px solid #eceef4;color:#1f2a44">${esc(l.desc || "—")}</td>
       <td style="padding:7px 0;border-bottom:1px solid #eceef4;text-align:right;color:#6b7590;white-space:nowrap">${Number(l.qty) || 0} × ${eur(l.pu)}</td>
       <td style="padding:7px 0;border-bottom:1px solid #eceef4;text-align:right;color:#1f2a44;white-space:nowrap">${eur(l.ht)}</td>
     </tr>`).join("");
  const due = (Number(inv.due) > 0.005) ? inv.due : inv.totalTTC;
  return `<!doctype html><html><body style="margin:0;background:#f4f6fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2a44">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="background:#fff;border:1px solid #e6e9f2;border-radius:14px;overflow:hidden">
      <div style="padding:20px 24px;border-bottom:1px solid #eceef4">
        <div style="font-weight:700;font-size:16px">${esc(inv.emitName || "")}</div>
        <div style="color:#6b7590;font-size:12px;margin-top:2px">Facture ${esc(inv.number || "")}</div>
      </div>
      <div style="padding:20px 24px">
        <p style="margin:0 0 14px;font-size:14px">Bonjour ${esc(inv.clientName || "")},</p>
        ${inv.reminder
          ? `<p style="margin:0 0 16px;font-size:14px;color:#3a4661">Sauf erreur de notre part, la facture <b>${esc(inv.number || "")}</b>${inv.dueDate ? ` (échéance du <b>${fmtDate(inv.dueDate)}</b>)` : ""} n'a pas encore été réglée. Nous vous remercions de bien vouloir procéder à son règlement.</p>`
          : `<p style="margin:0 0 16px;font-size:14px;color:#3a4661">Veuillez trouver ci-dessous le récapitulatif de votre facture${inv.dueDate ? `, à régler avant le <b>${fmtDate(inv.dueDate)}</b>` : ""}.</p>`}
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin:8px 0 4px">${lines}</table>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px">
          <tr><td style="padding:3px 0;color:#6b7590">Total HT</td><td style="padding:3px 0;text-align:right">${eur(inv.totalHT)}</td></tr>
          <tr><td style="padding:3px 0;color:#6b7590">TVA</td><td style="padding:3px 0;text-align:right">${eur(inv.totalTVA)}</td></tr>
          <tr><td style="padding:8px 0 0;font-weight:700;font-size:15px;border-top:1px solid #e6e9f2">Montant dû</td><td style="padding:8px 0 0;text-align:right;font-weight:700;font-size:15px;border-top:1px solid #e6e9f2">${eur(due)}</td></tr>
        </table>
        ${inv.payUrl ? `<div style="margin-top:18px"><a href="${esc(inv.payUrl)}" style="display:inline-block;background:#2b45ff;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:10px">Payer en ligne</a></div>` : ""}
        ${inv.terms ? `<p style="margin:16px 0 0;font-size:12px;color:#6b7590">${esc(inv.terms)}</p>` : ""}
        ${inv.message ? `<p style="margin:14px 0 0;font-size:13px">${esc(inv.message)}</p>` : ""}
      </div>
      <div style="padding:14px 24px;border-top:1px solid #eceef4;color:#8891a8;font-size:11px">${esc(inv.emitName || "")}${inv.emitEmail ? " · " + esc(inv.emitEmail) : ""}</div>
    </div>
  </div></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "Non authentifié" }, 401);

    const KEY = Deno.env.get("RESEND_API_KEY");
    const FROM = Deno.env.get("RESEND_FROM");
    if (!KEY || !FROM) return json({ error: "E-mail non configuré (RESEND_API_KEY / RESEND_FROM manquants)." }, 400);

    const inv = await req.json().catch(() => ({}));
    if (!inv?.to || !/.+@.+\..+/.test(inv.to)) return json({ error: "Adresse e-mail du client manquante ou invalide." }, 400);

    const payload: Record<string, unknown> = {
      from: FROM,
      to: [inv.to],
      subject: (inv.reminder ? `Rappel — Facture ${inv.number || ""}` : `Facture ${inv.number || ""} — ${inv.emitName || ""}`).trim(),
      html: renderEmail(inv),
    };
    if (inv.replyTo && /.+@.+\..+/.test(inv.replyTo)) payload.reply_to = inv.replyTo;
    if (inv.attachmentXml && inv.number) {
      payload.attachments = [{
        filename: `facturx-${String(inv.number).replace(/[^\w-]+/g, "_")}.xml`,
        content: btoa(unescape(encodeURIComponent(String(inv.attachmentXml)))),
      }];
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) return json({ error: (out as any)?.message || `Envoi refusé (${res.status})` }, 502);
    return json({ ok: true, id: (out as any)?.id });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
