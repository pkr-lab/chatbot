# Plaudi

Selbst gehosteter Chat: eigener Verlauf je Chat, Anzeige von Nutzungslimit und Kontext, automatischer Wechsel zwischen mehreren API-Konten. Läuft als einzelner Docker-Container.

```bash
cp .env.example .env
docker compose up -d --build
```

In `.env` `API_KEY`, `ADMIN_EMAIL` und die Mail-Anbindung eintragen. Die Anmeldung erfolgt per E-Mail-Code. Danach `http://<server>:3000` öffnen.

Die vollständige Dokumentation steht in [docs](docs/README.md).
