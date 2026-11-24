# Betrieb mit Docker

## Start

```bash
cp .env.example .env
docker compose up -d --build
docker compose logs -f chatbot
```

Das Image baut Frontend und Backend in getrennten Stufen und enthält zur Laufzeit nur das Nötige. Der Prozess läuft als Benutzer `node`, das Dateisystem ist schreibgeschützt, nur `/data` (benanntes Volume `chatbot-data`) ist beschreibbar. Der Container hat einen Healthcheck auf `/api/health`.

Update: `git pull`, dann `docker compose up -d --build`. Die Daten bleiben im Volume erhalten.

## Umgebungsvariablen

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | leer | API-Schlüssel (Konto 1) |
| `ANTHROPIC_API_KEYS` | leer | Mehrere Schlüssel, komma-getrennt, optional `Name=Schlüssel`. Reihenfolge ist Priorität |
| `APP_PASSWORD` | leer | Aktiviert den Passwortschutz |
| `SESSION_SECRET` | automatisch | Schlüssel für das Sitzungscookie, sonst in `/data/session.secret` erzeugt |
| `COOKIE_SECURE` | `false` | Auf `true` setzen, wenn die Seite per HTTPS ausgeliefert wird |
| `TRUST_PROXY` | `false` | Anzahl vorgeschalteter Proxys (`1`), damit das Login-Limit die echte IP sieht |
| `HOST_PORT` | `3000` | Port auf dem Host (nur Compose) |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Modell |
| `CLAUDE_EFFORT` | `medium` | `low`, `medium`, `high`, `xhigh`, `max` |
| `MAX_TOKENS` | `64000` | Obergrenze je Antwort, Denken zählt mit |
| `ENABLE_FALLBACK` | `auto` | Serverseitiger Fallback bei Ablehnungen: `auto`, `true`, `false` |
| `TITLE_MODEL` | `claude-haiku-5-5` | Modell für Chat-Titel |
| `SHOW_THINKING` | `true` | Zusammenfassung des Denkprozesses anzeigen |
| `MEMORY_DAYS` | `3` | Länge des Gedächtnisfensters in Tagen |
| `CROSS_CHAT_MEMORY` | `true` | Startwert für die Erinnerung an andere Chats |
| `MAX_CONTEXT_CHARS` | `400000` | Verlaufsbudget je Anfrage in Zeichen |
| `MEMORY_DIGEST_CHARS` | `12000` | Budget des Auszugs aus anderen Chats |
| `MAX_MESSAGE_CHARS` | `100000` | Maximale Länge einer Nutzernachricht |
| `SYSTEM_PROMPT` | eingebaut | Ersetzt den Basisprompt |
| `TZ` | `Europe/Berlin` | Zeitzone für Datum im Prompt und Uhrzeiten |
| `PORT`, `DATA_DIR`, `PUBLIC_DIR` | `3000`, `/data`, `/app/public` | Im Image bereits passend gesetzt |

## Reverse Proxy

Antworten werden gestreamt. Der Proxy darf sie nicht puffern.

Caddy:

```
chat.example.de {
    reverse_proxy chatbot:3000 {
        flush_interval -1
    }
}
```

nginx:

```
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_read_timeout 3600s;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
}
```

Hinter HTTPS `COOKIE_SECURE=true` und `TRUST_PROXY=1` setzen.

## Backup

Alle Daten liegen in einer SQLite-Datei im Volume.

```bash
docker run --rm -v chatbot_chatbot-data:/data -v "$PWD":/backup busybox tar czf /backup/chatbot-backup.tgz -C /data .
```

Der Volume-Name ergibt sich aus dem Projektordner, `docker volume ls` zeigt ihn an. Zum Wiederherstellen das Archiv in ein leeres Volume entpacken.

## Sicherheit

- Ohne `APP_PASSWORD` kann jeder mit Netzwerkzugriff chatten und Kosten verursachen. Für alles außerhalb eines vertrauten Netzes das Passwort setzen und HTTPS verwenden.
- Ein Ausgabenlimit in der Anthropic Console begrenzt das Risiko zusätzlich.
- API-Schlüssel stehen nur in `.env` und werden nie an den Browser gesendet. `.env` ist in `.gitignore` eingetragen.
- Alle Chatinhalte der letzten Tage werden zur Beantwortung an die Anthropic-API gesendet.
