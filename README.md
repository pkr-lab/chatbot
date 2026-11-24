# Plaudi

Selbst gehosteter Chat mit Claude: Chatverlauf, Gedächtnis der letzten 3 Tage, Anzeige von Nutzungslimit und Kontext, automatischer Wechsel zwischen mehreren API-Konten. Läuft als einzelner Docker-Container.

```bash
cp .env.example .env
docker compose up -d --build
```

In `.env` den `ANTHROPIC_API_KEY` eintragen und `APP_PASSWORD` setzen. Danach `http://<server>:3000` öffnen.

Die vollständige Dokumentation steht in [docs](docs/README.md).
