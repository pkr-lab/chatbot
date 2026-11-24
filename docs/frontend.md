# Frontend

React 19, TypeScript, Vite. Quellcode in `frontend/src`, Build nach `frontend/dist`, im Image unter `/app/public`. Es gibt keine UI-Bibliothek, das gesamte Styling steht in `styles.css` und nutzt CSS-Variablen für Hell, Dunkel und Systemmodus.

## Dateien

| Datei | Aufgabe |
| --- | --- |
| `main.tsx` | Startet den Bootstrap-Request noch vor dem Rendern und lädt den Markdown-Chunk im Leerlauf vor |
| `App.tsx` | Zustände Laden, Anmeldung, Fehler, bereit. Das Layout (`Shell`) fügt Seitenleiste, Chat und Eingabe zusammen |
| `api.ts` | REST-Client, Bootstrap-Prefetch, SSE-Parser (`streamRequest`) |
| `hooks/useChatApp.ts` | Gesamte Logik: Chats, Nachrichten, Streaming, Abbruch, Wiederholen, Suche, Nutzung, Kontext |
| `hooks/useTheme.ts` | Hell, Dunkel oder System, gespeichert im `localStorage` |
| `components/Sidebar.tsx` | Logo, Chatliste mit Gruppen, Suche, Umbenennen, Anheften, Löschen |
| `components/UsagePanel.tsx` | Limits je Konto mit Balken und Reset-Zeit |
| `components/ContextMeter.tsx` | Kontextbelegung und Verlauf unter dem Eingabefeld |
| `components/ChatView.tsx` | Nachrichtenliste, Auto-Scroll, Leerzustand, Fehler- und Hinweisbanner |
| `components/Markdown.tsx` | Markdown mit GFM, Syntaxhervorhebung, Kopieren-Button an Codeblöcken |
| `components/SettingsDialog.tsx` | Eigene Anweisungen, Benutzerverwaltung, Abmelden auf allen Geräten |

## Ablauf und Zustand

- **Start**: `GET /api/bootstrap` liefert Konfiguration, Einstellungen, Chatliste, Nutzung und den geöffneten Chat in einer Anfrage. Ein `401` zeigt die Anmeldung.
- **Senden**: Die Nutzernachricht erscheint sofort (optimistisch, negative ID) und wird durch das `user`-Ereignis ersetzt.
- **Streaming**: Textteile werden gesammelt und höchstens einmal pro Bildschirmaktualisierung gerendert (`requestAnimationFrame`).
- **Verbindungsverlust**: Endet der Stream ohne `done`, `stopped` oder `error`, fragt das Frontend den Chat alle 1,5 Sekunden ab, bis `busy` falsch ist. Das gilt auch nach einem Neuladen während einer Antwort.
- **Wechsel des Chats während einer Antwort** bricht nichts ab. Die Seitenleiste zeigt einen pulsierenden Punkt am laufenden Chat.
- **Routing**: `/c/<id>` mit der History-API, der Server liefert für diese Pfade `index.html`.

## Ladezeit

- Nur der Kern (React, Layout) liegt im Hauptbündel (ca. 80 KB gzip). Markdown, Syntaxhervorhebung (ca. 100 KB gzip) und der Einstellungsdialog sind eigene Chunks. Bis der Markdown-Chunk da ist, wird der Text als einfacher Text angezeigt.
- Der Bootstrap-Request startet vor dem Rendern, es gibt keine Kaskade aus Einzelabfragen.
- Systemschriften, keine externen Anfragen. Das Logo hat feste Abmessungen und verursacht keinen Layoutsprung.
- Gehashte Assets mit `immutable`, gzip-Kompression, SQLite im WAL-Modus.

## Barrierefreiheit

Beschriftete Schaltflächen, sichtbarer Fokus, `role="dialog"` mit Fokusfalle und Escape im Einstellungsdialog, `role="alert"` bei Fehlern, reduzierte Animationen bei `prefers-reduced-motion`, ausreichende Kontraste in beiden Themes.

## Logo

`frontend/public/logo.png` wird oben links in der Seitenleiste (mobil in der Kopfzeile), auf den Anmelde- und Reset-Seiten, im Leerzustand und in den Mails verwendet. `favicon.png` und `apple-touch-icon.png` liegen daneben.

Ein Original bereitet `tools/prepare-logo` vor:

```bash
cd tools/prepare-logo
npm install
npm start -- /pfad/zum/original.png
```

Das Werkzeug schneidet Ränder ab, macht weißen Hintergrund transparent und schreibt `logo.png`, `favicon.png` und `apple-touch-icon.png` nach `frontend/public`. Danach `docker compose up -d --build`.
