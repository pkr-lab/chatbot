# Entwicklung

## Voraussetzungen

Node.js 22 oder neuer. Docker ist nur für das Image nötig.

## Lokal starten

```bash
npm run install:all
API_KEY=sk-ant-... npm run dev:backend
npm run dev:frontend
```

Das Backend läuft auf Port 3000, Vite auf 5173 und leitet `/api` an das Backend weiter. Daten liegen in `backend/data`.

## Build und Prüfung

```bash
npm run typecheck
npm run build
```

Nach dem Build kann das Backend mit `PUBLIC_DIR=../frontend/dist node backend/dist/index.js` das Frontend selbst ausliefern.

## Test ohne echten Schlüssel

`API_BASE_URL` leitet das SDK auf einen beliebigen Server um. Für Tests eignet sich ein kleiner Mock, der das SSE-Format der Messages-API nachbildet (`message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`) und für bestimmte Schlüssel `429` mit `retry-after` liefert. Damit lassen sich Streaming, Gedächtnis, Abbruch, Ablehnung, Kontowechsel und Rate-Limit-Header prüfen, ohne Kosten zu verursachen.

## Konventionen

- Keine Kommentare im Quelltext, Erklärungen stehen in dieser Dokumentation.
- Benennungen und Oberflächentexte sind deutsch bzw. englisch im Code, deutsch in der Oberfläche.
- Neue Umgebungsvariablen werden in `config.ts` ergänzt und in [deployment.md](deployment.md) dokumentiert.
