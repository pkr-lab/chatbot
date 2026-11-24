import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import { Logo } from "./Logo";
import { PasswordField } from "./PasswordField";

type Mode = "password" | "code" | "forgot" | "forgot-sent";

const RESEND_SECONDS = 30;

export const Login = ({ onSuccess }: { onSuccess: () => void }) => {
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState("");
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
    if (mode === "code") codeInput.current?.focus();
  }, [mode]);

  const message = (failure: unknown, fallback: string): string => (failure instanceof Error ? failure.message : fallback);

  const submitPassword = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault();
    if (!email.trim() || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const step = await api.login(email.trim(), password);
      setChallenge(step.challenge);
      setPassword("");
      setCode("");
      setWait(RESEND_SECONDS);
      setMode("code");
    } catch (failure) {
      setError(message(failure, "Anmeldung fehlgeschlagen."));
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.verifyCode(email.trim(), value, challenge);
      onSuccess();
    } catch (failure) {
      setError(message(failure, "Code ungültig."));
      setCode("");
      setBusy(false);
      codeInput.current?.focus();
    }
  };

  const submitForgot = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.forgot(email.trim());
      setMode("forgot-sent");
    } catch (failure) {
      setError(message(failure, "Die Anfrage ist fehlgeschlagen."));
    } finally {
      setBusy(false);
    }
  };

  const back = (): void => {
    setMode("password");
    setError(null);
    setCode("");
  };

  const errorLine = error ? (
    <p className="over" role="alert">
      {error}
    </p>
  ) : null;

  if (mode === "code") {
    return (
      <main className="login">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (/^\d{6}$/.test(code)) void verify(code);
          }}
        >
          <Logo height={52} />
          <p>
            Passwort stimmt. Wir haben einen 6-stelligen Code an <strong>{email.trim()}</strong> gesendet. Er ist 10 Minuten gültig.
          </p>
          <label>
            <span>Code aus der E-Mail</span>
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
          {errorLine}
          <button type="submit" className="primary" disabled={code.length !== 6 || busy}>
            {busy ? "Prüfe…" : "Anmelden"}
          </button>
          <div className="login-links">
            <span className="hint">{wait > 0 ? `Neuer Code nach erneuter Anmeldung in ${wait} s` : "Kein Code? Zurück und erneut anmelden."}</span>
            <button type="button" className="text-button" onClick={back}>
              Zurück
            </button>
          </div>
        </form>
      </main>
    );
  }

  if (mode === "forgot" || mode === "forgot-sent") {
    return (
      <main className="login">
        <form onSubmit={(event) => void submitForgot(event)}>
          <Logo height={52} />
          {mode === "forgot-sent" ? (
            <>
              <p>
                Falls <strong>{email.trim()}</strong> freigeschaltet ist, haben wir einen Link zum Festlegen eines neuen Passworts gesendet. Er ist 30 Minuten
                gültig. Ein neues Passwort hebt auch eine Sperre auf.
              </p>
              <button type="button" className="primary" onClick={back}>
                Zur Anmeldung
              </button>
            </>
          ) : (
            <>
              <p>Gib deine E-Mail-Adresse ein. Wir senden dir einen Link, mit dem du ein neues Passwort festlegst.</p>
              <label>
                <span>E-Mail-Adresse</span>
                <input type="email" value={email} autoComplete="email" autoFocus maxLength={254} onChange={(event) => setEmail(event.target.value)} />
              </label>
              {errorLine}
              <button type="submit" className="primary" disabled={!email.trim() || busy}>
                {busy ? "Sende…" : "Link senden"}
              </button>
              <button type="button" className="text-button" onClick={back}>
                Zurück
              </button>
            </>
          )}
        </form>
      </main>
    );
  }

  return (
    <main className="login">
      <form onSubmit={(event) => void submitPassword(event)}>
        <Logo height={52} />
        <p>Melde dich mit E-Mail und Passwort an. Danach bestätigst du mit einem Code per Mail.</p>
        <label>
          <span>E-Mail-Adresse</span>
          <input type="email" value={email} autoComplete="username" autoFocus maxLength={254} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <PasswordField label="Passwort" value={password} onChange={setPassword} autoComplete="current-password" />
        {errorLine}
        <button type="submit" className="primary" disabled={!email.trim() || !password || busy}>
          {busy ? "Prüfe…" : "Weiter"}
        </button>
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setError(null);
            setMode("forgot");
          }}
        >
          Passwort vergessen oder noch keins?
        </button>
      </form>
    </main>
  );
};
