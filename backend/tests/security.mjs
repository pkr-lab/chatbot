import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 3300;
const MAIL_PORT = 3301;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "plaudi-sec-"));
const mails = [];
let results = { pass: 0, fail: 0 };

const mailServer = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    mails.push({ auth: req.headers.authorization, body: JSON.parse(raw) });
    res.writeHead(200).end("ok");
  });
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const check = (name, condition, detail = "") => {
  if (condition) results.pass += 1;
  else results.fail += 1;
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${condition || !detail ? "" : `  -> ${detail}`}`);
};

class Client {
  constructor(ip) {
    this.ip = ip;
    this.cookie = "";
  }

  async call(method, url, body, headers = {}) {
    const response = await fetch(BASE + url, {
      method,
      redirect: "manual",
      headers: {
        "X-Forwarded-For": this.ip,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = response.headers.get("set-cookie");
    if (set) {
      const pair = set.split(";")[0];
      this.cookie = pair.endsWith("=") ? "" : pair;
    }
    let data = null;
    const text = await response.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: response.status, data, headers: response.headers, setCookie: set };
  }
}

const lastCodeFor = async (email, since) => {
  for (let index = 0; index < 40; index += 1) {
    const mail = [...mails].reverse().find((entry) => entry.body.to === email && mails.indexOf(entry) >= since);
    if (mail) return mail.body.text.match(/\b(\d{6})\b/)[1];
    await sleep(100);
  }
  return null;
};

const login = async (client, email) => {
  const since = mails.length;
  await client.call("POST", "/api/auth/request", { email });
  const code = await lastCodeFor(email, since);
  return client.call("POST", "/api/auth/verify", { email, code });
};

const server = spawn("node_modules/.bin/tsx", ["src/index.ts"], {
  env: {
    ...process.env,
    PORT: String(PORT),
    DATA_DIR: dataDir,
    PUBLIC_DIR: path.join(dataDir, "none"),
    ADMIN_EMAIL: "admin@example.com",
    MAIL_TRANSPORT: "webhook",
    MAIL_WEBHOOK_URL: `http://127.0.0.1:${MAIL_PORT}/mail`,
    MAIL_WEBHOOK_TOKEN: "geheim-token",
    ANTHROPIC_API_KEY: "test",
    TRUST_PROXY: "1",
    CODE_TTL_MINUTES: "0.05",
    CODE_RESEND_SECONDS: "1",
    CODE_REQUESTS_PER_HOUR: "12",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (chunk) => (serverLog += chunk));
server.stderr.on("data", (chunk) => (serverLog += chunk));

const waitUp = async () => {
  for (let index = 0; index < 60; index += 1) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`Server startet nicht:\n${serverLog}`);
};

const run = async () => {
  await new Promise((resolve) => mailServer.listen(MAIL_PORT, "127.0.0.1", resolve));
  await waitUp();

  console.log("\n== Zugriff ohne Anmeldung ==");
  const anon = new Client("10.0.0.1");
  for (const [method, url] of [["GET", "/api/bootstrap"], ["GET", "/api/chats"], ["POST", "/api/chats"], ["GET", "/api/usage"], ["GET", "/api/settings"], ["GET", "/api/memory"], ["GET", "/api/admin/users"], ["POST", "/api/admin/users"]]) {
    const r = await anon.call(method, url, method === "POST" ? { email: "x@example.com" } : undefined);
    check(`${method} ${url} ohne Login -> 401`, r.status === 401, String(r.status));
  }
  const health = await anon.call("GET", "/api/health");
  check("Health liefert nur {ok:true}", JSON.stringify(health.data) === '{"ok":true}', JSON.stringify(health.data));
  check("Keine Server-Info im Header", !health.headers.get("x-powered-by"));
  check("API-Antworten nicht cachebar", /no-store/.test(health.headers.get("cache-control") ?? ""));
  check("CSP gesetzt", /default-src 'self'/.test(health.headers.get("content-security-policy") ?? ""));
  check("X-Frame-Options DENY", health.headers.get("x-frame-options") === "DENY");

  console.log("\n== Code anfordern (keine Benutzer-Enumeration) ==");
  const a = new Client("10.0.1.1");
  const unknown = await a.call("POST", "/api/auth/request", { email: "fremd@example.com" });
  await sleep(600);
  check("Unbekannte Adresse: 202", unknown.status === 202, String(unknown.status));
  check("Unbekannte Adresse: keine Mail verschickt", mails.length === 0, String(mails.length));
  const knownSince = mails.length;
  const known = await a.call("POST", "/api/auth/request", { email: "Admin@Example.com " });
  check("Bekannte Adresse: gleiche Antwort wie unbekannte", known.status === 202 && JSON.stringify(known.data) === JSON.stringify(unknown.data), JSON.stringify([known.data, unknown.data]));
  const code1 = await lastCodeFor("admin@example.com", knownSince);
  check("Mail kam per Webhook mit Token an", Boolean(code1) && mails.at(-1).auth === "Bearer geheim-token");
  check("Code ist 6-stellig", /^\d{6}$/.test(code1 ?? ""));
  check("Code steht nicht in der API-Antwort", !JSON.stringify(known.data).includes(code1));
  check("Ungültige E-Mail -> 400", (await a.call("POST", "/api/auth/request", { email: "kein-mail" })).status === 400);
  check("Objekt statt E-Mail -> 400", (await a.call("POST", "/api/auth/request", { email: { $ne: "" } })).status === 400);
  check("Überlange E-Mail -> 400", (await a.call("POST", "/api/auth/request", { email: `${"a".repeat(300)}@example.com` })).status === 400);
  const cooldown = await a.call("POST", "/api/auth/request", { email: "admin@example.com" });
  check("Erneute Anforderung innerhalb der Wartezeit -> 429", cooldown.status === 429, String(cooldown.status));

  console.log("\n== Code prüfen ==");
  const wrong = await a.call("POST", "/api/auth/verify", { email: "admin@example.com", code: code1 === "000000" ? "111111" : "000000" });
  check("Falscher Code -> 401", wrong.status === 401);
  check("Code als Zahl statt Text -> 401", (await a.call("POST", "/api/auth/verify", { email: "admin@example.com", code: Number(code1) })).status === 401);
  check("Code mit Buchstaben -> 401", (await a.call("POST", "/api/auth/verify", { email: "admin@example.com", code: "12345a" })).status === 401);
  check("Code für fremde Adresse -> 401", (await a.call("POST", "/api/auth/verify", { email: "fremd@example.com", code: code1 })).status === 401);
  check("Fehlermeldungen unterscheiden sich nicht", wrong.data.error === (await a.call("POST", "/api/auth/verify", { email: "fremd@example.com", code: "123456" })).data.error);
  for (let index = 0; index < 4; index += 1) await a.call("POST", "/api/auth/verify", { email: "admin@example.com", code: "999999" });
  const locked = await a.call("POST", "/api/auth/verify", { email: "admin@example.com", code: code1 });
  check("Nach 5 Fehlversuchen ist auch der richtige Code gesperrt", locked.status === 401, String(locked.status));
  check("Dabei keine Sitzung ausgestellt", !locked.setCookie);

  await sleep(1100);
  const s2 = mails.length;
  await a.call("POST", "/api/auth/request", { email: "admin@example.com" });
  const code2 = await lastCodeFor("admin@example.com", s2);
  await sleep(3300);
  const expired = await a.call("POST", "/api/auth/verify", { email: "admin@example.com", code: code2 });
  check("Abgelaufener Code -> 401", expired.status === 401, String(expired.status));

  await sleep(1100);
  const ok = await login(a, "admin@example.com");
  check("Anmeldung mit gültigem Code -> 200", ok.status === 200 && ok.data.user.role === "admin", JSON.stringify(ok.data));
  const cookieHeader = ok.setCookie ?? "";
  check("Cookie ist HttpOnly", /HttpOnly/i.test(cookieHeader));
  check("Cookie ist SameSite=Strict", /SameSite=Strict/i.test(cookieHeader));
  check("Cookie enthält keinen Klartext-Benutzer", !/admin/.test(cookieHeader));
  check("Cookie-Token lang genug (>= 40 Zeichen)", (cookieHeader.split(";")[0].split("=")[1] ?? "").length >= 40);
  const reuse = new Client("10.0.1.2");
  const s3 = mails.length;
  await sleep(1100);
  await reuse.call("POST", "/api/auth/request", { email: "admin@example.com" });
  const code3 = await lastCodeFor("admin@example.com", s3);
  check("Erster Einsatz des Codes klappt", (await reuse.call("POST", "/api/auth/verify", { email: "admin@example.com", code: code3 })).status === 200);
  check("Zweiter Einsatz desselben Codes scheitert (Einmalcode)", (await new Client("10.0.1.3").call("POST", "/api/auth/verify", { email: "admin@example.com", code: code3 })).status === 401);

  console.log("\n== Sitzung ==");
  check("Geschützte Route mit Sitzung -> 200", (await a.call("GET", "/api/chats")).status === 200);
  const forged = new Client("10.0.2.1");
  forged.cookie = "plaudi_session=" + "A".repeat(43);
  check("Erfundenes Token -> 401", (await forged.call("GET", "/api/chats")).status === 401);
  const tampered = new Client("10.0.2.2");
  tampered.cookie = a.cookie.slice(0, -2) + "xx";
  check("Manipuliertes Token -> 401", (await tampered.call("GET", "/api/chats")).status === 401);
  const bootstrap = await a.call("GET", "/api/bootstrap");
  check("Bootstrap enthält Benutzer, aber keine API-Schlüssel", bootstrap.data.user.email === "admin@example.com" && !JSON.stringify(bootstrap.data).includes("sk-"));

  console.log("\n== CSRF ==");
  check("Fremde Origin -> 403", (await a.call("POST", "/api/chats", {}, { Origin: "https://evil.example" })).status === 403);
  check("Cross-Site Fetch-Metadaten -> 403", (await a.call("POST", "/api/chats", {}, { "Sec-Fetch-Site": "cross-site" })).status === 403);
  check("Gleiche Origin -> erlaubt", (await a.call("POST", "/api/chats", {}, { Origin: BASE, "Sec-Fetch-Site": "same-origin" })).status === 201);

  console.log("\n== Benutzerverwaltung ==");
  check("Neuen Benutzer anlegen", (await a.call("POST", "/api/admin/users", { email: "Nutzer@Example.com" })).status === 201);
  check("Doppelt anlegen -> 409", (await a.call("POST", "/api/admin/users", { email: "nutzer@example.com" })).status === 409);
  check("Ungültige Adresse -> 400", (await a.call("POST", "/api/admin/users", { email: "nope" })).status === 400);
  const userClient = new Client("10.0.3.1");
  const userLogin = await login(userClient, "nutzer@example.com");
  check("Neuer Benutzer kann sich anmelden", userLogin.status === 200 && userLogin.data.user.role === "user");
  check("Normaler Benutzer: Admin-Liste -> 403", (await userClient.call("GET", "/api/admin/users")).status === 403);
  check("Normaler Benutzer: Benutzer anlegen -> 403", (await userClient.call("POST", "/api/admin/users", { email: "x@example.com" })).status === 403);
  check("Normaler Benutzer sieht keine API-Konten", (await userClient.call("GET", "/api/usage")).data.length === 0);

  console.log("\n== Trennung der Daten zwischen Benutzern ==");
  const adminChat = (await a.call("POST", "/api/chats")).data;
  const own = (await userClient.call("POST", "/api/chats")).data;
  const listing = (await userClient.call("GET", "/api/chats")).data;
  check("Fremder Chat fehlt in der eigenen Liste", listing.length === 1 && listing[0].id === own.id);
  for (const [method, url, body] of [["GET", `/api/chats/${adminChat.id}`], ["GET", `/api/chats/${adminChat.id}/context`], ["PATCH", `/api/chats/${adminChat.id}`, { title: "gehackt" }], ["DELETE", `/api/chats/${adminChat.id}`], ["POST", `/api/chats/${adminChat.id}/messages`, { content: "hallo" }], ["POST", `/api/chats/${adminChat.id}/regenerate`], ["POST", `/api/chats/${adminChat.id}/stop`]]) {
    const r = await userClient.call(method, url, body);
    check(`Fremder Chat: ${method} ${url.replace(adminChat.id, ":id")} -> 404`, r.status === 404, String(r.status));
  }
  const intact = await a.call("GET", `/api/chats/${adminChat.id}`);
  check("Fremder Chat blieb unverändert", intact.status === 200 && intact.data.chat.title === "Neuer Chat" && intact.data.messages.length === 0);
  check("Suche liefert nur eigene Chats", (await userClient.call("GET", "/api/chats?q=Neuer")).data.every((chat) => chat.id === own.id));
  const chatBootstrap = await userClient.call("GET", `/api/bootstrap?chat=${adminChat.id}`);
  check("Bootstrap gibt fremden Chat nicht heraus", chatBootstrap.data.detail === null);
  await userClient.call("PUT", "/api/settings", { customInstructions: "nur für Nutzer" });
  check("Einstellungen sind pro Benutzer getrennt", (await a.call("GET", "/api/settings")).data.customInstructions === "");

  console.log("\n== Abmelden und Entziehen von Zugriff ==");
  const second = new Client("10.0.4.1");
  await sleep(1100);
  await login(second, "admin@example.com");
  check("Zweite Sitzung funktioniert", (await second.call("GET", "/api/chats")).status === 200);
  await second.call("POST", "/api/auth/logout-all");
  check("Nach Abmeldung aller Geräte: erste Sitzung ungültig", (await a.call("GET", "/api/chats")).status === 401);
  await sleep(1100);
  await login(a, "admin@example.com");
  const oldCookie = a.cookie;
  await a.call("POST", "/api/auth/logout");
  const replay = new Client("10.0.4.2");
  replay.cookie = oldCookie;
  check("Abgemeldetes Cookie lässt sich nicht erneut verwenden", (await replay.call("GET", "/api/chats")).status === 401);
  await sleep(1100);
  await login(a, "admin@example.com");
  const users = (await a.call("GET", "/api/admin/users")).data;
  const normal = users.find((user) => user.email === "nutzer@example.com");
  const me = users.find((user) => user.email === "admin@example.com");
  check("Admin kann sich nicht selbst entfernen", (await a.call("DELETE", `/api/admin/users/${me.id}`)).status === 400);
  check("Letzten Admin nicht herabstufen", (await a.call("PATCH", `/api/admin/users/${me.id}`, { role: "user" })).status === 400);
  check("Ungültige Rolle -> 400", (await a.call("PATCH", `/api/admin/users/${normal.id}`, { role: "root" })).status === 400);
  check("Benutzer entfernen -> 204", (await a.call("DELETE", `/api/admin/users/${normal.id}`)).status === 204);
  check("Entfernter Benutzer verliert sofort den Zugriff", (await userClient.call("GET", "/api/chats")).status === 401);
  const afterRemoval = mails.length;
  await sleep(1100);
  await new Client("10.0.5.1").call("POST", "/api/auth/request", { email: "nutzer@example.com" });
  await sleep(700);
  check("Entfernter Benutzer erhält keinen Code mehr", mails.length === afterRemoval);

  console.log("\n== Begrenzung der Anfragen ==");
  const flood = new Client("10.0.6.1");
  const statuses = [];
  for (let index = 0; index < 14; index += 1) {
    await sleep(1100);
    statuses.push((await flood.call("POST", "/api/auth/request", { email: "flut@example.com" })).status);
  }
  check("Pro Adresse höchstens 12 Anforderungen pro Stunde (hier konfiguriert)", statuses.slice(0, 12).every((s) => s === 202) && statuses.slice(12).every((s) => s === 429), statuses.join(","));
  const bruteforce = new Client("10.0.7.1");
  let blocked = 0;
  for (let index = 0; index < 40; index += 1) {
    const r = await bruteforce.call("POST", "/api/auth/verify", { email: `x${index}@example.com`, code: "123456" });
    if (r.status === 429) blocked += 1;
  }
  check("Prüf-Versuche je IP werden begrenzt", blocked > 0, String(blocked));
  check("Anderes Gerät bleibt unbeeinträchtigt", (await new Client("10.0.7.2").call("POST", "/api/auth/verify", { email: "a@example.com", code: "123456" })).status === 401);

  console.log("\n== Log ==");
  const logged = [code1, code2, code3].filter(Boolean).some((code) => serverLog.includes(code));
  check("Server-Log enthält keine Anmeldecodes", !logged);
};

run()
  .catch((error) => {
    console.error("Testlauf abgebrochen:", error.message);
    results.fail += 1;
  })
  .finally(() => {
    console.log(`\nErgebnis: ${results.pass} bestanden, ${results.fail} fehlgeschlagen`);
    server.kill("SIGTERM");
    mailServer.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    process.exit(results.fail ? 1 : 0);
  });
