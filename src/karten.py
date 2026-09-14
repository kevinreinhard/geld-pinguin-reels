"""Rendert die Bildebene eines Reels: Szenenkarten, Diagramme, Maskottchen.

Eingabe ist eine JSON-Spezifikation (src/regie.js baut sie, src/render.js reicht
sie durch), Ausgabe sind PNG-Ebenen mit Transparenz plus eine concat-Liste, die
ffmpeg als Zeitleiste liest.

Warum Einzelbilder und nicht ffmpeg-Filter: Balken, die wachsen, Zahlen, die
hochzaehlen, und Listen, die nacheinander erscheinen, sind mit drawbox-Ausdruecken
kaum zu bauen und noch schwerer zu aendern. Pillow zeichnet nur die Bilder, die
sich wirklich unterscheiden - eine ruhende Karte ist ein einziges Bild, das
ffmpeg ueber seine Standzeit haelt.
"""

import json
import math
import os
import shutil
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pinguin import zeichne as zeichne_pinguin  # noqa: E402

ANIM_FPS = 24          # Taktung der bewegten Abschnitte
EIN = 0.42             # Einblenden
DATEN = 2.60           # Fenster fuer Bewegung innerhalb einer Szene

# Innerhalb dieses Fensters laeuft die Hauptbewegung zuerst, die Nebenelemente
# danach - eine Karte, die nach einer Sekunde fertig ist, steht die restlichen
# vier still. Der Aufbau selbst bleibt aber schnell: Die Bildkontrolle sieht
# Standbilder, kein Video, und eine Liste, von der erst eine Zeile stand, hat
# sie als "zu drei Vierteln leer" gemeldet. Schnell aufbauen, danach eine
# zweite, kleinere Bewegung.
HAUPT = 0.32           # Anteil des Fensters fuer Zahl, Balken, Kurve
NEBEN = (0.46, 0.80)   # Anteil, in dem Fussnoten und Werte nachziehen

# In der Eroeffnung zaehlt die Zahl langsamer hoch. Die Bildkontrolle entnimmt
# ihre ersten drei Bilder aus den ersten zwei Sekunden, und dreimal dasselbe
# Standbild ist genau der Eindruck, den ein Zuschauer beim Wischen bekommt.
# Wichtig bleibt, dass die Zahl nie bei null steht - siehe kennzahl().
HAUPT_ERSTE = 0.80
AUS = 0.24             # Ausblenden


# --------------------------------------------------------------- Grundlagen

def hexfarbe(s, alpha=255):
    s = s.lstrip("#")
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), alpha)


def mische(a, b, t):
    """Blendet zwei Farben, behaelt die Deckkraft von a."""
    return tuple(round(x + (y - x) * t) for x, y in zip(a[:3], b[:3])) + (a[3] if len(a) > 3 else 255,)


def ease_out(t):
    return 1 - (1 - t) ** 3


def nachzug(p, versatz=0.0, sofort=False):
    """Fortschritt des nachziehenden Elements, 0 bis 1.

    In der Eroeffnungsszene zieht nichts nach: Dort stand die Zahl sekundenlang
    ohne ihre Bezugsgroesse im Bild, und die ersten zwei Sekunden sind genau
    die, in denen jemand entscheidet, ob er bleibt.
    """
    if sofort:
        return 1.0
    a, b = NEBEN[0] + versatz, NEBEN[1] + versatz
    return min(1.0, max(0.0, (p - a) / (b - a)))


def ease_out_back(t):
    c1, c3 = 1.70158, 2.70158
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2


class Schriften:
    """Zwischenspeicher fuer Schnitte der variablen Inter."""

    def __init__(self, pfad):
        self.pfad = pfad
        self._cache = {}

    def __call__(self, groesse, schnitt="Bold"):
        key = (int(groesse), schnitt)
        if key not in self._cache:
            f = ImageFont.truetype(self.pfad, int(groesse))
            try:
                f.set_variation_by_name(schnitt)
            except Exception:
                pass
            self._cache[key] = f
        return self._cache[key]


def breite(d, text, font, spacing=0):
    if not text:
        return 0
    b = d.textbbox((0, 0), text, font=font)
    return (b[2] - b[0]) + spacing * max(0, len(text) - 1)


def sperr(d, xy, text, font, fill, spacing, anchor_mitte=False):
    """Gesperrter Text - Pillow kennt keinen Buchstabenabstand.

    Jedes Zeichen wird auf der Grundlinie gesetzt, nicht an seiner Oberkante.
    Sonst rutschen Punkt und Komma nach oben und lesen sich wie Apostrophe,
    und ein Ü landet tiefer als die Grossbuchstaben daneben.
    """
    ges = breite(d, text, font, spacing)
    x, y = xy
    grundlinie = y + font.getmetrics()[0]
    if anchor_mitte:
        x -= ges / 2
    for ch in text:
        d.text((x, grundlinie), ch, font=font, fill=fill, anchor="ls")
        x += breite(d, ch, font) + spacing
    return ges


def umbrich(d, text, font, maxbreite):
    worte, zeilen, aktuell = str(text).split(), [], ""
    for w in worte:
        probe = (aktuell + " " + w).strip()
        if breite(d, probe, font) <= maxbreite or not aktuell:
            aktuell = probe
        else:
            zeilen.append(aktuell)
            aktuell = w
    if aktuell:
        zeilen.append(aktuell)
    return zeilen


def kuerze(d, text, font, maxbreite, maxzeilen):
    """Umbricht und macht sichtbar, wenn etwas fehlt.

    Ein stilles [:maxzeilen] hat auf einer Vergleichskarte aus
    'mehrere 1.000 Euro' ein 'mehrere 1.00' gemacht - der Rest war weg, ohne
    dass es jemand sehen konnte. Lieber ein Auslassungszeichen als ein Wert,
    der falsch dasteht.
    """
    zeilen = umbrich(d, text, font, maxbreite)
    if len(zeilen) <= maxzeilen:
        return zeilen
    gekuerzt = zeilen[:maxzeilen]
    gekuerzt[-1] = gekuerzt[-1].rstrip() + "…"
    return gekuerzt


def passe_an(d, text, schriften, groessen, maxbreite, maxzeilen, schnitt="Black"):
    """Groesste Schriftgroesse, in der der Text noch in maxzeilen Zeilen passt.

    Ohne das schneidet ein Aufruf wie 'Mehr Tricks gegen Bankgebuehren' auf der
    Endkarte einfach ab - genau das ist beim ersten Durchlauf passiert.
    """
    for groesse in groessen:
        font = schriften(groesse, schnitt)
        zeilen = umbrich(d, text, font, maxbreite)
        # Die Zeilenzahl allein genuegt nicht: "GEHALTSERHOEHUNG" ist ein
        # einziges Wort, das sich nicht umbrechen laesst. umbrich() setzt es
        # trotzdem in eine Zeile, und die war dann breiter als die Karte.
        breiteste = max((breite(d, z, font) for z in zeilen), default=0)
        if len(zeilen) <= maxzeilen and breiteste <= maxbreite:
            return font, zeilen
    # Keine Stufe passt. Dann wird die Groesse ausgerechnet statt geraten -
    # sonst laeuft ein einzelnes langes Wort ueber die Karte hinaus, und die
    # Stufenliste endet einfach, ohne dass es jemand merkt.
    font = schriften(groessen[-1], schnitt)
    zeilen = kuerze(d, text, font, maxbreite, maxzeilen)
    breiteste = max((breite(d, z, font) for z in zeilen), default=0)
    if breiteste > maxbreite:
        font = schriften(max(28, int(groessen[-1] * maxbreite / breiteste)), schnitt)
        zeilen = kuerze(d, text, font, maxbreite, maxzeilen)
    return font, zeilen


def schatten(bild, box, radius, staerke=95, streuung=26, versatz=16):
    """Weicher Schlagschatten unter einer Karte."""
    ebene = Image.new("RGBA", bild.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ebene)
    d.rounded_rectangle(
        [box[0], box[1] + versatz, box[2], box[3] + versatz],
        radius=radius, fill=(0, 0, 0, staerke),
    )
    bild.alpha_composite(ebene.filter(ImageFilter.GaussianBlur(streuung)))


# --------------------------------------------------------------- Zahlen

def zerlege_zahl(s):
    """'1.247,50' -> (1247.5, Nachkommastellen, Tausenderpunkte ja/nein)."""
    roh = str(s).strip().replace(" ", "").replace(" ", "")
    if not roh or not any(c.isdigit() for c in roh):
        return None, 0, False
    nachkomma = 0
    if "," in roh:                      # deutsches Dezimalkomma
        nachkomma = len(roh.split(",")[-1])
        norm = roh.replace(".", "").replace(",", ".")
    elif roh.count(".") and len(roh.split(".")[-1]) == 3:   # 24.000
        norm = roh.replace(".", "")
    else:
        norm = roh
    try:
        wert = float(norm)
    except ValueError:
        return None, 0, False
    return wert, nachkomma, abs(wert) >= 1000


def formatiere(wert, nachkomma, tausender):
    """Deutsche Schreibweise: Punkt als Tausender-, Komma als Dezimaltrenner."""
    s = f"{wert:,.{nachkomma}f}"            # 1,247.50
    s = s.replace(",", "\x01").replace(".", ",").replace("\x01", ".")
    if not tausender:
        s = s.replace(".", "")
    return s


# --------------------------------------------------------------- Szenenkarten

class Maler:
    def __init__(self, spec):
        self.spec = spec
        self.F = {k: hexfarbe(v) for k, v in spec["marke"]["farben"].items()}
        self.STIMMUNG = spec["marke"]["stimmungen"]
        self.L = spec["marke"]["layout"]
        self.f = Schriften(spec["marke"]["schriften"]["display"])
        self.W, self.H = self.L["breite"], self.L["hoehe"]
        self._pinguine = {}
        self._glanz = {}

    def glanz(self, szene):
        """Weicher Farbschleier hinter der Karte.

        Er traegt die Stimmung der Szene in den Hintergrund: Bei einem Schnitt
        wechselt nicht nur die Karte, sondern der ganze Bildton. Einmal je Farbe
        berechnet - ein Gaussscher Weichzeichner auf 1080x1920 kostet zu viel,
        um ihn je Einzelbild zu wiederholen.
        """
        name = szene.get("stimmung", "neutral")
        if name not in self._glanz:
            st = self.STIMMUNG.get(name, self.STIMMUNG["neutral"])
            farbe = hexfarbe(st.get("schimmer", st["akzent"]))
            ebene = Image.new("RGBA", (self.W // 4, self.H // 4), (0, 0, 0, 0))
            d = ImageDraw.Draw(ebene)
            cx, cy = self.W / 8, (self.L["buehneOben"] + self.L["buehneUnten"]) / 8
            d.ellipse([cx - 170, cy - 150, cx + 170, cy + 150], fill=farbe[:3] + (210,))
            ebene = ebene.filter(ImageFilter.GaussianBlur(52)).resize(
                (self.W, self.H), Image.BILINEAR)
            self._glanz[name] = ebene
        return self._glanz[name]

    def akzent(self, szene):
        st = self.STIMMUNG.get(szene.get("stimmung", "neutral"), self.STIMMUNG["neutral"])
        return hexfarbe(st["akzent"])

    def setze_pinguin(self, bild, pos, groesse, blick=0.0, augen="offen"):
        """Setzt das Maskottchen mit weichem Lichtsaum.

        Sein Koerper ist fast so dunkel wie der Hintergrund. Ohne Saum schweben
        nur Bauch und Gesicht im Bild, der Rest verschwindet - auf der Endkarte
        war genau das zu sehen. Der Saum entsteht aus der eigenen Silhouette,
        deshalb passt er immer, egal wie die Figur steht.
        """
        ping = self.pinguin(groesse, blick=blick, augen=augen)
        saum = Image.new("RGBA", ping.size, self.F["gold"][:3] + (0,))
        saum.putalpha(
            ping.getchannel("A").filter(ImageFilter.GaussianBlur(groesse / 20))
            .point(lambda v: min(104, int(v * 0.55)))
        )
        bild.alpha_composite(saum, pos)
        bild.alpha_composite(ping, pos)

    def pinguin(self, groesse, blick=0.0, augen="offen"):
        key = (int(groesse), round(blick, 2), augen)
        if key not in self._pinguine:
            self._pinguine[key] = zeichne_pinguin(int(groesse), blick=blick, augen=augen)
        return self._pinguine[key]

    # -------------------------------------------------- gemeinsame Bausteine

    def buehne(self):
        return self.L["buehneOben"], self.L["buehneUnten"]

    def karte(self, bild, hoehe, kartenbreite=None, oben=None, pinguin=True):
        """Zeichnet die Grundkarte mittig auf der Buehne, liefert ihre Box."""
        o, u = self.buehne()
        b = kartenbreite or (self.W - 2 * self.L["randX"])
        hoehe = min(hoehe, u - o)
        x0 = (self.W - b) / 2
        y0 = oben if oben is not None else (o + u) / 2 - hoehe / 2
        box = [x0, y0, x0 + b, y0 + hoehe]
        schatten(bild, box, 46)
        # Der Pinguin lugt hinter der oberen Kartenkante hervor. Er wird vor
        # der Karte gezeichnet, damit die Karte ihn zur Haelfte verdeckt. Ohne
        # ihn waren die Inhaltskarten dunkle Rechtecke, die von jedem
        # beliebigen Finanzkanal haetten stammen koennen.
        if pinguin:
            gr = 220
            self.setze_pinguin(bild, (int(box[2] - gr - 10), int(y0 - gr * 0.50)), gr,
                               blick=-0.6)
        d = ImageDraw.Draw(bild)
        d.rounded_rectangle(box, radius=46, fill=self.F["flaeche"])
        d.rounded_rectangle(box, radius=46, outline=self.F["linie"], width=2)
        # Markenband an der Oberkante. Ohne das waren die Inhaltskarten dunkle
        # Rechtecke, die von jedem beliebigen Kanal haetten stammen koennen.
        d.rounded_rectangle([box[0] + 46, box[1] - 5, box[0] + 158, box[1] + 5],
                            radius=5, fill=self.F["gold"])
        return box

    def kicker(self, d, text, y, farbe, box=None, erste=False):
        """Kleine gesperrte Ueberschrift ueber der eigentlichen Aussage.

        Sie passt sich der Karte an. Bei fester Groesse lief
        'DURCHSCHNITTLICHE ERSTATTUNG' ueber die Kartenkante hinaus - und zwar
        im Hook, also genau dort, wo es am meisten kostet. Erst wird der
        Buchstabenabstand enger, dann die Schrift kleiner; der gesperrte Satz
        ist ein Gestaltungsmittel und nicht wichtiger als ein vollstaendiges
        Wort.
        """
        text = str(text or "").upper()
        if not text:
            return y
        maxbreite = (box[2] - box[0] - 76) if box else (self.W - 2 * self.L["randX"] - 76)
        stufen = ((52, 6), (46, 5), (40, 4), (36, 4), (32, 3), (28, 3), (24, 2)) if erste             else ((40, 6), (40, 4), (36, 4), (32, 3), (28, 3), (24, 2))
        for groesse, spacing in stufen:
            font = self.f(groesse, "Bold")
            if breite(d, text, font, spacing) <= maxbreite:
                break
        sperr(d, (self.W / 2, y), text, font, farbe, spacing, anchor_mitte=True)
        return y + groesse + 26

    # -------------------------------------------------- Szenentypen

    def kennzahl(self, bild, s, p):
        d = ImageDraw.Draw(bild)
        akz = self.akzent(s)
        wert, nachkomma, tausender = zerlege_zahl(s.get("wert", ""))
        if wert is None:
            text = str(s.get("wert", ""))
        else:
            # Hochzaehlen, aber nie bei null beginnen: Im ersten sichtbaren
            # Bild stand sonst "0 %" - in einem Reel ueber zwoelf Prozent
            # Aufschlag ist das die Gegenaussage, und die ersten Sekunden sind
            # genau die, auf die es ankommt.
            fenster = HAUPT_ERSTE if s.get("satz") == 0 else HAUPT
            t = min(1.0, p / fenster)
            anteil = 0.55 + 0.45 * ease_out(t)
            text = formatiere(wert * anteil, nachkomma if t >= 1 else min(nachkomma, 1),
                              tausender)

        einheit = str(s.get("einheit", ""))
        box = self.karte(bild, 540)
        y = box[1] + 66
        y = self.kicker(d, s.get("kicker", ""), y, akz, box, s.get("satz") == 0)

        # Zahl und Einheit muessen zusammen in die Karte passen. Die letzte
        # Stufe rechnet die Groesse aus, statt sie zu raten: Bei einer langen
        # Einheit lief die Zeile sonst auf beiden Seiten ueber die Karte hinaus.
        maxb = box[2] - box[0] - 120
        groesse, ges = 240, 0
        for stufe in (240, 210, 180, 155, 130, 110, 92, 78):
            groesse = stufe
            fz = self.f(groesse, "Black")
            fe = self.f(groesse * 0.52, "Bold")
            ges = breite(d, text, fz) + (breite(d, einheit, fe) + 20 if einheit else 0)
            if ges <= maxb:
                break
        if ges > maxb:
            groesse = max(40, int(groesse * maxb / ges))
            fz = self.f(groesse, "Black")
            fe = self.f(groesse * 0.52, "Bold")
            ges = breite(d, text, fz) + (breite(d, einheit, fe) + 20 if einheit else 0)
        mitte_y = y + 132
        x = self.W / 2 - ges / 2
        d.text((x, mitte_y), text, font=fz, fill=akz, anchor="lm")
        if einheit:
            d.text((x + breite(d, text, fz) + 20, mitte_y + groesse * 0.14), einheit,
                   font=fe, fill=mische(akz, self.F["flaeche"], 0.3), anchor="lm")

        # Die Fussnote faehrt erst nach der Zahl ein - die zweite Bewegung in
        # der Szene, damit die Karte nicht nach einer Sekunde erstarrt.
        tn = nachzug(p, sofort=s.get("satz") == 0)
        if s.get("fussnote") and tn > 0:
            ff = self.f(48, "Medium")
            farbe = self.F["textStill"][:3] + (int(255 * min(1.0, tn * 1.4)),)
            for i, zeile in enumerate(kuerze(d, s["fussnote"], ff, maxb, 2)):
                d.text((self.W / 2, mitte_y + 122 + i * 58 + (1 - ease_out(tn)) * 26), zeile,
                       font=ff, fill=farbe, anchor="mt")

    def vergleich(self, bild, s, p):
        d = ImageDraw.Draw(bild)
        zeilen = list(s.get("zeilen", []))[:3]
        box = self.karte(bild, 210 + len(zeilen) * 152)
        y = box[1] + 64
        y = self.kicker(d, s.get("kicker", ""), y, self.akzent(s), box, s.get("satz") == 0)

        x0, x1 = box[0] + 58, box[2] - 58
        anteile = [max(0.02, float(z.get("anteil", 0.5))) for z in zeilen] or [1]
        maxanteil = max(anteile)
        fl, fw = self.f(44, "SemiBold"), self.f(50, "Black")
        for i, z in enumerate(zeilen):
            farbe = hexfarbe(self.STIMMUNG.get(z.get("stimmung", "neutral"),
                                               self.STIMMUNG["neutral"])["akzent"])
            wert = str(z.get("wert", ""))
            wb = breite(d, wert, fw)
            flz, zeilen = passe_an(d, z.get("label", ""), self.f, (44, 40, 36, 32),
                                   x1 - x0 - wb - 30, 1, "SemiBold")
            d.text((x0, y + 8), zeilen[0] if zeilen else "", font=flz,
                   fill=self.F["text"], anchor="lt")
            tw = nachzug(p, i * 0.06)
            if tw > 0:
                d.text((x1, y + 2 + (1 - ease_out(tw)) * 14), wert, font=fw,
                       fill=farbe[:3] + (int(255 * min(1.0, tw * 1.6)),), anchor="rt")

            by = y + 76
            d.rounded_rectangle([x0, by, x1, by + 30], radius=15, fill=self.F["flaecheHell"])
            # Gestaffelt: Zeile i startet etwas spaeter als Zeile i-1.
            tz = min(1.0, max(0.0, (p - i * 0.06) / HAUPT))
            b = (x1 - x0) * (anteile[i] / maxanteil) * ease_out(tz)
            if b > 6:
                d.rounded_rectangle([x0, by, x0 + b, by + 30], radius=15, fill=farbe)
            y += 152

    def liste(self, bild, s, p):
        d = ImageDraw.Draw(bild)
        punkte = list(s.get("punkte", []))[:4]
        box = self.karte(bild, 180 + len(punkte) * 130)
        y = box[1] + 64
        y = self.kicker(d, s.get("kicker", ""), y, self.akzent(s), box, s.get("satz") == 0)

        x0 = box[0] + 56
        ft = self.f(48, "SemiBold")
        for i, pt in enumerate(punkte):
            # Jeder Punkt klappt einzeln herein - der Blick wandert mit.
            # Der erste Punkt steht fest, aus demselben Grund wie in hook():
            # Waehrend des Einblendens ist p noch null, und eine Karte, auf der
            # nur die Ueberschrift steht, sieht nach einem Fehler aus.
            tp = 1.0 if i == 0 else min(1.0, max(0.0, (p - i * 0.09) / (HAUPT * 0.8)))
            if tp <= 0:
                y += 130
                continue
            versatz = (1 - ease_out(tp)) * 42
            alpha = int(255 * min(1.0, tp * 1.7))
            zeichen = pt.get("zeichen", "punkt")
            basis = {"ja": self.F["gruen"], "nein": self.F["rot"]}.get(zeichen, self.F["gold"])
            farbe = basis[:3] + (alpha,)

            cx, cy = x0 + 34, y + 38
            d.ellipse([cx - 34, cy - 34, cx + 34, cy + 34],
                      fill=mische(basis, self.F["flaeche"], 0.76)[:3] + (alpha,))
            if zeichen == "ja":
                d.line([(cx - 15, cy + 1), (cx - 4, cy + 14), (cx + 16, cy - 14)],
                       fill=farbe, width=8, joint="curve")
            elif zeichen == "nein":
                d.line([(cx - 13, cy - 13), (cx + 13, cy + 13)], fill=farbe, width=8)
                d.line([(cx - 13, cy + 13), (cx + 13, cy - 13)], fill=farbe, width=8)
            else:
                d.ellipse([cx - 9, cy - 9, cx + 9, cy + 9], fill=farbe)

            # Ein Punkt mit rotem Kreuz muss sich auch im Text vom Haken
            # abheben. Sonst liest sich "Mini-Ansprueche wie im Minijob" unter
            # der Ueberschrift "DEIN VORTEIL" wie ein Vorteil - genau so ist es
            # live gegangen.
            tf = (self.F["rot"] if zeichen == "nein" else self.F["text"])[:3] + (alpha,)
            for j, zeile in enumerate(kuerze(d, pt.get("text", ""), ft, box[2] - x0 - 130, 2)):
                d.text((x0 + 94 + versatz, y + 6 + j * 54), zeile, font=ft, fill=tf, anchor="lt")
            y += 130

    def verlauf(self, bild, s, p):
        d = ImageDraw.Draw(bild)
        akz = self.akzent(s)
        werte = [float(v) for v in s.get("werte", [])] or [0.0, 1.0]
        if len(werte) < 2:
            werte = [0.0] + werte
        box = self.karte(bild, 600)
        y = box[1] + 64
        y = self.kicker(d, s.get("kicker", ""), y, akz, box, s.get("satz") == 0)

        # Der Endwert steht ueber dem Raster und braucht seine eigene Zeile -
        # direkt am Kurvenende ueberdeckt er die oberste Hilfslinie.
        endwert = str(s.get("endwert", "") or "")
        gx0, gx1 = box[0] + 74, box[2] - 74
        gy0, gy1 = y + (108 if endwert else 40), box[3] - 120
        hoch, tief = max(werte), min(werte)
        spanne = (hoch - tief) or 1.0

        for i in range(4):   # Hilfslinien
            ly = gy0 + (gy1 - gy0) * i / 3
            d.line([(gx0, ly), (gx1, ly)], fill=self.F["linie"], width=2)

        n = len(werte)
        punkte = [(gx0 + (gx1 - gx0) * i / (n - 1),
                   gy1 - (gy1 - gy0) * (v - tief) / spanne) for i, v in enumerate(werte)]

        # Die Kurve waechst von links nach rechts.
        t = min(1.0, p / HAUPT)
        bis_x = gx0 + (gx1 - gx0) * ease_out(t)
        sichtbar = [pt for pt in punkte if pt[0] <= bis_x]
        if sichtbar and len(sichtbar) < len(punkte):
            a, b = punkte[len(sichtbar) - 1], punkte[len(sichtbar)]
            f = (bis_x - a[0]) / ((b[0] - a[0]) or 1)
            sichtbar.append((bis_x, a[1] + (b[1] - a[1]) * f))
        if len(sichtbar) >= 2:
            flaeche = Image.new("RGBA", bild.size, (0, 0, 0, 0))
            ImageDraw.Draw(flaeche).polygon(
                sichtbar + [(sichtbar[-1][0], gy1), (gx0, gy1)], fill=akz[:3] + (56,))
            bild.alpha_composite(flaeche)
            d.line(sichtbar, fill=akz, width=9, joint="curve")
            kx, ky = sichtbar[-1]
            d.ellipse([kx - 17, ky - 17, kx + 17, ky + 17], fill=akz)
            d.ellipse([kx - 7, ky - 7, kx + 7, ky + 7], fill=self.F["flaeche"])

        fa = self.f(38, "Medium")
        d.text((gx0, gy1 + 28), str(s.get("von", "")), font=fa,
               fill=self.F["textLeise"], anchor="lt")
        d.text((gx1, gy1 + 28), str(s.get("bis", "")), font=fa,
               fill=self.F["textLeise"], anchor="rt")
        if endwert and t > 0.7:
            fe = self.f(66, "Black")
            a = int(255 * min(1.0, (t - 0.7) / 0.3))
            d.text((gx1, gy0 - 22), endwert, font=fe, fill=akz[:3] + (a,), anchor="rb")

    def stichwort(self, bild, s, p):
        d = ImageDraw.Draw(bild)
        akz = self.akzent(s)
        maxb = self.W - 2 * self.L["randX"] - 120
        ft, zeilen = passe_an(d, s.get("begriff", ""), self.f,
                              (108, 96, 84, 74, 64), maxb, 3)
        # Auch die Erlaeuterung wird angepasst, nicht nur der Begriff. Bei
        # fester Groesse sprengt ein langes Wort wie
        # "Rentenversicherungsbeitragsbemessungsgrenze" die Karte.
        if s.get("erlaeuterung"):
            fe, ezeilen = passe_an(d, s["erlaeuterung"], self.f, (46, 42, 38, 34, 30),
                                   maxb, 3, "Medium")
        else:
            fe, ezeilen = self.f(46, "Medium"), []

        hoehe = 200 + len(zeilen) * (ft.size + 18) + (len(ezeilen) * 58 + 34 if ezeilen else 0)
        box = self.karte(bild, hoehe)
        y = box[1] + 64
        y = self.kicker(d, s.get("kicker", ""), y, akz, box, s.get("satz") == 0)
        for zeile in zeilen:
            d.text((self.W / 2, y), zeile, font=ft, fill=self.F["text"], anchor="mt")
            y += ft.size + 18
        tn = nachzug(p, sofort=s.get("satz") == 0)
        if ezeilen and tn > 0:
            y += 24
            farbe = self.F["textStill"][:3] + (int(255 * min(1.0, tn * 1.4)),)
            for zeile in ezeilen:
                d.text((self.W / 2, y + (1 - ease_out(tn)) * 22), zeile,
                       font=fe, fill=farbe, anchor="mt")
                y += 58
        d.rounded_rectangle([self.W / 2 - 58, box[3] - 42, self.W / 2 + 58, box[3] - 32],
                            radius=5, fill=akz)

    def hook(self, bild, s, p):
        """Eroeffnung: Der Pinguin bringt die Behauptung mit."""
        d = ImageDraw.Draw(bild)
        akz = self.akzent(s)
        o, u = self.buehne()
        groesse = 400
        t = min(1.0, p / 0.30)
        # Wippt herein und atmet danach weiter. Die Hook-Karte war die einzige
        # ohne eigene Bewegung, und sie steht ausgerechnet dort, wo entschieden
        # wird, ob jemand bleibt.
        # Setzt sich von oben herab statt von unten heraufzuwippen. Der alte
        # Weg liess ihn zu Beginn 90 Pixel tiefer stehen - genau dort, wo die
        # erste Textzeile liegt, und der Balken schnitt ihm die Fuesse ab.
        hoch = -(1 - ease_out_back(t)) * 46 + math.sin(p * 6.0) * 5 * t
        self.setze_pinguin(bild, (int(self.W / 2 - groesse / 2), int(o + 10 + hoch)), groesse)

        text = str(s.get("begriff", "")).strip()
        if not text:
            return
        ft, zeilen = passe_an(d, text.upper(), self.f, (92, 82, 72, 62, 54),
                              self.W - 2 * self.L["randX"] - 90, 3)
        y = o + 10 + groesse + 58
        for i, zeile in enumerate(zeilen):
            # Zeile fuer Zeile, jede mit kurzem Versatz - so passiert in der
            # Eroeffnung ueber mehr als eine Sekunde etwas.
            # Die erste Zeile steht fest. Waehrend des Einblendens ist der
            # Fortschritt p noch null - alles, was von p abhaengt, fehlt dort.
            # Ein Eroeffnungsbild mit nur dem Maskottchen sagt in der
            # wichtigsten halben Sekunde nichts aus.
            tz = 1.0 if i == 0 else min(1.0, max(0.0, (p - i * 0.15) / 0.24))
            if tz <= 0:
                y += ft.size + 30
                continue
            e = ease_out(tz)
            versatz = (1 - e) * 34
            b = breite(d, zeile, ft)
            ebene = Image.new("RGBA", bild.size, (0, 0, 0, 0))
            ed = ImageDraw.Draw(ebene)
            ed.rounded_rectangle([self.W / 2 - b / 2 - 26, y - 8 + versatz,
                                  self.W / 2 + b / 2 + 26, y + ft.size + 16 + versatz],
                                 radius=18, fill=akz)
            ed.text((self.W / 2, y + 2 + versatz), zeile, font=ft,
                    fill=self.F["grund"], anchor="mt")
            if e < 1:
                ebene.putalpha(ebene.getchannel("A").point(lambda v: int(v * e)))
            bild.alpha_composite(ebene)
            y += ft.size + 30

    def endkarte(self, bild, s, p):
        d = ImageDraw.Draw(bild)
        o, u = self.buehne()
        groesse = 360
        # Blinzeln: zweimal kurz in der Endkarte, das macht die Figur lebendig.
        augen = "zu" if 0.45 < (p % 0.55) < 0.55 else "offen"
        self.setze_pinguin(bild, (int(self.W / 2 - groesse / 2), int(o + 30)), groesse,
                           augen=augen)

        ft, zeilen = passe_an(d, str(s.get("begriff", "Folge für mehr")).upper(), self.f,
                              (84, 74, 66, 58, 50), self.W - 2 * self.L["randX"], 2)
        y = o + 30 + groesse + 36
        for zeile in zeilen:
            d.text((self.W / 2, y), zeile, font=ft, fill=self.F["text"], anchor="mt")
            y += ft.size + 14

        handle = str(self.spec.get("handle", ""))
        if handle:
            fh = self.f(56, "Bold")
            b = breite(d, handle, fh)
            y += 24
            d.rounded_rectangle([self.W / 2 - b / 2 - 36, y, self.W / 2 + b / 2 + 36, y + 92],
                                radius=46, fill=self.F["gold"])
            d.text((self.W / 2, y + 46), handle, font=fh, fill=self.F["grund"], anchor="mm")

    TYPEN = {
        "kennzahl": kennzahl, "vergleich": vergleich, "liste": liste,
        "verlauf": verlauf, "stichwort": stichwort, "hook": hook, "endkarte": endkarte,
    }

    def zeichne_szene(self, szene, p, alpha, versatz):
        """Ein Einzelbild der Szene bei Fortschritt p, Deckkraft alpha, Versatz in Pixeln."""
        bild = Image.new("RGBA", (self.W, self.H), (0, 0, 0, 0))
        bild.alpha_composite(self.glanz(szene))
        fn = self.TYPEN.get(szene.get("typ"), Maler.stichwort)
        fn(self, bild, szene, p)
        if versatz:
            verschoben = Image.new("RGBA", bild.size, (0, 0, 0, 0))
            verschoben.paste(bild, (0, int(versatz)))
            bild = verschoben
        if alpha < 1:
            bild.putalpha(bild.getchannel("A").point(lambda v: int(v * alpha)))
        return bild


# --------------------------------------------------------------- Zeitleiste

def baue(spec):
    ziel = spec["ausgabe"]
    shutil.rmtree(ziel, ignore_errors=True)
    os.makedirs(ziel, exist_ok=True)
    maler = Maler(spec)
    dauer = float(spec["dauer"])

    eintraege = []      # (dateiname, standzeit)
    nr = 0
    leerbild_da = False

    def leer(laenge):
        nonlocal leerbild_da
        if laenge <= 0.01:
            return
        if not leerbild_da:
            Image.new("RGBA", (maler.W, maler.H), (0, 0, 0, 0)).save(
                os.path.join(ziel, "leer.png"), compress_level=1)
            leerbild_da = True
        eintraege.append(("leer.png", laenge))

    def schreibe(bild, laenge):
        nonlocal nr
        name = f"e{nr:04d}.png"
        bild.save(os.path.join(ziel, name), compress_level=1)
        eintraege.append((name, laenge))
        nr += 1

    uhr = 0.0
    for szene in spec["szenen"]:
        start, ende = float(szene["start"]), float(szene["ende"])
        leer(start - uhr)
        laenge = ende - start
        if laenge < 0.5:
            uhr = max(uhr, ende)
            continue

        ein = min(EIN, laenge * 0.3)
        aus = min(AUS, laenge * 0.2)
        daten = min(DATEN, max(0.0, laenge - ein - aus - 0.25))
        schritt = 1.0 / ANIM_FPS

        n = max(1, round(ein / schritt))
        for i in range(n):
            e = ease_out((i + 1) / n)
            schreibe(maler.zeichne_szene(szene, 0.0, e, (1 - e) * 46), ein / n)

        if daten > 0.02:
            n = max(1, round(daten / schritt))
            for i in range(n):
                schreibe(maler.zeichne_szene(szene, (i + 1) / n, 1.0, 0), daten / n)

        halten = laenge - ein - daten - aus
        if halten > 0.01:
            schreibe(maler.zeichne_szene(szene, 1.0, 1.0, 0), halten)

        n = max(1, round(aus / schritt))
        for i in range(n):
            t = (i + 1) / n
            schreibe(maler.zeichne_szene(szene, 1.0, 1 - t, -t * 22), aus / n)

        uhr = ende

    leer(dauer - uhr)

    liste = os.path.join(ziel, "ebenen.txt")
    with open(liste, "w", encoding="utf8") as f:
        f.write("ffconcat version 1.0\n")
        for name, laenge in eintraege:
            f.write(f"file '{name}'\nduration {laenge:.4f}\n")
        if eintraege:
            f.write(f"file '{eintraege[-1][0]}'\n")   # haelt die letzte Standzeit
    return {"liste": liste, "bilder": nr, "eintraege": len(eintraege)}


if __name__ == "__main__":
    with open(sys.argv[1], encoding="utf8") as f:
        spec = json.load(f)
    print(json.dumps(baue(spec)))
