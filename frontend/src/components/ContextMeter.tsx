import type { ChatContext } from "../types";
import { formatCompact } from "../utils";

export const ContextMeter = ({ context }: { context: ChatContext | null }) => {
  if (!context) return null;
  const share = Math.min(1, context.usedTokens / context.windowTokens);
  const percent = share < 0.01 && context.usedTokens > 0 ? "<1" : String(Math.round(share * 100));
  const trimmed = context.historyMessages < context.totalMessages;
  const title = [
    `Kontextfenster des Modells: ${context.usedTokens.toLocaleString("de-DE")} von ${context.windowTokens.toLocaleString("de-DE")} Token belegt.`,
    `Gedächtnis (${context.memoryDays} Tage): ${context.historyMessages} von ${context.totalMessages} Nachrichten werden an Claude gesendet.`,
    `Verlaufsbudget: ${context.historyChars.toLocaleString("de-DE")} von ${context.maxHistoryChars.toLocaleString("de-DE")} Zeichen.`,
  ].join("\n");
  return (
    <div className={`context${share > 0.8 ? " warn" : ""}`} title={title}>
      <div className="bar" role="progressbar" aria-label="Kontext" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
        <i style={{ width: `${Math.max(share * 100, context.usedTokens > 0 ? 1.5 : 0)}%` }} />
      </div>
      <span>
        Kontext {formatCompact(context.usedTokens)} / {formatCompact(context.windowTokens)} ({percent} %)
        {trimmed ? ` · Gedächtnis ${context.historyMessages}/${context.totalMessages} Nachr.` : ""}
      </span>
    </div>
  );
};
