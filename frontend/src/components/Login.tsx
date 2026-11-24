import { useState, type FormEvent } from "react";
import { api } from "../api";
import { Logo } from "./Logo";

export const Login = ({ onSuccess }: { onSuccess: () => void }) => {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onSuccess();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Anmeldung fehlgeschlagen.");
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <form onSubmit={(event) => void submit(event)}>
        <Logo height={44} />
        <p>Bitte melde dich an, um fortzufahren.</p>
        <label>
          <span>Passwort</span>
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            autoFocus
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error ? (
          <p className="over" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="primary" disabled={!password || busy}>
          {busy ? "Prüfe…" : "Anmelden"}
        </button>
      </form>
    </main>
  );
};
