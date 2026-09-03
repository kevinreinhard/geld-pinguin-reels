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

// Untertitel-Design (Karaoke-Style, Wort faerbt sich beim Sprechen ein)
export const CAPTIONS = {
  maxWoerterProChunk: 3,
  maxSekundenProChunk: 1.35,
  fontSize: 96,
  titleFontSize: 64,
  yPosition: 1180,        // Mitte der Untertitel
  titleYPosition: 430,
  // Instagram legt Caption, Ton-Zeile und Buttons ueber die unteren rund 450 Pixel.
  // Alles, was gesehen werden soll, muss darueber liegen.
  fortschrittY: 1370,     // Fortschrittsbalken
  handleY: 1470,          // Wasserzeichen
  aktivFarbe: "&H0033E7FF&", // ASS = &HBBGGRR -> #FFE733 (Gelb)
  ruheFarbe: "&H00FFFFFF&",  // Weiss
  outlineFarbe: "&H00101010&",
  outlineStaerke: 8,
};

// Hintergrund-Paletten fuer den prozeduralen Verlauf (wenn keine eigenen Clips da sind)
export const PALETTEN = [
  { c0: "0x0B1E3B", c1: "0x123A5E", c2: "0x00A6A6", type: "spiral" },
  { c0: "0x1A0B2E", c1: "0x3D1E6D", c2: "0xC44FE8", type: "radial" },
  { c0: "0x0A1F14", c1: "0x14512E", c2: "0x8FD14F", type: "linear" },
  { c0: "0x2B0F0F", c1: "0x6B1D1D", c2: "0xF2994A", type: "circular" },
  { c0: "0x081018", c1: "0x1B2A41", c2: "0x4A90D9", type: "spiral" },
];

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
