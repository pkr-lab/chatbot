# Gedächtnis

Der Chatbot erinnert sich an die Unterhaltungen der **letzten 3 Tage**. Das Fenster ist über `MEMORY_DAYS` einstellbar. Es gibt zwei Ebenen, die in `backend/src/prompt.ts` umgesetzt sind.

## Ebene 1: Verlauf im aktuellen Chat

Bei jeder Anfrage sendet der Server die Nachrichten des Chats, deren Zeitstempel innerhalb des Fensters liegt.

```
Grenze = jetzt − MEMORY_DAYS × 24 Stunden
```

Ablauf in `buildHistory`:

1. Alle Nachrichten des Chats mit `created_at >= Grenze` laden.
2. Ist die letzte Nachricht älter als die Grenze (zum Beispiel beim erneuten Versuchen einer alten Frage), wird sie trotzdem als einzige gesendet.
3. Von hinten nach vorn auffüllen, bis `MAX_CONTEXT_CHARS` (Standard 400000 Zeichen) erreicht ist. Die ältesten Nachrichten fallen zuerst heraus.
4. Führende Antworten des Assistenten werden entfernt, weil der Verlauf mit einer Nutzernachricht beginnen muss.

Ältere Nachrichten bleiben in der Oberfläche sichtbar und in der Datenbank erhalten. Sie werden nur nicht mehr an Claude gesendet.

## Ebene 2: Erinnerung an andere Chats

Wenn aktiviert (`CROSS_CHAT_MEMORY=true` oder Schalter in den Einstellungen), erhält Claude zusätzlich einen **Auszug aus allen anderen Chats** des Zeitfensters. Dadurch kennt der Bot Informationen, die in einem anderen Chat genannt wurden.

Aufbau in `buildMemoryDigest`:

1. Bis zu 800 jüngste Nachrichten anderer Chats im Zeitfenster laden, neueste zuerst.
2. Jede Nachricht auf einen Satzstand kürzen (Nutzer 800 Zeichen, Claude 500 Zeichen, Zeilenumbrüche eingeebnet).
3. Auffüllen, bis das Budget `MEMORY_DIGEST_CHARS` (Standard 12000) aufgebraucht ist.
4. Zurück in zeitliche Reihenfolge bringen und nach Chat gruppieren.

Der Auszug wird als eigener Systemblock übergeben:

```
<memory>
Gedächtnis: Auszüge aus anderen Unterhaltungen der letzten 3 Tage. Das ist Hintergrundwissen über die Person, mit der du schreibst. Nutze es nur, wenn es für die aktuelle Frage relevant ist, und erwähne es nicht ungefragt.

### „Urlaub in Italien“ (Di., 24.11., 17:20)
Nutzer: Ich plane im Mai eine Reise nach Rom.
Claude: Gern, ...
</memory>
```

Der aktuelle Chat ist im Auszug nicht enthalten, weil sein Verlauf ohnehin als Nachrichtenliste mitgesendet wird.

## Einstellungen und Vorrang

| Quelle | Wirkung |
| --- | --- |
| `MEMORY_DAYS` | Länge des Fensters in Tagen, auch Dezimalwerte wie `0.5` |
| `CROSS_CHAT_MEMORY` | Startwert für den chatübergreifenden Auszug |
| Schalter in den Einstellungen | Wird in der Datenbank gespeichert und hat **Vorrang** vor der Umgebungsvariable |
| `MAX_CONTEXT_CHARS`, `MEMORY_DIGEST_CHARS` | Obergrenzen für Verlauf und Auszug |

Die Einstellungen zeigen unter *Gedächtnis* eine Vorschau mit Anzahl der Chats und Nachrichten sowie dem genauen Auszug, den Claude erhalten würde (`GET /api/memory`).

## Eigene Anweisungen

Zusätzlich lässt sich in den Einstellungen ein Text hinterlegen (bis 4000 Zeichen), zum Beispiel Anrede oder Tonfall. Er wird als weiterer Systemblock an jede Anfrage angehängt und ist unabhängig vom Zeitfenster dauerhaft aktiv.

## Verhalten und Grenzen

- Das Gedächtnis besteht aus dem gespeicherten Verlauf. Es werden keine Fakten extrahiert oder zusammengefasst, deshalb entsteht kein zusätzlicher Modellaufruf.
- Nach Ablauf des Fensters vergisst Claude Inhalte, ohne dass etwas gelöscht wird.
- Wer etwas vergessen lassen will, löscht den Chat in der Seitenleiste. Gelöschte Chats verschwinden auch aus dem Auszug.
- Der Auszug ändert sich, sobald in einem anderen Chat geschrieben wird. Das kann den Prompt-Cache für den Systemteil ungültig machen. Der Verlauf selbst bleibt davon unberührt.
- Alle gesendeten Inhalte gehen an die Anthropic-API. Sensible Chats sollten gelöscht werden oder der übergreifende Auszug deaktiviert sein.
