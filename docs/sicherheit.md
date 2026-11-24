# Sicherheitsbewertung

Stand der Prüfung: automatisierte Tests (`backend/tests/security.mjs`, 77 Prüfungen) plus Durchsicht des Codes. `npm audit` meldet für Backend und Frontend keine bekannten Schwachstellen in den Produktionsabhängigkeiten.

```bash
cd backend && node tests/security.mjs
```

Der Test startet einen Server mit Webhook-Mailempfänger und prüft unter anderem:

- Alle geschützten Routen liefern ohne Sitzung `401`, Admin-Routen für normale Benutzer `403`.
- Unbekannte und bekannte Adressen erhalten dieselbe Antwort, an unbekannte geht keine Mail.
- Falsche, abgelaufene, wiederverwendete und fremde Codes scheitern. Nach 5 Fehlversuchen ist auch der richtige Code gesperrt.
- Cookie ist `HttpOnly` und `SameSite=Strict`, erfundene oder manipulierte Token werden abgelehnt.
- Fremde Origin und Cross-Site-Anfragen werden mit `403` abgelehnt.
- Benutzer sehen und ändern keine Chats anderer (`404` auf allen Pfaden), Einstellungen sind getrennt.
- Abmelden, Abmelden aller Geräte und Entfernen eines Benutzers beenden Sitzungen sofort.
- Begrenzungen je Adresse und je IP greifen. Codes stehen nicht im Log.

## Ergebnis

Für den Betrieb im Internet **geeignet, wenn die Bedingungen unten erfüllt sind**. Der Schutz gegen unbefugten Zugriff beruht auf der Allowlist, dem Einmalcode und serverseitigen Sitzungen. Die Anwendung terminiert kein TLS und ist ohne HTTPS nicht für das Internet gedacht.

## Bedingungen für den Internet-Betrieb

1. **HTTPS über einen Reverse Proxy** (Caddy, nginx, Traefik), `COOKIE_SECURE=true`, `TRUST_PROXY=1`. Der Port 3000 gehört nicht ins Internet.
2. **Mail-Zustellung absichern**: Wer das Postfach einer freigeschalteten Adresse übernimmt, kann sich anmelden. Für Administratoren Postfächer mit eigener 2FA verwenden. SPF, DKIM und DMARC der Absenderdomain einrichten.
3. **Ausgabenlimit** in der Konsole des KI-Anbieters setzen. Ein gekaperter Zugang verursacht sonst Kosten.
4. **`.env` und Volume schützen**: Schlüssel und Datenbank liegen im Klartext auf dem Host (Dateirechte, Festplattenverschlüsselung, Backups verschlüsseln).
5. **Updates** regelmäßig einspielen (`docker compose up -d --build`, Basis-Image aktualisieren).

## Bekannte Grenzen

- **Ein Faktor.** Die Anmeldung per Mailcode ist passwortlos. Es ist keine echte Zwei-Faktor-Anmeldung. Wer die Zustellung der Mails kontrolliert, kontrolliert den Zugang. Soll zusätzlich ein Passwort oder ein Authenticator (TOTP) als erster oder zweiter Faktor verlangt werden, ist das eine Erweiterung.
- **Sperrung durch Dritte.** Wer eine freigeschaltete Adresse kennt, kann deren Code-Anforderungen verbrauchen (5 pro Stunde) und so die Anmeldung kurz blockieren. Der Zugriff selbst wird dadurch nicht möglich.
- **Begrenzungen im Arbeitsspeicher.** Sie gelten je Container und werden bei einem Neustart zurückgesetzt. Mehrere Container hinter einem Load Balancer würden sie nicht teilen.
- **Keine Protokollierung ins Audit-System.** Anmeldungen und Admin-Aktionen stehen im Container-Log, ohne Codes.
- **Daten an Dritte.** Chatinhalte gehen zur Beantwortung an die KI-API.
- **Keine Passwort-Wiederherstellung nötig, aber ein Notzugang fehlt.** Ist der Mailversand ausgefallen, ist die Anmeldung nicht möglich. Dann `MAIL_TRANSPORT=console` kurzzeitig setzen und den Code aus dem Log lesen.

## Umgesetzte Maßnahmen im Überblick

| Bereich | Maßnahme |
| --- | --- |
| Zugang | Allowlist, Einmalcode (HMAC, 5 Versuche, 10 Minuten), keine Benutzer-Enumeration |
| Sitzung | Zufallstoken 256 Bit, Hash in der Datenbank, serverseitig widerrufbar, Idle- und Höchstdauer |
| Cookie | `HttpOnly`, `SameSite=Strict`, `Secure` und `__Host-` hinter HTTPS |
| Angriffe von Webseiten | Herkunftsprüfung (`Origin`, `Sec-Fetch-Site`), strenge CSP, `X-Frame-Options`, HSTS hinter HTTPS |
| Daten | Trennung nach Benutzer bei jeder Abfrage, Löschung per Kaskade |
| Eingaben | Validierung aller Felder, parametrisierte SQL-Abfragen, Markdown ohne rohes HTML |
| Container | Nicht-root, read-only, ohne Capabilities, `no-new-privileges` |
| Fehler | Neutrale Meldungen, Details nur im Log |
