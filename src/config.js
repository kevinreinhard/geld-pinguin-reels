// Zentrale Konfiguration fuer den Kanal @geld.pinguin.
// Alles was du am Look/Content drehen willst, steht hier.

export const CHANNEL = {
  handle: "@geld.pinguin",
  sprache: "Deutsch (Schweiz), Du-Form, klar und direkt",
  waehrung: "CHF",
  zielgruppe:
    "18-35 Jahre, Schweiz, will endlich Ordnung in die Finanzen bringen, kein Vorwissen",
  tonalitaet:
    "freundlich-frech, konkret, null Bullshit, kein Motivations-Geschwafel, keine Emoji-Flut",
};

// Themensäulen. Pro Reel wird eine gewichtet zufällig gezogen.
export const PILLARS = [
  { key: "sparen", gewicht: 3, beschreibung: "Alltagssparen, Fixkosten senken, Abo-Fallen, Budget-Systeme" },
  { key: "investieren", gewicht: 3, beschreibung: "ETF-Basics, Zinseszins, Diversifikation, typische Anfängerfehler" },
  { key: "vorsorge", gewicht: 2, beschreibung: "Säule 3a, Pensionskasse, Einkauf PK, Vorsorge-Irrtümer Schweiz" },
  { key: "steuern", gewicht: 2, beschreibung: "Steuerabzüge Schweiz, Steuererklärung, legale Optimierung" },
  { key: "schulden", gewicht: 1, beschreibung: "Leasing, Kreditkarten, Konsumkredite, Schuldenspirale" },
  { key: "psychologie", gewicht: 2, beschreibung: "Money-Mindset, Lifestyle-Inflation, Impulskäufe, Vergleichsfalle" },
  { key: "nebeneinkommen", gewicht: 1, beschreibung: "Nebenverdienst, Skills monetarisieren, realistische Zahlen" },
  { key: "versicherung", gewicht: 1, beschreibung: "Krankenkasse, Franchise, unnötige Versicherungen" },
];

export const VIDEO = {
  breite: 1080,
  hoehe: 1920,
  fps: 30,
  crf: 20,
  preset: "medium",
  leadIn: 0.35,   // Sekunden Stille vor dem ersten Wort
  tail: 0.9,      // Sekunden Nachlauf nach dem letzten Wort
  minDauer: 12,   // kuerzere Videos werden verworfen und neu generiert
  maxDauer: 75,
};

export const VOICE = {
  // Schweizer Stimmen aus Edge TTS. Alternativen:
  // de-CH-JanNeural, de-CH-LeniNeural, de-DE-KillianNeural, de-DE-SeraphinaMultilingualNeural
  stimmen: ["de-CH-JanNeural", "de-CH-LeniNeural"],
  rate: "+10%",   // etwas schneller = besser fuer Reels
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
};
