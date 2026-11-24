import { memo } from "react";
import type { Message } from "../types";
import { formatDateTime, formatTokens } from "../utils";
import { CopyButton } from "./CopyButton";
import { Icon } from "./Icon";
import { LazyMarkdown } from "./LazyMarkdown";

interface MessageItemProps {
  message: Message;
  showThinking: boolean;
  canRegenerate: boolean;
  onRegenerate: () => void;
}

export const Thinking = ({ text, open = false }: { text: string; open?: boolean }) => (
  <details className="thinking" open={open}>
    <summary>
      <Icon name="brain" size={15} />
      <span>Denkprozess</span>
      <Icon name="chevron" size={14} />
    </summary>
    <div className="thinking-body">{text}</div>
  </details>
);

const stopNote = (reason: string | null): string | null => {
  if (reason === "aborted") return "Antwort abgebrochen";
  if (reason === "max_tokens") return "Antwort wegen Token-Limit abgeschnitten";
  return null;
};

export const MessageItem = memo(({ message, showThinking, canRegenerate, onRegenerate }: MessageItemProps) => {
  if (message.role === "user") {
    return (
      <article className="message user" aria-label="Deine Nachricht">
        <div className="bubble">{message.content}</div>
        <div className="message-actions">
          <CopyButton text={message.content} />
        </div>
      </article>
    );
  }

  const note = stopNote(message.stop_reason);
  const meta = message.output_tokens ? `${formatTokens(message.output_tokens)} Tokens` : "";

  return (
    <article className="message assistant" aria-label="Antwort von Plaudi">
      {showThinking && message.thinking ? <Thinking text={message.thinking} /> : null}
      <LazyMarkdown text={message.content} />
      {note ? <p className="note">{note}</p> : null}
      <div className="message-actions">
        <CopyButton text={message.content} />
        {canRegenerate ? (
          <button type="button" className="icon-button" onClick={onRegenerate} aria-label="Neu generieren" title="Neu generieren">
            <Icon name="refresh" size={16} />
          </button>
        ) : null}
        <span className="meta" title={formatDateTime(message.created_at)}>
          {meta}
        </span>
      </div>
    </article>
  );
});

MessageItem.displayName = "MessageItem";
