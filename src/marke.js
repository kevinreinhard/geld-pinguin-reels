// Das Designsystem des Kanals. Einzige Quelle der Wahrheit fuer Farben,
// Schriftgroessen und Bildaufteilung - src/karten.py bekommt diese Werte als
// JSON und malt danach. Wer den Look aendern will, aendert ihn hier.

export const FARBEN = {
  grund: "#0A1020",        // Basis des Hintergrunds
  grundTief: "#060A14",    // Vignette aussen
  flaeche: "#141E33",      // Karten
  flaecheHell: "#1D2A44",  // abgesetzte Zeilen in Karten
  linie: "#2A3A5C",
  text: "#FFFFFF",
  textLeise: "#93A4C4",
  gold: "#FFC845",         // Markenfarbe, Schal des Pinguins
  gruen: "#3DDC84",        // Vorteil, Ertrag, richtig
  rot: "#FF6B6B",          // Kosten, Verlust, falsch
  blau: "#5AA9FF",         // neutrale Hervorhebung
};

// Jede Szene bekommt eine Stimmung. Sie faerbt Akzent, Hintergrundschimmer und
// die Balken - damit ein Kostenblock rot und ein Ertragsblock gruen wirkt,
// ohne dass das Modell Farbwerte erfinden muss.
export const STIMMUNGEN = {
  neutral: { akzent: FARBEN.gold, schimmer: "#1B2A4A" },
  warnung: { akzent: FARBEN.rot, schimmer: "#33161F" },
  gut: { akzent: FARBEN.gruen, schimmer: "#123123" },
  info: { akzent: FARBEN.blau, schimmer: "#122744" },
};

export const LAYOUT = {
  breite: 1080,
  hoehe: 1920,
  // Instagram legt unten Caption und Ton-Zeile darueber und rechts die Buttons.
  // Alles Wichtige bleibt deshalb zwischen 200 und 1480 und haelt rechts Abstand.
  randX: 92,
  titelY: 230,
  handleY: 292,
  // Buehne der Szenenkarte
  buehneOben: 430,
  buehneUnten: 1240,
  // darunter die Textebene, die libass zeichnet
  untertitelY: 1350,
  fortschrittY: 1462,
};

export const SCHRIFTEN = {
  display: "assets/fonts/Inter-Variable.ttf",
  untertitel: "assets/fonts/Anton-Regular.ttf",
};

/** Alles, was der Python-Renderer braucht, in einem Objekt. */
export function markenSpezifikation() {
  return { farben: FARBEN, stimmungen: STIMMUNGEN, layout: LAYOUT, schriften: SCHRIFTEN };
}
