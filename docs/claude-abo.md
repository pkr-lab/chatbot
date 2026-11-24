# Betrieb mit Claude-Abo statt API-Schlüssel

> **Nur für den persönlichen Test gedacht.** Anthropic erlaubt Abo-Zugänge (Free, Pro, Max) nach meinem Kenntnisstand nur in den eigenen Claude-Anwendungen, nicht in fremden Diensten oder für mehrere Personen. Die aktuellen Nutzungsbedingungen vor der Nutzung selbst prüfen. Für den Betrieb mit mehreren Benutzern ist der API-Schlüssel vorgesehen.

Mit `AI_BACKEND=subscription` beantwortet Plaudi Nachrichten nicht über die Messages-API, sondern über die Claude-Code-Engine (`@anthropic-ai/claude-agent-sdk`, eine mitgelieferte Binärdatei), die mit dem Login des Abos arbeitet. Werkzeuge, Dateizugriff und Konfigurationsdateien sind abgeschaltet, die Engine liefert nur Text.

## Anmelden

1. Auf einem Rechner mit installiertem Claude Code `claude setup-token` ausführen und im Browser mit dem Claude-Konto anmelden. Das Token (`sk-ant-oat…`) wird einmal angezeigt.
2. In Plaudi als Administrator *Einstellungen → Claude-Anmeldung* öffnen, das Token einfügen und *Verbinden* wählen. Plaudi schickt eine kurze Testanfrage und speichert das Token nur, wenn sie gelingt.
3. Alternativ das Token als Umgebungsvariable `CLAUDE_CODE_OAUTH_TOKEN` setzen. Dann zeigt die Oberfläche nur den Status und erlaubt kein Ändern.

*Trennen* löscht das gespeicherte Token. Das Token selbst bleibt beim Anbieter gültig und muss dort widerrufen werden, wenn es abhandenkommt.

## Wie das Token gespeichert wird

AES-256-GCM, Schlüssel per HKDF aus dem `session.secret` im Datenverzeichnis. Das schützt gegen eine kopierte Datenbank oder ein Backup ohne `session.secret`, nicht gegen jemanden mit Zugriff auf das ganze Volume. Die Weboberfläche gibt das Token nie zurück, der Status zeigt nur „verbunden“.

## Unterschiede zum API-Betrieb

| Bereich | Verhalten im Abo-Betrieb |
| --- | --- |
| Limits | Es gelten die Limits des Abos (5-Stunden- und 7-Tage-Fenster). Die Anzeige unter *Einstellungen* zeigt, was die Engine meldet. Ist ein Fenster erreicht, antwortet Plaudi mit der Zeit der nächsten Freigabe |
| Mehrere Konten | Es gibt genau ein Abo, `API_KEYS` und der automatische Wechsel entfallen |
| Chat-Titel | Aus der ersten Nachricht abgeleitet, kein zusätzlicher Modellaufruf |
| Verlauf | Wird als Text in die Anfrage eingebettet, jede Antwort startet eine neue Engine-Sitzung ohne gespeicherten Verlauf |
| Kontextfenster | Anzeige mit festem Wert von 1 Mio. Tokens |
| Server-Fallback | Nicht verfügbar |
| Ressourcen | Jede laufende Antwort startet einen Prozess mit etwa 250 MB Arbeitsspeicher. Das Image ist wegen der Binärdatei etwa 1 GB groß |

## Fehlersuche

| Symptom | Ursache | Lösung |
| --- | --- | --- |
| „Die Claude-Anmeldung ist abgelaufen oder ungültig“ | Token widerrufen, abgelaufen oder falsch | Neues Token mit `claude setup-token` erzeugen und eintragen |
| „Das Nutzungslimit des Claude-Abos ist erreicht“ | 5-Stunden- oder 7-Tage-Fenster voll | Bis zur angezeigten Zeit warten |
| Prüfung beim Verbinden dauert lange oder scheitert | Server erreicht Anthropic nicht | Ausgehende Verbindung des Servers prüfen |
| Engine startet nicht | Binärdatei fehlt oder `/tmp` ist nicht beschreibbar | Image neu bauen, `/tmp` als beschreibbares Volume einbinden |
