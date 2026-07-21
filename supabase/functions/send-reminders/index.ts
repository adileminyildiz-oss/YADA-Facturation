// =====================================================================
//  AEM-CONSEIL — Edge Function : relances automatiques des impayés
//  À appeler une fois par jour (voir RELANCES-SETUP.md).
//  Déploiement :  supabase functions deploy send-reminders --no-verify-jwt
//  Secrets :
//    RESEND_API_KEY, RESEND_FROM      (comme send-invoice)
//    CRON_SECRET=un-secret-long        (protège l'appel planifié)
//    RELANCE_AFTER_DAYS=3  RELANCE_REPEAT_DAYS=7  RELANCE_MAX=3  (optionnels)
//    (SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY fournis automatiquement.)
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const KEY = Deno.env.get("RESEND_API_KEY");
const FROM = Deno.env.get("RESEND_FROM");
const AFTER = Number(Deno.env.get("RELANCE_AFTER_DAYS") ?? "3");
const REPEAT = Number(Deno.env.get("RELANCE_REPEAT_DAYS") ?? "7");
const MAX = Number(Deno.env.get("RELANCE_MAX") ?? "3");
const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

function esc(s: unknown){ return String(s ?? "").replace(/[&<>"]/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c] as string)); }
function eur(n: number){ return new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR"}).format(Number(n)||0); }
function fmt(iso: string){ const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso||"")); return m?`${m[3]}/${m[2]}/${m[1]}`:""; }
function daysSince(iso: string){ const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso||"")); if(!m) return -1; const d=Date.UTC(+m[1],+m[2]-1,+m[3]); const t=new Date(); const now=Date.UTC(t.getUTCFullYear(),t.getUTCMonth(),t.getUTCDate()); return Math.floor((now-d)/86400000); }
function todayISO(){ const t=new Date(); return t.getUTCFullYear()+"-"+String(t.getUTCMonth()+1).padStart(2,"0")+"-"+String(t.getUTCDate()).padStart(2,"0"); }

function due(d: any){
  let subHT=0; const vatMap: Record<string,number>={};
  (d.lines||[]).forEach((l: any)=>{ const ht=(Number(l.qty)||0)*(Number(l.pu)||0); subHT+=ht; const r=d.vatExempt?0:(Number(l.vat)||0); vatMap[r]=(vatMap[r]||0)+ht; });
  const disc = d.discountType==="pct" ? subHT*(Number(d.discount)||0)/100 : Math.min(Number(d.discount)||0,subHT);
  const factor = subHT>0 ? (subHT-disc)/subHT : 1;
  let tva=0; Object.keys(vatMap).forEach((r)=>{ if(!d.vatExempt) tva+=vatMap[r]*factor*Number(r)/100; });
  const ttc=(subHT-disc)+tva;
  let paidExtra=0; (d.payments||[]).forEach((p: any)=>paidExtra+=Number(p.amount)||0);
  const paid=Math.min(ttc,(Number(d.deposit)||0)+paidExtra);
  return { ttc, due: Math.max(0, ttc-paid) };
}
function email(d: any, montant: number){
  return `<!doctype html><html><body style="margin:0;background:#f4f6fb;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1f2a44">
  <div style="max-width:540px;margin:0 auto;padding:22px 16px"><div style="background:#fff;border:1px solid #e6e9f2;border-radius:14px;padding:22px 24px">
    <div style="font-weight:700">${esc(d.emit?.name||"")}</div>
    <p style="font-size:14px">Bonjour ${esc(d.client?.name||"")},</p>
    <p style="font-size:14px;color:#3a4661">Sauf erreur de notre part, la facture <b>${esc(d.number||"")}</b>${d.due?` (échéance du <b>${fmt(d.due)}</b>)`:""} reste impayée. Nous vous remercions de bien vouloir procéder à son règlement.</p>
    <p style="font-size:15px;font-weight:700;margin-top:14px">Montant dû : ${eur(montant)}</p>
    <p style="font-size:12px;color:#8891a8;margin-top:16px">${esc(d.emit?.name||"")}${d.emit?.email?" · "+esc(d.emit.email):""}</p>
  </div></div></body></html>`;
}

Deno.serve(async (req) => {
  // Protection : appel réservé au planificateur
  const secret = Deno.env.get("CRON_SECRET");
  if (secret && req.headers.get("x-cron-secret") !== secret) return new Response("forbidden", { status: 403 });
  if (!KEY || !FROM) return new Response(JSON.stringify({ error: "E-mail non configuré." }), { status: 400 });

  const { data: rows, error } = await admin.from("invoices").select("id,user_id,data");
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  let sent = 0, scanned = 0;
  for (const row of rows || []) {
    scanned++;
    const d: any = row.data || {};
    try {
      if (d.kind === "devis") continue;
      if (!d.due) continue;                                    // pas d'échéance
      const to = (d.client?.email || "").trim();
      if (!/.+@.+\..+/.test(to)) continue;                     // pas d'e-mail client
      const { due: reste } = due(d);
      if (reste <= 0.005) continue;                            // déjà réglée
      if (daysSince(d.due) < AFTER) continue;                  // pas encore assez en retard
      const reminders = Array.isArray(d.reminders) ? d.reminders : [];
      if (reminders.length >= MAX) continue;                   // plafond de relances
      const last = reminders.length ? reminders[reminders.length - 1].date : null;
      if (last && daysSince(last) < REPEAT) continue;          // trop tôt depuis la dernière

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM, to: [to], reply_to: d.emit?.email || undefined,
          subject: `Rappel — Facture ${d.number || ""}`, html: email(d, reste),
        }),
      });
      if (!res.ok) continue;

      d.reminders = reminders.concat([{ date: todayISO(), auto: true }]);
      d.updated = Date.now();
      await admin.from("invoices").update({ data: d, updated_at: new Date().toISOString() }).eq("id", row.id);
      sent++;
    } catch (_e) { /* on continue avec les autres factures */ }
  }
  return new Response(JSON.stringify({ ok: true, scanned, sent }), { headers: { "Content-Type": "application/json" } });
});
