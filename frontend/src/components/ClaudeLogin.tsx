import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import type { ClaudeLoginStatus } from "../types";
import { PasswordField } from "./PasswordField";

const LIMIT_NAMES: Record<string, string> = {
  five_hour: "5-Stunden-Fenster",
  seven_day: "7-Tage-Fenster",
  seven_day_opus: "7 Tage Opus",
  seven_day_sonnet: "7 Tage Sonnet",
  overage: "Zusatznutzung",
};

const clock = (value: number): string =>
  new Date(value).toLocaleString("de-DE", { weekday: "short", hour: "2-digit", minute: "2-digit" });

export const ClaudeLogin = () => {
  const [status, setStatus] = useState<ClaudeLoginStatus | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.claudeLogin().then(setStatus).catch(() => setError("Status konnte nicht geladen werden."));
  }, []);

  const connect = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setStatus(await api.connectClaude(token.trim()));
      setToken("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Verbinden fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await api.disconnectClaude());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Trennen fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  if (!status) return error ? <p className="over">{error}</p> : null;

  return (
    <section>
      <h3>Claude-Anmeldung</h3>
      {status.connected ? (
        <>
          <p className="hint">
            Verbunden mit dem Claude-Abo{status.source === "env" ? " (Token aus der Umgebung)" : ""}.
            {status.account.status === "invalid" ? " Das Token wurde zuletzt abgelehnt, bitte neu verbinden." : ""}
            {status.account.until ? ` Limit erreicht, wieder verfügbar ab ${clock(status.account.until)} Uhr.` : ""}
          </p>
          {status.limits.length > 0 ? (
            <ul className="user-list">
              {status.limits.map((item) => (
                <li key={item.type}>
                  <div>
                    <strong>{LIMIT_NAMES[item.type] ?? item.type}</strong>
                    <span>
                      {item.status === "rejected" ? "erreicht" : item.status === "allowed_warning" ? "fast erreicht" : "frei"}
                      {item.utilization !== null ? ` · ${Math.round(item.utilization * (item.utilization <= 1 ? 100 : 1))} % genutzt` : ""}
                      {item.resetsAt ? ` · zurückgesetzt ${clock(item.resetsAt)} Uhr` : ""}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          {status.source === "ui" ? (
            <button type="button" className="secondary fit" onClick={() => void disconnect()} disabled={busy}>
              Trennen
            </button>
          ) : null}
        </>
      ) : (
        <p className="hint">Noch nicht verbunden. Ohne Token kann Plaudi nicht antworten.</p>
      )}
      {status.source !== "env" ? (
        <form className="pw-form" onSubmit={(event) => void connect(event)}>
          <p className="hint">
            Auf deinem Rechner <code>claude setup-token</code> ausführen, im Browser mit dem Claude-Konto anmelden und das
            ausgegebene Token hier einfügen. Es wird geprüft und verschlüsselt auf dem Server gespeichert.
          </p>
          <PasswordField label="Claude-Token" value={token} onChange={setToken} autoComplete="new-password" />
          <button type="submit" className="secondary fit" disabled={busy || !token.trim()}>
            {busy ? "Prüfe…" : status.connected ? "Token ersetzen" : "Verbinden"}
          </button>
        </form>
      ) : null}
      {error ? <p className="over">{error}</p> : null}
    </section>
  );
};
