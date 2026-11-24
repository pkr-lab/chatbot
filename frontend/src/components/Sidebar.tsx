import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { ThemeMode } from "../hooks/useTheme";
import type { AccountUsage, Chat } from "../types";
import { groupChats } from "../utils";
import { Icon } from "./Icon";
import { Logo } from "./Logo";
import { UsagePanel } from "./UsagePanel";

interface SidebarProps {
  chats: Chat[];
  searching: boolean;
  query: string;
  onQuery: (query: string) => void;
  activeId: string | null;
  generatingId: string | null;
  usage: AccountUsage[];
  open: boolean;
  memoryDays: number;
  userEmail: string;
  themeMode: ThemeMode;
  onCycleTheme: () => void;
  onSelect: (id: string | null) => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
  onOpenSettings: () => void;
  onLogout: () => void;
  onClose: () => void;
}

const themeLabels: Record<ThemeMode, string> = {
  system: "Design: System",
  light: "Design: Hell",
  dark: "Design: Dunkel",
};

const themeIcons = { system: "monitor", light: "sun", dark: "moon" } as const;

interface ItemProps {
  chat: Chat;
  active: boolean;
  generating: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
}

const ChatItem = ({ chat, active, generating, onSelect, onRename, onPin, onDelete }: ItemProps) => {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(chat.title);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);

  const commit = (): void => {
    setEditing(false);
    const trimmed = title.trim();
    if (trimmed && trimmed !== chat.title) onRename(chat.id, trimmed);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") commit();
    if (event.key === "Escape") {
      setTitle(chat.title);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <li className="chat-item editing">
        <input
          ref={input}
          value={title}
          maxLength={120}
          aria-label="Chat umbenennen"
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
        />
      </li>
    );
  }

  return (
    <li className={`chat-item${active ? " active" : ""}`}>
      <button type="button" className="chat-link" onClick={() => onSelect(chat.id)} aria-current={active ? "page" : undefined}>
        {chat.pinned ? <Icon name="pin" size={13} /> : null}
        <span className="chat-title">{chat.title}</span>
        {generating ? <span className="pulse" role="status" aria-label="Antwort läuft" /> : null}
      </button>
      <div className="chat-actions">
        <button
          type="button"
          className="icon-button small"
          onClick={() => {
            setTitle(chat.title);
            setEditing(true);
          }}
          aria-label="Umbenennen"
          title="Umbenennen"
        >
          <Icon name="pencil" size={14} />
        </button>
        <button
          type="button"
          className="icon-button small"
          onClick={() => onPin(chat.id, !chat.pinned)}
          aria-label={chat.pinned ? "Loslösen" : "Anheften"}
          title={chat.pinned ? "Loslösen" : "Anheften"}
        >
          <Icon name="pin" size={14} />
        </button>
        <button
          type="button"
          className="icon-button small danger"
          onClick={() => {
            if (window.confirm(`Chat „${chat.title}“ endgültig löschen?`)) onDelete(chat.id);
          }}
          aria-label="Löschen"
          title="Löschen"
        >
          <Icon name="trash" size={14} />
        </button>
      </div>
    </li>
  );
};

export const Sidebar = ({
  chats,
  searching,
  query,
  onQuery,
  activeId,
  generatingId,
  usage,
  open,
  memoryDays,
  userEmail,
  themeMode,
  onCycleTheme,
  onSelect,
  onRename,
  onPin,
  onDelete,
  onOpenSettings,
  onLogout,
  onClose,
}: SidebarProps) => {
  const groups = useMemo(() => (searching ? [{ label: "Suchergebnisse", items: chats }] : groupChats(chats)), [chats, searching]);

  return (
    <>
      <div className={`scrim${open ? " visible" : ""}`} onClick={onClose} aria-hidden="true" />
      <aside className={`sidebar${open ? " open" : ""}`} aria-label="Chats">
        <div className="sidebar-top">
          <div className="brand">
            <Logo height={32} />
          </div>
          <button type="button" className="icon-button close-sidebar" onClick={onClose} aria-label="Seitenleiste schließen">
            <Icon name="close" size={18} />
          </button>
        </div>

        <button type="button" className="new-chat" onClick={() => onSelect(null)}>
          <Icon name="plus" size={17} />
          <span>Neuer Chat</span>
        </button>

        <label className="search">
          <Icon name="search" size={15} />
          <input
            type="search"
            value={query}
            placeholder="Chats durchsuchen"
            aria-label="Chats durchsuchen"
            onChange={(event) => onQuery(event.target.value)}
          />
        </label>

        <nav className="chat-list" aria-label="Chatverlauf">
          {groups.length === 0 ? (
            <p className="list-empty">{searching ? "Keine Treffer." : "Noch keine Chats."}</p>
          ) : (
            groups.map((group) => (
              <section key={group.label}>
                <h2>{group.label}</h2>
                <ul>
                  {group.items.map((chat) => (
                    <ChatItem
                      key={chat.id}
                      chat={chat}
                      active={chat.id === activeId}
                      generating={chat.id === generatingId}
                      onSelect={onSelect}
                      onRename={onRename}
                      onPin={onPin}
                      onDelete={onDelete}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </nav>

        {usage.length > 0 ? <UsagePanel accounts={usage} /> : null}

        <div className="whoami" title={userEmail}>
          {userEmail}
        </div>

        <div className="sidebar-foot">
          <button type="button" className="memory-chip" onClick={onOpenSettings} title="Gedächtnis und Einstellungen">
            <Icon name="brain" size={15} />
            <span>Gedächtnis: {memoryDays === 1 ? "24 Stunden" : `${memoryDays} Tage`}</span>
          </button>
          <div className="foot-buttons">
            <button type="button" className="icon-button" onClick={onOpenSettings} aria-label="Einstellungen" title="Einstellungen">
              <Icon name="settings" size={18} />
            </button>
            <button type="button" className="icon-button" onClick={onCycleTheme} aria-label={themeLabels[themeMode]} title={themeLabels[themeMode]}>
              <Icon name={themeIcons[themeMode]} size={18} />
            </button>
            <button type="button" className="icon-button" onClick={onLogout} aria-label="Abmelden" title="Abmelden">
              <Icon name="logout" size={18} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};
