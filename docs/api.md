# API

Alle Pfade liegen unter `/api`. Anfragen und Antworten sind JSON, Fehler haben die Form `{ "error": "Text" }`. Alle Pfade außer `/api/health` und `/api/auth/*` benötigen ein gültiges Sitzungscookie, sonst antwortet der Server mit `401`. Chats, Einstellungen und Gedächtnis gehören jeweils einem Benutzer, fremde Chats ergeben `404`. Pfade unter `/api/admin` verlangen die Rolle Administrator (`403` sonst).

## Allgemein

| Methode | Pfad | Beschreibung |
| --- | --- | --- |
| GET | `/api/health` | `{ ok, authRequired, apiConfigured, chats, messages }`, ohne Anmeldung, auch für den Docker-Healthcheck |
| GET | `/api/bootstrap` | Alles für den Seitenstart in einer Anfrage: `{ authRequired, config, settings, chats, usage, detail }`. Mit `?chat=<id>` enthält `detail` zusätzlich Nachrichten, `busy` und `context` |
| GET | `/api/usage` | Konten mit `{ name, active, status, until, limits }`, ohne Schlüssel |
| GET | `/api/config` | `{ showThinking, maxMessageChars, apiConfigured, accountCount }` |
| GET | `/api/settings` | `{ customInstructions }` |
| PUT | `/api/settings` | Teilweise aktualisieren, Felder wie oben. Anweisungen höchstens 4000 Zeichen |

## Anmeldung

| Methode | Pfad | Beschreibung |
| --- | --- | --- |
| GET | `/api/auth/me` | `{ authenticated, user? }` |
| POST | `/api/auth/login` | `{ email, password }`. Bei Erfolg `{ step: "code", challenge, ttlMinutes }` und Code per Mail, noch keine Sitzung. Falsch: `401` mit verbleibenden Versuchen, gesperrt: `423` mit `lockedUntil` |
| POST | `/api/auth/verify` | `{ email, code, challenge }`. Bei Erfolg Cookie, sonst `401` oder `423` |
| POST | `/api/auth/forgot` | `{ email }`, antwortet immer `202`. Nur für bekannte Adressen geht ein Link raus |
| POST | `/api/auth/reset` | `{ token, password }`. Setzt das Passwort, beendet alle Sitzungen, hebt die Sperre auf |
| POST | `/api/auth/password` | Angemeldet: `{ current, next }`. Beendet alle anderen Sitzungen, nach 3 falschen Eingaben `423` |
| POST | `/api/auth/logout` | Beendet die Sitzung serverseitig und löscht das Cookie |
| POST | `/api/auth/logout-all` | Beendet alle Sitzungen des Benutzers |

## Benutzerverwaltung (nur Administratoren)

| Methode | Pfad | Beschreibung |
| --- | --- | --- |
| GET | `/api/admin/users` | Liste der freigeschalteten Benutzer |
| POST | `/api/admin/users` | `{ email, role? }`, `201`, bei vorhandener Adresse `409` |
| PATCH | `/api/admin/users/:id` | `{ role }`, der letzte Administrator kann nicht herabgestuft werden |
| POST | `/api/admin/users/:id/reset-password` | Altes Passwort ungültig, Sitzungen beendet, Sperre aufgehoben, Link per Mail. Antwort enthält `link` |
| POST | `/api/admin/users/:id/unlock` | Hebt die Sperre auf |
| POST | `/api/admin/users/:id/invite` | Sendet eine Einladung zum Festlegen des Passworts |
| DELETE | `/api/admin/users/:id` | Entfernt Benutzer, Sitzungen und alle Chats. Nicht sich selbst, nicht den letzten Administrator |

## Chats

| Methode | Pfad | Beschreibung |
| --- | --- | --- |
| GET | `/api/chats` | Alle Chats, angeheftete zuerst, dann nach letzter Änderung. Mit `?q=Text` Suche in Titeln und Nachrichten, höchstens 50 Treffer |
| POST | `/api/chats` | Neuen Chat mit Titel „Neuer Chat“ anlegen, Antwort `201` |
| GET | `/api/chats/:id` | `{ chat, messages, busy }`. `busy` ist `true`, solange eine Antwort generiert wird |
| PATCH | `/api/chats/:id` | `{ title?, pinned? }`, Titel höchstens 120 Zeichen |
| DELETE | `/api/chats/:id` | Löscht Chat und Nachrichten, `204`. Während einer Antwort `409` |
| POST | `/api/chats/:id/messages` | Nachricht senden, Antwort als SSE-Stream (siehe unten) |
| POST | `/api/chats/:id/regenerate` | Letzte Antwort verwerfen und neu erzeugen, ebenfalls als SSE-Stream. Funktioniert auch, wenn die letzte Nachricht noch unbeantwortet ist |
| GET | `/api/chats/:id/context` | `{ usedTokens, windowTokens, historyMessages, totalMessages, historyChars, maxHistoryChars }` |
| POST | `/api/chats/:id/stop` | Laufende Generierung abbrechen, `{ stopped: boolean }` |

`:id` ist eine UUID, andere Werte ergeben `400`. Unbekannte Chats ergeben `404`.

### Nachricht senden

Body: `{ "content": "Text" }`.

Mögliche Fehlercodes vor Beginn des Streams:

| Code | Ursache |
| --- | --- |
| 400 | Nachricht leer |
| 404 | Chat nicht gefunden |
| 409 | Im Chat läuft bereits eine Antwort |
| 413 | Nachricht länger als `MAX_MESSAGE_CHARS` |

## Streaming-Protokoll (SSE)

Die Antwort hat den Typ `text/event-stream`. Jedes Ereignis besteht aus `event:` und einer JSON-Zeile `data:`. Zeilen, die mit `:` beginnen, sind Keep-Alive-Kommentare (alle 15 Sekunden) und werden ignoriert.

| Ereignis | Daten | Bedeutung |
| --- | --- | --- |
| `user` | Nachrichtenobjekt | Die gespeicherte Nutzernachricht, nur bei `/messages` |
| `thinking` | `{ text }` | Teil der Zusammenfassung des Denkprozesses |
| `delta` | `{ text }` | Teil der Antwort |
| `done` | `{ message, chat, fallbackUsed, account }` | Antwort gespeichert, Ende des Laufs |
| `stopped` | `{ message, chat }` | Nach `stop`. `message` ist `null`, wenn noch kein Text vorlag |
| `switch` | `{ from, to }` | Konto wegen Limit gewechselt |
| `title` | `{ id, title }` | Neuer Titel nach dem ersten Austausch, kommt nach `done` |
| `error` | `{ message }` | Fehler oder Ablehnung, es wird keine Antwort gespeichert |

`done`, `stopped` und `error` beenden den Lauf aus Sicht des Chats. Danach darf sofort die nächste Nachricht gesendet werden, auch wenn `title` noch aussteht.

Beispiel:

```
event: user
data: {"id":1,"role":"user","content":"Hallo",...}

event: delta
data: {"text":"Hallo! "}

event: done
data: {"message":{...},"chat":{...},"fallbackUsed":false}

event: title
data: {"id":"...","title":"Begrüßung"}
```

## Nachrichtenobjekt

| Feld | Typ | Beschreibung |
| --- | --- | --- |
| `id` | Zahl | Fortlaufend, bestimmt die Reihenfolge |
| `chat_id` | Text | UUID des Chats |
| `role` | `user` oder `assistant` | Absender |
| `content` | Text | Inhalt als Markdown |
| `thinking` | Text oder `null` | Zusammenfassung des Denkprozesses |
| `stop_reason` | Text oder `null` | `end_turn`, `max_tokens` oder `aborted` |
| `model` | Text oder `null` | Modell, das geantwortet hat |
| `input_tokens`, `output_tokens` | Zahl oder `null` | Verbrauch der Anfrage |
| `created_at` | Zahl | Millisekunden seit 1970 |

## Sicherheit der Schnittstelle

- Das Cookie ist `HttpOnly` und `SameSite=Strict`, hinter HTTPS zusätzlich `Secure` mit Präfix `__Host-`. Schreibende Anfragen mit fremder `Origin` oder `Sec-Fetch-Site: cross-site` werden mit `403` abgelehnt.
- Codes werden zeitkonstant verglichen. API-Antworten sind `no-store`.
- Antwortheader setzen eine strenge Content-Security-Policy, `X-Frame-Options: DENY` und `nosniff`.
- Markdown aus Antworten wird ohne rohes HTML gerendert, Skripte im Text bleiben Text.
