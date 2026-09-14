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
  // Fuer Fussnoten unter grossen Zahlen. #93A4C4 fiel auf dem Handy gegen die
  // Zahl darueber komplett ab - die Bildkontrolle hat es zweimal gemeldet.
  textStill: "#C3CEE2",
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
  // Die Bildaufteilung. Sie ist ein Kompromiss zwischen zwei Kraeften: Oben
  // liegt Instagrams Kopfzeile, unten Caption und Ton-Zeile - aber wer nur
  // deshalb alles nach oben schiebt, verschenkt die halbe Flaeche und der
  // Blick landet in der Kopfzeile. Der Inhalt sitzt darum so tief, wie es
  // geht, ohne unter die Bedienelemente zu geraten.
  //
  // Nachpruefen statt schaetzen: scripts/instagram-vorschau.py legt die
  // Oberflaeche ueber ein echtes Einzelbild.
  randX: 92,
  titelY: 262,
  handleY: 324,
  // Buehne der Szenenkarte
  buehneOben: 528,
  buehneUnten: 1296,
  // darunter die Textebene, die libass zeichnet
  untertitelY: 1396,
  fortschrittY: 1478,
};

export const SCHRIFTEN = {
  display: "assets/fonts/Inter-Variable.ttf",
  untertitel: "assets/fonts/Anton-Regular.ttf",
};

/** Alles, was der Python-Renderer braucht, in einem Objekt. */
export function markenSpezifikation() {
  return { farben: FARBEN, stimmungen: STIMMUNGEN, layout: LAYOUT, schriften: SCHRIFTEN };
}
