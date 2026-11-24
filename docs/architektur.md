# Architektur

## Überblick

```
Browser (React-SPA)
   │  REST (JSON) + SSE (Streaming)
   ▼
Express-Server (Node.js 22)
   ├─ Auth (E-Mail-Code, serverseitige Sitzungen, Benutzerverwaltung)
   ├─ REST-Routen  ──►  SQLite (better-sqlite3, /data/chatbot.sqlite)
   ├─ Chat-Runner  ──►  Messages-API des KI-Dienstes (offizielles SDK, Streaming)
   └─ statische Auslieferung des gebauten Frontends
```

Ein Container enthält alles. Das Frontend wird beim Image-Build kompiliert und vom Express-Server als statische Dateien ausgeliefert, deshalb gibt es keine CORS-Konfiguration und nur einen Port.

## Verzeichnisstruktur

```
.
├── backend/
│   └── src/
│       ├── index.ts        Server-Start, Header, statische Dateien, Shutdown
│       ├── config.ts       Umgebungsvariablen und Standardwerte
│       ├── db.ts           SQLite-Schema und alle Datenbankzugriffe
│       ├── auth.ts         Anmeldung, Sitzungen, Benutzerverwaltung
│       ├── mailer.ts       Mailversand (Webhook, SMTP)
│       ├── routes.ts       REST-Endpunkte
│       ├── chat-runner.ts  Ablauf einer Antwort inklusive Streaming und Abbruch
│       ├── llm.ts       Anbindung an die KI-API, Titel, Fehlertexte
│       └── prompt.ts       Systemprompt und Verlauf je Chat
├── frontend/
│   └── src/
│       ├── App.tsx         Anmeldung und Gesamtlayout
│       ├── api.ts          REST-Client und SSE-Parser
│       ├── hooks/          useChatApp (Zustand und Logik), useTheme
│       ├── components/     Sidebar, ChatView, Composer, Markdown, Einstellungen, Login
│       └── styles.css      Gesamtes Styling inklusive Dark Mode
├── docs/                   Diese Dokumentation
├── Dockerfile              Mehrstufiger Build
├── docker-compose.yml      Betrieb auf dem Homeserver
└── .env.example            Vorlage für die Konfiguration
```

## Datenmodell

| Tabelle | Spalten | Zweck |
| --- | --- | --- |
| `chats` | `id`, `user_id`, `title`, `pinned`, `created_at`, `updated_at` | Eine Unterhaltung |
| `messages` | `id`, `chat_id`, `role`, `content`, `thinking`, `stop_reason`, `model`, `input_tokens`, `output_tokens`, `created_at` | Einzelne Nachrichten, bei Löschung des Chats werden sie mitgelöscht |
| `users` | `id`, `email`, `role`, `created_at`, `last_login` | Freigeschaltete Adressen |
| `sessions` | `id` (Hash), `user_id`, `created_at`, `last_seen`, `expires_at`, `ip`, `user_agent` | Serverseitige Sitzungen |
| `login_codes` | `email`, `code_hash`, `expires_at`, `attempts` | Offene Einmalcodes, nur als Hash |
| `user_settings` | `user_id`, `key`, `value` | Eigene Anweisungen je Benutzer |
| `settings` | `key`, `value` | Globale Werte (Limit-Anzeige) |

Alle Zeitstempel sind Millisekunden seit 1970. Es werden nie Nachrichten automatisch gelöscht. Das Kontextbudget bestimmt nur, was an das Modell gesendet wird.

## Ablauf einer Nachricht

1. Das Frontend sendet `POST /api/chats/:id/messages`. Gibt es noch keinen Chat, legt es zuvor einen an.
2. Der Server speichert die Nutzernachricht und öffnet einen SSE-Stream.
3. `prompt.ts` baut aus der Datenbank den Systemprompt (Datum, eigene Anweisungen) und den Verlauf des Chats.
4. `llm.ts` ruft die KI-API im Streaming-Modus auf. Jeder Textabschnitt wird sofort als `delta`-Event an den Browser gereicht.
5. Nach Abschluss wird die Antwort gespeichert und als `done` gesendet. Beim ersten Austausch erzeugt ein kleines Modell zusätzlich einen Titel (`title`-Event).
6. Bricht die Verbindung zum Browser ab, läuft die Generierung auf dem Server zu Ende und die Antwort wird trotzdem gespeichert. Das Frontend lädt sie beim nächsten Abruf nach.

## Wichtige Entwurfsentscheidungen

- **Antwort überlebt Verbindungsabbrüche.** Mobilgeräte trennen Verbindungen im Hintergrund. Abbrechen geschieht ausschließlich über den Stopp-Button (`POST /api/chats/:id/stop`).
- **Ein Lauf pro Chat.** Eine zweite Anfrage im selben Chat erhält `409`.
- **Fehler werden nicht als Nachricht gespeichert.** Sie erscheinen als Hinweis mit Wiederholen-Schaltfläche und verfälschen den Verlauf nicht.
- **Denkprozess nur zur Anzeige.** Er wird gespeichert, aber nie an Plaudi zurückgesendet. Das ist erlaubt, weil keine Tool-Aufrufe im Spiel sind.
- **Keine Kommentare im Quelltext.** Diese Dokumentation ersetzt sie.
