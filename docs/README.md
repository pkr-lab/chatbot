# Plaudi: Dokumentation

Selbst gehosteter Chatbot mit Claude-Anbindung, Chatverlauf und Gedächtnis der letzten Tage. Das Projekt besteht aus einem Node.js-Backend (Express, SQLite), einem React-Frontend und läuft als einzelner Docker-Container.

| Dokument | Inhalt |
| --- | --- |
| [architektur.md](architektur.md) | Überblick, Verzeichnisstruktur, Datenfluss einer Nachricht |
| [claude-anbindung.md](claude-anbindung.md) | Wie die App mit Claude verbunden ist, Zugang, Parameter, Fehlerbehandlung, Kosten |
| [gedaechtnis.md](gedaechtnis.md) | Funktionsweise des 3-Tage-Gedächtnisses und chatübergreifende Erinnerung |
| [api.md](api.md) | REST-Schnittstelle und Server-Sent-Events-Protokoll |
| [backend.md](backend.md) | Module des Backends im Detail |
| [frontend.md](frontend.md) | Aufbau des Frontends, Zustandsverwaltung, Streaming |
| [anmeldung.md](anmeldung.md) | Anmeldung per E-Mail-Code, Benutzerverwaltung, Mail-Anbindung |
| [sicherheit.md](sicherheit.md) | Sicherheitsbewertung, Prüfergebnisse, Checkliste für den Betrieb im Internet |
| [deployment.md](deployment.md) | Docker, Compose, Umgebungsvariablen, Reverse Proxy, Backup, Sicherheit |
| [entwicklung.md](entwicklung.md) | Lokale Entwicklung, Build, Tests mit Mock-API |

## Schnellstart

```bash
cp .env.example .env
```

In `.env` den `ANTHROPIC_API_KEY`, `ADMIN_EMAIL` und die Mail-Anbindung eintragen.

```bash
docker compose up -d --build
```

Die Oberfläche ist danach unter `http://<server>:3000` erreichbar.
