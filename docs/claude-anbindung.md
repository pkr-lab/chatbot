# Anbindung an Claude

## Zugang: API-Schlüssel

Der Chatbot spricht Claude über die offizielle **Anthropic Messages API** an. Dafür wird ein API-Schlüssel benötigt:

1. Konto in der Anthropic Console anlegen (`console.anthropic.com`).
2. Unter *API keys* einen Schlüssel erzeugen.
3. Guthaben aufladen oder eine Zahlungsmethode hinterlegen. Die Abrechnung erfolgt nutzungsbasiert pro Token.
4. Den Schlüssel als `ANTHROPIC_API_KEY` in `.env` eintragen.

Ein Abo von claude.ai (Free, Pro, Max) ist ein separates Produkt und enthält keinen API-Zugang. Die API wird getrennt über die Console abgerechnet. Empfehlenswert ist ein monatliches Ausgabenlimit in der Console, falls der Chatbot erreichbar ist.

Das SDK liest neben `ANTHROPIC_API_KEY` auch `ANTHROPIC_AUTH_TOKEN` und `ANTHROPIC_BASE_URL`. Letzteres erlaubt zum Beispiel einen Proxy oder eine Mock-API für Tests.

## Mehrere Konten und automatischer Wechsel

Über `ANTHROPIC_API_KEYS` lassen sich mehrere Schlüssel hinterlegen, durch Komma getrennt, optional mit Namen: `Privat=sk-ant-...,Arbeit=sk-ant-...`. Ohne Namen heißen sie `Konto 1`, `Konto 2` usw. Die Reihenfolge ist die Priorität.

Ablauf in `accounts.ts` und `claude.ts`:

1. Jede Anfrage startet beim ersten verfügbaren Konto.
2. Antwortet die API vor der ersten Ausgabe mit einem Limit-Fehler, wird das Konto gesperrt und dieselbe Anfrage sofort mit dem nächsten Konto wiederholt. Die Oberfläche zeigt einen Hinweis, zum Beispiel „Privat hat das Limit erreicht. Es wird mit Arbeit weitergemacht.“
3. Sperrdauer: bei `429` der Wert aus `retry-after` (Standard 60 s), bei leerem Guthaben 1 Stunde, bei ungültigem Schlüssel 6 Stunden.
4. Zusätzlich sperrt das Konto vorausschauend, wenn die Antwort-Header melden, dass ein Limit bei 0 steht. Es bleibt bis zum angegebenen Reset gesperrt.
5. Sind alle Konten gesperrt, erscheint eine Meldung mit der Uhrzeit, ab der das nächste Konto wieder verfügbar ist.

Ein Wechsel mitten in einer laufenden Antwort findet nicht statt. Sobald Text geflossen ist, wird ein Fehler normal gemeldet.

## Nutzungslimit-Anzeige

Die Anthropic-API liefert bei jeder Antwort Header `anthropic-ratelimit-*` mit Limit, verbleibendem Wert und Reset-Zeit für Anfragen sowie Eingabe- und Ausgabetoken. Diese Werte werden je Konto gespeichert (auch in der Datenbank, damit sie einen Neustart überleben) und in der Seitenleiste unter *Nutzungslimit* angezeigt. Vor der ersten Nachricht eines Kontos gibt es noch keine Werte.

Das **verbleibende Guthaben** in Dollar stellt die API nicht bereit. Es ist nur in der Console sichtbar. Die Anzeige zeigt daher Rate-Limits, keinen Kontostand. Ist das Guthaben aufgebraucht, erkennt die App das an der Fehlermeldung der API und wechselt das Konto.

## Wie die App Claude aufruft

`backend/src/claude.ts` nutzt `@anthropic-ai/sdk` und `client.beta.messages.stream(...)`.

| Parameter | Wert | Grund |
| --- | --- | --- |
| `model` | `CLAUDE_MODEL`, Standard `claude-opus-5-5` | Stärkstes Modell als Standard, per Variable änderbar |
| `max_tokens` | `MAX_TOKENS`, Standard `64000` | Streaming erlaubt große Werte. Der Denkprozess zählt mit |
| `thinking` | `{ type: "adaptive", display: "summarized" }` | Claude entscheidet selbst, wann es nachdenkt. Die Zusammenfassung wird in der Oberfläche angezeigt. Mit `SHOW_THINKING=false` wird `omitted` gesendet |
| `output_config.effort` | `CLAUDE_EFFORT`, Standard `medium` | Steuert Denktiefe, Dauer und Kosten. Für Claude Opus 5.5 ist `medium` der API-Standard, er wird hier ausdrücklich gesetzt |
| `cache_control` | `{ type: "ephemeral" }` | Automatisches Prompt-Caching. Wiederholte Präfixe im Verlauf werden günstiger |
| `system` | Liste aus Textblöcken | Basisprompt mit Datum, eigene Anweisungen, Gedächtnis (siehe [gedaechtnis.md](gedaechtnis.md)) |
| `messages` | Verlauf des Chats im Gedächtnisfenster | Nur reiner Text, keine Denkblöcke |
| `betas` und `fallbacks` | `server-side-fallback-2026-07-01` und `"default"` | Siehe unten |

Der Beta-Endpunkt wird verwendet, weil die serverseitigen Fallbacks dort liegen. Alle anderen Parameter sind reguläre Messages-API-Parameter.

### Thinking und Verlauf

Bei Opus 5.5 lässt sich Denken nicht abschalten (`disabled` und `budget_tokens` führen zu einem 400er-Fehler). Die Tiefe wird ausschließlich über `effort` gesteuert. Denkblöcke werden nur für die Anzeige gespeichert. Beim Aufbau des Verlaufs werden sie weggelassen. Das ist zulässig und vermeidet Konflikte mit der Prüfung gebundener Denkblöcke, die greift, sobald der Verlauf nachträglich verändert wird. Das 3-Tage-Fenster verändert den Verlauf ständig.

### Ablehnungen und Fallbacks

Die Sicherheitsklassifizierer von Claude können Anfragen ablehnen, auch harmlose Grenzfälle. Eine Ablehnung kommt als HTTP 200 mit `stop_reason: "refusal"`. Mit `fallbacks: "default"` lässt die API eine abgelehnte Anfrage serverseitig auf einem geeigneten anderen Modell laufen. Das ist für folgende Modelle aktiv: `claude-opus-5-5`, `claude-opus-5`, `claude-fable-5*` und `claude-sonnet-5-5`. Über `ENABLE_FALLBACK` (`auto`, `true`, `false`) lässt sich das überschreiben. Lehnt auch die Fallback-Kette ab, zeigt die Oberfläche einen Hinweis mit der Kategorie.

### Titel

Nach dem ersten Austausch erzeugt `TITLE_MODEL` (Standard `claude-haiku-5-5`) einen Titel mit höchstens sechs Wörtern. Schlägt der Aufruf fehl, bleibt der gekürzte Text der ersten Nachricht als Titel.

## Fehlerbehandlung

`describeError` in `claude.ts` übersetzt SDK-Fehler in verständliche deutsche Meldungen. Die Prüfung läuft vom spezifischsten zum allgemeinsten Fehler.

| SDK-Fehler | Meldung an den Nutzer |
| --- | --- |
| `AuthenticationError` | Schlüssel fehlt oder ist ungültig |
| `PermissionDeniedError` | Schlüssel darf dieses Modell nicht nutzen |
| `RateLimitError` | Anfragelimit erreicht, später erneut versuchen |
| `BadRequestError` | Anfrage abgelehnt, mit Text der API (zum Beispiel zu wenig Guthaben) |
| `NotFoundError` | Modell nicht gefunden, `CLAUDE_MODEL` prüfen |
| `APIConnectionError` | Keine Verbindung zur API |
| `APIError` mit 503 oder 529 | API überlastet |

Das SDK wiederholt Anfragen bei temporären Fehlern selbst (`maxRetries: 2`). Technische Details landen im Container-Log, nicht in der Oberfläche.

## Kosten steuern

Preise je eine Million Token (Stand November 2026, aktuelle Werte stehen auf der Preisseite von Anthropic):

| Modell | Eingabe | Ausgabe |
| --- | --- | --- |
| `claude-opus-5-5` | 4 $ | 20 $ |
| `claude-sonnet-5-5` | 2 $ | 10 $ |
| `claude-haiku-5-5` | 0,10 $ | 0,50 $ |

Stellschrauben, nach Wirkung sortiert:

1. `CLAUDE_EFFORT=low` für einfache Chats. Weniger Denkaufwand bedeutet weniger Ausgabetoken.
2. `CLAUDE_MODEL=claude-sonnet-5-5` oder `claude-haiku-5-5` für günstigere Antworten.
3. `MEMORY_DAYS` und `MAX_CONTEXT_CHARS` verkleinern, damit weniger Verlauf bei jeder Anfrage mitgesendet wird.
4. `CROSS_CHAT_MEMORY=false`, wenn der Auszug aus anderen Chats nicht nötig ist.

Pro Antwort speichert die App die Token-Zahlen (`input_tokens`, `output_tokens`). Die Ausgabetoken erscheinen als kleine Angabe unter jeder Antwort, beide Werte stehen in der Datenbank.
