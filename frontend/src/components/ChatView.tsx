import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatError, Message, StreamState } from "../types";
import { greeting } from "../utils";
import { Icon } from "./Icon";
import { Logo } from "./Logo";
import { LazyMarkdown } from "./LazyMarkdown";
import { MessageItem, Thinking } from "./MessageItem";

interface ChatViewProps {
  messages: Message[];
  stream: StreamState | null;
  error: ChatError | null;
  loading: boolean;
  remoteBusy: boolean;
  showThinking: boolean;
  memoryDays: number;
  onRegenerate: () => void;
  onDismissError: () => void;
  onSuggestion: (text: string) => void;
}

const suggestions = [
  "Fasse mir die wichtigsten Punkte eines Themas zusammen, das ich dir gleich nenne.",
  "Hilf mir, einen Text sachlich und freundlich zu formulieren.",
  "Erkläre mir ein technisches Konzept Schritt für Schritt mit Beispiel.",
];

const Typing = ({ label }: { label: string }) => (
  <div className="typing" role="status">
    <span className="dots" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
    <span>{label}</span>
  </div>
);

export const ChatView = ({
  messages,
  stream,
  error,
  loading,
  remoteBusy,
  showThinking,
  memoryDays,
  onRegenerate,
  onDismissError,
  onSuggestion,
}: ChatViewProps) => {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const onScroll = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    const gap = element.scrollHeight - element.scrollTop - element.clientHeight;
    stick.current = gap < 96;
    setShowJump(gap > 260);
  }, []);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && stick.current) element.scrollTop = element.scrollHeight;
  }, [messages, stream?.text, stream?.thinking, error, remoteBusy]);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (stick.current) element.scrollTop = element.scrollHeight;
    });
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, []);

  const jump = (): void => {
    const element = scroller.current;
    if (element) element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  };

  const last = messages.at(-1);
  const generating = stream !== null || remoteBusy;
  const dangling = !error && !generating && !loading && last?.role === "user";
  const empty = messages.length === 0 && !generating && !loading && !error;

  return (
    <div className="chat-scroll" ref={scroller} onScroll={onScroll}>
      <div className="chat-column">
        {empty ? (
          <section className="empty">
            <Logo height={52} />
            <h1>{greeting()}</h1>
            <p>
              Ich erinnere mich an deine Unterhaltungen der letzten {memoryDays === 1 ? "24 Stunden" : `${memoryDays} Tage`}.
            </p>
            <div className="chips">
              {suggestions.map((text) => (
                <button key={text} type="button" className="chip" onClick={() => onSuggestion(text)}>
                  {text}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {loading && messages.length === 0 ? <Typing label="Lade Chat…" /> : null}

        {messages.map((message, index) => (
          <MessageItem
            key={message.id}
            message={message}
            showThinking={showThinking}
            canRegenerate={index === messages.length - 1 && message.role === "assistant" && !generating}
            onRegenerate={onRegenerate}
          />
        ))}

        {stream ? (
          <article className="message assistant streaming" aria-label="Claude schreibt">
            {showThinking && stream.thinking ? (
              <Thinking key={stream.text ? "closed" : "open"} text={stream.thinking} open={!stream.text} />
            ) : null}
            {stream.text ? <LazyMarkdown text={stream.text} /> : <Typing label={stream.thinking ? "Denkt nach…" : "Claude schreibt…"} />}
          </article>
        ) : null}

        {!stream && remoteBusy ? <Typing label="Antwort wird erstellt…" /> : null}

        {error ? (
          <div className="banner error" role="alert">
            <p>{error.message}</p>
            <div className="banner-actions">
              {last ? (
                <button type="button" className="text-button" onClick={onRegenerate}>
                  <Icon name="refresh" size={15} />
                  <span>Erneut versuchen</span>
                </button>
              ) : null}
              <button type="button" className="text-button" onClick={onDismissError}>
                Schließen
              </button>
            </div>
          </div>
        ) : null}

        {dangling ? (
          <div className="banner" role="status">
            <p>Zu dieser Nachricht gibt es noch keine Antwort.</p>
            <div className="banner-actions">
              <button type="button" className="text-button" onClick={onRegenerate}>
                <Icon name="refresh" size={15} />
                <span>Antwort erzeugen</span>
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {showJump ? (
        <button type="button" className="jump" onClick={jump} aria-label="Zum Ende springen">
          <Icon name="arrowDown" size={18} />
        </button>
      ) : null}
    </div>
  );
};
