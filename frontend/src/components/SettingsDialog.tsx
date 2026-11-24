import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api } from "../api";
import type { AppConfig, AuthUser, ManagedUser, Settings } from "../types";
import { Icon } from "./Icon";

interface SettingsDialogProps {
  user: AuthUser;
  settings: Settings;
  config: AppConfig;
  onSave: (settings: Settings) => void;
  onClose: () => void;
}

const MAX_INSTRUCTIONS = 4000;

export const SettingsDialog = ({ user, settings, config, onSave, onClose }: SettingsDialogProps) => {
  const [instructions, setInstructions] = useState(settings.customInstructions);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [newAdmin, setNewAdmin] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    first.current?.focus();
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    const onEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [onClose]);

  useEffect(() => {
    if (user.role === "admin") api.users().then(setUsers).catch(() => setUserError("Benutzer konnten nicht geladen werden."));
  }, [user.role]);

  const guard = async (action: () => Promise<void>): Promise<void> => {
    setUserError(null);
    try {
      await action();
    } catch (failure) {
      setUserError(failure instanceof Error ? failure.message : "Aktion fehlgeschlagen.");
    }
  };

  const addUser = (): Promise<void> =>
    guard(async () => {
      const created = await api.addUser(newEmail, newAdmin ? "admin" : "user");
      setUsers((previous) => [...previous, created]);
      setNewEmail("");
      setNewAdmin(false);
    });

  const toggleRole = (target: ManagedUser): Promise<void> =>
    guard(async () => {
      const updated = await api.setRole(target.id, target.role === "admin" ? "user" : "admin");
      setUsers((previous) => previous.map((item) => (item.id === updated.id ? updated : item)));
    });

  const removeUser = (target: ManagedUser): Promise<void> =>
    guard(async () => {
      if (!window.confirm(`${target.email} entfernen? Alle Chats dieser Person werden gelöscht.`)) return;
      await api.removeUser(target.id);
      setUsers((previous) => previous.filter((item) => item.id !== target.id));
    });

  const logoutEverywhere = (): void => {
    void api.logoutAll().finally(() => window.location.assign("/"));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Tab" || !panel.current) return;
    const focusable = panel.current.querySelectorAll<HTMLElement>("button, textarea, input, summary, [href]");
    const firstEl = focusable[0];
    const lastEl = focusable[focusable.length - 1];
    if (!firstEl || !lastEl) return;
    if (event.shiftKey && document.activeElement === firstEl) {
      event.preventDefault();
      lastEl.focus();
    } else if (!event.shiftKey && document.activeElement === lastEl) {
      event.preventDefault();
      firstEl.focus();
    }
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await api.saveSettings({ customInstructions: instructions });
      onSave(saved);
      onClose();
    } catch (failure) {
      setSaveError(failure instanceof Error ? failure.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  };

  const dirty = instructions !== settings.customInstructions;

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        ref={panel}
        onKeyDown={onKeyDown}
      >
        <header>
          <h2 id="settings-title">Einstellungen</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Schließen">
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="modal-body">
          {!config.apiConfigured ? (
            <div className="banner error" role="alert">
              <p>Auf dem Server ist kein API_KEY gesetzt. Ohne Schlüssel kann Plaudi nicht antworten.</p>
            </div>
          ) : null}

          <section>
            <h3>Eigene Anweisungen</h3>
            <p className="hint">Gelten für alle Chats, zum Beispiel Anrede, Tonfall oder Hintergrundwissen über dich.</p>
            <textarea
              ref={first}
              value={instructions}
              maxLength={MAX_INSTRUCTIONS}
              rows={6}
              placeholder="Zum Beispiel: Antworte kurz und duze mich."
              onChange={(event) => setInstructions(event.target.value)}
            />
            <div className="counter">
              {instructions.length} / {MAX_INSTRUCTIONS}
            </div>
          </section>

          {user.role === "admin" ? (
            <section>
              <h3>Zugriff</h3>
              <p className="hint">Nur hier eingetragene Adressen können sich per E-Mail-Code anmelden.</p>
              <ul className="user-list">
                {users.map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>{item.email}</strong>
                      <span>
                        {item.role === "admin" ? "Administrator" : "Benutzer"}
                        {item.last_login ? ` · zuletzt ${new Date(item.last_login).toLocaleDateString("de-DE")}` : " · noch nie angemeldet"}
                      </span>
                    </div>
                    {item.id !== user.id ? (
                      <div className="row-actions">
                        <button type="button" className="text-button" onClick={() => void toggleRole(item)}>
                          {item.role === "admin" ? "Zum Benutzer" : "Zum Admin"}
                        </button>
                        <button type="button" className="text-button danger" onClick={() => void removeUser(item)}>
                          Entfernen
                        </button>
                      </div>
                    ) : (
                      <span className="hint">du</span>
                    )}
                  </li>
                ))}
              </ul>
              <form
                className="add-user"
                onSubmit={(event) => {
                  event.preventDefault();
                  void addUser();
                }}
              >
                <input
                  type="email"
                  value={newEmail}
                  placeholder="name@beispiel.de"
                  aria-label="Neue E-Mail-Adresse"
                  maxLength={254}
                  onChange={(event) => setNewEmail(event.target.value)}
                />
                <label className="inline-check">
                  <input type="checkbox" checked={newAdmin} onChange={(event) => setNewAdmin(event.target.checked)} />
                  <span>Admin</span>
                </label>
                <button type="submit" className="primary" disabled={!newEmail.trim()}>
                  Hinzufügen
                </button>
              </form>
              {userError ? <p className="over">{userError}</p> : null}
            </section>
          ) : null}

          <section>
            <h3>Konto</h3>
            <p className="hint">Angemeldet als {user.email}.</p>
            <button type="button" className="secondary fit" onClick={logoutEverywhere}>
              Auf allen Geräten abmelden
            </button>
          </section>

        </div>

        <footer>
          {saveError ? <span className="over">{saveError}</span> : <span />}
          <div className="footer-buttons">
            <button type="button" className="secondary" onClick={onClose}>
              Abbrechen
            </button>
            <button type="button" className="primary" onClick={() => void save()} disabled={saving || !dirty}>
              {saving ? "Speichere…" : "Speichern"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};
