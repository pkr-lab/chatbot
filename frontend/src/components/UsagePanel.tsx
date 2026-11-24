import type { AccountUsage, LimitEntry } from "../types";
import { formatClock, formatCompact } from "../utils";
import { Icon } from "./Icon";

const statusText = (account: AccountUsage): string => {
  const until = account.until ? ` bis ${formatClock(account.until)} Uhr` : "";
  if (account.status === "limited") return `Limit erreicht${until}`;
  if (account.status === "credit") return `Guthaben leer${until}`;
  if (account.status === "invalid") return `Schlüssel ungültig${until}`;
  return account.active ? "aktiv" : "bereit";
};

const Meter = ({ label, entry, unit }: { label: string; entry: LimitEntry; unit: string }) => {
  if (entry.limit === null || entry.remaining === null) return null;
  const share = entry.limit > 0 ? entry.remaining / entry.limit : 0;
  const reset = entry.reset ? Date.parse(entry.reset) : NaN;
  return (
    <div className={`meter${share < 0.15 ? " low" : ""}`}>
      <div className="meter-row">
        <span>{label}</span>
        <span>
          {formatCompact(entry.remaining)} / {formatCompact(entry.limit)} {unit}
          {Number.isFinite(reset) ? ` · Reset ${formatClock(reset)}` : ""}
        </span>
      </div>
      <div className="bar">
        <i style={{ width: `${Math.max(0, Math.min(100, share * 100))}%` }} />
      </div>
    </div>
  );
};

export const UsagePanel = ({ accounts }: { accounts: AccountUsage[] }) => (
  <details className="usage">
    <summary>
      <Icon name="chevron" size={13} />
      <span>Nutzungslimit</span>
      <span className="usage-badge">{accounts.find((item) => item.active)?.name ?? "kein Konto"}</span>
    </summary>
    <div className="usage-body">
      {accounts.map((account) => (
        <section key={account.name} className={`account ${account.status}${account.active ? " active" : ""}`}>
          <header>
            <strong>{account.name}</strong>
            <span>{statusText(account)}</span>
          </header>
          {account.limits ? (
            <>
              <Meter label="Anfragen" entry={account.limits.requests} unit="" />
              <Meter label="Eingabe" entry={account.limits.inputTokens} unit="Token" />
              <Meter label="Ausgabe" entry={account.limits.outputTokens} unit="Token" />
            </>
          ) : (
            <p className="hint">Werte erscheinen nach der ersten Nachricht.</p>
          )}
        </section>
      ))}
    </div>
  </details>
);
