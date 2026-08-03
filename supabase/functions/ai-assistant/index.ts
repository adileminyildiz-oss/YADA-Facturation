// =====================================================================
//  AEM-CONSEIL — Edge Function : assistant IA (Claude / Anthropic)
//  Connecteur partagé pour toutes les fonctionnalités IA du site.
//  Déploiement :  supabase functions deploy ai-assistant
//  Secret requis (jamais dans le site) :
//    supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxx
//  Modèle : « Équilibré » -> claude-sonnet-5 (bon rapport qualité/coût).
//  Aucune donnée n'est stockée par cette fonction : elle relaie la
//  requête vers l'API Anthropic (UE possible via en-tête de région) et
//  renvoie la réponse. Voir la mention RGPD affichée côté site.
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MODEL = "claude-sonnet-5";
const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const str = (v: unknown) => String(v ?? "").trim();

// ---- Appel bas niveau à l'API Messages -------------------------------
async function callClaude(key: string, body: Record<string, unknown>) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": API_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, ...body }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (out as any)?.error?.message || `Requête IA refusée (${res.status})`;
    throw new Error(msg);
  }
  return out;
}

// Récupère l'entrée du 1er bloc tool_use (sortie structurée), sinon le texte.
function toolInput(out: any): any | null {
  const blocks = out?.content;
  if (!Array.isArray(blocks)) return null;
  const tu = blocks.find((b: any) => b?.type === "tool_use");
  return tu ? tu.input : null;
}
function textOut(out: any): string {
  const blocks = out?.content;
  if (!Array.isArray(blocks)) return "";
  return blocks.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n").trim();
}

// =====================================================================
//  Tâches
// =====================================================================

// ① Création de facture à partir d'une description en langage naturel.
async function taskInvoiceFromText(key: string, p: any) {
  const desc = str(p.text);
  if (!desc) throw new Error("Description vide.");
  const vatDefault = num(p.vatDefault) || 20;
  const tool = {
    name: "proposer_lignes",
    description: "Renvoie les lignes de facture déduites de la description.",
    input_schema: {
      type: "object",
      properties: {
        lines: {
          type: "array",
          description: "Lignes de la facture, dans l'ordre.",
          items: {
            type: "object",
            properties: {
              desc: { type: "string", description: "Désignation de la prestation ou du produit." },
              qty: { type: "number", description: "Quantité (1 si non précisé)." },
              unit: { type: "string", description: "Unité : u, h, j, m², ml, forfait… (vide si inconnu)." },
              pu: { type: "number", description: "Prix unitaire HT en euros (0 si inconnu)." },
              vat: { type: "number", description: `Taux de TVA en %, ${vatDefault} par défaut.` },
            },
            required: ["desc", "qty", "pu", "vat"],
          },
        },
        note: { type: "string", description: "Remarque courte pour l'utilisateur (hypothèses, prix manquants…)." },
      },
      required: ["lines"],
    },
  };
  const out = await callClaude(key, {
    max_tokens: 1500,
    tools: [tool],
    tool_choice: { type: "tool", name: "proposer_lignes" },
    system:
      "Tu es l'assistant de facturation d'une TPE/PME française (secteur BTP fréquent). " +
      "À partir d'une description libre, tu proposes des lignes de facture claires et professionnelles. " +
      "N'invente pas de prix : si un prix n'est pas donné, mets pu=0 et signale-le dans note. " +
      `TVA par défaut ${vatDefault} %. Quantité 1 si non précisée. Rédige les désignations en français, sobrement.`,
    messages: [{ role: "user", content: desc }],
  });
  const input = toolInput(out);
  const lines = Array.isArray(input?.lines) ? input.lines.map((l: any) => ({
    desc: str(l.desc),
    qty: num(l.qty) || 1,
    unit: str(l.unit),
    pu: num(l.pu),
    vat: num(l.vat) || vatDefault,
  })) : [];
  return { lines, note: str(input?.note) };
}

// ② Rédaction d'une relance progressive (ton adapté au niveau).
async function taskReminderDraft(key: string, p: any) {
  const level = Math.max(1, Math.min(3, num(p.level) || 1)); // 1 courtois … 3 ferme
  const inv = p.invoice || {};
  const toneMap: Record<number, string> = {
    1: "Ton courtois et bienveillant : simple rappel, on suppose un oubli.",
    2: "Ton plus ferme mais toujours poli : 2e relance, on insiste sur l'échéance dépassée.",
    3: "Ton ferme et formel : dernière relance avant recouvrement, on évoque les pénalités de retard légales.",
  };
  const out = await callClaude(key, {
    max_tokens: 700,
    system:
      "Tu rédiges des e-mails de relance de facture impayée pour une entreprise française. " +
      "Réponds uniquement par le corps de l'e-mail (texte simple, sans objet ni signature d'entreprise, " +
      "l'expéditeur ajoutera sa signature). Vouvoiement, français professionnel. " + toneMap[level],
    messages: [{
      role: "user",
      content:
        `Relance niveau ${level}.\n` +
        `Client : ${str(inv.clientName) || "—"}\n` +
        `Facture n° ${str(inv.number) || "—"}\n` +
        `Montant dû : ${num(inv.due)} €\n` +
        (inv.dueDate ? `Échéance : ${str(inv.dueDate)}\n` : "") +
        (inv.daysLate ? `Retard : ${num(inv.daysLate)} jours\n` : ""),
    }],
  });
  return { body: textOut(out), level };
}

// ③ Assistant : questions/réponses sur la facturation, le BTP, le site.
async function taskAssistant(key: string, p: any) {
  const q = str(p.text);
  if (!q) throw new Error("Question vide.");
  const ctx = str(p.context);
  const out = await callClaude(key, {
    max_tokens: 900,
    system:
      "Tu es l'assistant du logiciel de facturation AEM-CONSEIL (YADA). Tu aides des artisans et PME " +
      "françaises, souvent du BTP. Tu réponds en français, de façon concise et concrète. Sujets : facturation, " +
      "devis, situations de travaux, DGD, retenue de garantie, sous-traitance (loi 1975), TVA, e-facture " +
      "(Factur-X, e-reporting), et l'utilisation du logiciel. Tu ne donnes pas de conseil juridique ou fiscal " +
      "engageant : pour un cas précis, invite à vérifier auprès d'un expert-comptable. Si tu ne sais pas, dis-le.",
    messages: [{ role: "user", content: ctx ? `${q}\n\n[Contexte : ${ctx}]` : q }],
  });
  return { answer: textOut(out) };
}

// ④ Contrôle avant émission : cohérence / mentions obligatoires.
async function taskPreEmitCheck(key: string, p: any) {
  const doc = p.doc || {};
  const tool = {
    name: "rapport_controle",
    description: "Rapport de contrôle de la facture avant émission.",
    input_schema: {
      type: "object",
      properties: {
        ok: { type: "boolean", description: "true si aucun problème bloquant." },
        issues: {
          type: "array",
          description: "Anomalies détectées.",
          items: {
            type: "object",
            properties: {
              severity: { type: "string", enum: ["bloquant", "attention", "info"] },
              message: { type: "string", description: "Description courte du problème et de la correction." },
            },
            required: ["severity", "message"],
          },
        },
        summary: { type: "string", description: "Synthèse en une phrase." },
      },
      required: ["ok", "issues", "summary"],
    },
  };
  const out = await callClaude(key, {
    max_tokens: 1200,
    tools: [tool],
    tool_choice: { type: "tool", name: "rapport_controle" },
    system:
      "Tu contrôles une facture française avant émission. Vérifie la cohérence (totaux, quantités, prix à 0, " +
      "TVA plausible, dates), la présence des mentions obligatoires (identité et coordonnées de l'émetteur, " +
      "SIREN/SIRET, numéro et date de facture, identité du client, désignation des prestations, TVA ou mention " +
      "d'exonération, conditions et pénalités de retard), et les spécificités BTP le cas échéant (autoliquidation, " +
      "retenue de garantie). Signale surtout ce qui manque ou paraît erroné. Sois précis et bref.",
    messages: [{ role: "user", content: "Facture à contrôler :\n" + JSON.stringify(doc) }],
  });
  const input = toolInput(out) || {};
  return {
    ok: input.ok !== false,
    issues: Array.isArray(input.issues) ? input.issues : [],
    summary: str(input.summary),
  };
}

const TASKS: Record<string, (key: string, p: any) => Promise<unknown>> = {
  invoice_from_text: taskInvoiceFromText,
  reminder_draft: taskReminderDraft,
  assistant: taskAssistant,
  pre_emit_check: taskPreEmitCheck,
};

// =====================================================================
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "Non authentifié" }, 401);

    const KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!KEY) return json({ error: "IA non configurée (ANTHROPIC_API_KEY manquante).", notConfigured: true }, 400);

    const body = await req.json().catch(() => ({}));
    const task = str(body?.task);
    const handler = TASKS[task];
    if (!handler) return json({ error: `Tâche IA inconnue : ${task || "(vide)"}` }, 400);

    const result = await handler(KEY, body || {});
    return json({ ok: true, ...(result as object) });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
