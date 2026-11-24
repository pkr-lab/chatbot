# Anmeldung und Benutzerverwaltung

## Ablauf

1. Auf der Anmeldeseite die E-Mail-Adresse eingeben.
2. Ist die Adresse freigeschaltet, sendet der Server einen 6-stelligen Einmalcode (10 Minuten gültig).
3. Code eingeben. Der Server prüft ihn, legt eine Sitzung in der Datenbank an und setzt ein Cookie mit einem zufälligen Token. In der Datenbank steht nur der SHA-256-Hash des Tokens.
4. Jede weitere Anfrage wird serverseitig gegen diese Sitzung geprüft. Abmelden oder Entfernen eines Benutzers macht das Cookie sofort wertlos.

Es gibt kein Passwort. Die Anmeldung beweist den Besitz des Postfachs. Es ist also **ein** Faktor, nicht zwei.

## Wer hat Zugriff

Nur Adressen in der Tabelle `users`. Der erste Administrator kommt aus `ADMIN_EMAIL` und wird bei jedem Start sichergestellt. Ohne diese Variable und ohne vorhandene Benutzer startet der Server nicht.

Administratoren verwalten den Zugriff unter *Einstellungen → Zugriff*: Adresse hinzufügen (optional als Administrator), Rolle ändern, entfernen. Entfernen löscht Sitzungen und alle Chats der Person. Der letzte Administrator kann weder entfernt noch herabgestuft werden.

Jeder Benutzer hat eigene Chats, eigene Einstellungen und ein eigenes Gedächtnis. Die Limit-Anzeige der API-Konten sehen nur Administratoren.

## Mail-Anbindung

`MAIL_TRANSPORT` wählt den Weg. Ohne Angabe gilt `webhook`, wenn `MAIL_WEBHOOK_URL` gesetzt ist, sonst `smtp`, wenn `SMTP_HOST` gesetzt ist, sonst `console`.

### Webhook (bestehender Mail-Dienst)

Der Server sendet `POST MAIL_WEBHOOK_URL` mit JSON und, falls gesetzt, `Authorization: Bearer <MAIL_WEBHOOK_TOKEN>`:

```json
{ "from": "Plaudi <no-reply@example.com>", "to": "name@example.com", "subject": "Dein Plaudi-Code: 123456", "text": "...", "html": "..." }
```

Jede Antwort mit Status 2xx gilt als gesendet, Weiterleitungen werden nicht verfolgt, das Zeitlimit beträgt 10 Sekunden. Ein vorhandener Dienst muss nur diesen Endpunkt anbieten oder über einen kleinen Adapter erreichbar sein. Die Anbindung ist in `backend/src/mailer.ts` gekapselt.

### SMTP

`SMTP_HOST`, `SMTP_PORT` (587 mit STARTTLS, 465 mit TLS), `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`. Unverschlüsselte Verbindungen werden nicht aufgebaut.

### Konsole

Schreibt die Mail samt Code ins Log. Nur für Tests, nie im Internet-Betrieb.

## Schutzmaßnahmen

| Maßnahme | Wert |
| --- | --- |
| Code | 6 Ziffern aus `crypto.randomInt`, als HMAC gespeichert, einmalig verwendbar |
| Falsche Eingaben je Code | 5, danach ist der Code gesperrt |
| Neue Codes je Adresse | alle 30 Sekunden, höchstens 5 pro Stunde |
| Anforderungen je IP | 15 in 15 Minuten |
| Prüfversuche je IP | 30 in 15 Minuten |
| Sitzung | 7 Tage Inaktivität, 30 Tage absolut, beides einstellbar |
| Antworten | gleich für bekannte und unbekannte Adressen |
