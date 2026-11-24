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

const frame = (content: string): string =>
  `<div style="font-family:system-ui,sans-serif;max-width:460px;margin:auto;color:#1f1e1c"><img src="${config.publicUrl}/logo.png" alt="Plaudi" height="40" style="height:40px;margin-bottom:12px">${content}</div>`;

export const resetMail = (to: string, token: string, ttlMinutes: number, invite: boolean): Mail => {
  const link = `${config.publicUrl}/reset#token=${token}`;
  const duration = ttlMinutes >= 120 ? `${Math.round(ttlMinutes / 60)} Stunden` : `${Math.round(ttlMinutes)} Minuten`;
  const intro = invite ? "Du wurdest zu Plaudi eingeladen. Lege jetzt dein Passwort fest:" : "Für dein Plaudi-Konto wurde ein neues Passwort angefordert:";
  const text = `${intro}\n\n${link}\n\nDer Link ist ${duration} gültig und kann nur einmal verwendet werden.\nWenn du das nicht warst, ignoriere diese E-Mail. Dein Passwort bleibt dann unverändert.`;
  const html = frame(`<p>${intro}</p><p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#1a78ad;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Passwort festlegen</a></p><p style="color:#666;font-size:13px">Der Link ist ${duration} gültig und kann nur einmal verwendet werden. Wenn du das nicht warst, ignoriere diese E-Mail.</p>`);
  return { to, subject: invite ? "Einladung zu Plaudi" : "Passwort für Plaudi zurücksetzen", text, html };
};

export const loginCodeMail = (to: string, code: string, ttlMinutes: number): Mail => {
  const minutes = Math.round(ttlMinutes);
  const text = `Dein Anmeldecode für Plaudi lautet: ${code}\n\nDer Code ist ${minutes} Minuten gültig und kann nur einmal verwendet werden.\nWenn du dich nicht angemeldet hast, ändere umgehend dein Passwort.`;
  const html = frame(`<p>Dein Anmeldecode:</p><p style="font-size:32px;letter-spacing:6px;font-weight:700">${code}</p><p>Der Code ist ${minutes} Minuten gültig und kann nur einmal verwendet werden.</p><p style="color:#666">Wenn du dich nicht anmelden wolltest, ändere dein Passwort.</p>`);
  return { to, subject: `Dein Plaudi-Code: ${code}`, text, html };
};
