# Anmeldung und Benutzerverwaltung

## Ablauf (zwei Faktoren)

1. **Passwort:** E-Mail-Adresse und Passwort eingeben. Der Server prüft das Passwort gegen den gespeicherten Hash. Im Browser wird nichts entschieden.
2. **Code:** Nur bei richtigem Passwort sendet der Server einen 6-stelligen Einmalcode per Mail (10 Minuten gültig). Der Code ist an den Anmeldeversuch gebunden (`challenge`), er lässt sich nur im selben Ablauf einlösen.
3. Mit richtigem Code legt der Server eine Sitzung in der Datenbank an und setzt ein Cookie mit einem zufälligen Token. In der Datenbank steht nur dessen SHA-256-Hash.
4. Jede Anfrage wird serverseitig gegen diese Sitzung geprüft. Abmelden, Passwortwechsel oder Entfernen des Benutzers beenden Sitzungen sofort.

Passwörter werden mit scrypt (N=32768, r=8, p=1, zufälliges Salz) gehasht und nie im Klartext gespeichert oder geloggt. Mindestlänge 10 Zeichen (`PASSWORD_MIN_LENGTH`), höchstens 128. Abgelehnt werden sehr häufige Passwörter, Wiederholungen und Passwörter, die den Teil der E-Mail-Adresse vor dem @ enthalten.

## Sperre nach Fehlversuchen

Nach **3 falschen Eingaben** (Passwort oder Code, `MAX_LOGIN_FAILURES`) ist der Zugang für **24 Stunden** gesperrt (`LOCK_HOURS`). Währenddessen wird auch das richtige Passwort abgelehnt und es wird kein Code verschickt. Die Fehlversuche zählen gemeinsam und werden erst nach einer vollständigen Anmeldung zurückgesetzt. Die Meldung nennt die verbleibenden Versuche und das Ende der Sperre.

- Die Sperre steht in der Datenbank und übersteht Neustarts.
- Unbekannte Adressen werden gleich behandelt, damit niemand erkennt, ob eine Adresse existiert.
- Code-Eingaben zählen nur, wenn zuvor das Passwort stimmte und ein Code ausgelöst wurde.
- Aufheben: Ein Administrator klickt *Entsperren*, oder der Benutzer setzt über „Passwort vergessen“ ein neues Passwort.
- Auch die Passwortänderung im Konto sperrt nach 3 falschen aktuellen Passwörtern.

Nachteil jeder solchen Sperre: Wer eine Adresse kennt, kann sie durch absichtliche Fehleingaben für einen Tag sperren. Der Zugriff selbst wird dadurch nicht möglich, und Administratoren oder der Reset per Mail heben die Sperre auf.

## Passwort vergessen und Reset

Auf der Anmeldeseite *Passwort vergessen* wählen. Ist die Adresse freigeschaltet, kommt ein Link (`PUBLIC_URL/reset#token=...`, 30 Minuten gültig, einmalig). Das Token steht im Fragment der Adresse, wird also nicht an den Server oder in Logs gesendet, und die Seite entfernt es sofort aus der Adresszeile. Mit dem Link legt man ein neues Passwort fest. Danach sind alle bisherigen Sitzungen beendet und eine Sperre ist aufgehoben. Die Antwort ist für bekannte und unbekannte Adressen identisch.

`PUBLIC_URL` muss auf die echte Adresse zeigen (zum Beispiel `https://plaudi.example.com`). Links werden nie aus der Anfrage gebildet, damit niemand Links auf fremde Domains erzeugen kann.

## Benutzerverwaltung (Administratoren)

*Einstellungen → Zugriff*:

- **Hinzufügen:** Die Adresse erhält automatisch eine Einladung mit Link zum Festlegen des Passworts (24 Stunden gültig).
- **Passwort zurücksetzen:** Das alte Passwort wird sofort ungültig, alle Sitzungen enden, eine Sperre wird aufgehoben und der Benutzer bekommt einen Link per Mail. Der Link wird dem Administrator zusätzlich angezeigt, falls die Mail nicht ankommt. Ein Administrator setzt nie selbst ein Passwort und kennt nie das Passwort anderer.
- **Einladung senden:** Für Benutzer ohne Passwort.
- **Entsperren**, **Rolle ändern**, **Entfernen** (löscht auch die Chats der Person). Der letzte Administrator bleibt immer erhalten.

Der erste Administrator kommt aus `ADMIN_EMAIL`. Sein Startpasswort kann einmalig über `ADMIN_PASSWORD` gesetzt werden (nur wenn noch keins existiert, danach Variable entfernen). Alternativ funktioniert „Passwort vergessen“, sobald der Mailversand läuft.

## Mail-Anbindung

`MAIL_TRANSPORT` wählt den Weg. Ohne Angabe gilt `webhook`, wenn `MAIL_WEBHOOK_URL` gesetzt ist, sonst `smtp`, wenn `SMTP_HOST` gesetzt ist, sonst `console`.

**Webhook (bestehender Mail-Dienst):** `POST MAIL_WEBHOOK_URL` mit JSON und, falls gesetzt, `Authorization: Bearer <MAIL_WEBHOOK_TOKEN>`:

```json
{ "from": "Plaudi <no-reply@example.com>", "to": "name@example.com", "subject": "Dein Plaudi-Code: 123456", "text": "...", "html": "..." }
```

Jede Antwort mit Status 2xx gilt als gesendet, Weiterleitungen werden nicht verfolgt, Zeitlimit 10 Sekunden. **SMTP:** `SMTP_HOST`, `SMTP_PORT` (587 mit STARTTLS, 465 mit TLS), `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, unverschlüsselte Verbindungen werden nicht aufgebaut. **Konsole:** schreibt Codes und Links ins Log, nur für Tests.

## Weitere Schutzmaßnahmen

| Maßnahme | Wert |
| --- | --- |
| Code | 6 Ziffern aus `crypto.randomInt`, als HMAC gespeichert, einmalig, an den Ablauf gebunden |
| Neue Codes je Adresse | alle 30 Sekunden, höchstens 5 pro Stunde |
| Anmeldeversuche je IP | 30 in 15 Minuten |
| Reset-Anfragen | je IP 10 in 15 Minuten, je Adresse 3 pro Stunde |
| Hash-Berechnungen | höchstens 4 gleichzeitig, schützt den Server vor Überlast |
| Sitzung | läuft nach 3 Stunden Inaktivität ab, höchstens 24 Stunden insgesamt |
| Antworten | gleich für bekannte und unbekannte Adressen |
