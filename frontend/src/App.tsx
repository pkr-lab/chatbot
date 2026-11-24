import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { api, ApiError, loadBootstrap } from "./api";
import { ChatView } from "./components/ChatView";
import { Composer } from "./components/Composer";
import { Icon } from "./components/Icon";
import { Login } from "./components/Login";
import { Logo } from "./components/Logo";
import { Sidebar } from "./components/Sidebar";
import { useChatApp } from "./hooks/useChatApp";
import { useTheme } from "./hooks/useTheme";
import type { Bootstrap } from "./types";
import { modelLabel } from "./utils";

const SettingsDialog = lazy(() => import("./components/SettingsDialog").then((module) => ({ default: module.SettingsDialog })));

interface ShellProps {
  initial: Bootstrap;
  onLoggedOut: () => void;
}

const Shell = ({ initial, onLoggedOut }: ShellProps) => {
  const app = useChatApp(initial, onLoggedOut);
  const authRequired = initial.authRequired;
  const theme = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const { config, settings } = app;
  const visibleStream = app.stream && app.stream.chatId === app.activeId ? app.stream : null;
  const visibleError = app.error && app.error.chatId === (app.activeId ?? "new") ? app.error : null;
  const generating = visibleStream !== null || app.remoteBusy;

  const select = useCallback(
    (id: string | null) => {
      setSidebarOpen(false);
      app.openChat(id);
    },
    [app],
  );

  const logout = useCallback(() => {
    void api.logout().finally(onLoggedOut);
  }, [onLoggedOut]);

  const title = app.activeChat?.title ?? "Neuer Chat";

  return (
    <div className="app">
      <Sidebar
        chats={app.visibleChats}
        searching={app.searching}
        query={app.query}
        onQuery={app.setQuery}
        activeId={app.activeId}
        generatingId={app.streamingChatId}
        open={sidebarOpen}
        usage={app.usage}
        memoryDays={config.memoryDays}
        authRequired={authRequired}
        themeMode={theme.mode}
        onCycleTheme={theme.cycle}
        onSelect={select}
        onRename={(id, value) => void app.rename(id, value)}
        onPin={(id, pinned) => void app.pin(id, pinned)}
        onDelete={(id) => void app.remove(id)}
        onOpenSettings={() => {
          setSidebarOpen(false);
          setSettingsOpen(true);
        }}
        onLogout={logout}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="main">
        <header className="topbar">
          <button type="button" className="icon-button menu" onClick={() => setSidebarOpen(true)} aria-label="Seitenleiste öffnen">
            <Icon name="menu" size={20} />
          </button>
          <span className="topbar-logo">
            <Logo height={24} />
          </span>
          <h1 className="topbar-title">{title}</h1>
          <span className="model-badge">{modelLabel(config.model)}</span>
          <button type="button" className="icon-button menu" onClick={() => select(null)} aria-label="Neuer Chat">
            <Icon name="plus" size={20} />
          </button>
        </header>

        {!config.apiConfigured ? (
          <div className="banner error top" role="alert">
            <p>Kein ANTHROPIC_API_KEY auf dem Server gesetzt. Claude kann so nicht antworten.</p>
          </div>
        ) : null}

        {app.notice ? (
          <div className="banner notice" role="status">
            <p>{app.notice}</p>
            <button type="button" className="text-button" onClick={app.dismissNotice}>
              OK
            </button>
          </div>
        ) : null}

        <ChatView
          key={app.activeId ?? "new"}
          messages={app.messages}
          stream={visibleStream}
          error={visibleError}
          loading={app.loading}
          remoteBusy={app.remoteBusy}
          showThinking={config.showThinking}
          memoryDays={config.memoryDays}
          onRegenerate={() => void app.regenerate()}
          onDismissError={app.dismissError}
          onSuggestion={setDraft}
        />

        <Composer
          value={draft}
          onChange={setDraft}
          onSend={app.send}
          onStop={() => void app.stop()}
          generating={generating}
          maxChars={config.maxMessageChars}
          focusKey={app.activeId ?? "new"}
          context={app.context}
        />
      </main>

      {settingsOpen ? (
        <Suspense fallback={null}>
          <SettingsDialog settings={settings} config={config} onSave={app.setSettings} onClose={() => setSettingsOpen(false)} />
        </Suspense>
      ) : null}
    </div>
  );
};

type AuthState = { kind: "loading" } | { kind: "login" } | { kind: "error" } | { kind: "ready"; data: Bootstrap };

export const App = () => {
  const [state, setState] = useState<AuthState>({ kind: "loading" });

  const load = useCallback(() => {
    loadBootstrap().then(
      (data) => setState({ kind: "ready", data }),
      (failure: unknown) => setState({ kind: failure instanceof ApiError && failure.status === 401 ? "login" : "error" }),
    );
  }, []);

  useEffect(load, [load]);

  const loggedOut = useCallback(() => setState({ kind: "login" }), []);

  if (state.kind === "loading") {
    return (
      <div className="splash" role="status" aria-label="Lade">
        <Logo height={40} />
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <main className="login">
        <div className="form-like">
          <Logo height={40} />
          <h1>Server nicht erreichbar</h1>
          <p>Der Server antwortet nicht.</p>
          <button
            type="button"
            className="primary"
            onClick={() => {
              setState({ kind: "loading" });
              load();
            }}
          >
            Erneut versuchen
          </button>
        </div>
      </main>
    );
  }
  if (state.kind === "login") {
    return (
      <Login
        onSuccess={() => {
          setState({ kind: "loading" });
          load();
        }}
      />
    );
  }
  return <Shell initial={state.data} onLoggedOut={loggedOut} />;
};
