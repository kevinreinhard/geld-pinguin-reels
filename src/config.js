import { LAYOUT } from "./marke.js";

// Zentrale Konfiguration fuer den Kanal @geld.pinguin.
// Alles was du am Look/Content drehen willst, steht hier.

export const CHANNEL = {
  handle: "@geld.pinguin",
  sprache: "Deutsch (Deutschland), Du-Form, klar und direkt",
  waehrung: "Euro",
  markt:
    "Deutschland – deutsches Steuer-, Renten- und Bankensystem. Keine Schweizer oder " +
    "österreichischen Begriffe wie Säule 3a, Franchise, AHV oder Franken.",
  zielgruppe:
    "20-35 Jahre, Deutschland, Berufseinsteiger bis Mitte der Karriere, will endlich " +
    "Ordnung in die Finanzen bringen, kein Vorwissen",
  tonalitaet:
    "freundlich-frech, konkret, null Bullshit, kein Motivations-Geschwafel, keine Emoji-Flut",
};

// Themensäulen für den deutschen Markt. Pro Reel wird eine gewichtet zufällig gezogen.
export const PILLARS = [
  { key: "sparen", gewicht: 3, beschreibung: "Alltagssparen, Fixkosten senken, Abo-Fallen, Haushaltsbudget, Tagesgeld" },
  { key: "investieren", gewicht: 3, beschreibung: "ETF-Sparplan, Zinseszins, Diversifikation, MSCI World, typische Anfängerfehler, Depotkosten" },
  { key: "vorsorge", gewicht: 2, beschreibung: "Gesetzliche Rente, Rentenlücke, betriebliche Altersvorsorge, Riester und Rürup, ETF statt Versicherung" },
  { key: "steuern", gewicht: 3, beschreibung: "Steuererklärung, Werbungskosten, Freistellungsauftrag, Sparerpauschbetrag, Homeoffice-Pauschale, Kapitalertragsteuer" },
  { key: "schulden", gewicht: 1, beschreibung: "Dispozinsen, Ratenkauf, Kreditkarten, Autokredit, Schuldenspirale" },
  { key: "psychologie", gewicht: 2, beschreibung: "Money-Mindset, Lifestyle-Inflation, Impulskäufe, Vergleichsfalle" },
  { key: "banking", gewicht: 2, beschreibung: "Girokonto-Gebühren, Kontowechsel, Tagesgeld versus Girokonto, Neobanken, versteckte Entgelte" },
  { key: "versicherung", gewicht: 2, beschreibung: "Berufsunfähigkeit, Haftpflicht, gesetzlich versus privat krankenversichert, unnötige Policen" },
  { key: "gehalt", gewicht: 2, beschreibung: "Brutto und netto, Steuerklassen, Gehaltsverhandlung, Sachbezüge, Minijob-Grenze" },
];

export const VIDEO = {
  breite: 1080,
  hoehe: 1920,
  fps: 30,
  crf: 20,
  preset: "medium",
  leadIn: 0.35,   // Sekunden Stille vor dem ersten Wort
  tail: 0.7,      // Sekunden Nachlauf nach dem letzten Wort
  minDauer: 10,   // kuerzere Videos werden verworfen
  // Kurze Reels werden haeufiger zu Ende geschaut, und die Abspielrate ist das
  // staerkste Signal im Reels-Ranking. Darum ein hartes Dach statt 75 Sekunden.
  maxDauer: 40,
};

export const VOICE = {
  // Deutsche Stimmen aus Edge TTS. Die Multilingual-Stimmen sind die neueren und
  // klingen deutlich natuerlicher. Alternativen: de-DE-KillianNeural,
  // de-DE-ConradNeural, de-DE-KatjaNeural, de-DE-AmalaNeural
  stimmen: ["de-DE-FlorianMultilingualNeural", "de-DE-SeraphinaMultilingualNeural"],
  rate: "+12%",   // etwas schneller = besser fuer Reels
  pitch: "+0Hz",
  musikLautstaerke: 0.10, // nur relevant wenn assets/music/*.mp3 vorhanden
};

// Untertitel-Design (Karaoke-Style, Wort faerbt sich beim Sprechen ein).
// Die Positionen stammen aus src/marke.js - dort steht die Bildaufteilung.
export const CAPTIONS = {
  // Vier statt drei Woerter: Mit nur drei Plaetzen bleibt der Segmentierung in
  // src/ass.js keine Wahl, und sie muss mitten in eine Wortgruppe schneiden.
  maxWoerterProChunk: 4,
  maxSekundenProChunk: 1.5,
  fontSize: 82,          // kleiner als frueher: die Karte darueber traegt jetzt die Aussage
  titleFontSize: 52,     // Marke am oberen Rand - die Zone darueber ist sonst leer
  yPosition: LAYOUT.untertitelY,
  titleYPosition: LAYOUT.titelY,
  handleY: LAYOUT.handleY,
  fortschrittY: LAYOUT.fortschrittY,
  // Karaoke, umgekehrt herum gedacht: Noch nicht gesprochene Woerter stehen in
  // Markengold und ziehen den Blick nach vorn, gesprochene werden weiss. So ist
  // der gelesene Teil der Zeile immer der kontrastreichste, und am Satzende
  // steht alles in Weiss. Vorher faerbte sich die Zeile fortschreitend gold ein
  // und war am Ende komplett golden - die Bildkontrolle hat sie zweimal als
  // praktisch unlesbar gemeldet.
  gesprochenFarbe: "&H00FFFFFF&",  // Weiss
  kommendFarbe: "&H0045C8FF&",     // ASS = &HBBGGRR -> #FFC845 (Markengold)
  aktivFarbe: "&H0045C8FF&",       // Markengold, fuer Titelzeile und Balken
  outlineFarbe: "&H00140A05&",
  outlineStaerke: 7,
};

export const MODEL = {
  id: "claude-opus-5",
  effort: "medium",
  maxTokens: 8000,
};

// Instagram Graph API (Instagram Login Variante)
export const IG = {
  apiBase: "https://graph.instagram.com",
  apiVersion: "v23.0",
  pollIntervalMs: 6000,
  pollMaxVersuche: 60, // ~6 Minuten
  shareToFeed: true,
  // Titelbild des Reels. Frame 0 waere fast leer - hier steht schon Text im Bild,
  // was im Profilraster und in der Vorschau deutlich mehr hergibt.
  thumbOffsetMs: 2200,
};
