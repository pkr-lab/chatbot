import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { prefersEnterForNewline } from "../utils";
import type { ChatContext } from "../types";
import { ContextMeter } from "./ContextMeter";
import { Icon } from "./Icon";

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string) => Promise<boolean>;
  onStop: () => void;
  generating: boolean;
  maxChars: number;
  focusKey: string;
  context: ChatContext | null;
}

export const Composer = ({ value, onChange, onSend, onStop, generating, maxChars, focusKey, context }: ComposerProps) => {
  const area = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 240)}px`;
  }, [value]);

  useEffect(() => {
    if (!prefersEnterForNewline()) area.current?.focus();
  }, [focusKey]);

  const tooLong = value.length > maxChars;
  const canSend = value.trim().length > 0 && !generating && !tooLong;

  const submit = async (): Promise<void> => {
    if (!canSend) return;
    if (await onSend(value)) onChange("");
    if (!prefersEnterForNewline()) area.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    if (prefersEnterForNewline()) return;
    event.preventDefault();
    void submit();
  };

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="composer-box">
        <textarea
          ref={area}
          value={value}
          rows={1}
          placeholder="Nachricht an Plaudi…"
          aria-label="Nachricht"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {generating ? (
          <button type="button" className="send stop" onClick={onStop} aria-label="Antwort stoppen" title="Antwort stoppen">
            <Icon name="stop" size={16} />
          </button>
        ) : (
          <button type="submit" className="send" disabled={!canSend} aria-label="Senden" title="Senden">
            <Icon name="send" size={18} />
          </button>
        )}
      </div>
      <div className="composer-foot">
        {tooLong ? (
          <span className="over">
            {value.length.toLocaleString("de-DE")} / {maxChars.toLocaleString("de-DE")} Zeichen
          </span>
        ) : (
          <ContextMeter context={context} />
        )}
      </div>
    </form>
  );
};
