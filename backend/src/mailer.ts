import nodemailer, { type Transporter } from "nodemailer";
import { config } from "./config.js";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type TransportKind = "smtp" | "webhook" | "console";

export const transportKind = (): TransportKind => {
  const wanted = config.mail.transport;
  if (wanted === "smtp" || wanted === "webhook" || wanted === "console") return wanted;
  if (config.mail.webhookUrl) return "webhook";
  if (config.mail.smtpHost) return "smtp";
  return "console";
};

let smtp: Transporter | null = null;

const smtpTransport = (): Transporter => {
  if (smtp) return smtp;
  smtp = nodemailer.createTransport({
    host: config.mail.smtpHost,
    port: config.mail.smtpPort,
    secure: config.mail.smtpSecure || config.mail.smtpPort === 465,
    requireTLS: !(config.mail.smtpSecure || config.mail.smtpPort === 465),
    auth: config.mail.smtpUser ? { user: config.mail.smtpUser, pass: config.mail.smtpPass ?? "" } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  return smtp;
};

const sendWebhook = async (mail: Mail): Promise<void> => {
  const response = await fetch(config.mail.webhookUrl as string, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.mail.webhookToken ? { Authorization: `Bearer ${config.mail.webhookToken}` } : {}),
    },
    body: JSON.stringify({ from: config.mail.from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html }),
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Mail-Webhook antwortete mit Status ${response.status}`);
};

export const sendMail = async (mail: Mail): Promise<void> => {
  const kind = transportKind();
  if (kind === "webhook") {
    if (!config.mail.webhookUrl) throw new Error("MAIL_WEBHOOK_URL fehlt");
    await sendWebhook(mail);
    return;
  }
  if (kind === "smtp") {
    if (!config.mail.smtpHost) throw new Error("SMTP_HOST fehlt");
    await smtpTransport().sendMail({ from: config.mail.from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
    return;
  }
  console.log(`[mail:console] an ${mail.to}: ${mail.subject}\n${mail.text}`);
};

export const loginCodeMail = (to: string, code: string, ttlMinutes: number): Mail => {
  const minutes = Math.round(ttlMinutes);
  const text = `Dein Anmeldecode für Plaudi lautet: ${code}\n\nDer Code ist ${minutes} Minuten gültig und kann nur einmal verwendet werden.\nWenn du dich nicht anmelden wolltest, ignoriere diese E-Mail.`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:420px;margin:auto"><h2 style="color:#2fa3dc">Plaudi</h2><p>Dein Anmeldecode:</p><p style="font-size:32px;letter-spacing:6px;font-weight:700">${code}</p><p>Der Code ist ${minutes} Minuten gültig und kann nur einmal verwendet werden.</p><p style="color:#666">Wenn du dich nicht anmelden wolltest, ignoriere diese E-Mail.</p></div>`;
  return { to, subject: `Dein Plaudi-Code: ${code}`, text, html };
};
