# Polaris: vollständiges Spielkonzept

**Stand: 11. November 2026, nach bestätigten Nutzerentscheidungen. Zieldesign mit vorläufigem Testregelsatz, keine Gameplay-Implementierung.**

Dieses Dokument hält das gemeinsam entwickelte Zielspiel fest. Es ist zusammen mit dem [abhängigkeitsgeordneten Umsetzungsplan](umsetzungsplan.md) lesbar, ohne den vorausgegangenen Chat zu kennen. Der [englische Regelstand](game-design.md) beschreibt die vorhandene Entwicklungsbasis. **Auf ausdrückliche Präzisierung des Nutzers werden alle offenen PRs als vorgesehene Gesamtbasis berücksichtigt: Sie sollen alle freigegeben werden.** Das neue Zielspiel baut darauf auf; bestehende Spielstände werden dadurch nicht umgedeutet.

## Inhalt

1. [Verbindlichkeit und tatsächlicher Entwicklungsstand](#1-verbindlichkeit-und-tatsächlicher-entwicklungsstand)
2. [Spielversprechen und Welt](#2-spielversprechen-und-welt)
3. [Partie, Karte und Information](#3-partie-karte-und-information)
4. [Ressourcen und Verbesserungen](#4-ressourcen-und-verbesserungen)
5. [Städte, Bevölkerung und Produktion](#5-städte-bevölkerung-und-produktion)
6. [Versorgung und deterministischer Zugabschluss](#6-versorgung-und-deterministischer-zugabschluss)
7. [Einheiten und taktischer Kampf](#7-einheiten-und-taktischer-kampf)
8. [Belagerung und Besetzung](#8-belagerung-und-besetzung)
9. [Die vier Stämme](#9-die-vier-stämme)
10. [Forschung, Gesellschaft und spätere Systeme](#10-forschung-gesellschaft-und-spätere-systeme)
11. [Sieg, Niederlage und Unentschieden](#11-sieg-niederlage-und-unentschieden)
12. [Bedienung, Darstellung und technische Verträge](#12-bedienung-darstellung-und-technische-verträge)
13. [Durchgerechnete Beispiele](#13-durchgerechnete-beispiele)
14. [Entscheidungsregister](#14-entscheidungsregister)

## 1. Verbindlichkeit und tatsächlicher Entwicklungsstand

### Leseschlüssel

| Kennzeichnung | Bedeutung |
| --- | --- |
| **Zielrichtung** | Im Gespräch gewählte Richtung; noch keine Behauptung über implementiertes Verhalten |
| **Bestätigt** | Vom Nutzer gewählte Zielregel; nicht erneut als offene Produktentscheidung behandeln |
| **Testregelsatz** | Zusammenhängende vorgeschlagene Präzisierung für die erste Umsetzung; keine getestete Balance |
| **Vorschlag** | Empfohlene Präzisierung einer offenen Regel oder eines Randfalls; vor Implementierung bestätigen |
| **Testwert** | Vorläufige Zahl für reproduzierbare Tests und Spieltests, keine bestätigte Balance |
| **Bestand main** | Im dokumentierten Ausgangscommit vorhanden |
| **Entwicklungsstand** | In einer offenen PR-Kette vorhanden, noch nicht in main integriert |
| **Später** | Nicht Voraussetzung des ersten vollständigen Zweispieler-Spiels |

Alle Zahlen in den Zielregeln sind **Testwerte**, sofern sie nicht ausdrücklich als vorhandene Regeln bezeichnet sind. Namen der Stämme, Einheiten und Gebäude sind Arbeitsnamen. Krieg ab Start, unbegrenzte Stadtzahl mit teuren Gründern, vorläufig akzeptierte Armeeschuld, freie Stammeswahl einschließlich Spiegelpartien, ausdrücklich angegriffene statt automatisch entfernte Zivilisten und der gemeinsame Forschungsentwurf sind gewählt. Zahlen und taktische Randfälle bilden den dokumentierten vorläufigen Testregelsatz; ihre Bestätigung als Richtung ist kein Nachweis funktionierender Balance.

### Geprüfte Basis und bewusste Branch-Wahl

Der ursprüngliche Ausgangspunkt `main`, Commit `6aa2dbe8d45ccea58def5054ff32a55295a22b04`, enthält Atlas, quadratische Karte mit vier Nachbarn, Generator 2, Regeln 1, Späherbewegung, Fraktionen-Sicht und Zugwechsel. Er ist **nicht** die Funktionsbasis des neuen Plans.

Die gewählte Dokumentations- und Planungsbasis ist `klaus/graphics-polish`, Commit `834ffc491fa4932e3c719191db837b3fea639445`: der kumulative Stand der PRs #20, #21, #22, #24, #29 und #31. Der eigene Dokumentationsbranch wurde lokal auf diesen Nachfolger vorgerückt; keine Remote-PR wurde verändert oder gemergt. Quellregeln, Dokumentation und tatsächliche Issue-Abhängigkeiten wurden gelesen. Dieser Stand enthält die aufeinander aufbauenden Arbeiten:

| Bereich | Geprüfter Entwicklungsstand, nicht main | Konsequenz für das Zielspiel |
| --- | --- | --- |
| Stadtgründung und Wirtschaft | Regeln seit v2; höchstens zwei Städte je Fraktion, Radius 1, Abstand 5, Nahrung und generische Materialien, eine Warteschlange | Wiederverwenden, aber gezielt durch Arbeitskräfte, sechs Ressourcen und Hunger ersetzen |
| Zwei Menschen | Serverlose Messenger-Partien; Host Meridian, Gast Lantern; vollständige Befehlswiedergabe | Beibehalten; Spielerplätze von Stammesdefinitionen trennen |
| Hex-Welt | Pointy-top odd-r, sechs Nachbarn, kanonische IDs weiterhin `z * width + x` | Zielregeln nutzen Hex-Distanzen, nicht Manhattan-Distanzen |
| Direkte Befehle | Regeln v4; alle Einheiten beweglich, gemeinsame aktuelle Sicht eigener Einheiten und Städte | Nicht auf den älteren unbeweglichen Gründer zurückfallen |
| Gelände | Generator v4; Voxel-Meshing, feste orthografische Kamera, echte Wasserbuchten | Keine neue Engine oder beiläufige Topologieänderung |
| Ressourcenbilder | Äpfel, Fisch und Stein sind rein visuelle Vorkommen | Noch kein abbaubarer Vorrat und kein Wirtschaftsertrag |
| Speicherung | Fremde Regel-/Generatorversionen werden nicht unter aktuellen Regeln abgespielt; lesbare inkompatible Saves bleiben erhalten | Neue Regeln brauchen explizite Versionsgrenzen und Erhalt alter Partien |
| Noch fehlend | Kämpfe, Arbeitsaufträge, Forschung, Diplomatie, KI und Sieg | Nicht durch Dokumentation als fertig darstellen |

Maßgebliche gelesene Quellen sind `src/game/expedition.ts`, `src/game/map.ts` auf main sowie `src/game/hex.ts`, `src/game/expedition.ts`, `src/game/match.ts`, `src/exchange/match-storage.ts` und die Dokumentation im genannten Entwicklungscommit.

**Alle PRs berücksichtigt, Integration weiterhin transparent:** Hex-Brett, Voxel-Renderer, Stadtwirtschaft, Messenger, Grafikpolitur und gemeinsame Guidance sind übernommene Ausgangsverträge, keine optional zu verwerfenden Vorarbeiten. Der Plan setzt ihre Freigabe und geordnete Integration voraus; er stellt nicht fälschlich dar, sie seien bereits auf main gemergt. Für neue Implementierung auf main muss diese Integration abgeschlossen sein; auf ausdrücklich freigegebener gestapelter Basis kann sie bereits vorliegen. Keine Einzeldateien herauskopieren und den lokalen Hauptcheckout nicht verändern. Der [Umsetzungsplan](umsetzungsplan.md#2-vorhandene-abhängigkeiten-und-alte-issues) dokumentiert die realen Blocker.

## 2. Spielversprechen und Welt

### Das Spiel in einem Absatz

Zwei Menschen führen je einen von vier Stämmen über dieselbe überschaubare Hex-Karte. Sie erkunden, gründen und versorgen Städte, erschließen Rohstoffe und führen wenige, klar unterscheidbare Truppen. Drei alte Leuchtfeuer schaffen einen sichtbaren Konflikt: Wer mindestens zwei davon über drei eigene Zugabschlüsse hält, gewinnt. Eroberung ist ein Mittel, aber vollständige Vernichtung nicht das normale Ziel. Strategische Tiefe entsteht aus Wegen, Versorgung, Bauentscheidungen und Zusammenspiel der drei Kampfklassen, nicht aus einer unüberschaubaren Zahl von Sonderregeln.

### Die Leuchtfeuer und das Erlöschen

Früher verbanden monumentale Leuchtfeuer Städte als Navigationspunkte, Nachrichtenknoten und Träger einer rätselhaften Energie. Mit dem **Erlöschen** brach das Netz zusammen. Städte wurden isoliert, Wissen zerfiel in lokale Überlieferungen, neue Gemeinschaften entstanden.

Nun leuchtet ein Feuer wieder. Manche sehen darin den Beginn einer gemeinsamen Zukunft, andere die Wiederkehr eines nicht verstandenen Risikos. Das Spiel erklärt die Ursache des Erlöschens absichtlich nicht abschließend. Ingenieure verstehen Wartung, Leitungen und Mechanik; Zauberinnen kennen Resonanzen, Lieder und Zeichen. Keine Seite besitzt die vollständige Wahrheit.

Auch die Herkunft der aufrecht gehenden Waschbären bleibt offen. Beschädigte Altanlagen in ihren Siedlungsgebieten sind ein Hinweis, kein naturwissenschaftlich gesicherter Ursprung. Keine Kampagne oder Technologie muss dieses Rätsel bereits lösen.

### Gestaltungsprinzipien

- Vier vollständige Gesellschaften mit Alltag, internen Konflikten und eigener Architektur, keine Karikaturen einzelner Eigenschaften.
- Gemeinsame, verständliche Grundregeln; Stammesunterschiede ändern Entscheidungen und Vorbereitung, nicht die Siegfähigkeit durch pauschal bessere Zahlen.
- Keine geschlechtsabhängigen Kampfwerte.
- Deterministische Vorschau statt Trefferwürfen, kritischen Treffern oder verdeckten Zufallsereignissen.
- Faire erreichbare Startgrundlagen; seltene Kristalle und Ruinen sind Vorteile, keine Voraussetzung für einen Gegenkonter.
- Browser-first, zwei Menschen per Messenger; kein Server, kein neues Netzwerkverfahren, kein Engine-Wechsel.

## 3. Partie, Karte und Information

### Aufbau und Spielerplätze

**Zielrichtung:** genau zwei gegnerische Spielerplätze. Jeder wählt einen der vier Stämme; vier Stämme bedeuten nicht vier Teilnehmer.

**Bestätigt:** Beide Spieler wählen unabhängig frei aus den vier Stämmen; derselbe Stamm auf beiden Seiten ist von Beginn an erlaubt. Einheiten, Städte und Eigentum gehören unterschiedlichen Spieler-IDs, nicht einer gemeinsam benutzten Stammes-ID. Der ausrichtende Spieler erstellt die Partie mit Seed, Kartenversion, Regel-/Inhaltsversion, Startspieler und beiden Stämmen; der Gast bestätigt dasselbe Paket. Host und erster Zug dürfen nicht dauerhaft mit einem bestimmten Stamm verknüpft sein.

Die erste vollständige Partie verwendet eine kleine kuratierte oder deterministisch erzeugte, validierte Karte. **24 × 24 Hex-Felder** ist ein Ausgangstest, keine Pflichtgröße für jede Partie. Keine größeren Karten erzwingen, bevor Wege, Partiezeit und mobile Lesbarkeit gemessen sind.

**Gewählter Startentwurf:** je ein Gründer und ein Späher, gleiche offengelegte Rohstoffausstattung, keine fertige Armee. Erste Stadt und Produktionsweg zu allen drei Basisklassen funktionieren ohne Forschung, Kristalle oder Bergungsgut. Der erste Gründer ist ausdrücklich eine kostenlose Szenarioausstattung; weitere Gründer sind teuer. Sofortige Truppen je Klasse sind nur eine separate Kampftestfixture. Konkrete Anfangsmengen stehen als Testwerte im Kostenrahmen.

### Geografie und Fairness

Das Ziel nutzt die sechs Hex-Nachbarn in fester Reihenfolge **O, SO, SW, W, NW, NO**. Wasser ist für anfängliche Landeinheiten unpassierbar. Ein Berg-Terraintyp ist später; sichtbare Steine machen ein Feld nicht automatisch unpassierbar. Bäume sind zunächst Dekoration und kein implizites Wald-Geländehindernis.

Jede Startregion braucht Nahrung, erreichbares Holz und Stein sowie einen gesicherten frühen Metallpfad. Nicht jedes Vorkommen muss in der ersten Stadt liegen. Kristalle und Ruinen dürfen umkämpft sein. Keine Fraktion darf allein wegen einer Zufallsplatzierung ihre drei Konterklassen nicht bauen können.

Drei neutrale Leuchtfeuer liegen auf legalem Land: eines näher bei jedem Start, eines im umkämpften Zentrum. Alle müssen ohne Schiffe erreichbar sein. Vergleichbar sind **gewichtete Wegkosten**, Engstellen, Ankunftszeit und Versorgungszugang, nicht nur Luftlinien. Faire Routen dürfen unterschiedlich aussehen. Beacons sind reservierte strategische Orte, keine bebaubaren Stadt- oder Rohstofffelder.

### Sicht und öffentliche Information

Eigene Sicht kennt drei Zustände: unbekannt, erkundet, aktuell sichtbar. Gegnerische Truppen und veränderliche gegnerische Wirtschaft sind nur bei aktueller Sicht bekannt. Erkundete Daten sind als letzter bekannter Stand markiert. Kampf und Fernangriffe setzen aktuelle Sicht voraus.

**Vorschlag für sichere Befehle:** Marschziele und ausgeführte Routensegmente müssen aktuell sichtbar sein; ein Späher erweitert seine Sicht durch einzelne Vorstöße. Bekannte alte Karten dürfen einen unverbindlichen Reiseplan zeigen, aber Reichweitenberechnung, Ablehnungsgründe oder Tooltips dürfen keine verborgene Belegung verraten. Alternative Erkundungsbefehle brauchen einen eigenen, getesteten Informationsvertrag.

Leuchtfeuerpositionen, Besitzer und Haltezähler sind ab Partiebeginn öffentlich. Ein Besitzerwechsel übermittelt nur das objektive Ereignis, keine neue Sicht auf umliegendes Terrain oder die angreifende Einheit. Die UI trennt diese öffentliche Ebene von Sichtdaten.

Messenger-Kopien enthalten die ganze Partie. Sichtschutz ist damit eine Regel der Benutzeroberfläche für vertrauenswürdige Mitspieler, kein kryptografischer Geheimnisschutz und keine Anti-Cheat-Zusage.

## 4. Ressourcen und Verbesserungen

### Sechs Ressourcen, keine versteckten Zusatzwährungen

| Ressource | Quelle im Zielspiel | Verwendung | Begrenzung |
| --- | --- | --- | --- |
| Nahrung | Felder, Obstgärten, Fischerei | Bevölkerung, Wachstum, Armeeversorgung | Lokale Stadtspeicher, pro Zug begrenzte Erträge |
| Holz | Bewirtschaftete Wälder | Gebäude, Wege, Waffen, optional Maschinenbetrieb | Zunächst erneuerbarer Ertrag, kein automatisches Abholzen |
| Stein | Steinbrüche und geeignete Hügel | Verwaltung, Befestigung, schwere Infrastruktur | Zunächst keine Erschöpfung |
| Metall | Explizite sichtbare Erzvorkommen mit Mine | Truppen, Werkstätten, anspruchsvolle Upgrades | Ein Metalltyp; noch kein Eisen-/Kupfersystem |
| Kristalle | Seltene Resonanzvorkommen mit Sammler | Bezahlte Fähigkeiten, fortgeschrittene Bauten aller Stämme | Begrenzter Ertrag; nie Grundkonterpflicht |
| Bergungsgut | Endlicher, angezeigter Ruinenvorrat | Wiederaufbau und verlustbehaftete Umwandlung in Holz/Metall | Abbau senkt den konkreten Vorrat bis null |

Die ersten fünf Ressourcen haben zunächst stetige, begrenzte Erträge ohne Vorkommenserschöpfung. Nachhaltiger Holzbetrieb ist Standard; Kahlschlag ist eine spätere Entscheidung. Bauarbeit und Forschung sind **Fortschritt**, keine siebte beziehungsweise achte lagerbare Rohstoffart.

Nichtnahrungs-Rohstoffe liegen fraktionsweit. Nahrung bleibt an Städte gebunden. Diese Trennung steht sichtbar im HUD: Ein entfernter Metallvorrat kann einen Bau finanzieren, aber ein entfernter Apfelgarten versorgt ohne Anschluss keine Stadt.

### Arbeitsauftrag und automatisierter Betrieb

Ein Arbeiter beginnt einen bezahlten Auftrag auf einem erkundeten eigenen Feld, das einer eigenen Stadt zugeordnet ist. Terrain, Vorkommen, Gebäudefreischaltung, Rohstoffe und zulässige Belegung werden vor Start geprüft. Die erforderliche Arbeitszeit wird in eigenen Zugabschlüssen gezählt. **Vorschlag:** Der Arbeiter muss am Arbeitsort bleiben, verwendet dafür seine gesamte Aktion und Bewegung und unterbricht den Auftrag durch Weggehen; bezahlter Fortschritt bleibt bestehen.

Nach Fertigstellung steht die Verbesserung auf dem Feld. Der Arbeiter kann weiterziehen. Ertrag entsteht erst mit einer zugewiesenen Bevölkerungskraft, erforderlichem Anschluss und ohne feindliche Besetzung. Eine fertiggestellte Verbesserung verlangt keine dauerhafte Arbeiterfigur.

| Verbesserung | Voraussetzung | Kostenprofil / Arbeitsumfang | Wirkung |
| --- | --- | --- | --- |
| Feld | Geeignetes eigenes Land | Klein: Holz, wenig Arbeit | Nahrung |
| Obstgarten | Als nutzbar definiertes Obstvorkommen | Klein: Holz, Arbeit | Nahrung; Apfelgrafik allein genügt nicht |
| Forstbetrieb | Kanonisches Holzvorkommen | Klein: Holz, Arbeit | Nachhaltiges Holz |
| Steinbruch | Geeigneter Hügel/Steinvorkommen | Klein: Holz, Arbeit | Stein |
| Mine | Explizites Erzvorkommen | Mittel: Holz, Stein, Arbeit | Metall |
| Fischerei | Eigenes Küstenwasser neben eigenem zugänglichem Land | Klein: Holz, Arbeit vom Land aus | Nahrung ohne Flotte |
| Kristallsammler | Kristallvorkommen | Mittel: Holz, Stein, Metall, Arbeit | Kristalle |
| Bergungsstelle | Ruine mit Restvorrat | Klein: Holz, Arbeit | Endliche Bergung; öffentlich für den Besitzer bilanzierter Rest |
| Straße | Eigenes legales Land | Klein je Abschnitt: Stein/Holz, Arbeit | Transportverbindung; Bewegungseffekt separat versioniert |

Der [vorläufige Kosten- und Ertragssatz](#vorläufige-gemeinsame-testdaten) stellt gemeinsame Zahlen für die erste Wirtschaftsfixture bereit. Er ist keine Behauptung über heutige Gelände-Erträge oder bereits gemessene Balance.

### Anschluss, Besetzung und Abbau

Stadtzentrum und angrenzende eigene Stadtfelder gelten als angeschlossen. Entferntere Verbesserungen brauchen einen lückenlosen eigenen Straßenpfad zum Zentrum oder eine ausdrücklich gleichwertige Stammesverbindung. Wasser überbrückt keine Straßenlücke; die Küstenfischerei hängt an ihrem Landzugang. Sichtbare Straßen dürfen unpassierbares Terrain nicht beiläufig passierbar machen.

Feindliche Besetzung eines Ertragsfelds stoppt dessen Ertrag; Besetzung eines benötigten Straßenabschnitts unterbricht den Anschluss aller davon abhängigen Betriebe. Keine automatische Zerstörung und keine pauschale Hungersperre nur durch Nähe eines Gegners. Für Besetzung zählen auch feindliche zivile Figuren; sie erhalten dadurch keine Kontrollzone.

Bewusstes Demontieren ist ein eigener, protokollierter Arbeitsauftrag. **Vorschlag:** Normale Demontage erstattet höchstens die Hälfte tatsächlich gezahlter Rohstoffe, je Art abgerundet; Waschbären höchstens drei Viertel. Erstattungen nutzen den bezahlten Baukostenbeleg, niemals Listenpreise oder den Marktwert kostenlos erbeuteter Bauten. Keine Erstattung von Arbeit, Unterhalt, bereits verbrauchten Ladungen oder mehrfach demselben Material. Ruinen sind für Waschbären hilfreich, aber keine Existenzvoraussetzung.

## 5. Städte, Bevölkerung und Produktion

### Drei getrennte Begriffe

**Besitz** erlaubt Nutzung und schützt vor fremder Gründung. **Bewirtschaftung** setzt eine zugewiesene Arbeitskraft voraus. **Anschluss** erlaubt Transport. Ein gekauftes, unverbessertes oder nicht angeschlossenes Feld liefert nicht automatisch Ertrag.

### Gründung, Reichweite und teure Expansion

Eine Gründung verbraucht einen eigenen Gründer auf freiem legalem Land. Der Standort ist erkundet, nicht besetzt, kein Leuchtfeuer und außerhalb fremden Besitzes. Beansprucht werden das Zentrum und bis zu sechs unbesessene Nachbarfelder. **Zieländerung:** Angrenzendes Küstenwasser kann dazugehören; das erlaubt Fischereien, aber keine Bewegung von Landeinheiten über Wasser. Bereits zugeordnete Nachbarn werden nicht überschrieben; die Gründungsvorschau zeigt den tatsächlichen Anspruch.

| Maximale Reichweite | Freischaltung | Was tatsächlich passiert |
| --- | --- | --- |
| Radius 1 | Gründung | Anfangsanspruch, noch keine automatische Arbeit aller Felder |
| Radius 2 | Bevölkerung mindestens 4 und Ratshaus oder funktional gleichwertige Verwaltung | Einzelne verbundene Felder können per Projekt beansprucht werden |
| Radius 3 | Bevölkerung mindestens 7 und höhere Verwaltung | Ebenso einzelne Projekte; kein kostenloser äußerer Ring |

Erweiterungen müssen innerhalb der freigeschalteten Hex-Distanz liegen und an das Gebiet dieser Stadt angrenzen. **Vorschlag:** ein aktuell sichtbares unbesessenes Feld je Projekt, Kostenprofil klein bis mittel, wachsend mit Entfernung. Feindliche Besetzung blockiert Start und Abschluss; die Prüfung darf nicht heimlich ein Feld außerhalb aktueller Sicht abfragen. Jedes Feld gehört genau einer Stadt. Keine passive Kulturübernahme; ein umstrittenes Feld bleibt beim ersten rechtmäßigen Besitzer. Eigene Städte dürfen ein angrenzendes Feld ausdrücklich übertragen, wenn danach beide Gebiete verbunden bleiben und Radiusregeln gelten. Verbesserung und deren bezahlter Kostenbeleg wechseln mit; Arbeitskraftzuweisungen werden neu geprüft. Das Stadtzentrum ist nicht übertragbar.

**Gewählter Testwert:** Stadtzentren mindestens 4 Hex-Schritte auseinander. Dadurch dürfen sich spätere Radius-3-Einzugsgebiete geometrisch überschneiden, Besitz aber nicht. Überlappung schafft Entscheidungen statt Vollringanspruch. Der vorhandene Mindestabstand 5 bleibt nur in älteren Regelversionen gültig; der neue Testregelsatz verwendet einheitlich 4.

**Bestätigt: keine Obergrenze für Städte**, weder für Gründung noch Eroberung oder lebenslang gegründete Orte. Legaler Standort, Mindestabstand, Rohstoffe, Versorgung und die Opportunitätskosten des Gründers begrenzen Expansion. Das alte Zwei-Städte-Limit ist ausschließlich Implementierungsbestand, kein Zielvertrag.

Nachproduzierte Gründer kosten im Testentwurf ungefähr die Bauarbeit von **drei Basiskampfeinheiten**, zusätzlich Holz, Stein und ein Nahrungspaket aus der Herkunftsstadt. Keine stillschweigende Bevölkerungsausgabe. Das lokale Nahrungspaket wird bei Produktionsstart reserviert und beim fertigen Gründer als Reisevorrat geführt; beim Gründen geht es in die neue Stadt, nicht nochmals aus dem Nichts hervor. Stirbt der Gründer, verfällt sein Reisevorrat ohne Beute. Ein blockierter Ausgang produziert weder einen zweiten Gründer noch zusätzliche Nahrung. Die transparente Ausnahme für den kostenlosen Anfangsgründer gilt nicht für jede weitere Stadt.

### Arbeitskräfte, Gebäudeplätze und Wohnen

Eine Bevölkerungsgruppe ergibt genau einen Arbeitskraftplatz. Ein Platz betreibt entweder ein verbessertes Feld oder ein personalpflichtiges Gebäude. Bevölkerung wird bei normaler Einheitenproduktion nicht verbraucht; Gründerproduktion ist anfangs ebenfalls ein Material-/Arbeitsprojekt ohne verdeckten Bevölkerungsabzug.

**Testregelsatz für einen deadlockfreien Anfang:** Das Zentrum liefert ohne Belegschaft 3 Nahrung und 2 Bauarbeit pro eigenem Zug. Jede Stadt beginnt mit Bevölkerung 1 und einem fertigen Anfangsfeld auf dem ersten geeigneten eigenen Nachbarland in Hex-Reihenfolge; fehlt ein solches Feld, ist der Gründungsort in der ersten Testkarte unzulässig. Dieses Feld ist Teil des Gründungspakets, beim Anfangsgründer eine offengelegte Szenarioausnahme; sein Demontage-Kostenbeleg ist null. Neue Städte erzeugen keine kostenlosen gemeinsamen Rohstoffe. Nur der Szenariostart vergibt die Anfangsausstattung. Grundbauten und alle Basistruppen sind ohne Metall betreibbar; Metall verbessert die zweite Stufe.

Automatische Zuweisung hat die Profile Wachstum, Produktion und ausgewogen. Manuelle Pins gehen vor, solange legal; danach werden verbleibende Plätze nach priorisiertem Ertrag und bei Gleichstand nach Feld-/Gebäude-ID belegt. Bei Bevölkerungsverlust werden zuerst unfixierte, dann zuletzt gesetzte Pins gelöst; gleiche Zeitpunkte nach ID. Die UI nennt unbesetzte, abgeschnittene und besetzte Arbeitsplätze getrennt.

**Deterministischer Zuweisungsvorschlag:** Für den reinen automatischen Erstentwurf sei `N` der Nahrungs-, `A` der Bauarbeits- und `R` die Summe der fünf Nichtnahrungs-Erträge eines legalen Arbeitsplatzes. Wachstum bewertet `4*N + A + R`, Produktion `N + 4*A + 2*R`, ausgewogen `2*N + 2*A + R`; höchste Bewertung zuerst. Nichtnumerische Funktionen ohne direkten Ertrag werden nur explizit aktiviert/gepinnt, nicht aus einer willkürlichen „Wertigkeit“ erraten. Kandidaten werden einmal aus dem selben Snapshot sortiert, jeder höchstens einmal belegt. Die Gewichte sind Testwerte; spätere bedarfsabhängige Heuristiken brauchen einen ebenso reproduzierbaren Vertrag.

**Platzvorschlag:** vier besondere Gebäudeplätze je Stadt; mittlere beziehungsweise höhere Verwaltung öffnet einen fünften beziehungsweise sechsten. Zentrum, Wohnen und Befestigung liegen außerhalb dieser Plätze. Stammesketten und gemeinsame Zusatzbauten wie Lager, Verwaltung oder Wissenshaus belegen je einen; erfüllt eine Stammeskette dieselbe Funktion, ersetzt sie den gemeinsamen Bau statt einen zweiten Bonus zu stapeln. Upgrades nutzen denselben Platz. Ein Pfadhaus konkurriert daher mit anderen wirtschaftlichen oder militärischen Ausbauten, statt kostenlos bessere Straßen zu schenken. Auch Nicht-Amazonen haben eine gemeinsame Verwaltungsalternative; sie müssen keine fremde Stadt erobern, um Radius 2/3 zu erreichen.

| Wohnstufe | Bevölkerungslimit | Voraussetzung / Kostenprofil |
| --- | --- | --- |
| Gründung | 3 | Zentrum vorhanden |
| Wohnanlage | 6 | Anbauverfahren, Holz, Stein, mittlere Bauarbeit; **keine** Bevölkerung-4- oder Ratshauspflicht |
| Ausgebautes Wohnquartier | 9 | Wohnanlage und Stadtplanung, Stein/Metall, hohe Bauarbeit; **keine** Bevölkerung-7-Pflicht |

Wohnraum ist unabhängig von Gebietsreichweite. Eine Hungerphase entfernt kein bereits freigeschaltetes Verwaltungsgebäude; **Vorschlag:** einmal erreichte Reichweiten bleiben freigeschaltet, vorhandene Felder werden bei Bevölkerungsverlust nicht entzogen.

**Keine tote Fortschrittsschleife:** Vorratshaltung → Anbauverfahren lässt bei Bevölkerung 3 die Wohnanlage bauen. Erst dadurch kann die Stadt auf 4 wachsen; Wegebau → Stadtplanung plus Ratshaus schaltet dann Radius 2 frei. Stadtplanung und Wohnanlage erlauben außerdem Wohnraum 9, bevor Bevölkerung 7 und höhere Verwaltung Radius 3 ermöglichen. Forschung, Grundversorgung und Wohnbau brauchen selbst keinen Außenring.

### Nahrung, Wachstum und Hunger

Bevölkerung benötigt 2 Nahrung je Gruppe und eigenem Zug. Nach Versorgung und Lieferungen gilt die Wachstumsschwelle `8 + 4 * aktuelle Bevölkerung`. Bei genug Nahrung und Wohnraum wächst die Stadt um höchstens eine Gruppe; die Schwelle wird genau einmal vom Nahrungsvorrat abgezogen. Die neue Gruppe arbeitet und isst erst ab dem nächsten eigenen Zug.

**Speichervorschlag:** Grundkapazität 24 Nahrung, Lagerstufen 36/48/60 als Funktionsäquivalente. Wachstum wird vor abschließender Speicherbegrenzung geprüft. Fehlender Wohnraum oder belegtes Wachstum verbraucht keine Wachstumsschwelle; überzählige Nahrung oberhalb der Kapazität verfällt sichtbar. Der Spieler sieht Vorrat, Kapazität, Verbrauch, Wachstumssperre und erwarteten Überlauf.

Unvollständig versorgte Bevölkerung erhöht den lokalen Hungerzähler. Der erste solche eigene Abschluss warnt. Beim zweiten aufeinanderfolgenden Abschluss verliert die Stadt eine Bevölkerung; bei fortdauerndem Hunger danach höchstens eine je Abschluss, nie unter 1. Ein vollständig ernährter Abschluss setzt den Zähler auf null. Fehlende Armeenahrung allein zählt nicht als Bevölkerungshunger. Bevölkerungsverlust erfolgt vor Wachstum; eine hungernde Stadt wächst nie im selben Abschluss.

Das ist eine **bewusste spätere Regeländerung**: Der vorhandene Stadtprototyp setzt bei Mangel Nahrung auf null und verliert keine Bevölkerung. Bestehende Saves behalten dessen Verhalten in ihrer alten Version.

### Produktionsvertrag und Kostenrahmen

Jede Stadt hat eine aktive Warteschlange. Gebäude, Truppen, Forschungsvorbereitungen und Stadtprojekte brauchen einen Rohstoffvektor und lokale Bauarbeit. Rohstoffe werden beim Start aus dem gemeinsamen Bestand reserviert und vom frei verfügbaren Bestand abgezogen. Arbeit entsteht nur lokal und wird nicht gespeichert, wenn kein Projekt läuft.

Kostenprofile beschreiben die Zusammensetzung: klein = frühes Holz plus wenig Stein; mittel = Holz/Stein, gegebenenfalls Metall; groß = mehrere Grundstoffe, Metall und gegebenenfalls Kristalle. Konkrete Testdaten folgen unten. Die Dauer ergibt sich aus der tatsächlichen lokalen Bauarbeit, nicht aus einer unabhängig versprochenen Rundenzahl; noch fehlende Spezialpreise dürfen vor Implementierung nicht als null interpretiert werden.

Ein Upgrade braucht seine Vorstufe, die zugehörige Freischaltung und freien Zugang zur Stadt. Es ersetzt die Vorstufe, stapelt nicht deren vollen Ertrag zusätzlich. Alltägliche Gebäude benötigen vor allem Arbeitskräfte, nicht pauschal jede Runde neue Rohstoffe. Nur ausdrücklich gewählte Umwandlung, Maschinenbetrieb oder Fähigkeiten haben laufende Materialkosten.

**Stornierungsvorschlag:** Bei bezahlten Kosten `C`, Sollarbeit `W` und Fortschritt `p` wird je Rohstoff `floor(C * (W - min(p,W)) / W)` zurückgegeben. Bereits eingebaute Materialien werden nicht nochmals durch eine Gebäudedemontage erstattet. Eine voll bearbeitete, aber blockierte Truppe hat keinen unverbrauchten Materialrest. Der Dialog zeigt vor Bestätigung Kostenbeleg, Rückgabe und endgültigen Verlust.

Ein Gründer-Nahrungspaket gehört zum bezahlten Kostenvektor, bleibt aber lokal: Ein unverbrauchter Rückgabeteil geht ausschließlich an die ursprüngliche eigene Herkunftsstadt, höchstens bis zu ihrer freien Speicherkapazität. Überlauf verfällt sichtbar; nach fremder Eroberung gibt es keine Auszahlung an den neuen Besitzer oder einen gemeinsamen Nahrungsbestand.

Fertige Einheiten erscheinen erst auf einem freien legalen Nachbarfeld in fester Hex-Reihenfolge. Kein Überschreiben, Stapeln oder doppelter Abschluss: Bei Blockade wartet das Projekt mit voller Arbeit. **Vorschlag:** Frisch produzierte oder aufgewertete Einheiten sind bis zum nächsten eigenen Zug erschöpft; Aufwertung erhält den prozentualen Gesundheitsschaden, setzt weder Konterbudget noch Unterhalt zurück.

### Vorläufige gemeinsame Testdaten

Diese Tabelle ist ein **zusammenhängender Startpunkt für Implementierungs- und Spieltests**, keine empirisch bestätigte Balance. Sie ersetzt nicht die alten Regeln v4. Ohne Spezialisierung erzeugt das Zentrum 2 Arbeit pro eigenem Abschluss; ein Grundsoldat mit 12 Arbeit braucht dort 6, ein Gründer mit 36 Arbeit 18 Abschlüsse. Wer schneller expandieren will, muss Arbeit statt Nahrung oder Rohstoffen priorisieren.

| Testdefinition | Ganzzahliger Wert |
| --- | --- |
| Szenarioausstattung je Spieler | 20 Holz, 12 Stein, 0 Metall/Kristalle/Bergungsgut; Anfangsgründer trägt 12 Nahrung; Späher und keine Armee |
| Bevölkerung / Zentrum | Anfangsbevölkerung 1; Zentrum 3 Nahrung + 2 Arbeit, keine Gratisforschung je Stadt |
| Feld / Obstgarten / Fischerei | Je 4 Nahrung bei einem zugewiesenen Arbeitsplatz |
| Verbessertes Feld nach Anbauverfahren | 5 statt 4 Nahrung; bezahltes Upgrade 4 Holz + 2 Arbeiterabschlüsse, keine automatische globale Ertragserhöhung |
| Forst / Steinbruch / einfache Mine | Je Arbeitsplatz 3 Holz / 2 Stein / 2 Metall |
| Kristallsammler / Bergungsstelle | Je Arbeitsplatz 1 Kristall / höchstens 2 Bergungsgut bis Vorrat null |
| Ruinen-Testvorrat | 12 Bergungsgut je kanonischer Test-Ruine; keine Endlos-Erneuerung |
| Bauarbeitsplatz im gemeinsamen Werkhof | 3 zusätzliche Arbeit, eine Arbeitskraft |
| Basis-Bollwerk | 6 Holz + 4 Stein + 12 Arbeit |
| Basis-Sturm | 8 Holz + 2 Stein + 12 Arbeit |
| Basis-Brecher | 10 Holz + 4 Stein + 12 Arbeit |
| Späher / Arbeiter | 4 Holz + 8 Arbeit / 6 Holz + 2 Stein + 10 Arbeit |
| Weiterer Gründer | 12 Holz + 8 Stein + 12 lokale Nahrung + 36 Arbeit; keine Bevölkerungskosten |
| Feld, Obstgarten, Forst, Steinbruch, Fischerei | 4 Holz + 2 Arbeiterabschlüsse |
| Einfache Mine / Kristallsammler | 4 Holz + 4 Stein + 3 Arbeiterabschlüsse / zusätzlich 2 Metall, 4 Arbeiterabschlüsse |
| Bergungsstelle / Straßenabschnitt | 2 Holz + 2 Arbeiterabschlüsse / 1 Holz + 1 Stein + 1 Arbeiterabschluss |
| Kleine / mittlere / hohe Gebäudestufe | Ausgangsprofil 8 Holz + 4 Stein + 12 Arbeit / 12 Holz + 8 Stein + 4 Metall + 20 Arbeit / 16 Holz + 12 Stein + 8 Metall + 28 Arbeit |
| Wohnanlage / Wohnquartier | 8 Holz + 4 Stein + 12 Arbeit / 12 Stein + 4 Metall + 20 Arbeit |
| Zusätzlicher Gebietsanspruch | Radius 1: 2 Holz + 2 Stein + 4 Arbeit; Radius 2: 4 Holz + 4 Stein + 8 Arbeit; Radius 3: 6 Holz + 6 Stein + 12 Arbeit |

Ein Arbeiterabschluss bedeutet eine volle Arbeitsaktion der beteiligten Arbeiterfigur; kein Bevölkerungs-Arbeitsplatz ist dafür zusätzlich nötig. Der Bauarbeitsplatz im Zentrum-Werkhof ist ein gewöhnlicher Spezialplatzbau, anfangs ohne Forschung und ohne Metall möglich. Generische Lager und Verwaltung verwenden dieselben Stufenprofile; Stammesbesonderheiten werden als ausgewiesene Abweichung bezahlt. Für die spätere Inhaltsstufe sind konkrete zweite Einheitenpreise und alle zusätzlichen Spezialeffekte vor Code einzeln zu vervollständigen. Sie sind bewusst nicht im ersten Ein-Fähigkeit-pro-Stamm-Inkrement enthalten.

## 6. Versorgung und deterministischer Zugabschluss

### Armeenahrung ohne Abmelde-Trick

Jede Kampfeinheit kostet 1 Nahrung je eigenem Abschluss; keine zusätzliche taktische Hungerstrafe im ersten Regelsatz. Zivilisten haben zunächst keinen separaten Unterhalt. Jede Kampfeinheit hat eine angezeigte Versorgungsstadt. Straßenunterbrechung erlaubt kein Abschalten dieser Verpflichtung.

**Für die erste Fassung bestätigt:** Die Versorgungsstadt ist ein Abrechnungsort, keine Reichweitenbedingung für den Armeezoll. Sie zahlt auch für fern stehende Einheiten. Bei Verlust der Stadt wird eine andere eigene Stadt mit kleinster stabiler Stadt-ID zugewiesen. Ein Wechsel darf die bereits fällige Verpflichtung nicht reduzieren. Noch offene Nahrung kann aus anderen eigenen Stadtüberschüssen in stabiler Reihenfolge gedeckt werden; das ist eine ausdrücklich abstrakte Unterhaltsabrechnung, keine heimliche allgemeine Lebensmittel-Lieferroute.

Kann der Spieler insgesamt nicht zahlen oder hat er keine Stadt mehr, bleibt die offene Armeenahrung als **fraktionsweite Nahrungsschuld** im Partiestand. Das ist kein handelbarer Rohstoff. Schuld überlebt Stadtverlust, Neuzuweisung, Entlassung der verursachenden Einheit und Import/Export. Künftige freie Stadtnahrung tilgt sie vor Export und Wachstum; bis zur Tilgung keine Kampfrekrutierung. Die lokale Bevölkerung erhält vor dem Armeezoll ihre verfügbare Grundration; ein fremder Stadtüberschuss wird ihr dagegen nur durch eine tatsächliche Lieferroute zugänglich. Bestehende Armeen bleiben taktisch unverändert. Ohne Städte läuft die Schuld weiter, solange ein Gründer die Niederlage verhindert. Der spätere Stadtaufbau beginnt nicht schuldenfrei.

Diese vorläufig akzeptierte Abstraktion verhindert das Löschen von Unterhalt durch Disconnection und Umbenennung. Sie erlaubt bewusst vorübergehend unbezahltes Kämpfen statt Desertion oder Kampfmali. Stadtlose Armeen und die wachsende Schuld bleiben ein gezielter Spieltest, nicht eine erneut offene Grundentscheidung. Eine spätere Änderung braucht eine dokumentierte Regelrevision.

### Lieferungen zwischen Städten

**Zielrichtung, nach dem Kernspiel ausbaubar:** Verbundene eigene Städte können stehende Nahrungslieferungen vereinbaren. Keine Lieferung an fremde Spieler im ersten Modell.

**Vorschlag:** Eine Route hat Quelle, Ziel und ganzzahliges Maximum; anfangs maximal 4 Nahrung je Route und Abschluss, insgesamt maximal 4 exportierte Nahrung je Quellstadt. Der Geber behält zuerst Bevölkerung, zugewiesenen aktuellen Armeeunterhalt und fällige Schuldtilgung. Nur der danach bestehende Überschuss darf geliefert werden. Straßenbesetzung suspendiert die Route sichtbar, löscht aber nicht den Auftrag.

Alle Exporte werden aus demselben Vor-Lieferungs-Snapshot berechnet. Empfangene Nahrung kann in diesem Abschluss weder weiterexportiert noch zum nachträglichen Erhöhen eines anderen Exports verwendet werden. Reihenfolge: Quellen nach Stadt-ID, deren Routen nach Zielstadt-ID und Routen-ID. Bei mehreren Gebern wird die freie Empfängerkapazität in dieser Reihenfolge reserviert; niemand sendet in einen bereits vollständig reservierten Speicher. Deshalb entsteht auch bei A→B→C kein Nahrungskarussell.

### Vollständige Abschlussreihenfolge

Unmittelbare Befehle wie Bewegung, Angriff, Beanspruchung nach fertigem Projekt und Beacon-Aktivierung werden sofort legal geprüft und angewandt. Ein abgelehnter Befehl ändert weder Zustand noch Sequenz, Historie oder RNG.

Am Ende des **aktiven Spielers** gilt folgender vorgeschlagener atomarer Ablauf:

1. Befehlsannahme schließen; aktive Besitz-, Anschluss-, Sicht-, Besatzungs- und Arbeitskraftdaten als Abschluss-Snapshot festhalten. Fällige Unterhaltszuweisungen festlegen; alle Sortierungen nutzen stabile IDs.
2. Für alle eigenen Städte gleichzeitig Erträge aus zu Beginn fertigen, betriebenen, angeschlossenen und unbesetzten Anlagen berechnen. Zentrum einschließen. Besatzungsabschläge nur auf Nichtnahrung und Bauarbeit anwenden. Rohstofferträge zum gemeinsamen Bestand, Nahrung zum jeweiligen Stadtbestand buchen. Ruinenvorräte exakt um tatsächlich gewonnene Bergung senken.
3. Bevölkerung mit `2 * Bevölkerung` reservieren; dann aktuellen Armeeunterhalt zuweisen und aus lokalen Resten sowie anderen Stadtüberschüssen decken. Ungedeckte Armeeanteile zur Nahrungsschuld addieren; übrige Überschüsse tilgen ältere Schuld nach Stadt-ID. Für Bevölkerung ungedeckte Bedarfe können in Schritt 4 noch beliefert werden.
4. Stehende Nahrungstransporte anhand des gemeinsamen Snapshots nach Reservierungen planen und einmalig ausführen. Empfängerplatz berechnet sich nach reserviertem Eigenverbrauch; Empfänger können mit Importen ihren Bevölkerungsfehlbedarf decken. Kein Weiterreichen und keine Neuberechnung von Exportbudgets nach Empfang.
5. Reservierte und durch Importe gedeckte Bevölkerungskost abbuchen; Hungerzähler und gegebenenfalls Bevölkerungsverlust anwenden. Der aktuelle Armeeunterhalt wurde in Schritt 3 bezahlt oder als Schuld protokolliert und wird nicht doppelt abgebucht. Hunger kann keine unbezahlte Armeekost löschen.
6. Wachstum anhand der danach verbleibenden Nahrung und des bisherigen Wohnraums einmal prüfen; bei offener Nahrungsschuld kein Wachstum. Danach Nahrungskapazität anwenden und Verlust durch Überlauf protokollieren.
7. Bauarbeit der Städte sowie deklarierte Arbeiteraufträge gutschreiben, gemeinsame Forschung fortschreiben. Fällige Abschlüsse in Stadt-/Auftrags-ID-Reihenfolge abwickeln; blockierte Ausgänge bleiben wartend. Neue Ertrags-, Wohn- und Forschungsboni gelten erst im nächsten eigenen Abschluss. Bereits reservierte Rohstoffe verhindern einen Wettlauf um gemeinsam fehlende Materialien.
8. Gegebenenfalls Besetzungsdauer fortschreiben; der zweite qualifizierte Abschluss war wirtschaftlich noch besetzt, der nächste ist normal. Keine rückwirkende zusätzliche Produktion oder Rekrutierung.
9. Niederlage prüfen; danach Beacon-Haltezähler des aktiven Spielers und Sieg; danach gegebenenfalls die Grenze von 40 vollständigen Runden. Ergebnis finalisieren, weitere Spielbefehle sperren.
10. Nur ohne Ergebnis zum anderen Spieler wechseln, eingehende Bewegungs-/Aktions-/Konterbudgets erneuern, Sicht/Änderungsereignisse aktualisieren und Export eines vollständigen Zugendes erlauben. Nach dem zweiten Spieler beginnt die nächste Runde.

Lokale Hunger- und Wachstumsberechnung verwendet die Bevölkerung aus dem Snapshot; eine neu gewachsene Gruppe erzeugt keine rückwirkende Arbeit. Ein neues Gebäude kann nicht schon seine eigenen Baukosten erwirtschaften. Die UI zeigt eine Vorschau desselben Domain-Ablaufs, keine zweite vereinfachte Simulation.

## 7. Einheiten und taktischer Kampf

### Gemeinsame Rollen

| Rolle | Aufgabe | Harte Grenze |
| --- | --- | --- |
| Bollwerk | Raum halten, Sturm abfangen, kontrollieren | Kontert Sturm, wird von Brecher gekontert |
| Sturm | Lücken nutzen, Brecher angreifen, Städte betreten | Kontert Brecher, verliert gegen Bollwerk |
| Brecher | Bollwerke und Befestigungen aufbrechen | Kontert Bollwerk, ist gegen Sturm verwundbar |
| Späher | Erkunden, Wege und Vorkommen finden | Keine Kampfklasse, kein Stadteroberer |
| Gründer | Neue Stadt aufbauen | Wird bei Gründung verbraucht |
| Arbeiter | Verbesserungen, Wege und Demontage | Keine zusätzliche vierte Kampfklasse |

**Bollwerk > Sturm > Brecher > Bollwerk.** Rolle und Reichweite sind getrennte Eigenschaften. Basiskonter sind früh und ohne Kristalle oder Ruinenmaterial verfügbar. Zwei Stufen pro Einheit reichen zunächst; eine Aufwertung braucht Vorstufe, Militärfreischaltung, bezahlte Rohstoffe und Zeit in einer eigenen versorgten Stadt.

| Gemeinsames Kostenprofil | Vorgeschlagene Materialien / Arbeit | Freischaltung |
| --- | --- | --- |
| Basis-Bollwerk | Holz/Stein, mittlere Arbeit | Stadtzentrum; kein Metallzwang |
| Basis-Sturm | Vorwiegend Holz, mittlere Arbeit | Stadtzentrum; kein Kristallzwang |
| Basis-Brecher | Holz/Stein, mittlere bis höhere Arbeit | Stadtzentrum; kein Ruinenzwang |
| Zweite Einheitenstufe | Vorstufe plus Holz/Stein/Metall, hohe Arbeit; Kristalle nur für optionale Fähigkeit | Passende Militärgebäudestufe und Forschung oder ausdrücklich freigegebene Szenariostufe |
| Späher | Holz, kleine Arbeit | Zentrum |
| Gründer | Holz/Stein, lokale Nahrung, Arbeit von ungefähr drei Basiseinheiten; keine Bevölkerungskosten | Zentrum; kein Stadtlimit, legaler Standort und Mindestabstand beim Gründen |
| Arbeiter | Holz/Stein, mittlere Arbeit | Zentrum |

Die zwölf Stammes-Kampfketten verwenden diese vergleichbaren Grundprofile. Amazonen verschieben Kosten zu Holz, Ingenieure vor allem im Ausbau zu Stein/Metall, Waschbären können einen begrenzten normalen Materialanteil durch Bergung ersetzen, Zauberinnen bezahlen nur Zusatzkräfte mit Kristallen. Keine Variante darf die Grundkonter-Verfügbarkeit aufheben. Konkrete ganzzahlige Preise werden vor dem zugehörigen Wirtschaftspaket festgelegt.

### Gemeinsame Testparameter

| Parameter | Testwert / vorgeschlagene Regel |
| --- | --- |
| Gesundheit | 10 |
| Kampfeinheitenbewegung | 2; Stammesfähigkeit kann einen engen Sonderfall erlauben |
| Angriff | Ein Angriff pro eigenem Zug; beendet verbleibende Bewegung |
| Reihenfolge | Bewegen, dann angreifen ist legal; danach nicht frei weiterziehen |
| Geländekosten | Ebene 1, Hügel 2; keine automatische Walddeckung für dekorative Bäume |
| Nahkampf | Benachbartes aktuell sichtbares Ziel |
| Fernkampf | Höchstens 2 Hex-Schritte, aktuelle Sicht und freie Schusslinie |
| Unverwandte/gleiche Klasse | 4 Grundschaden |
| Klassenvorteil / -nachteil | 6 / 3 Grundschaden |
| Verteidigung | Hügel -1, eingegraben -1; zusammen höchstens -2, Schaden mindestens 1 |
| Flanke | +1 nur auf Nahkampfangriff bei zwei eigenen Kampftruppen auf unterschiedlichen Zielnachbarn |
| Verwundet | Zunächst unveränderte Angriffskraft |
| Zufall | Keine Trefferchance, kein kritischer Treffer |

Bei der Flanke zählt der angreifende Nahkämpfer selbst als eine der zwei Einheiten; die zweite muss leben und zum Angriffszeitpunkt neben demselben Ziel stehen. Zivilisten und verbündete Gebäude zählen nicht.

Schadensreihenfolge: Klassengrundwert bestimmen, beim aktiven Nahkampfangriff gegebenenfalls Flanke addieren, wirksame Verteidigung abziehen, auf mindestens 1 begrenzen, expliziten begrenzten Fähigkeitsschutz anwenden. **Schutzvorschlag:** maximal 1 weiterer Schadenspunkt, niemals unter 1; gleiche Schutzeffekte stapeln nicht. Befestigungsschaden folgt einem getrennten Belagerungswert.

### Wege, Belegung und Kontrollzone

Eigene Einheiten dürfen durchquert werden, ein Endfeld darf aber nur eine Einheit enthalten. Ein Durchgang über eine eigene Figur ist nur legal, wenn ein freies nächstes End-/Zwischenfeld noch im selben Bewegungsbudget erreicht wird und keine Kontrollzone den Durchgang auf dem belegten Feld beendet. Auch zivile Einheiten belegen einen Platz; die Stadt ist kein zweiter Stapelplatz. Gegnerische Belegung blockiert Wege. Gleiche Wegkosten behalten den zuerst gefundenen Pfad; Nachbarn und Warteschlangengleichstände sind stabil.

**Bollwerk-Kontrollzone, Vorschlag:** Die sechs Nachbarfelder eines lebenden feindlichen Bollwerks sind kontrolliert. Betritt eine Einheit ein solches Feld, endet ihre restliche Bewegung; ein noch verfügbarer Angriff bleibt erlaubt. Beginnt sie bereits dort, darf sie genau einen normalen legalen Schritt ausführen, danach endet Bewegung auch beim Verlassen der Zone. Dadurch gibt es keine kostenlose Fluchtkette und kein Festkleben ohne Gegenentscheidung.

Eigene Bollwerke behindern eigene Einheiten nicht; mehrere Zonen stapeln keine zusätzlichen Aktionen. Die Zone wirkt auf Zivilisten und auf Stadtfelder. Fernkämpfer und Städte erzeugen keine eigene Zone. Ein Teleport endet ebenfalls die Bewegung und darf kein kontrolliertes Zielfeld wählen; bei Start in einer Zone ist er gesperrt. Die unten beschriebene Eroberungs-Vorrückbewegung ist eine ausdrückliche Ausnahme, kein allgemeiner Zonen-Bypass.

Verborgene Kontrollzonen dürfen keine Zielvorschau verraten. **Kontaktvorschlag:** Vorschau und Pfadsuche verwenden nur aktuell bekannte Belegung und Zonen. Der akzeptierte Marsch führt den festgelegten Pfad schrittweise aus und aktualisiert nach jedem Schritt Sicht; eine dabei neu erkannte Kontrollzone kann ihn am ersten kontrollierten Feld regulär beenden. Das ist ein protokollierter erfolgreicher Marsch mit kürzerem tatsächlichem Weg, keine rückwirkende Ablehnung und kein Verbrauch eines zweiten Befehls. Bei eigenem belegtem Durchgangsfeld bleibt die Einheit vor dem blockierten Durchgang stehen; Durchquerung kann nie einen illegalen Stapelzustand erzeugen. Die UI warnt bei noch nicht einsehbaren Nachbarn vor einem möglichen früheren Kontaktstopp, ohne die verborgene Wahrheit abzufragen. In allen Fällen sind illegale Befehle schon anhand des sichtbaren Ausgangswissens ohne Zustandsänderung abzulehnen.

### Eingraben, Gegenangriff und Fernkampf

**Eingraben** ist ein eigener Befehl: nur ohne frühere Bewegung oder Angriff in diesem Zug, verbraucht Angriff und beendet Bewegung. Schutz beginnt sofort und bleibt bis zur nächsten eigenen Bewegung beziehungsweise teleportartigen Versetzung. Ein normaler späterer Angriff entfernt Eingraben nicht; es entsteht aber kein zusätzlicher Bonus allein durch einen passiven Zug. Stammes-Standfähigkeiten verwenden denselben Zustandsbegriff.

Ein überlebender, nahkampffähiger Verteidiger darf zwischen zwei eigenen Zugstarts **einmal** kontern. Ausgangsbudget 1; im HUD sichtbar. Kein Konter bei Tod, Fernkampfangriff, reinem Fernkämpfer oder Befestigungsziel.

Konterschaden berechnet den Klassengrundwert des Verteidigers gegen den Angreifer, zieht dessen Hügel-/Eingrabenverteidigung ab, begrenzt auf mindestens 1 und halbiert anschließend mit Aufrunden. Kein Flankenbonus und keine aktive Angriffsfähigkeit im Konter; ein vorhandener Schutz des Angreifers wird nach Halbierung angewandt, Mindestschaden bleibt 1. Kein Gegenkonter und kein Verbrauch des späteren eigenen normalen Angriffs. Das Budget erneuert sich beim eigenen Zugstart, nicht für jeden Angreifer.

Ein Fernkämpfer neben einer feindlichen Kampfeinheit kann nicht schießen, auch nicht auf ein anderes Ziel oder eine Stadt. Er muss sich zuerst legal lösen oder geschützt werden. **Vorschlag:** Reine Fernkämpfer können nicht stattdessen einen vollwertigen Nahkampfangriff wählen; die Vorschau erklärt diese Schwäche.

**Schusslinienvorschlag:** Beide Endpunkte und alle durchquerten Zwischenhexes müssen sichtbar sein; sie werden auf kanonischen Hex-Koordinaten bestimmt. Bei einem exakt auf einer Kante verlaufenden Schuss müssen beide berührten Zwischenfelder frei sein. Ein Zwischenhügel blockiert, wenn seine kanonische Domain-Höhe mindestens die größere der beiden Endpunkthöhen erreicht; niedrigere Hügel nicht. Ausdrücklich als blockierend definierte Bauten sperren den Schuss ebenfalls; dekorative Bäume, kleine Figuren und ein nicht eingeführter Waldtyp tun es nicht. Höhenvergleich und Gleichstandregel werden als reine Domain-Funktion getestet; Babylon-Sichtstrahlen entscheiden keinen Schaden.

### Ausruhen und bezahlte Fähigkeiten

Ausruhen ersetzt den ganzen Bewegungs- und Angriffszug und ist nur ohne vorherige Aktion erlaubt: auf angeschlossenem eigenem Land, ohne benachbarte feindliche Kampfeinheit. Es heilt 2 Gesundheit, nahe einer betriebenen passenden Reparatur-/Heilanlage insgesamt 3. **Vorschlag:** Nähe bedeutet Zentrum oder direkt benachbartes Feld. Nicht 2 plus 3, keine Kumulation mehrerer Anlagen, nie über 10.

Fähigkeiten haben ein sichtbares Ziel, Rohstoffkosten, einen festen Verbrauch von Bewegung/Angriff und eine Obergrenze. Eine abgelehnte Fähigkeit verbraucht nichts. Kein Heilen in ein gegnerisch bedrohtes Nahfeld, kein Angriff-Heilen-Angriff, kein kostenloses Aufladen durch Stadtwechsel. Konkrete Kosten in den Stammeskatalogen sind Profile, keine bereits freigegebene Zahlenbalance.

## 8. Belagerung und Besetzung

### Mauern sind keine vierte Kampfklasse

Städte haben vorgeschlagen 8 Befestigungspunkte, mit Ausbau 12 und 16. Höchstens eine normale Kampfeinheit steht als Garnison im Stadtzentrum. Es gibt keinen kostenlosen unabhängigen Stadtfernangriff.

Solange Befestigung größer als null ist, trifft ein Angriff auf das Stadtfeld **nur die Befestigung**: Bollwerk/Sturm verursachen 1, Brecher 3 Punkte. Keine Klassen-, Flanken-, Hügel- oder Eingrabenrechnung gegen Mauerpunkte, kein Überlaufschaden auf die Garnison, kein Garnisonskonter hinter intakter Mauer. Reichweite, Sicht und Fernkampfbindung gelten weiterhin.

Bei null Befestigung wird eine vorhandene Garnison mit den normalen Kampfregeln bekämpft. Ihre Klasse, nicht die Stadtarchitektur, entscheidet den Konter. Kein zusätzlicher pauschaler Stadtverteidigungsbonus neben den ausdrücklich vorhandenen Modifikatoren.

### Erobern und Zivilisten

Nur eine **nahkampffähige Bollwerk- oder Sturm-Einheit** kann eine unbefestigte Stadt ohne feindliche Einheit im Zentrum durch Betreten erobern. Ein feindlicher Zivilist muss vorher ausdrücklich angegriffen werden; er ist keine Kampfgarnison, blockiert aber den Platz. Brecher und reine Fernkämpfer können Mauern und Gegner bekämpfen, aber nicht übernehmen; eigene Zivilisten können ebenfalls keine Stadt erobern.

Ausdrückliche Vorrückausnahme: Tötet ein benachbarter geeigneter Nahkämpfer bei Befestigung null die letzte feindliche Einheit im Zentrum, darf der Angriff unmittelbar in die Stadt vorrücken, obwohl er sonst Bewegung beendet. Das gilt auch nach einem ausdrücklich gewählten Angriff auf einen dortigen Zivilisten. Dasselbe gilt, wenn er die letzten Mauerpunkte zerstört und das Zentrum **frei von jeder feindlichen Einheit** ist. Kein zusätzlicher Angriff, nur genau dieses eine Feld. Feindliche Kontrollzone verhindert diese Abschlussbewegung nicht, beendet sie aber dort. Eine reine Fernkampfzerstörung ermöglicht kein Vorrücken aus Distanz. Entfernen der Einheit, Vorrücken und Besitzerwechsel sind zusammen ein atomarer Befehl; Niederlage erst danach prüfen.

**Gewählter Zivilistenentwurf:** Ein benachbarter feindlicher Kampfverband darf eine aktuell sichtbare zivile Einheit mit einem **ausdrücklichen Angriff** töten. Der Angriff verbraucht die normale Angriffsaktion und beendet Bewegung; er entfernt die Figur deterministisch, ohne Konter. Keine automatische Tötung durch Betreten, keine Beute, Übernahme, Flucht oder Gefangenenverwaltung. Die Darstellung bleibt abstrakt und nichtgrafisch. Auch ein reiner Fernkampfverband darf diesen gesonderten benachbarten Angriff ausführen; das gibt ihm keinen normalen Nahkampf gegen Kampftruppen und keinen Fernangriff auf Zivilisten aus zwei Feldern.

Auf einem Stadtfeld schützt vorhandene Befestigung auch den Zivilisten: zuerst Mauerpunkte auf null bringen, ohne Überlaufschaden oder automatische Tötung. Danach den Zivilisten ausdrücklich angreifen. Tötet ein übernahmeberechtigter Nahkämpfer ihn, kann die atomare Vorrückausnahme greifen; ein Brecher leert nur das Feld, ein weiterer geeigneter Verband muss übernehmen. Außerhalb dieser Stadt-Ausnahme wird ein nach dem Angriff leeres Feld nicht gratis betreten. Die Vorschau zeigt Kosten, Tod der Figur und gegebenenfalls Übernahme eindeutig; es gibt keinen versteckten Fluchtausgang.

### Erhalten, gesperrt und generisch nutzbar

Eroberung überträgt Stadt, Gebiet, Verbesserungen, Gebäude, Bevölkerung und **lokale** Nahrung. Die Architektur bleibt erkennbar. Sie gewährt keinen Zugriff auf den gemeinsamen Rohstoffvorrat des alten Besitzers.

Eine laufende Produktion wird mit ihrem bezahlten Kostenbeleg eingefroren; kein automatischer Refund beim Besitzerwechsel. **Vorschlag:** Der neue Besitzer kann sie aufgeben, erhält aber für fremd bezahlte Reserven keine eigene Auszahlung. Ein generisches kompatibles Bauprojekt kann nach Besetzung fortgesetzt werden; fremdstammspezifische Truppen- und Fähigkeitsprojekte bleiben gesperrt. Befreiung durch den ursprünglichen Auftragseigentümer erlaubt dessen Fortsetzung. Keine kostenlose Vervielfältigung bei wechselnden Eroberungen.

Generische Funktionen erhalten funktionale Zuordnung: Wohnraum bleibt Wohnraum, Lagerkapazität bleibt Lagerkapazität, Verwaltung erfüllt die passende Verwaltungsstufe, Reparatur bleibt die definierte allgemeine Ruheverbesserung. Personalbedarf gilt normal. Exklusive Rekrutierung, Forschung und aktive Stammesfähigkeiten werden nicht mitgesammelt. Ein fremdes Spezialgebäude kann nur die ausdrücklich registrierte gemeinsame Funktion erfüllen; ohne solche Zuordnung ist es inaktiv und sichtbar so beschriftet. Architektur ist keine Freischaltung aller vier Stammboni.

### Zwei Besetzungsabschlüsse

Eine neu eroberte Stadt braucht zwei eigene Zugabschlüsse mit mindestens einer eigenen Kampfeinheit irgendwo in ihrem Gebiet. **Vorschlag:** Fehlt diese Präsenz, bleibt der Fortschritt stehen statt automatisch zurückzusetzen. Nichtnahrungs-Erträge und Bauarbeit sind bis einschließlich des zweiten qualifizierten Abschlusses halbiert, je Stadt und Rohstoffart einmal mit Abrunden nach Summierung. Nahrung bleibt normal, Kampfrekrutierung und militärische Aufwertungen sind gesperrt.

Besitzerwechsel setzt die Besetzungszählung neu auf null. **Befreiungsvorschlag:** Rückeroberung durch den ersten Gründerbesitzer beendet Besetzung sofort; angefangene fremde Besatzungsfortschritte werden nicht übernommen. Die Herkunfts-ID ist dauerhaft gespeichert. Andere Besitzerwechsel benötigen wieder zwei Abschlüsse. Keine zufällige Revolte, keine automatische Bevölkerungsstrafe; tatsächlicher Nahrungsmangel kann weiterhin Hunger auslösen.

Befestigung regeneriert nicht selbst. Ein bezahltes Reparaturprojekt stellt sichtbare Punkte wieder her; bei benachbarter feindlicher Kampfeinheit ist Start/Fortschritt blockiert. Ein repariertes Mauerwerk schützt die verbliebene Garnison, erzeugt aber keinen freien Angriff. Straßen- und Feldbesetzung wirken konkret; bloßes Belagern sperrt nicht pauschal alle Stadtnahrung.

## 9. Die vier Stämme

### Gemeinsame Katalogregeln

Vier Zielstämme ersetzen **im neuen Design** Meridian Union und Lantern Compact. Im vorhandenen Code bleiben diese bis zu einer versionierten Umstellung gültig. Steinwacht und Gezeitenbund waren verworfene Namens-/Konzeptalternativen, keine fünfte und sechste Fraktion.

Das vollständige Ausbauziel jedes Stamms hat drei zweistufige Kampfketten, drei zivile Rollen und vier dreistufige besondere Gebäudeketten. **Die erste Inhaltsumsetzung liefert nur eine charakteristische Fähigkeit je Stamm** zusammen mit den gemeinsamen Klassen und zivilen Rollen. Alle weiteren Katalogfähigkeiten und Gebäudestufen bleiben ausdrücklich Ausbauziel, nicht Voraussetzung dieses ersten Inhaltsinkrements. Welche Katalogfähigkeit zuerst repräsentativ umgesetzt wird und ihre konkreten Kosten werden im Paket P12 festgelegt.

Alle beginnen mit den drei gemeinsamen Kontern. Basis-Militär ist am Zentrum rekrutierbar; Militärgebäude fördern Ausbau und Stufe 2, sperren nicht einen Grundkonter hinter seltenen Stoffen.

Für die **Ausbauketten** gilt als Testregelsatz: Stufe 1 benötigt Gründung und einen freien Spezialplatz; Stufe 2 die Vorstufe und ihre gemeinsame Forschung, Stufe 3 die Vorstufe und fortgeschrittene Forschung. Die Verwaltungs-Reichweiten brauchen zusätzlich Bevölkerung 4 beziehungsweise 7, nicht pauschal jede Werkstatt. Die Verwaltungskette ist nicht zirkulär durch eine schon vorhandene höhere Verwaltung gesperrt; Lager- und Wohnzugang bleiben vor Bevölkerung 4 möglich. Ein Upgrade ersetzt den Platz. Passive Wohn-/Verwaltungs-/Lagerfreischaltung braucht kein Personal; produzierende oder aktive Funktionen benötigen vorgeschlagen einen Arbeitskraftplatz pro Kette, unabhängig von Stufe. Effekte gelten nur bei aktivem Betrieb, außer ausdrücklich passiven Kapazitäten.

### 9.1 Amazonen / Bund der Morgenröte

Eine Gemeinschaft ausschließlich erwachsener Frauen, hervorgegangen aus den Verteidigerinnen früher Zufluchtsorte. Mitgliedschaft beruht auf Aufnahme und Eid, nicht auf einer behaupteten biologischen Überlegenheit. Ausbildung, Ortskenntnis und gegenseitige Verantwortung prägen die Gesellschaft. Innerer Konflikt: Schützt Isolation die Gemeinschaft, oder braucht sie die erneute Verbindung mit anderen Städten?

Städte zeigen offene Höfe, Terrassen, leichte Wohnbauten und unverwechselbare Tore. Optional kann die kulturelle Kleidung erwachsener Figuren stilisiert und nichtsexualisiert einen unbedeckten Oberkörper einschließen. Das ist keine Hauptidentität, keine Darstellung Minderjähriger und keine Bildgenerierungsanforderung.

Stärke: Nahrung, Holz, Gelände und defensive Beweglichkeit. Schwäche: schwere Industrie benötigt fremdgleich teure, langsame Vorbereitung; keine kostenlose bessere Gesamtwirtschaft.

| Klasse | Basis → Aufwertung | Profil und begrenzte Fähigkeit |
| --- | --- | --- |
| Bollwerk | Speerwächterin → Schildschwester | Nahkampf; stationäre Verteidigung. Aufwertung nutzt denselben Eingrabenstatus, erhält keine zweite additive Gratisdeckung |
| Sturm | Jägerin → Windläuferin | Nahkampf trotz Jagdname; einmal je eigenem Zug einen Hügeleintritt für 1 statt 2 Bewegung bezahlen; Kontrollzone bleibt bindend |
| Brecher | Schwerbognerin → Sonnenbognerin | Reiner Fernkampf, Reichweite 2 und Schusslinie; schwere Bögen statt zusätzlicher Reichweitenstapelung |

**Fähigkeitsvorschlag:** Schildschwester kann beim Eingraben 1 Holz zahlen, um genau den nächsten Treffer um 1 zusätzlich zu mindern, Mindestschaden 1. Maximal eine solche Wache pro Einheit; endet bei Bewegung oder Verbrauch. Die Windläuferin bezahlt ihren Geländeimpuls ebenfalls aus einem kleinen Holzprofil; genaue Kosten gemeinsam testen. Sonnenbognerin erhält bessere Vorbereitung/Freischaltung, nicht gleichzeitig mehr Reichweite, Gesundheit und Grundschaden.

Zivilisten: **Pfadfinderin, Gründerin, Feldarbeiterin**; dieselben Grundaufgaben und Kostenklassen wie bei anderen Stämmen.

| Gebäudekette | Stufe 1 / 2 / 3: Effektstaffel | Kostenprofil / Entscheidung |
| --- | --- | --- |
| Gemeinschaftsgarten → Bewässerungshof → Saatenhaus | Betriebener Stadt-Nahrungsbonus; höherer begrenzter Bonus; zusätzlich geringerer sichtbarer Lagerverlust als späterer Ausbau, nicht unendliches Essen | Holz, später Stein; klein/mittel/groß, eine Arbeitskraft |
| Übungsplatz → Speerhof → Kriegsschule | Gemeinsame Rekrutierung unterstützen; Stufe-2-Bollwerk und -Sturm freischalten; Stufe-2-Brecher und begrenzte Trainingsprojekte | Holz/Stein, Metall erst im Ausbau; keine Klasse grundsätzlich gesperrt |
| Pfadhaus → Läuferhaus → Wegenetz | Ein eigenes Außenfeld per durchgehend eigenem Landpfad anschließen; zwei; drei, jeweils innerhalb Stadtradius | Holz, steigende Arbeit; ein Spezialplatz und Betrieb statt kostenloser Straßenüberlegenheit |
| Versammlungshof → Ratshaus → Bundhalle | Allgemeine Verwaltungsstufe 1; Radius-2-Bedingung erfüllen; Radius-3-Bedingung erfüllen, spätere Stabilitätsfunktion | Holz/Stein, später Metall; passive Verwaltung, keine unangekündigte Unruhemechanik |

**Namensnormierung:** Die Kette heißt Pfadhaus, nicht wechselnd Wegstation. Ihre Verbindung ist kein Teleport und kein Durchgang durch feindliche Felder oder Wasser. Unterbrechung des eigenen Pfads unterbricht den Anschluss; Transport zwischen Städten und militärische Bewegungsrabatte werden dadurch nicht automatisch ersetzt.

### 9.2 Waschbären / Bund der Fundstücke

Aufrecht gehende, mutierte Waschbären mit Ringelschwänzen und geschickten Pfoten. Sie haben aus verlassenen Anlagen bewohnbare Orte gemacht. Ihr Konflikt mit menschlichen Nachfahren alter Besitzer dreht sich um tatsächlichen Wiederaufbau gegen geerbte Besitzansprüche. Innerer Streit: gemeinsames Fundgut oder persönliche Erfinderrechte?

Verschachtelte Häuser, Stege, Sortierhöfe und bewusst wiederverwendete Konstruktionen bilden eine nachvollziehbare Stadt, keinen bloßen Müllhaufen. Ihre Stärke ist Anpassung und Rückgewinnung; ihre Spitzen-Massenproduktion bleibt unter einer vorbereiteten Ingenieurindustrie.

| Klasse | Basis → Aufwertung | Profil und begrenzte Fähigkeit |
| --- | --- | --- |
| Bollwerk | Deckelwacht → Panzerwacht | Nahkampf; statt des ganzen Zuges Reparatur nach gemeinsamen Ruhebedingungen, kleines Materialprofil; insgesamt höchstens 3 Heilung |
| Sturm | Gassenläufer → Hakenspringer | Nahkampf; einmalige begrenzte Routenflexibilität über ein eigenes belegtes Zwischenfeld, niemals fremde Belegung, Wasser oder Kontrollzone überspringen |
| Brecher | Schrottschleuder → Federschleuder | Reiner Fernkampf, Reichweite 2; verlässlicher Konter auch ohne Ruinenfund |

Hakenspringer ist kein freier Sprung durch die Karte: **Vorschlag** für Stufe 2 ist ein bezahlter Zweischritt entlang legaler sichtbarer Landnachbarn, Gesamtkosten mindestens 2 Bewegung, reguläre Zonenstopps an jedem Schritt. Liegt dadurch kein zusätzlicher brauchbarer Unterschied vor, Fähigkeit im Spieltest ersetzen statt eine verborgene Ausnahme zu erfinden.

Zivilisten: **Fährtensucher, Nestgründer, Schrauber**. Ein **Bergungstrupp** ist später eine Arbeiteraufwertung mit höherer Arbeitsleistung, keine vierte Kampfklasse und keine Pflicht für den normalen Ruinenzugang.

| Gebäudekette | Stufe 1 / 2 / 3: Effektstaffel | Kostenprofil / Entscheidung |
| --- | --- | --- |
| Sammelplatz → Sortierhof → Kreislaufwerk | Kontrollierte Demontagerückgewinnung; bessere begrenzte Quote; effizientere, weiterhin verlustbehaftete Wiederverwendung | Holz/Stein, später Metall; Spezialplatz und Personal bei aktiven Projekten |
| Werkbank → Werkstatt → Tüftlerhalle | Basisproduktion unterstützen; Stufe-2-Bollwerk/-Sturm; Stufe-2-Brecher und Arbeiteraufwertung | Holz/Metall, mittlere bis hohe Arbeit |
| Vorratsnest → Kühlkeller → Verbundlager | Nahrungskapazität 36 / 48 / 60 statt Grundwert 24 | Holz, Stein, später Metall; passive Kapazität, Lieferverbindung bleibt Voraussetzung |
| Tauschplatz → Markt → Handelshof | Ein Umwandlungsauftrag; höheres Auftragslimit; breiterer Austausch normaler Stoffe | Holz/Stein/Metall; personalpflichtige Arbeit, kein Netto-Gewinn-Zyklus |

**Namensnormierung:** Vorratsnest ist die erste Lagerstufe, nicht ein zweites separates Gebäude namens Lager. Andere Stämme erhalten funktional gemeinsame Lagerprojekte, ohne die Waschbärenarchitektur zu kopieren.

**Umwandlungsvorschlag:** 3 Bergungsgut → höchstens 2 Holz **oder** 1 Metall, mit Arbeit und eigenem Abschluss. Markt kann normale Stoffe nur mit einer offen verlustbehafteten Tabelle tauschen. Keine Kombination von Rückbau, Gratisbeute, Markt und Wiederaufbau darf mehr Ausgangsstoffe liefern. Alle Stämme können Bergung verwenden; Waschbären optimieren den Kreislauf, nicht den Zugang.

### 9.3 Ingenieure / Verbund der Werker

Menschen aller Geschlechter, deren Verbände aus Wartungsteams entstanden. Sie bauen bemannte Maschinen, keine autonome Roboterarmee. Ihr Streit gilt der Frage, ob gefährliches Wissen frei geteilt oder durch Verantwortungsträger begrenzt werden muss.

Städte haben Art-Deco-Stufenhallen, modulare Wohnungen, Leitungen und Maschinenhöfe. Präzision und standardisierte Teile unterscheiden sie von der improvisierten Wiederverwendung der Waschbären. Stärke ist vorbereitete Produktion; Preis sind Materialbedarf, Bauzeit und gegebenenfalls Betriebskosten.

| Klasse | Basis → Aufwertung | Profil und begrenzte Fähigkeit |
| --- | --- | --- |
| Bollwerk | Stahlträger → Schildschreitwerk | Bemannter Nahkampf; Stellung gemäß Eingraben, keine permanente überlegene Gesundheit |
| Sturm | Stoßläufer → Kolbenläufer | Nahkampf; vorbereiteter, bezahlter Bewegungsimpuls auf legalem Land, kein zusätzlicher Angriff oder Zonen-Bypass |
| Brecher | Bolzenwerfer → Bohrlafette | Reiner Fernkampf; Aufstellung vor wirksamem Spezialschuss, Reichweite bleibt 2 |

**Aufstellungsvorschlag:** Bolzenwerfer funktioniert als gemeinsamer Basis-Brecher ohne zusätzliche Wartepflicht. Bohrlafette erhält einen bezahlten Belagerungsspezialeffekt nur, wenn sie seit eigenem Zugstart nicht bewegt wurde; ihr normaler Konterangriff bleibt verfügbar. Ein eigenes Set-up, das einen ganzen früheren Zug braucht, ist eine spätere Alternative, nicht stillschweigend zusätzlich erforderlich.

**Maschinenimpuls-Vorschlag:** kleine Holzkosten, einmal je eigenem Zug ein zusätzlicher Bewegungspunkt, danach kein Rest über dem definierten Maximum; Kontrollzonen und Angriffsschluss gelten normal. Kein pauschales Paket aus mehr Schaden, Reichweite und Leben.

Zivilisten: **Vermesser, Baukolonne, Monteur**.

| Gebäudekette | Stufe 1 / 2 / 3: Effektstaffel | Kostenprofil / Entscheidung |
| --- | --- | --- |
| Werkhof → Maschinenhalle → Präzisionswerk | Mehr Bauarbeit; höherer Bonus gegen ausgewiesenen Holzverbrauch; bessere spezialisierte Produktionsprojekte | Stein/Metall, hohe Investition; eine Arbeitskraft, Betrieb abschaltbar ohne gratis Ertrag |
| Montageplatz → Fabrikhalle → Schwerwerk | Basisproduktion unterstützen; Stufe-2-Bollwerk/-Sturm; Stufe-2-Brecher | Holz/Stein/Metall; starke Vorbereitung, nicht alle Grundwerte besser |
| Depot → Pumpwerk → Versorgungszentrale | Gemeinsame Lager-/Versorgungsfunktion; begrenzte Lieferkapazität erhöhen; verlässlicheres eigenes Netz | Stein/Metall; keine kostenlose Nahrung aus fehlendem Anschluss |
| Reparaturplatz → Wartungshalle → Zentraldepot | Ruheheilung auf insgesamt 3 erhöhen; mehr zulässige Reparaturplätze; bezahlte Instandsetzungsprojekte | Stein/Metall, Personal im Betrieb; Heilmenge bleibt gedeckelt |

Für Maschinen wird Holz als vorhandener Brennstoff benutzt, wenn diese Betriebsentscheidung eingeführt wird. Kein automatischer siebter Rohstoff Treibstoff. Ausbleibender Brennstoff stoppt nur den ausdrücklich bezahlten Zusatzbetrieb, nicht lautlos die gesamte normale Stadt.

### 9.4 Zauberinnen / Zirkel des Nachglanzes

Eine Gesellschaft ausschließlich von Frauen, die Zufluchtsrituale, Lieder und Sternkarten bewahrt. Resonanz ist erlernte Vorbereitung, kein unbegrenztes Wunder. Ihr innerer Konflikt: Soll das Leuchtnetz wieder aktiviert oder seine alte Gefahr eingedämmt werden?

Runde Höfe, gestufte Observatorien, geometrische Schreine und sichtbar getragene Bögen prägen die Städte. Effekte bleiben sparsam, lesbar und deterministisch.

| Klasse | Basis → Aufwertung | Profil und begrenzte Fähigkeit |
| --- | --- | --- |
| Bollwerk | Schwellenhüterin → Siegelhüterin | Nahkampf; bezahlt einen begrenzten Schutz auf eine benachbarte eigene Einheit |
| Sturm | Funkenläuferin → Schleiertänzerin | Nahkampf; kurzer bezahlter Schritt auf sichtbares freies Land, kein Sprung durch Nebel |
| Brecher | Resonanzruferin → Sternruferin | Reiner Fernkampf, Reichweite 2 und normale Schusslinie, keine garantierte Volltreffer-Sonderarithmetik |

**Schutzvorschlag:** 1 Kristall, verbraucht Angriff und Bewegung, maximal ein Schild je Ziel, mindert den nächsten Treffer um 1 bei Mindestschaden 1, verfällt spätestens zu Beginn des nächsten eigenen Zuges. Erneuern oder mehrere Quellen stapeln nicht. Konter- und Mauerregeln bleiben eindeutig.

**Schleierschritt-Vorschlag:** 1 Kristall, höchstens 2 Hex-Distanz, Ziel sichtbar, frei, Land, nicht feindliche Stadt und nicht in Kontrollzone. Nicht aus einer Kontrollzone; beendet Bewegung, lässt einen vorhandenen normalen Angriff zu. Keine Gegnerüberschreibung oder kostenlose Beacon-Aktivierung im selben bereits verbrauchten Angriff. Grenzen und Kosten müssen gegen normale Routen getestet werden.

Zivilisten: **Schleierseherin, Kreisgründerin, Zeichenweberin**.

| Gebäudekette | Stufe 1 / 2 / 3: Effektstaffel | Kostenprofil / Entscheidung |
| --- | --- | --- |
| Kräutergarten → Mondgarten → Lebenshof | Begrenzter Nahrungsbonus; höherer Bonus; allgemeine Ruheheilfunktion, weiterhin höchstens 3 | Holz/Stein, optional Kristalle erst für Zusatzprojekte; eine Arbeitskraft |
| Lehrkreis → Zeichenhalle → Sternenkonvent | Gemeinsame Basisrekrutierung unterstützen; Stufe-2-Bollwerk/-Sturm; Stufe-2-Brecher | Holz/Stein/Metall, Kristalle nur für aktive Zusätze |
| Beobachtungsplatz → Sternwarte → Himmelsarchiv | Bezahltes kleines Sichtfenster; begrenzt größere Reichweite; längere, weiterhin befristete Aufklärung | Stein/Metall/Kristalle; keine dauerhaft offene Feindkarte |
| Schrein → Resonanzhof → Leuchtkreis | Maximal eine gespeicherte Resonanzladung; zwei; drei | Kristallbezahltes Laden, eine Arbeitskraft; kein selbstgenerierendes Endloskonto |

**Aufklärungsvorschlag:** ein aktuell sichtbares Ziel als Ausgangspunkt, kleiner definierter Radius, Ende beim nächsten eigenen Zugstart; Kosten und benannte Maximalreichweite steigen mit Stufe. Kein Abfragen beliebiger unbekannter Koordinaten auf verborgene Gegner. Sichtfenster zeigt Einheiten nur während seiner tatsächlichen Dauer.

Keine Gedankensteuerung, kein ganzer verlorener Gegnerzug, keine unendlichen Beschwörungen, keine unbegrenzte Heilung oder Schutzstapelung. Alle Grundkonter funktionieren ohne Kristalle; normale Materialien bleiben erforderlich.

## 10. Forschung, Gesellschaft und spätere Systeme

### Kleiner gemeinsamer Baum

**Gewählter Forschungsentwurf:** Alle vier Stämme teilen denselben kleinen Baum aus vier Zweigen mit jeweils zwei Technologien. Die Anwendungen sind stammesbezogen, nicht vier getrennte Technologiebäume. Forschung ist keine Eintrittsbedingung für das erste isolierte Kampf-/Sieg-Inkrement; der vollständige Wirtschafts- und Inhaltsmodus nutzt dagegen die folgenden Freischaltungen.

| Zweig | Erste Technologie, ohne Forschungsvoraussetzung | Zweite Technologie, benötigt nur die erste im Zweig |
| --- | --- | --- |
| Versorgung | **Vorratshaltung:** größere Lager und stehende Nahrungslieferungen | **Anbauverfahren:** bessere Felder und Wohnraumausbau |
| Bauwesen | **Wegebau:** Straßen und entfernte Förderanlagen | **Stadtplanung:** Verwaltung und größere Gebietsreichweite |
| Handwerk | **Metallverarbeitung:** fortgeschrittene Werkstätten | **Ausrüstung:** zweite Stufe aller drei Kampfklassen |
| Resonanzkunde | **Resonanzmessung:** Kristalle erschließen und nutzen | **Resonanztechnik:** fortgeschrittene Stammesfähigkeiten |

Grundnahrung, Holz, Stein, einfache Metallförderung und alle drei Basiskampfklassen sind **ab Beginn** verfügbar, ebenso Beacon-Aktivierung. Keine Grundklasse oder grundlegende Heil-/Versorgungsmöglichkeit wird hinter Forschung, Kristallen oder Ruinen gesperrt. Lokale Erträge im ersten Ring brauchen keinen Wegebau; Außenanlagen und interstädtische Transporte benötigen ihre ausdrücklich genannten Freischaltungen.

Ein aktives Forschungsprojekt gilt je **Spielerfraktion**, nicht je Stamm oder Stadt. Der feste geringe Fraktionsgrundertrag existiert genau einmal auch bei mehreren Städten; keine Gratisforschung für jede Neugründung. Betriebene Wissensgebäude liefern zusätzlichen Ertrag gegen belegte Bevölkerung und Gebäudeplätze. Beim Projektwechsel bleibt der erreichte Fortschritt **an der jeweiligen Technologie** gespeichert, er wird weder gelöscht noch auf ein anderes Projekt übertragen. Kein aktives Projekt bedeutet kein ungebunden lagerbares Forschungsguthaben.

Eroberung überträgt weder Technologien noch Teilfortschritt oder fremde Forschungsprojekte. Ein erobertes Wissensgebäude kann nach den gemeinsamen Besetzungs-/Personalregeln künftig eigene Forschung liefern; es stiehlt kein Wissen rückwirkend. Spiegelpartien haben getrennte Forschungsstände. Ein Abschluss investiert ausschließlich in das beim Abschluss gewählte Projekt; Fertigstellung überschreibt keine vorherigen Punkte und hat keinen automatischen Überlauf ins nächste Projekt.

**Forschungstestwerte:** 1 Punkt je Fraktion und eigenem Abschluss, zusätzlich 1 Punkt je besetztem Wissensgebäude-Arbeitsplatz; hier bedeutet „besetzt“ mit eigener Arbeitskraft betrieben, nicht militärisch okkupiert. Bei militärischer Besetzung zählt der Beitrag als Nichtnahrungs-Ertrag und wird entsprechend halbiert. Erste Technologien kosten 5, zweite 8 Punkte. Ohne Wissensgebäude braucht die erste Technologie damit 5 eigene Züge, innerhalb des Testziels **4–6**, nicht als verifizierte Balance. Kein Zwang, sämtliche Zweige innerhalb einer Partie freizuschalten.

Das gemeinsame Wissenshaus ist ab Beginn mit dem kleinen Gebäudeprofil baubar, benötigt einen Spezialplatz und eine Arbeitskraft. Forschungsvoraussetzungen haben keine wechselseitigen Zyklen: Insbesondere Anbauverfahren erlaubt Wohnraum 6 ohne Bevölkerung-4-Hürde; Stadtplanung erlaubt den Verwaltungsbau, dessen Radius-2-Nutzung erst danach Bevölkerung 4 verlangt. Wohnraum 9 wird vor Bevölkerung 7 freigeschaltet. Die breite Dreistufen-Inhaltsplanung wird später diesen acht Technologien zugeordnet, ohne weitere unbeschlossene Pflichttechnologien einzuschieben.

### Stadtrollen statt zusätzlicher Teilspiele

Nahrungsstadt, Industriestadt, Grenzstadt und Handelsstadt entstehen durch Felder, Personal, Gebäudeplätze und Standort. Sie brauchen keine separaten Regelsysteme. Eine Grenzstadt kann trotzdem wachsen; eine Industriestadt zahlt weiterhin Nahrung.

Stabilität, Politik und Unruhe können später Entscheidungen ergänzen. Die ersten Verwaltungshäuser behaupten deshalb noch keine konkrete Unruhezahl. Besetzung ist bereits eine feste deterministische Regel, keine zufällige Revoltensimulation.

### Krieg, Diplomatie und KI

**Bestätigt für den PvP-Kernmodus:** Beide Spieler stehen ab Partiebeginn im Krieg. Beacon-Wettkampf, Unterbrechung und Stadteroberung brauchen kein vorgeschaltetes Diplomatieprojekt. Das ersetzt ausdrücklich den alten Zukunftsentwurf „Start im Frieden, Nichtangriffspakt, Kriegserklärung“.

Spätere Diplomatie kann Frieden, Krieg und begrenzte Nichtangriffsabkommen ergänzen. Zuerst klären, wie ein friedlicher Gegner Beacons zurückerobern darf; nicht den Kernmodus mit einer widersprüchlichen Kriegssperre blockieren.

KI ist später und keine Voraussetzung für zwei menschliche Spieler. Sie verwendet dieselben Befehle, Kosten und Sichtdaten, stabile Bewertungen und begrenzte Sucharbeit. Keine Kenntnis verborgener Einheiten und kein Zufalls-/Zeitbudget, das Replay-Ergebnisse verändert. Ein nativer Wrapper oder zusätzliche Netzwerkarchitektur ist kein Bestandteil dieses Plans.

## 11. Sieg, Niederlage und Unentschieden

### Drei Leuchtfeuer

Ein lebender Kampfverband besetzt ein freies Leuchtfeuer und aktiviert es mit seiner noch verfügbaren Angriffsaktion. Er muss nicht Bollwerk oder Sturm sein: **Auch ein Fernkampf-Brecher darf aktivieren**, weil Stadteroberungsbeschränkungen nicht für Beacons gelten. Ein ziviler Späher nicht.

Die Aktivierung beendet Bewegung und Angriff. Fernkampfbinding durch angrenzende Gegner verhindert Schießen, nicht diese Interaktion. Besetzt ein Gegner das Feld, muss er zuerst im normalen Kampf entfernt werden; ein Fernangriff aktiviert nicht aus Distanz. Der Anspruch bleibt nach dem Weggehen bestehen, bis ein Gegner legal neu aktiviert.

Am eigenen Zugende erhöht mindestens zweifacher Besitz den eigenen Haltezähler um 1; der dritte solche Abschluss gewinnt. Bei weniger als zwei zählt er als null. **Wichtig:** Jedes zwischenzeitliche Ereignis, das den Besitz unter zwei senkt, setzt den Zähler **sofort** zurück, auch im Gegnerzug. Ein anderer Zweierverbund ist zulässig, solange die Zahl zwischendurch nie unter zwei fällt. Besitzwechsel und Reset sind atomar mit der Aktivierung.

### Niederlage und Zeitgrenze

Ein Spieler verliert, sobald er weder Städte noch lebende Gründer besitzt. Ein verbliebener Gründer hält ihn im Spiel; Späher, Armee oder Beacon-Besitz ohne Stadt und Gründer reichen nicht.

**Vorschlag für Grenzen:** Niederlage wird nach jedem zustandsverändernden Befehl geprüft, der Stadt-/Gründerbestand ändern kann, und nochmals am Zugende. Dadurch kann eine bereits ausgeschiedene Seite keine Siegaktion mehr ausführen. Nie mitten in einer atomaren Eroberung zwischen Entfernen und Übertragen prüfen. Wenn eine Testfixture beide Seiten gleichzeitig auslöscht, ist das ein Unentschieden, kein ID-Zufallssieger.

Eine vollständige Runde besteht aus genau einem Zug beider Spieler. Runde 1 endet nach dem zweiten Spieler, nicht nach zwei abstrakten Kalendertagen. Nach dem zweiten Zug der Runde 40 endet die Partie unentschieden, sofern nicht vorher Niederlage oder Beacon-Sieg entschieden hat.

Ergebnispriorität: **Niederlage/Ausscheiden vor Beacon-Sieg vor Rundengrenze.** Der aktive Spieler prüft seinen Beacon-Sieg am eigenen Abschluss. Der zweite Spieler kann also am Abschluss der Runde 40 noch gewinnen; die Runde wird nicht zu früh beim ersten Spieler beendet. Nach Ergebnis sind Spielbefehle gesperrt, Export und erneuter Import desselben abgeschlossenen Ergebnisses bleiben möglich.

Erster-Zug-Vorteil ist keine gelöste Eigenschaft dieses Entwurfs. Jede Karten-/Stammpaarung wird mit getauschten Starts und Startspieler wiederholt. Aktivierungszeit, Schutzdauer bis zum dritten Abschluss und letzte Reaktionsmöglichkeit werden separat gemessen.

## 12. Bedienung, Darstellung und technische Verträge

### Was Spieler verstehen können müssen

Vor einem Angriff: Klasse, Reichweite, Schusslinie, Rohschaden, Flanke, Verteidigung, Schutz, Konterbudget, Endgesundheit und möglicher Eroberungsschritt. Vor Zugende: Stadtnahrung, Armeeanteil, Schuld, Lieferung, Hunger, Wachstum, Arbeit und Fortschritt zum Beacon-Sieg.

Stadtinspektion trennt Besitz, Bewirtschaftung, Verbindung, Besetzung und Wohnraum. Aufwertung, Abbruch, Demontage und ein ausdrücklich gewählter Angriff auf einen Zivilisten zeigen ihre Folgen vor Bestätigung. Illegale Befehle haben klare, sichtkonforme Gründe und verändern nichts.

Einheiten sind über Rolle, Silhouette und Symbol unterscheidbar, nicht nur über Fraktionsfarbe oder Geschlecht. Tastatur und kleine Touchflächen sind Bestandteil des späteren Vollspiel-Gates. Keine dauernden Effekte, die Sichtzustände oder Auswahl überdecken.

### Visuelle Kontinuität

`docs/showcase.png` wurde als vorhandene Wurzelreferenz gelesen. Breite getrennte Landformen, Küsten, terrassierte Höhen, Komposition und Maßstab bleiben maßgeblich. Dieses Dokument ersetzt oder regeneriert kein Referenzbild.

Die übernommene Hex-Entwicklung dokumentiert zusätzlich ihr freigegebenes `concept-hex-voxel.jpg` für Brettdarstellung und Palette. Beide Referenzen wurden gelesen und bleiben unverändert. Ihre explizit freigegebenen Referenzzuständigkeiten gelten gemeinsam: Hex-Konzept für das Brett, Showcase für die Weltkomposition. Stammesarchitektur muss daraus abgeleitet werden, nicht das Brett neu erfinden.

Beschriebene Gebäude und Kleidung sind künftige Inhaltsrichtung, keine implementierten Assets. Es wurden für diese reine Dokumentationsarbeit keine visuellen Änderungen durchgeführt; vorhandene Bilder sind kein Nachweis des Zielspiels. Jede tatsächliche visuelle Umsetzung benötigt danach frische Aufnahmen der laufenden Anwendung als separate Visual overview.

### Domain, Versionierung und Messenger

`src/game` entscheidet Regeln; Rendering und UI zeigen nur Zustand und Domain-Vorschauen. Ganzzahlige Wirtschaft, explizite IDs, feste Nachbar-/Auftragsreihenfolgen und sichtbare Zustandsautomaten verhindern abweichende Ergebnisse. Fähigkeiten, Erträge und Preise gehören in validierte Definitionen.

Neue Befehle brauchen versionierte serialisierbare Formen: Angriff, Eingraben, Ruhe, Fähigkeit, Beacon-Aktivierung, Verbesserung, Zuweisung, Bauabbruch, Gebietskauf/-transfer, Nachschub und Besatzung. UI-Lokalzustand ist kein autoritativer Teil eines Zuges.

Neue Sieg-, Hunger-, Kampf-, Stammes- und Wirtschaftsregeln ändern Regel-/Inhaltsversionen. Kanonische Ressourcen- oder Start-/Beacon-Platzierung ändert die Generatorversion, auch wenn sie ähnlich aussieht. Transport-/Save-Schema wird nur bei Formänderung angehoben; Versionsnummern erst anhand des dann integrierten Basestands vergeben, nicht hier pauschal als „v5“ versprechen.

Prüfsummen über Karte und vollständigen autoritativen Zustand umfassen Gesundheit, Budgets, Nahrungsschuld, Projektreservierungen einschließlich lokaler Gründer-Nahrung, Reisevorrat, Forschungsprojekt und Teilfortschritte je Technologie, aktive Fähigkeiten, Besatzungszähler, Beacon-Besitz und Haltezähler. Spieleridentität und Stamm sind getrennt; derselbe Stamm kann zwei unabhängige Spielerzustände haben. Export ist nur an vollständigen erlaubten Zuggrenzen gültig; doppelte, alte, fremde, beschädigte und unvollständige Pakete müssen erklärt zurückgewiesen werden.

Lesbare inkompatible gespeicherte Partien bleiben unverändert und gelistet; nur ihr eigener automatischer Fortsetzungszeiger wird entfernt. Keine automatische Migration von Meridian zu Amazonen, Materialien zu sechs Rohstoffen oder alter Siegfreiheit zu Beacon-Rennen. Die bisherige Version bleibt zum Fortsetzen notwendig, bis eine ausdrücklich spezifizierte und geprüfte Migration existiert.

Azure-Container-App-Deployment, release-only GitHub-Workflow und bestehende Aufbau-/Prüfskripte bleiben unverändert. Der gesonderte Nutzerauftrag erlaubt die Veröffentlichung dieser Dokumentation mit einem Dokumentations-Issue und PR, aber keine Gameplay-Implementierung, Implementierungs-Issue-Flut, Deployments, Releases oder Merge-Aktionen. Veröffentlichungsstatus und gegebenenfalls Berechtigungsblockaden gehören in die Übergabe, nicht in behauptete Gameplay-Fertigstellung.

## 13. Durchgerechnete Beispiele

### Ein vollständiger eigener Zug

Der Spieler prüft die Abschlussvorschau und startet ein Stadtprojekt; dessen Materialien sind sofort reserviert. Sein Sturm zieht über ein sichtbares Ebenenfeld und greift einen benachbarten Brecher an: der Angriff verbraucht die verbleibende Bewegung, ein zweiter Angriff ist ausgeschlossen. Eine andere Kampftruppe steht auf einem neutralen Leuchtfeuer und verwendet ihre Angriffsaktion zur Aktivierung. Zwei unabhängige Einheitenaktionen sind kein Doppelzug einer Figur.

Beim Abschluss liefern nur bereits betriebene Felder; Bevölkerung und Armee werden versorgt, Routen einmal abgewickelt, Hunger/Wachstum geprüft und danach Arbeit gutgeschrieben. Ein dadurch fertiger Wohnbau hilft erst beim nächsten Abschluss. Hält der Spieler nun durchgehend zwei Feuer, steigt sein Zähler um eins. Ohne Partieende wird der vollständige Zug als Paket an den Gegner übergeben; dieser kann den Zähler durch rechtzeitige Rückeroberung sofort zurücksetzen.

### Stadtwirtschaft ohne versteckte Gratisarbeit

Eine Teststadt hat Bevölkerung 3, Wohnraum 6, Nahrung 14 und drei Arbeitsplätze: zwei Nahrungsfelder mit je 4 sowie ein Steinbruch mit 2 Stein. Das Zentrum liefert vorgeschlagen 3 Nahrung und 2 Arbeit; ein vorhandenes Nahrungsgebäude ist unbesetzt und liefert deshalb nichts.

Der Abschluss erzeugt 11 Nahrung und 2 Stein. Der lokale Vorrat steigt auf 25, die Bevölkerung verbraucht 6, zwei zugewiesene Kampftruppen 2. Es bleiben 17. Die Wachstumsschwelle beträgt `8 + 4 * 3 = 20`: kein Wachstum. Die 2 Arbeit gehen in das aktive bezahlte Projekt. Ein weiteres beanspruchtes, aber nicht bewirtschaftetes Feld ändert keine dieser Zahlen.

Beim nächsten identischen Abschluss bleiben `17 + 11 - 6 - 2 = 20`; genau eine Gruppe wächst, 20 Nahrung werden abgezogen. Neuer Bestand: 0, Bevölkerung 4. Der vierte Arbeitsplatz und dessen 2 Nahrung Verbrauch wirken erst im nächsten eigenen Abschluss.

### Lieferung ohne Kettenvermehrung

A hat nach Eigenbedarf und Schuldtilgung 8 freie Nahrung und Route A→B maximal 4. B hat selbst keinen Überschuss, aber Route B→C maximal 4. A sendet 4 an B; B sendet in diesem Abschluss **0** an C, weil seine Exportbasis vor dem Empfang feststand. Bei besetzter Verbindungsstraße bleibt A→B mit Status „unterbrochen“ bestehen. Hunger in B hängt an tatsächlichem Endvorrat, nicht am bloßen Routenstatus.

### Hunger

Eine Stadt mit Bevölkerung 3 hat trotz Vorrat, Ertrag und Import nur 5 ihrer 6 benötigten Nahrung: erster eigener Abschluss Hungerzähler 1, noch kein Verlust. Der nächste ebenso unvollständige Abschluss erreicht 2 und reduziert auf Bevölkerung 2. Ein weiterer unvollständiger Abschluss reduziert höchstens auf 1. Vollständige Versorgung dazwischen hätte die Folge zurückgesetzt. Fehlende Armeenahrung wird separat verbucht und lässt keinen zweiten Bevölkerungsverlust entstehen.

### Kampf und Konter

Ein Sturm greift einen Brecher an: Klassenvorteil 6. Ein zweiter eigener Kampfverband neben dem Ziel erzeugt Flanke +1. Der Brecher steht auf Hügel und eingegraben: zusammen -2. Ergebnis 5 Schaden, verbleibende Gesundheit bei voller Ausgangsgesundheit 5. Als reiner Fernkämpfer kontert dieser Brecher nicht.

Greift derselbe Sturm stattdessen ein Bollwerk auf Ebene ohne Flanke an, verursacht er 3. Das überlebende Bollwerk hat noch Konterbudget: sein Klassenvorteil gegen Sturm ergibt 6; ohne Angreiferdeckung halbiert und aufgerundet sind das 3 Gegenschaden. Ein zweiter Angreifer erhält keinen erneuten Konter vor dem nächsten eigenen Zug des Bollwerks.

### Belagerung

Eine Stadt mit 8 Mauerpunkten wird von drei Brechern mit je 3 angegriffen: 8→5→2→0, ohne Überlauf in die Garnison. Die drei Angriffe benötigen drei getrennte angreifende Einheiten beziehungsweise eigene Angriffsgelegenheiten; nicht drei Aktionen derselben Einheit. Ein anschließender geeigneter Nahkämpfer muss die Garnison normal besiegen. Erst der letzte tödliche Nahkampfangriff kann die Stadt übernehmen. War keine Garnison vorhanden, kann danach ein Sturm mit legalem Bewegungsbudget in die Stadt ziehen. Alternativ zerstört ein bereits angrenzender Sturm bei genau 1 verbleibendem Mauerpunkt mit seinem Angriff diesen letzten Punkt und rückt unmittelbar vor. Ein Fernkampf-Brecher übernimmt die Stadt niemals allein.

### Beacon-Reset zwischen eigenen Zügen

A hält zwei Feuer und hat nach seinem zweiten qualifizierten Abschluss Zähler 2. B aktiviert in seinem Zug eines davon: A fällt auf eins und sein Zähler wird sofort 0. A holt es im nächsten Zug zurück; dessen Abschluss zählt wieder als 1, nicht als 3. Hätte A vorher das dritte Feuer besessen und wäre beim Verlust von drei auf zwei gefallen, bliebe der bisherige Zähler erhalten.

## 14. Entscheidungsregister

Bestätigte Produktentscheidungen, vorläufiger Testregelsatz und echte Restentscheidungen sind getrennt. Bereits entschiedene Punkte werden nicht erneut als offen behandelt. Das Register blockiert weder die Dokumentation noch das erste begrenzte Kampfexperiment; Tests können begründete spätere Revisionen auslösen.

| ID | Status / Entscheidung | Festlegung und Grund | Prüfung / verbleibender Umfang |
| --- | --- | --- | --- |
| E1 | **Bestätigt:** Krieg ab Beginn | Diplomatie allenfalls später, kein Friedensstart | Keine erneute Grundsatzfreigabe nötig |
| E2 | **Testregelsatz:** Kampf, Mauern und Heilung | 10 Leben, 2 Bewegung, 4/6/3 Schaden, Mauer 8/12/16, Ruhe 2/3 | Mit Preview-/Domain-Tests und Spieltests prüfen, nicht als balanciert ausgeben |
| E3 | **Bestätigt:** kein Stadtlimit; **Testwert:** Abstand 4 | Standort, Versorgung und teure Gründer begrenzen Expansion | Mehr als zwei Städte sowie Abstände 3/4 und Radiusüberlappung testen |
| E4 | **Gewählter Entwurf mit Testdaten:** Start/Ökonomie | Ein Gründer, ein Späher, keine Armee; Gründer 36 Arbeit = drei Grundsoldaten plus Holz/Stein/lokale Nahrung | Gemeinsame Testtabelle prüfen; spätere Spezialpreise noch vervollständigen |
| E5 | **Testregelsatz:** Bevölkerung und Gebäude | Ein Arbeitskraftplatz je Gruppe, vier Grund-Spezialplätze, Speicher 24/36/48/60 | Wirtschaft, Überlauf und zyklusfreie Wohn-/Verwaltungsprogression prüfen |
| E6 | **Vorläufig bestätigt:** Armeeschuld | Kein Löschen durch Stadtverlust/Neuzuweisung, keine taktischen Hungermali | Stadtlose Armeen und Rekrutierungssperre gezielt testen |
| E7 | **Testregelsatz:** Konter, Zonen, Vorrücken | Eindeutige taktische Reihenfolge wie beschrieben | Keine offene Produktgrundsatzfrage; Grenzfälle testen |
| E8 | **Gewählter Entwurf:** Zivilisten können sterben | Nur ausdrücklicher benachbarter Angriff; kein Flucht-/Gefangenen-/Beutesystem | Vor Stadtübernahme entfernen; atomare Einnahme und Niederlage testen |
| E9 | **Bestätigter Umfang:** zuerst eine Fähigkeit je Stamm | Vollkatalog bleibt Ausbauziel | **Offen für P12:** erste repräsentative Fähigkeit auswählen; weitere Preise/Effekte vor jeweiliger Umsetzung festlegen |
| E10 | **Gewählter Entwurf:** gemeinsamer Acht-Technologien-Baum | Vier Zweierzweige; ein Projekt, fixer Fraktionssockel, erhaltene Teilfortschritte, kein Wissensdiebstahl | Testwerte 1/5/8 und Ziel 4–6 eigene Züge prüfen; keine Wohnraum-/Radius-Schleife |
| E11 | **Bestätigt:** gleiche Stämme erlaubt | Freie unabhängige Auswahl ab Beginn | Sechs gemischte plus vier Spiegelpaarungen, getrennte Spieleridentitäten |
| E12 | Zielidentitäten dokumentiert; Arbeitsnamen/Assets vorläufig | Keine geschlechtsabhängigen Werte; Kleidung wie beschrieben | **Offen:** finale Namen und tatsächlich umzusetzenes Art-Design |
| E13 | **Testregelsatz:** sichtkonforme Aktionen | Kein verborgener Zustand über Vorschau/Ablehnungsgründe | Kontaktstopp, Schusslinie und begrenzte Aufklärung testen |
| E14 | **Noch zu messen:** Szenario und erster Zug | Gewichtete Wege statt behaupteter Symmetrie; Sieg 2 von 3 über 3 eigene Abschlüsse, Rundengrenze 40 als Testwert | Konkrete Release-Karten und messbare Balance-Akzeptanzbereiche vor M5 festlegen |

Umsetzung und Freigabe jedes Pakets aktualisieren dieses Register, den tatsächlichen englischen Regelstand und die Agent-Guidance gemeinsam. Ein verwendeter Testwert ist ein verbindlicher Replay-Vertrag **seiner Testregelversion**, aber keine Behauptung dauerhafter Balance. Änderungen daran erhalten eine nachvollziehbare neue Regel-/Inhaltsversion.
