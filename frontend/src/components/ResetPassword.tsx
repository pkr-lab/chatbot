import { useState, type FormEvent } from "react";
import { api } from "../api";
import { Logo } from "./Logo";
import { PasswordField } from "./PasswordField";

const readToken = (): string => {
  const match = /token=([A-Za-z0-9_-]+)/.exec(window.location.hash);
  if (match) window.history.replaceState(null, "", "/reset");
  return match?.[1] ?? "";
};

export const ResetPassword = () => {
  const [token] = useState(readToken);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    if (password !== repeat) {
      setError("Die beiden Passwörter stimmen nicht überein.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Das Passwort konnte nicht gesetzt werden.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <form onSubmit={(event) => void submit(event)}>
        <Logo height={52} />
        {done ? (
          <>
            <p>Dein Passwort wurde gesetzt. Alle bisherigen Sitzungen wurden beendet.</p>
            <button type="button" className="primary" onClick={() => window.location.assign("/")}>
              Zur Anmeldung
            </button>
          </>
        ) : !token ? (
          <>
            <p className="over">Dieser Link ist unvollständig. Fordere über „Passwort vergessen“ einen neuen an.</p>
            <button type="button" className="primary" onClick={() => window.location.assign("/")}>
              Zur Anmeldung
            </button>
          </>
        ) : (
          <>
            <p>Lege ein neues Passwort fest. Mindestens 10 Zeichen, am besten ein langer Satz.</p>
            <PasswordField label="Neues Passwort" value={password} onChange={setPassword} autoComplete="new-password" autoFocus />
            <PasswordField label="Passwort wiederholen" value={repeat} onChange={setRepeat} autoComplete="new-password" />
            {error ? (
              <p className="over" role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" className="primary" disabled={!password || !repeat || busy}>
              {busy ? "Speichere…" : "Passwort speichern"}
            </button>
          </>
        )}
      </form>
    </main>
  );
};
