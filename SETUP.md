# Einrichtung – Schritt für Schritt

> **Bebilderte Fassung mit Fortschritts-Häkchen:** https://claude.ai/code/artifact/beac596a-e3bf-4bde-8c7f-4d7ceba2fb96
> Diese Datei hier ist die Kurzfassung zum Nachschlagen.

Du brauchst rund 45 Minuten. Reihenfolge einhalten, Schritt 2 hängt von Schritt 1 ab.

---

## 1. Instagram-Konto vorbereiten

Die Content-Publishing-API funktioniert **nur** mit Business- oder Creator-Konten.

1. Instagram-App → Profil → Menü → **Konto­typ und Tools** → **Auf professionelles Konto umstellen**
2. **Business** wählen (Creator geht auch, Business ist bei der API die sichere Variante)
3. Kategorie z. B. „Persönlicher Blog" oder „Bildung"

Eine Facebook-Seite brauchst du **nicht** – wir nutzen den Weg „Instagram API mit Instagram Login".

---

## 2. Meta-App anlegen

1. <https://developers.facebook.com> → oben rechts **Anmelden**, mit deinem Facebook- oder Instagram-Konto
2. Falls noch nie gemacht: **Registrieren** als Entwickler (Handynummer bestätigen)
3. **Meine Apps** → **App erstellen**
4. Anwendungsfall: **Andere** → App-Typ: **Business** → Name z. B. `geld-pinguin-poster`
5. Im App-Dashboard links: **Produkt hinzufügen** → bei **Instagram** auf **Einrichten**
6. Reiter **API-Einrichtung mit Instagram-Login** (englisch: *API setup with Instagram login*)

---

## 3. Zugriffstoken erzeugen

Im selben Reiter, Abschnitt **1. Generate access tokens**:

1. **Instagram-Konto hinzufügen** → mit `geld.pinguin` einloggen und die Berechtigungen bestätigen
2. Achte darauf, dass diese beiden Berechtigungen dabei sind:
   - `instagram_business_basic`
   - `instagram_business_content_publish`
3. **Generate token** klicken → langen Token (beginnt mit `IGAA…`) kopieren

> Dieser Token ist 60 Tage gültig. Der Workflow `refresh-token.yml` verlängert ihn
> automatisch jeden Montag – solange du Schritt 5 machst.

Notiere dir ausserdem die **Instagram-App-ID** bzw. die Konto-ID, falls angezeigt.
Das Skript ermittelt sie sonst selbst über `GET /me`.

**Kein App Review nötig**, solange du ausschliesslich auf dein eigenes, in der App
verknüpftes Konto postest. Erst wenn fremde Konten dazukommen, wird Review fällig.

---

## 4. GitHub-Repository anlegen

```bash
cd C:\Users\kevin\geld-pinguin-reels
git init -b main
git add .
git commit -m "Reel-Automatisierung fuer geld.pinguin"
gh repo create geld-pinguin-reels --public --source=. --push
```

> **Warum öffentlich?** Instagram lädt das fertige Video per HTTPS von einer
> öffentlichen URL. Das Standard-Backend legt es als Datei an ein GitHub Release –
> und Release-Dateien privater Repos verlangen einen Login, den Instagram nicht hat.
> Deine Zugangsdaten liegen in *Secrets*, nicht im Code, und bleiben geheim.
> Willst du das Repo privat halten, richte stattdessen Cloudflare R2 ein (Abschnitt 8).

---

## 5. Secrets hinterlegen

`Repo → Settings → Secrets and variables → Actions → New repository secret`

| Name | Wert | Pflicht |
|---|---|---|
| `ANTHROPIC_API_KEY` | Key von <https://console.anthropic.com> → API Keys | ja |
| `IG_ACCESS_TOKEN` | Der `IGAA…`-Token aus Schritt 3 | ja |
| `IG_USER_ID` | Deine Instagram-Konto-ID (spart einen API-Call) | nein |
| `GH_PAT` | Fine-grained PAT, nur für die Token-Erneuerung | empfohlen |

**`GH_PAT` erzeugen:** <https://github.com/settings/personal-access-tokens/new>
→ *Repository access*: nur dieses Repo → *Permissions*:
`Secrets: Read and write` **und** `Contents: Read-only` → Laufzeit 1 Jahr.

Ohne `GH_PAT` läuft alles – aber du musst `IG_ACCESS_TOKEN` alle 60 Tage von Hand
erneuern, sonst steht die Automatisierung still.

---

## 6. Erster Testlauf

`Repo → Actions → „Reel erzeugen und veröffentlichen" → Run workflow`

- **Publish auf `false`** setzen → es wird gebaut, aber **nicht** gepostet
- Nach ~4 Minuten unten beim Lauf das Artefakt `reel-1` herunterladen und anschauen

Passt das Ergebnis? Dann denselben Workflow noch einmal mit `publish = true` starten.
Ab da läuft der Cron alle drei Stunden von allein.

---

## 7. Zeitplan anpassen

In `.github/workflows/reel.yml`:

```yaml
    - cron: "0 */3 * * *"
```

Die Zeit ist **UTC**. Schweizer Zeit ist UTC+1 (Winter) bzw. UTC+2 (Sommer).

| Cron (UTC) | Postet (Sommerzeit CH) |
|---|---|
| `0 */3 * * *` | 02, 05, 08, 11, 14, 17, 20, 23 Uhr |
| `0 5,8,11,14,17,20 * * *` | 07, 10, 13, 16, 19, 22 Uhr – nur tagsüber, 6× statt 8× |
| `0 6,10,16,19 * * *` | 08, 12, 18, 21 Uhr – 4× täglich, reichweitenfreundlicher |

Zwei Eigenheiten von GitHub Actions:
- Cron-Jobs starten oft 5–20 Minuten später als angegeben. Für Reels egal.
- Nach 60 Tagen **ohne Repo-Aktivität** schaltet GitHub geplante Workflows ab.
  Weil jeder Lauf `data/history.json` zurückschreibt, passiert das hier nicht.

---

## 8. Optional: Cloudflare R2 statt GitHub Release

Nötig, wenn das Repo privat bleiben soll.

1. Cloudflare → **R2** → Bucket anlegen, z. B. `geld-pinguin-reels`
2. Bucket → **Settings** → *Public access* über eine eigene Domain aktivieren
   (z. B. `media.deine-domain.ch`)
3. **Manage R2 API Tokens** → Token mit *Object Read & Write* erzeugen
4. Diese Secrets ergänzen: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE`
5. In `.github/workflows/reel.yml` bei „Abhängigkeiten" das `--omit=optional` entfernen,
   damit das S3-SDK mitinstalliert wird

Sobald `R2_BUCKET`, `R2_ACCOUNT_ID` und `R2_PUBLIC_BASE` gesetzt sind, nimmt das
Skript automatisch R2.

---

## Fehlerbilder

| Meldung | Ursache und Lösung |
|---|---|
| `Die Video-URL ist nicht öffentlich abrufbar (HTTP 404)` | Repo ist privat → öffentlich schalten oder R2 nutzen |
| `Instagram API 400 … media_type` | Konto ist noch kein Business-/Creator-Konto (Schritt 1) |
| `(code 190)` | Token abgelaufen oder ungültig → Schritt 3 wiederholen |
| `(code 4) Application request limit reached` | Zu viele API-Aufrufe – Intervall vergrössern |
| `Zeitüberschreitung: Instagram hat das Video nicht verarbeitet` | Meist zu grosse Datei oder langsamer Abruf – `crf` in `src/config.js` auf 22 erhöhen |
| `Edge TTS hat weder Wort- noch Satzgrenzen geliefert` | Microsofts TTS-Endpunkt war kurz gestört – nächster Lauf greift wieder |
| `Tageskontingent von Instagram ausgeschöpft` | 50 Beiträge in 24 h erreicht – kann bei 8 Posts/Tag nicht passieren |
