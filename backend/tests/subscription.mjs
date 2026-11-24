import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "plaudi-sub-"));
process.env.DATA_DIR = dataDir;
process.env.AI_BACKEND = "subscription";
delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
delete process.env.API_KEY;
delete process.env.API_KEYS;

const results = { pass: 0, fail: 0 };
const check = (name, condition, detail = "") => {
  if (condition) results.pass += 1;
  else results.fail += 1;
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${condition || !detail ? "" : `  -> ${detail}`}`);
};

const sub = await import("../dist/subscription.js");
const { seal, unseal } = await import("../dist/secret.js");
const { closeDb } = await import("../dist/db.js");

const token = `sk-ant-oat01-${"Ab1_-".repeat(14)}`;

console.log("== Token-Format ==");
check("Gültiges Token wird akzeptiert", sub.validTokenFormat(token));
for (const bad of ["", "abc", "sk-ant-", `sk-ant-${"x".repeat(20)} `, `sk-ant-${"x".repeat(20)}\n`, `xsk-ant-${"x".repeat(30)}`, `sk-ant-${"x".repeat(600)}`, "sk-ant-aaaa;rm -rf /aaaaaaaaaaaaaaaa"]) {
  check(`Ungültig: ${JSON.stringify(bad).slice(0, 40)}`, !sub.validTokenFormat(bad));
}

console.log("== Verschlüsselte Ablage ==");
check("Anfangs nicht verbunden", sub.isConnected() === false && sub.tokenSource() === null);
sub.storeToken(token);
check("Nach dem Speichern verbunden (Quelle ui)", sub.isConnected() === true && sub.tokenSource() === "ui" && sub.getToken() === token);
const raw = fs.readdirSync(dataDir).map((name) => fs.readFileSync(path.join(dataDir, name))).map((buf) => buf.toString("latin1")).join("");
check("Token liegt nirgends im Klartext in den Daten", !raw.includes(token) && !raw.includes(token.slice(12, 40)));
const sealed = seal("a", "geheim");
check("Entschlüsseln mit richtigem Zweck", unseal("a", sealed) === "geheim");
check("Anderer Zweck entschlüsselt nicht", unseal("b", sealed) === null);
const parts = sealed.split(".");
parts[2] = Buffer.from("manipuliert").toString("base64url");
check("Manipulierter Inhalt wird abgelehnt", unseal("a", parts.join(".")) === null);
check("Müll wird abgelehnt", unseal("a", "x.y.z") === null && unseal("a", "") === null);
check("Zwei Verschlüsselungen desselben Werts unterscheiden sich", seal("a", "geheim") !== seal("a", "geheim"));
sub.clearToken();
check("Nach dem Entfernen nicht mehr verbunden", sub.isConnected() === false && sub.getToken() === null);

console.log("== Antwort ohne Token ==");
let failure = null;
try {
  await sub.streamViaSubscription({ system: [{ type: "text", text: "x" }], messages: [{ role: "user", content: "hi" }], signal: new AbortController().signal, onText() {}, onThinking() {}, onSwitch() {} });
} catch (error) {
  failure = error;
}
check("Ohne Token SubscriptionError not_connected", failure?.kind === "not_connected");

console.log("== Prüfung eines erfundenen Tokens ==");
const verified = await sub.verifyToken(token);
check("Erfundenes Token wird nicht akzeptiert", verified.ok === false, JSON.stringify(verified));

closeDb();
fs.rmSync(dataDir, { recursive: true, force: true });
console.log(`\nErgebnis: ${results.pass} bestanden, ${results.fail} fehlgeschlagen`);
process.exit(results.fail ? 1 : 0);
