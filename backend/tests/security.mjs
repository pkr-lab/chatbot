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
const results = { pass: 0, fail: 0 };
const ADMIN = "admin@example.com";
const ADMIN_PW = "Sehr-Sicheres-Passwort-1";

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
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: response.status, data, headers: response.headers, setCookie: set };
  }
}

const waitMail = async (to, since, pattern) => {
  for (let index = 0; index < 50; index += 1) {
    const mail = mails.slice(since).reverse().find((entry) => entry.body.to === to && pattern.test(entry.body.text));
    if (mail) return mail.body.text.match(pattern)[1];
    await sleep(100);
  }
  return null;
};

const codeFrom = (to, since) => waitMail(to, since, /\b(\d{6})\b/);
const tokenFrom = (to, since) => waitMail(to, since, /#token=([A-Za-z0-9_-]+)/);

let ipCounter = 0;
const fresh = () => new Client(`10.1.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`);

const lastLoginAt = new Map();

const loginPassword = async (client, email, password) => {
  const wait = 1150 - (Date.now() - (lastLoginAt.get(email) ?? 0));
  if (wait > 0) await sleep(wait);
  const response = await client.call("POST", "/api/auth/login", { email, password });
  if (response.status === 200) lastLoginAt.set(email, Date.now());
  return response;
};

const fullLogin = async (client, email, password) => {
  const since = mails.length;
  const step = await loginPassword(client, email, password);
  if (step.status !== 200) return step;
  const code = await codeFrom(email, since);
  return client.call("POST", "/api/auth/verify", { email, code, challenge: step.data.challenge });
};

const setPassword = async (email, token, password) => fresh().call("POST", "/api/auth/reset", { token, password });

let server = null;
let serverLog = "";

const startServer = async () => {
  server = spawn("node_modules/.bin/tsx", ["src/index.ts"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: dataDir,
      PUBLIC_DIR: path.join(dataDir, "none"),
      ADMIN_EMAIL: ADMIN,
      ADMIN_PASSWORD: ADMIN_PW,
      PUBLIC_URL: BASE,
      MAIL_TRANSPORT: "webhook",
      MAIL_WEBHOOK_URL: `http://127.0.0.1:${MAIL_PORT}/mail`,
      MAIL_WEBHOOK_TOKEN: "geheim-token",
      API_KEY: "test",
      TRUST_PROXY: "1",
      CODE_TTL_MINUTES: "0.05",
      CODE_RESEND_SECONDS: "1",
      CODE_REQUESTS_PER_HOUR: "60",
      RESET_TTL_MINUTES: "0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => (serverLog += chunk));
  server.stderr.on("data", (chunk) => (serverLog += chunk));
  for (let index = 0; index < 80; index += 1) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`Server startet nicht:\n${serverLog}`);
};

const stopServer = async () => {
  server.kill("SIGTERM");
  await new Promise((resolve) => server.once("exit", resolve));
};

const run = async () => {
  await new Promise((resolve) => mailServer.listen(MAIL_PORT, "127.0.0.1", resolve));
  await startServer();

  console.log("\n== Zugriff ohne Anmeldung ==");
  const anon = fresh();
  for (const [method, url] of [["GET", "/api/bootstrap"], ["GET", "/api/chats"], ["POST", "/api/chats"], ["GET", "/api/usage"], ["GET", "/api/admin/users"], ["POST", "/api/admin/users/1/reset-password"], ["POST", "/api/admin/users/1/unlock"], ["POST", "/api/auth/password"]]) {
    const r = await anon.call(method, url, method === "POST" ? {} : undefined);
    check(`${method} ${url} ohne Login -> 401`, r.status === 401, String(r.status));
  }
  const health = await anon.call("GET", "/api/health");
  check("Health liefert nur {ok:true}", JSON.stringify(health.data) === '{"ok":true}');
  check("Keine Server-Info im Header", !health.headers.get("x-powered-by"));
  check("API-Antworten nicht cachebar", /no-store/.test(health.headers.get("cache-control") ?? ""));
  check("Alter Endpunkt ohne Passwort existiert nicht mehr", (await anon.call("POST", "/api/auth/request", { email: ADMIN })).status === 401);

  console.log("\n== Passwort und Code (zwei Faktoren) ==");
  const a = fresh();
  const wrong = await loginPassword(a, ADMIN, "falsches-passwort-123");
  const wrongUnknown = await loginPassword(fresh(), "fremd@example.com", "falsches-passwort-123");
  check("Falsches Passwort -> 401", wrong.status === 401, String(wrong.status));
  check("Meldung nennt verbleibende Versuche", /Noch 2 Versuche/.test(wrong.data.error), wrong.data.error);
  check("Unbekannte Adresse: identische Antwort wie falsches Passwort", wrongUnknown.status === 401 && wrongUnknown.data.error === wrong.data.error, wrongUnknown.data?.error);
  check("Bei falschem Passwort wird keine Mail verschickt", mails.length === 0);
  const since = mails.length;
  const step = await loginPassword(a, ADMIN, ADMIN_PW);
  check("Richtiges Passwort -> Code-Schritt", step.status === 200 && step.data.step === "code" && Boolean(step.data.challenge), JSON.stringify(step.data));
  check("Nach dem Passwort noch keine Sitzung", !step.setCookie && (await a.call("GET", "/api/chats")).status === 401);
  check("Passwort steht nicht in der Antwort", !JSON.stringify(step.data).includes(ADMIN_PW));
  const code1 = await codeFrom(ADMIN, since);
  check("Code kam per Webhook mit Token", Boolean(code1) && mails.at(-1).auth === "Bearer geheim-token");
  const wrongChallenge = await a.call("POST", "/api/auth/verify", { email: ADMIN, code: code1, challenge: "x".repeat(43) });
  check("Richtiger Code mit falscher Challenge -> 401", wrongChallenge.status === 401);
  check("Code ohne Challenge -> 401", (await a.call("POST", "/api/auth/verify", { email: ADMIN, code: code1 })).status === 401);
  const ok = await a.call("POST", "/api/auth/verify", { email: ADMIN, code: code1, challenge: step.data.challenge });
  check("Code mit Challenge -> Anmeldung", ok.status === 200 && ok.data.user.role === "admin", JSON.stringify(ok.data));
  check("Cookie HttpOnly und SameSite=Strict", /HttpOnly/i.test(ok.setCookie) && /SameSite=Strict/i.test(ok.setCookie));
  check("Einmalcode: zweite Verwendung scheitert", (await fresh().call("POST", "/api/auth/verify", { email: ADMIN, code: code1, challenge: step.data.challenge })).status === 401);
  check("Geschützte Route mit Sitzung -> 200", (await a.call("GET", "/api/chats")).status === 200);
  const bootstrap = await a.call("GET", "/api/bootstrap");
  check("Bootstrap enthält keine Hashes oder Schlüssel", !/scrypt|password|sk-/i.test(JSON.stringify(bootstrap.data)));
  const forged = fresh();
  forged.cookie = "plaudi_session=" + "A".repeat(43);
  check("Erfundenes Token -> 401", (await forged.call("GET", "/api/chats")).status === 401);

  console.log("\n== Benutzer anlegen, Einladung, Passwort setzen ==");
  const sinceInvite = mails.length;
  const created = await a.call("POST", "/api/admin/users", { email: "Nutzer@Example.com" });
  check("Benutzer anlegen -> 201 ohne Passwort", created.status === 201 && created.data.has_password === false);
  check("Admin-Antwort enthält keinen Hash", !/scrypt|password_hash/.test(JSON.stringify(created.data)));
  const inviteToken = await tokenFrom("nutzer@example.com", sinceInvite);
  check("Einladung per Mail mit Link", Boolean(inviteToken) && mails.at(-1).body.text.includes(`${BASE}/reset#token=`));
  check("Anmeldung vor dem Setzen des Passworts scheitert", (await loginPassword(fresh(), "nutzer@example.com", "irgendwas-langes-1")).status === 401);
  check("Zu kurzes Passwort wird abgelehnt", (await setPassword("n", inviteToken, "kurz")).status === 400);
  check("Häufiges Passwort wird abgelehnt", (await setPassword("n", inviteToken, "passwort123")).status === 400);
  check("Passwort mit eigener Adresse wird abgelehnt", (await setPassword("n", inviteToken, "nutzer-nutzer-1")).status === 400);
  const USER_PW = "Kaffee-Tasse-Morgen-2026!";
  check("Passwort per Einladungslink setzen", (await setPassword("n", inviteToken, USER_PW)).status === 200);
  check("Link ist nur einmal gültig", (await setPassword("n", inviteToken, "Anderes-Passwort-9876")).status === 400);
  check("Falsches Token -> 400", (await setPassword("n", "z".repeat(43), USER_PW)).status === 400);
  const u = fresh();
  const uLogin = await fullLogin(u, "nutzer@example.com", USER_PW);
  check("Neuer Benutzer kann sich mit Passwort und Code anmelden", uLogin.status === 200 && uLogin.data.user.role === "user", JSON.stringify(uLogin.data));
  check("Normaler Benutzer: Admin-Routen -> 403", (await u.call("GET", "/api/admin/users")).status === 403 && (await u.call("POST", "/api/admin/users/1/reset-password")).status === 403);

  console.log("\n== Trennung der Daten ==");
  const adminChat = (await a.call("POST", "/api/chats")).data;
  const own = (await u.call("POST", "/api/chats")).data;
  check("Fremder Chat fehlt in der Liste", (await u.call("GET", "/api/chats")).data.every((chat) => chat.id === own.id));
  for (const [method, url, body] of [["GET", `/api/chats/${adminChat.id}`], ["PATCH", `/api/chats/${adminChat.id}`, { title: "x" }], ["DELETE", `/api/chats/${adminChat.id}`], ["POST", `/api/chats/${adminChat.id}/messages`, { content: "x" }]]) {
    check(`Fremder Chat ${method} -> 404`, (await u.call(method, url, body)).status === 404);
  }

  console.log("\n== CSRF ==");
  check("Fremde Origin -> 403", (await a.call("POST", "/api/chats", {}, { Origin: "https://evil.example" })).status === 403);
  check("Cross-Site Fetch-Metadaten -> 403", (await a.call("POST", "/api/chats", {}, { "Sec-Fetch-Site": "cross-site" })).status === 403);

  console.log("\n== Sperre: 3 Fehlversuche = 24 Stunden ==");
  const lockUser = fresh();
  const f1 = await loginPassword(lockUser, "nutzer@example.com", "falsch-falsch-1");
  const f2 = await loginPassword(lockUser, "nutzer@example.com", "falsch-falsch-2");
  const f3 = await loginPassword(lockUser, "nutzer@example.com", "falsch-falsch-3");
  check("1. Fehlversuch: 401, noch 2", f1.status === 401 && /Noch 2 Versuche/.test(f1.data.error), f1.data.error);
  check("2. Fehlversuch: 401, noch 1", f2.status === 401 && /Noch 1 Versuch,/.test(f2.data.error), f2.data.error);
  check("3. Fehlversuch: gesperrt (423)", f3.status === 423 && /gesperrt/.test(f3.data.error), `${f3.status} ${f3.data.error}`);
  const until = f3.data.lockedUntil;
  check("Sperre dauert 24 Stunden", Math.abs(until - Date.now() - 24 * 3600 * 1000) < 60000);
  const sinceLocked = mails.length;
  const rightButLocked = await loginPassword(fresh(), "nutzer@example.com", USER_PW);
  check("Auch das richtige Passwort wird während der Sperre abgelehnt", rightButLocked.status === 423);
  await sleep(500);
  check("Während der Sperre wird kein Code verschickt", mails.length === sinceLocked);
  const lockedUnknown = fresh();
  for (let index = 0; index < 3; index += 1) await loginPassword(lockedUnknown, "gibtsnicht@example.com", "falsch-falsch-1");
  check("Unbekannte Adressen werden gleich behandelt (ebenfalls gesperrt)", (await loginPassword(fresh(), "gibtsnicht@example.com", "falsch-falsch-1")).status === 423);
  check("Sitzung des gesperrten Benutzers bleibt unberührt", (await u.call("GET", "/api/chats")).status === 200);

  await stopServer();
  await startServer();
  check("Sperre überlebt einen Neustart", (await loginPassword(fresh(), "nutzer@example.com", USER_PW)).status === 423);

  const adminAgain = fresh();
  const adminLogin = await fullLogin(adminAgain, ADMIN, ADMIN_PW);
  check("Administrator ist von der Sperre des Benutzers nicht betroffen", adminLogin.status === 200);
  const list = (await adminAgain.call("GET", "/api/admin/users")).data;
  const target = list.find((user) => user.email === "nutzer@example.com");
  check("Admin-Liste zeigt die Sperre", Boolean(target.locked_until));
  check("Admin hebt Sperre auf", (await adminAgain.call("POST", `/api/admin/users/${target.id}/unlock`)).status === 200);
  const afterUnlock = await fullLogin(fresh(), "nutzer@example.com", USER_PW);
  check("Nach Aufhebung klappt die Anmeldung", afterUnlock.status === 200, JSON.stringify(afterUnlock.data));

  console.log("\n== Sperre über den Code-Schritt ==");
  const c = fresh();
  const sinceC = mails.length;
  const stepC = await loginPassword(c, "nutzer@example.com", USER_PW);
  const realCode = await codeFrom("nutzer@example.com", sinceC);
  const wrongCode = realCode === "000000" ? "111111" : "000000";
  const c1 = await c.call("POST", "/api/auth/verify", { email: "nutzer@example.com", code: wrongCode, challenge: stepC.data.challenge });
  const c2 = await c.call("POST", "/api/auth/verify", { email: "nutzer@example.com", code: wrongCode, challenge: stepC.data.challenge });
  const c3 = await c.call("POST", "/api/auth/verify", { email: "nutzer@example.com", code: wrongCode, challenge: stepC.data.challenge });
  check("Falsche Codes zählen mit (noch 2, noch 1, dann Sperre)", c1.status === 401 && /Noch 2/.test(c1.data.error) && /Noch 1/.test(c2.data.error) && c3.status === 423, `${c1.status} ${c2.status} ${c3.status}`);
  check("Danach ist auch der richtige Code wertlos", (await c.call("POST", "/api/auth/verify", { email: "nutzer@example.com", code: realCode, challenge: stepC.data.challenge })).status === 423);
  const junk = fresh();
  for (let index = 0; index < 5; index += 1) await junk.call("POST", "/api/auth/verify", { email: ADMIN, code: "123456", challenge: "y".repeat(43) });
  check("Ohne ausgelösten Code sperren Verify-Anfragen niemanden", (await fullLogin(fresh(), ADMIN, ADMIN_PW)).status === 200);

  console.log("\n== Passwort vergessen (Mail) ==");
  const sinceForgot = mails.length;
  const forgotUnknown = await fresh().call("POST", "/api/auth/forgot", { email: "fremd2@example.com" });
  await sleep(500);
  check("Unbekannte Adresse: 202 ohne Mail", forgotUnknown.status === 202 && mails.length === sinceForgot);
  const forgotKnown = await fresh().call("POST", "/api/auth/forgot", { email: "nutzer@example.com" });
  check("Bekannte Adresse: gleiche Antwort", forgotKnown.status === 202 && JSON.stringify(forgotKnown.data) === JSON.stringify(forgotUnknown.data));
  const resetToken = await tokenFrom("nutzer@example.com", sinceForgot);
  check("Reset-Link kam per Mail", Boolean(resetToken));
  const oldSession = u.cookie;
  const NEW_PW = "Neues-Passwort-fuer-mich-7";
  check("Passwort per Reset-Link ändern", (await setPassword("n", resetToken, NEW_PW)).status === 200);
  check("Alle bisherigen Sitzungen sind beendet", (await u.call("GET", "/api/chats")).status === 401 && Boolean(oldSession));
  check("Altes Passwort gilt nicht mehr", (await loginPassword(fresh(), "nutzer@example.com", USER_PW)).status === 401);
  check("Neues Passwort funktioniert", (await fullLogin(fresh(), "nutzer@example.com", NEW_PW)).status === 200);
  await sleep(1100);
  const sinceExpire = mails.length;
  await fresh().call("POST", "/api/auth/forgot", { email: "nutzer@example.com" });
  const expiring = await tokenFrom("nutzer@example.com", sinceExpire);
  await sleep(6500);
  check("Abgelaufener Reset-Link wird abgelehnt", (await setPassword("n", expiring, "Noch-ein-Passwort-123")).status === 400);

  console.log("\n== Reset hebt Sperre auf ==");
  const lockAgain = fresh();
  for (let index = 0; index < 3; index += 1) await loginPassword(lockAgain, "nutzer@example.com", "falsch-falsch-9");
  check("Konto ist gesperrt", (await loginPassword(fresh(), "nutzer@example.com", NEW_PW)).status === 423);
  await sleep(1100);
  const sinceUnlock = mails.length;
  await fresh().call("POST", "/api/auth/forgot", { email: "nutzer@example.com" });
  const unlockToken = await tokenFrom("nutzer@example.com", sinceUnlock);
  const FINAL_PW = "Endgueltiges-Passwort-55";
  await setPassword("n", unlockToken, FINAL_PW);
  check("Nach Reset per Mail ist die Sperre aufgehoben", (await fullLogin(fresh(), "nutzer@example.com", FINAL_PW)).status === 200);

  console.log("\n== Passwort im Admin-Panel zurücksetzen ==");
  const nutzerSession = fresh();
  await fullLogin(nutzerSession, "nutzer@example.com", FINAL_PW);
  const adminPanel = fresh();
  await fullLogin(adminPanel, ADMIN, ADMIN_PW);
  const nutzer = (await adminPanel.call("GET", "/api/admin/users")).data.find((user) => user.email === "nutzer@example.com");
  const sinceAdminReset = mails.length;
  const adminReset = await adminPanel.call("POST", `/api/admin/users/${nutzer.id}/reset-password`);
  check("Admin setzt Passwort zurück -> 200 mit Link", adminReset.status === 200 && /\/reset#token=/.test(adminReset.data.link), JSON.stringify(adminReset.data));
  const adminResetToken = await tokenFrom("nutzer@example.com", sinceAdminReset);
  check("Benutzer erhält Mail mit Link", Boolean(adminResetToken) && adminReset.data.link.endsWith(adminResetToken));
  check("Altes Passwort ist sofort ungültig", (await loginPassword(fresh(), "nutzer@example.com", FINAL_PW)).status === 401);
  check("Laufende Sitzung des Benutzers ist beendet", (await nutzerSession.call("GET", "/api/chats")).status === 401);
  check("Der Benutzer wählt das neue Passwort selbst über den Link", (await setPassword("n", adminResetToken, "Selbst-gewaehltes-Wort-31")).status === 200);
  check("Anmeldung mit dem selbst gewählten Passwort", (await fullLogin(fresh(), "nutzer@example.com", "Selbst-gewaehltes-Wort-31")).status === 200);
  check("Reset für unbekannten Benutzer -> 404", (await adminPanel.call("POST", "/api/admin/users/99999/reset-password")).status === 404);

  console.log("\n== Passwort ändern (angemeldet) ==");
  const changer = fresh();
  await fullLogin(changer, "nutzer@example.com", "Selbst-gewaehltes-Wort-31");
  const other = fresh();
  await fullLogin(other, "nutzer@example.com", "Selbst-gewaehltes-Wort-31");
  const bad = await changer.call("POST", "/api/auth/password", { current: "falsch-falsch-1", next: "Neues-Passwort-8888" });
  check("Falsches aktuelles Passwort -> 403 mit Restversuchen", bad.status === 403 && /Noch 2/.test(bad.data.error), `${bad.status} ${bad.data?.error}`);
  check("Schwaches neues Passwort -> 400", (await changer.call("POST", "/api/auth/password", { current: "Selbst-gewaehltes-Wort-31", next: "kurz" })).status === 400);
  check("Passwort ändern -> 200", (await changer.call("POST", "/api/auth/password", { current: "Selbst-gewaehltes-Wort-31", next: "Geaendert-im-Konto-4711" })).status === 200);
  check("Eigene Sitzung bleibt, andere Geräte werden abgemeldet", (await changer.call("GET", "/api/chats")).status === 200 && (await other.call("GET", "/api/chats")).status === 401);
  const brute = fresh();
  await brute.call("POST", "/api/auth/password", { current: "x1x1x1x1x1x1", next: "Geaendert-im-Konto-0000" });
  await brute.call("POST", "/api/auth/password", { current: "x1x1x1x1x1x1", next: "Geaendert-im-Konto-0000" });
  check("Ohne Anmeldung kein Passwortwechsel", (await brute.call("POST", "/api/auth/password", { current: "x", next: "y" })).status === 401);
  for (let index = 0; index < 3; index += 1) await changer.call("POST", "/api/auth/password", { current: "falsch-falsch-1", next: "Geaendert-im-Konto-0000" });
  check("3 falsche aktuelle Passwörter sperren den Passwortwechsel", (await changer.call("POST", "/api/auth/password", { current: "Geaendert-im-Konto-4711", next: "Geaendert-im-Konto-1234" })).status === 423);

  console.log("\n== Abmelden und Entfernen ==");
  const second = fresh();
  await fullLogin(second, ADMIN, ADMIN_PW);
  const oldCookie = second.cookie;
  await second.call("POST", "/api/auth/logout");
  const replay = fresh();
  replay.cookie = oldCookie;
  check("Abgemeldetes Cookie ist wertlos", (await replay.call("GET", "/api/chats")).status === 401);
  const removable = fresh();
  const sinceRemove = mails.length;
  await adminPanel.call("POST", "/api/admin/users", { email: "weg@example.com" });
  const removeToken = await tokenFrom("weg@example.com", sinceRemove);
  await setPassword("w", removeToken, "Zum-Entfernen-gedacht-12");
  await fullLogin(removable, "weg@example.com", "Zum-Entfernen-gedacht-12");
  const weg = (await adminPanel.call("GET", "/api/admin/users")).data.find((user) => user.email === "weg@example.com");
  check("Benutzer entfernen -> 204", (await adminPanel.call("DELETE", `/api/admin/users/${weg.id}`)).status === 204);
  check("Entfernter Benutzer verliert sofort den Zugriff", (await removable.call("GET", "/api/chats")).status === 401);
  const me = (await adminPanel.call("GET", "/api/admin/users")).data.find((user) => user.email === ADMIN);
  check("Admin kann sich nicht selbst entfernen", (await adminPanel.call("DELETE", `/api/admin/users/${me.id}`)).status === 400);

  console.log("\n== Speicherung ==");
  const dbBytes = ["chatbot.sqlite", "chatbot.sqlite-wal"].map((name) => (fs.existsSync(path.join(dataDir, name)) ? fs.readFileSync(path.join(dataDir, name)).toString("latin1") : "")).join("");
  check("Kein Klartext-Passwort in der Datenbank", ![ADMIN_PW, USER_PW, NEW_PW, FINAL_PW, "Geaendert-im-Konto-4711"].some((pw) => dbBytes.includes(pw)));
  check("Passwörter liegen als scrypt-Hash vor", /scrypt\$32768\$8\$1\$/.test(dbBytes));
  check("Reset-Token liegen nicht im Klartext in der Datenbank", ![inviteToken, resetToken, adminResetToken].some((token) => dbBytes.includes(token)));
  check("Weder Passwörter noch Codes im Server-Log", ![ADMIN_PW, USER_PW, NEW_PW, FINAL_PW, code1].some((secret) => serverLog.includes(secret)));

  console.log("\n== Begrenzung je IP ==");
  const flood = fresh();
  let blocked = 0;
  for (let index = 0; index < 40; index += 1) {
    const r = await flood.call("POST", "/api/auth/login", { email: `flut${index}@example.com`, password: "falsch-falsch-1" });
    if (r.status === 429) blocked += 1;
  }
  check("Anmeldeversuche je IP werden begrenzt", blocked > 0, String(blocked));
};

run()
  .catch((error) => {
    console.error("Testlauf abgebrochen:", error.stack ?? error.message);
    results.fail += 1;
  })
  .finally(async () => {
    console.log(`\nErgebnis: ${results.pass} bestanden, ${results.fail} fehlgeschlagen`);
    try {
      server.kill("SIGTERM");
    } catch {
      results.fail += 0;
    }
    mailServer.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    process.exit(results.fail ? 1 : 0);
  });
