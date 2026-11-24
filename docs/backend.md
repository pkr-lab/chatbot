# Backend

Node.js 22, TypeScript, Express 5, `better-sqlite3`, `@anthropic-ai/sdk`. Quellcode in `backend/src`, Build nach `backend/dist`.

| Modul | Aufgabe |
| --- | --- |
| `config.ts` | Liest alle Umgebungsvariablen, validiert sie und liefert ein unveränderliches `config`-Objekt. Parst auch die Kontenliste |
| `db.ts` | Öffnet SQLite (WAL-Modus, Fremdschlüssel), legt das Schema an, kapselt alle SQL-Statements als vorbereitete Abfragen |
| `auth.ts` | Anmeldung per E-Mail-Code, serverseitige Sitzungen, Begrenzungen, Herkunftsschutz, Benutzerverwaltung |
| `mailer.ts` | Mailversand über Webhook, SMTP oder Konsole |
| `accounts.ts` | Konten-Pool: ein SDK-Client je Konto, Sperrzeiten, Rate-Limit-Werte aus den Antwort-Headern, Wechsel bei Limit |
| `llm.ts` | Streaming-Aufruf, Konto-Wiederholung, Titel-Erzeugung, Kontextfenster des Modells, Übersetzung von API-Fehlern |
| `prompt.ts` | Systemprompt und Verlauf je Chat |
| `chat-runner.ts` | Ablauf einer Antwort: SSE öffnen, streamen, speichern, Abbruch, Titel. Verwaltet laufende Antworten je Chat |
| `routes.ts` | REST-Endpunkte, Eingabevalidierung |
| `index.ts` | Express-Setup, Sicherheits-Header, Komprimierung und Caching statischer Dateien, SPA-Fallback, geordnetes Herunterfahren |

## Besonderheiten

- **Laufende Antworten** liegen in einer `Map` von Chat-ID auf `AbortController`. `POST /stop` bricht darüber ab. Trennt der Browser die Verbindung, läuft die Antwort weiter.
- **Heartbeat**: Alle 15 Sekunden wird ein SSE-Kommentar gesendet, damit Proxys die Verbindung nicht schließen.
- **Statische Dateien**: Dateien unter `/assets` sind inhaltsadressiert und werden mit `immutable` ein Jahr gecacht. `index.html` wird nie gecacht. Antworten werden gzip-komprimiert, die API (inklusive Streams) nicht.
- **Fehler** werden im Log mit Präfix `[llm]` oder `[chat-runner]` ausgegeben, dem Nutzer wird nur ein verständlicher Text gezeigt.
- **Herunterfahren**: `SIGTERM` schließt den Server und die Datenbank, nach spätestens 5 Sekunden wird beendet.
