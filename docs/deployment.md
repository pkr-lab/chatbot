# Betrieb mit Docker

## Start

```bash
cp .env.example .env
docker compose up -d --build
docker compose logs -f chatbot
```

Das Image baut Frontend und Backend in getrennten Stufen und enthält zur Laufzeit nur das Nötige. Der Prozess läuft als Benutzer `node`, das Dateisystem ist schreibgeschützt, nur `/data` (benanntes Volume `chatbot-data`) ist beschreibbar. Der Container hat einen Healthcheck auf `/api/health`.

Update: `git pull`, dann `docker compose up -d --build`. Die Daten bleiben im Volume erhalten.

## Betrieb ohne Docker (systemd)

Die App ist ein einzelner Node-Prozess und braucht kein Docker. Voraussetzung ist Node.js 22 oder neuer.

Einrichten (als root):

```bash
useradd --system --home /opt/plaudi --shell /usr/sbin/nologin plaudi
git clone <repo-url> /opt/plaudi
cd /opt/plaudi
npm run install:all
npm run build
mkdir -p /var/lib/plaudi /etc/plaudi
chown -R plaudi:plaudi /var/lib/plaudi
cp .env.example /etc/plaudi/plaudi.env
chown root:plaudi /etc/plaudi/plaudi.env
chmod 640 /etc/plaudi/plaudi.env
```

In `/etc/plaudi/plaudi.env` die Werte eintragen. In dieser Datei stehen die Zeilen ohne Anführungszeichen und ohne `export`. Die Pfade setzt die Unit.

Unit `/etc/systemd/system/plaudi.service`:

```ini
[Unit]
Description=Plaudi
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=plaudi
Group=plaudi
WorkingDirectory=/opt/plaudi
EnvironmentFile=/etc/plaudi/plaudi.env
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=DATA_DIR=/var/lib/plaudi
Environment=PUBLIC_DIR=/opt/plaudi/frontend/dist
ExecStart=/usr/bin/node /opt/plaudi/backend/dist/index.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=15
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=true
LockPersonality=true
SystemCallArchitectures=native
ReadWritePaths=/var/lib/plaudi
MemoryMax=512M

[Install]
WantedBy=multi-user.target
```

Starten und prüfen:

```bash
systemctl daemon-reload
systemctl enable --now plaudi
systemctl status plaudi
journalctl -u plaudi -f
curl http://127.0.0.1:3000/api/health
```

Update:

```bash
cd /opt/plaudi
git pull
npm run install:all
npm run build
systemctl restart plaudi
```

Hinweise:

- Der Pfad zu `node` kann abweichen (`which node`). Bei Installation über nvm den vollen Pfad eintragen oder Node systemweit installieren.
- Die Datenbank liegt in `/var/lib/plaudi`. Backup: Dienst kurz stoppen und den Ordner kopieren, oder die Datei `chatbot.sqlite` mit `sqlite3 chatbot.sqlite ".backup backup.sqlite"` sichern.
- `MemoryMax=512M` ist großzügig, der Dienst braucht im Betrieb etwa 100 bis 150 MB.
- Der Dienst lauscht auf Port 3000. Für den Zugriff aus dem Internet wie im Abschnitt Reverse Proxy beschrieben einen Proxy mit HTTPS davorsetzen und den Port nur lokal erreichbar lassen.
- Nur eine Instanz betreiben. Sperren, Limits und laufende Antworten werden nicht zwischen Instanzen geteilt.

## Umgebungsvariablen

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `API_KEY` | leer | API-Schlüssel (Konto 1) |
| `API_KEYS` | leer | Mehrere Schlüssel, komma-getrennt, optional `Name=Schlüssel`. Reihenfolge ist Priorität |
| `ADMIN_PASSWORD` | leer | Startpasswort des ersten Administrators, wird nur gesetzt, wenn noch keins existiert |
| `PUBLIC_URL` | `http://localhost:3000` | Öffentliche Adresse für Links in Mails. Im Betrieb zwingend setzen |
| `RESET_TTL_MINUTES`, `INVITE_TTL_HOURS` | `30`, `24` | Gültigkeit von Reset- und Einladungslinks |
| `MAX_LOGIN_FAILURES`, `LOCK_HOURS` | `3`, `24` | Fehlversuche bis zur Sperre und Dauer der Sperre |
| `PASSWORD_MIN_LENGTH` | `10` | Mindestlänge neuer Passwörter |
| `ADMIN_EMAIL` | leer | **Pflicht beim ersten Start.** Erster Administrator, wird bei jedem Start sichergestellt |
| `MAIL_TRANSPORT` | automatisch | `webhook`, `smtp` oder `console` (nur Test, schreibt Codes ins Log) |
| `MAIL_WEBHOOK_URL`, `MAIL_WEBHOOK_TOKEN` | leer | Anbindung an einen bestehenden Mail-Dienst, siehe [anmeldung.md](anmeldung.md) |
| `MAIL_FROM` | `Plaudi <no-reply@localhost>` | Absender |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE` | leer, `587`, leer, leer, `false` | SMTP-Zugang, STARTTLS wird erzwungen |
| `SESSION_IDLE_HOURS`, `SESSION_MAX_HOURS` | `3`, `24` | Inaktivität, nach der eine Sitzung abläuft, und absolute Höchstdauer |
| `CODE_TTL_MINUTES` | `10` | Gültigkeit eines Codes |
| `CODE_RESEND_SECONDS` | `30` | Wartezeit zwischen zwei Codes je Adresse |
| `CODE_REQUESTS_PER_HOUR` | `5` | Codes pro Adresse und Stunde |
| `SESSION_SECRET` | automatisch | Geheimnis zum Hashen der Codes (mind. 32 Zeichen), sonst in `/data/session.secret` erzeugt |
| `COOKIE_SECURE` | `false` | Auf `true` setzen, wenn die Seite per HTTPS ausgeliefert wird |
| `TRUST_PROXY` | `false` | Anzahl vorgeschalteter Proxys (`1`), damit das Login-Limit die echte IP sieht |
| `HOST_PORT` | `3000` | Port auf dem Host (nur Compose) |
| `AI_MODEL` | `claude-opus-5-5` | Modell |
| `AI_EFFORT` | `medium` | `low`, `medium`, `high`, `xhigh`, `max` |
| `MAX_TOKENS` | `64000` | Obergrenze je Antwort, Denken zählt mit |
| `ENABLE_FALLBACK` | `auto` | Serverseitiger Fallback bei Ablehnungen: `auto`, `true`, `false` |
| `TITLE_MODEL` | `claude-haiku-5-5` | Modell für Chat-Titel |
| `SHOW_THINKING` | `true` | Zusammenfassung des Denkprozesses anzeigen |
| `MAX_CONTEXT_CHARS` | `400000` | Verlaufsbudget je Anfrage in Zeichen |
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

Hinter HTTPS `COOKIE_SECURE=true` und `TRUST_PROXY=1` setzen. Ohne `TRUST_PROXY` sieht der Server nur die IP des Proxys, und die Begrenzungen gelten dann für alle Nutzer gemeinsam. Der Proxy muss `Host` unverändert weiterreichen, sonst lehnt der Herkunftsschutz Anfragen ab.

## Backup

Alle Daten liegen in einer SQLite-Datei im Volume.

```bash
docker run --rm -v chatbot_chatbot-data:/data -v "$PWD":/backup busybox tar czf /backup/chatbot-backup.tgz -C /data .
```

Der Volume-Name ergibt sich aus dem Projektordner, `docker volume ls` zeigt ihn an. Zum Wiederherstellen das Archiv in ein leeres Volume entpacken.

## Sicherheit

- Der Zugang ist immer geschützt. Für den Betrieb im Internet ist HTTPS Pflicht, siehe [sicherheit.md](sicherheit.md).
- Ein Ausgabenlimit in der Konsole des KI-Anbieters begrenzt das Risiko zusätzlich.
- API-Schlüssel stehen nur in `.env` und werden nie an den Browser gesendet. `.env` ist in `.gitignore` eingetragen.
- Alle Chatinhalte werden zur Beantwortung an die KI-API gesendet.
