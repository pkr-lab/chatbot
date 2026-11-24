import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api } from "../api";
import type { AppConfig, MemoryInfo, Settings } from "../types";
import { Icon } from "./Icon";

interface SettingsDialogProps {
  settings: Settings;
  config: AppConfig;
  onSave: (settings: Settings) => void;
  onClose: () => void;
}

const MAX_INSTRUCTIONS = 4000;

export const SettingsDialog = ({ settings, config, onSave, onClose }: SettingsDialogProps) => {
  const [instructions, setInstructions] = useState(settings.customInstructions);
  const [crossChat, setCrossChat] = useState(settings.crossChatMemory);
  const [memory, setMemory] = useState<MemoryInfo | null>(null);
  const [memoryError, setMemoryError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    first.current?.focus();
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    api
      .memory()
      .then(setMemory)
      .catch(() => setMemoryError(true));
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      onClose();
      return;
    }
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
      const saved = await api.saveSettings({ customInstructions: instructions, crossChatMemory: crossChat });
      onSave(saved);
      onClose();
    } catch (failure) {
      setSaveError(failure instanceof Error ? failure.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  };

  const dirty = instructions !== settings.customInstructions || crossChat !== settings.crossChatMemory;

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
              <p>Auf dem Server ist kein ANTHROPIC_API_KEY gesetzt. Ohne Schlüssel kann Claude nicht antworten.</p>
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

          <section>
            <h3>Gedächtnis</h3>
            <p className="hint">
              Innerhalb eines Chats kennt Claude den Verlauf der letzten {config.memoryDays} Tage. Ältere Nachrichten bleiben für dich sichtbar,
              werden aber nicht mehr an Claude gesendet.
            </p>
            <label className="switch">
              <input type="checkbox" checked={crossChat} onChange={(event) => setCrossChat(event.target.checked)} />
              <span className="track" aria-hidden="true" />
              <span>Auch aus anderen Chats der letzten {config.memoryDays} Tage erinnern</span>
            </label>
            {memoryError ? (
              <p className="hint">Gedächtnis konnte nicht geladen werden.</p>
            ) : memory ? (
              <details className="memory-preview">
                <summary>
                  Aktuell im Gedächtnis: {memory.chats} {memory.chats === 1 ? "Chat" : "Chats"}, {memory.messages}{" "}
                  {memory.messages === 1 ? "Nachricht" : "Nachrichten"}
                </summary>
                <pre>{memory.digest || "Keine Nachrichten in diesem Zeitraum."}</pre>
              </details>
            ) : null}
          </section>

          <section>
            <h3>Verbindung</h3>
            <dl className="facts">
              <dt>Modell</dt>
              <dd>{config.model}</dd>
              <dt>Denkaufwand</dt>
              <dd>{config.effort}</dd>
              <dt>Denkprozess anzeigen</dt>
              <dd>{config.showThinking ? "Ja" : "Nein"}</dd>
            </dl>
            <p className="hint">Diese Werte werden über Umgebungsvariablen des Servers festgelegt.</p>
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
