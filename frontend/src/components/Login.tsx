import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import { Logo } from "./Logo";

const RESEND_SECONDS = 30;

export const Login = ({ onSuccess }: { onSuccess: () => void }) => {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  useEffect(() => {
    if (sentTo) codeInput.current?.focus();
  }, [sentTo]);

  const message = (failure: unknown, fallback: string): string => (failure instanceof Error ? failure.message : fallback);

  const requestCode = async (target: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.requestCode(target);
      setSentTo(target);
      setCode("");
      setWait(RESEND_SECONDS);
    } catch (failure) {
      setError(message(failure, "Der Code konnte nicht angefordert werden."));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value: string): Promise<void> => {
    if (!sentTo || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.verifyCode(sentTo, value);
      onSuccess();
    } catch (failure) {
      setError(message(failure, "Anmeldung fehlgeschlagen."));
      setCode("");
      codeInput.current?.focus();
      setBusy(false);
    }
  };

  const submitEmail = (event: FormEvent): void => {
    event.preventDefault();
    const trimmed = email.trim();
    if (trimmed && !busy) void requestCode(trimmed);
  };

  const submitCode = (event: FormEvent): void => {
    event.preventDefault();
    if (/^\d{6}$/.test(code)) void verify(code);
  };

  return (
    <main className="login">
      {sentTo ? (
        <form onSubmit={submitCode}>
          <Logo height={44} />
          <p>
            Falls <strong>{sentTo}</strong> freigeschaltet ist, haben wir einen 6-stelligen Code gesendet. Er ist 10 Minuten gültig.
          </p>
          <label>
            <span>Code</span>
            <input
              ref={codeInput}
              className="code-input"
              value={code}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="000000"
              onChange={(event) => {
                const next = event.target.value.replace(/\D/g, "").slice(0, 6);
                setCode(next);
                if (next.length === 6) void verify(next);
              }}
            />
          </label>
          {error ? (
            <p className="over" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="primary" disabled={code.length !== 6 || busy}>
            {busy ? "Prüfe…" : "Anmelden"}
          </button>
          <div className="login-links">
            <button type="button" className="text-button" disabled={wait > 0 || busy} onClick={() => void requestCode(sentTo)}>
              {wait > 0 ? `Neuen Code senden (${wait})` : "Neuen Code senden"}
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setSentTo(null);
                setError(null);
              }}
            >
              Andere Adresse
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={submitEmail}>
          <Logo height={44} />
          <p>Melde dich mit deiner freigeschalteten E-Mail-Adresse an. Du erhältst einen Einmalcode per Mail.</p>
          <label>
            <span>E-Mail-Adresse</span>
            <input
              type="email"
              value={email}
              autoComplete="email"
              autoFocus
              maxLength={254}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          {error ? (
            <p className="over" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="primary" disabled={!email.trim() || busy}>
            {busy ? "Sende…" : "Code senden"}
          </button>
        </form>
      )}
    </main>
  );
};
