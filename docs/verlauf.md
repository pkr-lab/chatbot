# Verlauf

Jeder Chat merkt sich seinen eigenen Verlauf. Es gibt kein Zeitfenster und keine Erinnerung zwischen Chats: Was in einem Chat besprochen wurde, kennt Plaudi in einem anderen Chat nicht.

## Funktionsweise

Bei jeder Nachricht sendet der Server den gesamten Verlauf des Chats an das Modell (`buildHistory` in `backend/src/prompt.ts`). Ist der Verlauf länger als das Budget `MAX_CONTEXT_CHARS` (Standard 400000 Zeichen, etwa 100000 Token), fallen die ältesten Nachrichten heraus, bis es passt. In der Oberfläche bleibt alles sichtbar. Die Anzeige unter dem Eingabefeld zeigt, wie viel vom Kontextfenster belegt ist und, falls gekürzt wird, wie viele Nachrichten noch berücksichtigt werden.

Zusätzlich gilt je Benutzer ein Text mit eigenen Anweisungen (Einstellungen, bis 4000 Zeichen), der in jedem Chat berücksichtigt wird.

## Löschen

Wer etwas vergessen lassen will, löscht den Chat. Löschen entfernt Nachrichten endgültig.

## Kosten

Je länger ein Chat, desto mehr Eingabetoken fallen pro Nachricht an. Ein Zwischenspeicher des Dienstes macht wiederholte Verläufe deutlich günstiger. Für lange Chats lohnt sich ein neuer Chat oder ein kleineres `MAX_CONTEXT_CHARS`.
