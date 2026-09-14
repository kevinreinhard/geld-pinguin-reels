// Das Designsystem des Kanals. Einzige Quelle der Wahrheit fuer Farben,
// Schriftgroessen und Bildaufteilung - src/karten.py bekommt diese Werte als
// JSON und malt danach. Wer den Look aendern will, aendert ihn hier.
//
// Zwei Themen. Umschalten ueber REEL_THEMA=dunkel oder REEL_THEMA=gelb.
//
// Der Unterschied liegt nur im Hintergrund und in dem, was direkt darauf
// liegt. Die Karten bleiben in beiden Themen dunkel - sie tragen Zahlen,
// Balken und Kurven, und dafuer ist heller Text auf dunklem Grund die
// verlaesslichste Kombination. Getauscht wird, was sie umgibt.

const GEMEINSAM = {
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

export const THEMEN = {
  dunkel: {
    ...GEMEINSAM,
    grund: "#0A1020",       // Basis des Hintergrunds
    grundTief: "#060A14",   // Vignette aussen
    grundHell: "#141E33",   // heller Pol des Verlaufs
    // Was direkt auf dem Hintergrund liegt: Titelzeile, Wasserzeichen,
    // Fortschrittsbalken, Lichtsaum des Pinguins.
    aufGrund: "#FFC845",
    aufGrundLeise: "#FFFFFF",
    balken: "#FFC845",
    saum: "#FFC845",
    // Untertitel stehen frei auf dem Hintergrund und brauchen dort keinen
    // Kasten - dunkler Grund traegt hellen Text von allein.
    untertitelKasten: false,
    schimmerStaerke: 210,
    // Vignette und Koernung sind auf dunkle Flaechen abgestimmt: Sie geben
    // Tiefe und nehmen dem Verlauf das Digitale.
    vignette: "PI/4.2",
    koernung: 7,
  },
  gelb: {
    ...GEMEINSAM,
    grund: "#FFC845",
    grundTief: "#E8A317",
    grundHell: "#FFE08A",
    // Auf Gelb muss alles Freistehende dunkel sein, sonst verschwindet es.
    aufGrund: "#1C1406",
    aufGrundLeise: "#5A4413",
    balken: "#1C1406",
    saum: "#1C1406",
    // Freistehender Text auf Gelb ist der schwierige Fall: Weiss verschwindet,
    // Dunkel schlaegt sich mit dem Karaoke-Wechsel. Deshalb bekommen die
    // Untertitel einen dunklen Kasten - dieselbe Flaeche wie die Karten, und
    // die Schriftfarben bleiben in beiden Themen dieselben.
    untertitelKasten: true,
    schimmerStaerke: 90,
    // Auf Gelb wirkt beides anders. Die Vignette zieht die Raender selbst bei
    // PI/11 sichtbar ins Olivbraune - auf hellem Grund gibt sie keine Tiefe,
    // sie macht nur schmutzig. Sie entfaellt hier ganz. Koernung auf einer
    // flachen hellen Flaeche sieht nach Schmutz aus statt nach Film, bleibt
    // aber ganz leicht drin, damit der Verlauf nicht bandet.
    vignette: null,
    koernung: 2,
  },
};

const GEWAEHLT = process.env.REEL_THEMA === "dunkel" ? "dunkel" : "gelb";

export const THEMA = GEWAEHLT;
export const FARBEN = THEMEN[GEWAEHLT];

// Jede Szene bekommt eine Stimmung. Sie faerbt Akzent, Hintergrundschimmer und
// die Balken - damit ein Kostenblock rot und ein Ertragsblock gruen wirkt,
// ohne dass das Modell Farbwerte erfinden muss.
//
// Der Schimmer liegt im Hintergrund und muss deshalb zum Thema passen: auf
// Dunkel ein farbiger Schein, auf Gelb ein warmer Ton, der die Flaeche nicht
// schmutzig macht.
const SCHIMMER = {
  dunkel: { neutral: "#1B2A4A", warnung: "#33161F", gut: "#123123", info: "#122744" },
  gelb: { neutral: "#FFD873", warnung: "#F58A6A", gut: "#9BD9A6", info: "#8FC4F0" },
};

export const STIMMUNGEN = {
  neutral: { akzent: FARBEN.gold, schimmer: SCHIMMER[GEWAEHLT].neutral },
  warnung: { akzent: FARBEN.rot, schimmer: SCHIMMER[GEWAEHLT].warnung },
  gut: { akzent: FARBEN.gruen, schimmer: SCHIMMER[GEWAEHLT].gut },
  info: { akzent: FARBEN.blau, schimmer: SCHIMMER[GEWAEHLT].info },
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
