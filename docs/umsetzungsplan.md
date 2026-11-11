# Polaris: abhängigkeitsgeordneter Umsetzungsplan

**Stand: 11. November 2026. Planung, keine Implementierung und kein Auftrag zum Erstellen von Issues oder PRs.**

Grundlage ist das [vollständige Spielkonzept](spielkonzept.md). Dieser Plan schließt zuerst einen kleinen spielbaren Zweispielerkern und baut danach Wirtschaft und vier unterschiedliche Stämme aus. Nicht Forschung, Diplomatie und KI vor den ersten überprüfbaren Sieg stellen.

## 1. Ausgangsbasis und Arbeitsregeln

**Nutzerpräzisierung:** Alle offenen PRs sind zu berücksichtigen; sie sollen alle freigegeben werden. Gewählte Schreib- und Funktionsbasis ist deshalb der kumulative Stand `klaus/graphics-polish` bei `834ffc491fa4932e3c719191db837b3fea639445`, einschließlich PRs #20, #21, #22, #24, #29 und #31. Diese Entwicklungsbasis enthält Hex-Regeln/Generator v4, Städte, Messenger und die Grafikpolitur. Ihr Remote-Integrationsstatus bleibt separat sichtbar.

**Warum diese Basis?** Der ältere main-Stand `6aa2dbe8d45ccea58def5054ff32a55295a22b04` besitzt diese bereits erarbeiteten Verträge noch nicht. Darauf ein neues Spiel zu planen würde freizugebende PR-Arbeit ignorieren. Nur der eigene Dokumentationsbranch wurde per lokalem Fast-forward auf den neuesten kumulativen Commit vorgerückt; keine PR wurde gemergt, verändert oder retargetet. Die eigentliche Dokumentationsänderung ist relativ zu diesem Entwicklungscommit zu lesen, nicht als erneute Implementierung seiner 57 geänderten Dateien. Die bestehende Hex-/Messenger-/Grafik-Dokumentation bleibt erhalten.

Vor tatsächlicher Arbeit an einem Paket: aktuellen Stand und Blocker neu lesen, Testwerte aus dem Entscheidungsregister bestätigen, enges Implementierungsinkrement wählen, passende Versionen festlegen und direkt betroffene Dokumentation plus `.github/copilot-instructions.md` synchronisieren. Keine Umsetzung blockierter Vorgänger „nebenbei“.

## 2. Vorhandene Abhängigkeiten und alte Issues

Die folgende Reihenfolge wurde am Dokumentationsdatum über GitHubs `dependencies/blocked_by` gelesen, nicht aus PR-Nummern geraten:

| Issue | Tatsächlicher Blocker | Zugehörige offene PR | Zustand und Bedeutung |
| --- | --- | --- | --- |
| [#8](https://github.com/aschauera/polaris-game/issues/8) Stadtwirtschaft | #7, geschlossen | [#20](https://github.com/aschauera/polaris-game/pull/20) | Erste Stadtwirtschaft; Issue noch offen |
| [#25](https://github.com/aschauera/polaris-game/issues/25) Messenger | #8, offen | [#21](https://github.com/aschauera/polaris-game/pull/21) | Serverloser Zweispielermodus |
| [#26](https://github.com/aschauera/polaris-game/issues/26) Voxel-Engine | #25, offen | [#22](https://github.com/aschauera/polaris-game/pull/22) | Renderer und Siedlungen |
| [#27](https://github.com/aschauera/polaris-game/issues/27) Hex-Welt | #26, offen | [#24](https://github.com/aschauera/polaris-game/pull/24) | Sechs Nachbarn, Voxel-Hex-Brett |
| [#28](https://github.com/aschauera/polaris-game/issues/28) Guidance | #27, offen | [#29](https://github.com/aschauera/polaris-game/pull/29) | Verträge und Dokumentation synchronisieren |
| [#30](https://github.com/aschauera/polaris-game/issues/30) Grafikpolitur | #28, offen | [#31](https://github.com/aschauera/polaris-game/pull/31), Draft | Regeln/Generator v4, direkte Befehle, visuelle Vorkommen |

Beschriebene Integrationsfolge: **#20 → #21 → #22 → #24 → #29 → #31**. Tatsächliche PR-Basen sind teils bereits main, teils Vorgängerbranches; diese Tabelle retargetet nichts und ist keine Merge-Freigabe. Stacked PRs müssen nach Integration des Vorgängers ausdrücklich auf korrekte Basis, CI und das Schließen ihres eigenen Issues geprüft werden. Keine automatische Retargetierung voraussetzen. Die neue Planung erzeugt keine Remote-Beziehungen.

Die alten Issues [#9](https://github.com/aschauera/polaris-game/issues/9) bis [#15](https://github.com/aschauera/polaris-game/issues/15) beschreiben noch die frühere Reihenfolge:

| Alt | Weiter gültiger Bedarf | Anpassung bei späterer, gesondert autorisierter Issue-Pflege |
| --- | --- | --- |
| #9 Arbeiter/Straßen | Verbesserungen und Anschluss | Sechs Ressourcen, Arbeitskräfte und Hex-Entfernungen übernehmen; nicht sofort Straßen-Bewegungsrabatt verlangen |
| #10 Kampf | Domain-Kampf | Drei Konterklassen, Sicht, Konter/Zonen und separate Belagerungspakete statt nur Nachbarangriff |
| #11 Forschung/Politik/Unruhe | Späterer Ausbau | Nicht Voraussetzung des ersten PvP-Siegs; kleine Forschung von Unruhe trennen |
| #12 Fog | Sichtkonforme Aktionen | Öffentliche Beacon-Daten von privater Einheiten-/Wirtschaftssicht trennen |
| #13 Diplomatie | Optionale spätere Verträge | Kernmodus startet vorgeschlagen im Krieg; keine alte Kriegserklärungssperre einschleppen |
| #14 Fraktionen/KI | Vier Zielstämme, später KI | Meridian/Lantern-Features und verpflichtende KI sind überholte Zukunftsplanung |
| #15 Vollspiel | Sieg, Niederlage und Draw | Früher liefern, nicht hinter sämtlicher Forschung, Politik, Diplomatie und KI |

Diese Issues wurden **nicht** verändert oder geschlossen. Die Beschreibung veralteter Anforderungen ist keine Behauptung, deren vollständige neue Abhängigkeitsbeziehungen seien bereits eingerichtet. Neue Paket-IDs unten sind lokale Planungsnamen, keine GitHub-Issues.

## 3. Meilensteine und bewusste Begrenzung

| Meilenstein | Ergebnis | Ausdrücklich noch nicht nötig |
| --- | --- | --- |
| M0: Konzept | Zieldesign, Baseline, offene Entscheidungen und Reihenfolge gespeichert | Gameplay-Code |
| M1: Integrierte Basis | Hex-Städte, deterministische Messenger-Züge, kompatible Speicherung | Neue Wirtschaft, neue Stämme |
| M2: Vollständiger Kern | Zwei Menschen, kleine faire Karte, drei Klassen, drei Beacons, Stadtverlust und klares Partieende | Alle Stammesgebäude, Forschung, Diplomatie, KI |
| M3: Tragfähige Wirtschaft | Sechs Ressourcen, Arbeit, Städteausbau, Hunger und Versorgung | Vollständige Spezialeffekte |
| M4: Vier Stämme | Je drei Klassenketten, Zivilisten, Gebäude, begrenzte Fähigkeiten und Auswahl | Zusätzliche Siegarten und große Technologiebäume |
| M5: Überprüfte Partie | Sechs Paarungen, getauschte Starts, gemessene Ressourcen-/Konter-/Zugdauerprobleme | Behauptung endgültiger Balance |
| M6: Spätere Tiefe | Kleine Forschung, freiwillige Diplomatie, regelkonforme KI nach Bedarf | Server, neue Engine, ungefragte Plattformmigration |

**Wichtige Trennung:** M2 darf die bestehende generische Materialwirtschaft verwenden. Die dortige Stadt hat noch keine voll ausgebaute Arbeitskraft-/Hungerökonomie. Dokumentation und UI kennzeichnen diesen Zwischenstand; M2 und M3 erhalten unterschiedliche Regelversionen. Keine halbfertige Mischökonomie mit erfundenen sechs Nullbeständen.

## 4. Arbeitspakete mit echten Voraussetzungen

„Integrierte Basis“ bedeutet Vorgänger tatsächlich verfügbar und geprüft, nicht nur als offene PR auffindbar. Die Pakete sind vor Umsetzung noch in kleine reviewbare Änderungen aufzuteilen; Aufwandsschätzungen werden nach Quellenprüfung erstellt, nicht als feste Liefertermine behauptet.

### P0 — Konzept und Freigaberegister

**Voraussetzungen:** keine. **Ergebnis:** dieses Dokument und Spielkonzept; M0.

Abnahme: Vier Zielstämme und gemeinsame Regeln vollständig beschrieben; Bestand main und offene Entwicklung getrennt; unbelegte Zahlen als Testwerte; konkrete Randfälle und offene Entscheidungen sichtbar. README und bestehende Dokumentation verweisen darauf. Keine Remote-Aktion.

### P1 — Vorhandene Entwicklungsbasis integrieren lassen

**Voraussetzungen:** P0; alle sechs vorhandenen PRs in ihrer Reihenfolge berücksichtigen. Für Arbeit auf main müssen ihre realen Vorgängerissues geschlossen sein; alternativ ausdrücklich freigegebene gestapelte Basis verwenden.

Die lokale kumulative Basis ist in dieser Dokumentationsarbeit bereits übernommen. Ihre Integration in main bleibt ein organisatorisches Gate, kein Auftrag, hier offene PRs zu mergen. Die Aussage „alle werden freigegeben“ wird als vollständige Planungsgrundlage berücksichtigt, nicht als bereits erfolgter Remote-Merge ausgegeben. Vor neuem Gameplay die dann aktuellen Hex-, Stadt-, Messenger-, Speicher- und Renderverträge lesen und bestehende Checks ausführen.

Abnahme: main beziehungsweise ausdrücklich gewählte Basis besitzt die erforderlichen Verträge; zwei Geräte können regelkonforme aktuelle Züge austauschen; inkompatible Saves bleiben erhalten; keine quadratischen Annahmen in neuen Paketen. Konflikte zwischen diesem Dokument und nachträglichen Vorgängeränderungen sind aufgelöst.

### P2 — Szenario, Spielerplätze und Inhaltsgerüst

**Voraussetzungen:** P1.

Spieler-ID von Stammes-ID lösen. Kleine Testkarte mit zwei validierten Starts, drei reservierten öffentlichen Beacons und sechsfacher Hex-Topologie definieren. Erst gemeinsame Klassenprofile ohne volle Stammesfähigkeiten verwenden; kein vorgetäuschter vollständiger Vier-Stämme-Inhalt.

Abnahme:

- Host und Startspieler sind nicht an einen Stamm gebunden; Export enthält identische Szenariodaten.
- Alle Beacons auf legalem erreichbarem Land, Wege nicht durch Wasserpflicht oder unüberwindbaren Engpass blockiert.
- Kartenfixture misst gewichtete Wege und Startressourcen; spiegelverkehrtes Aussehen allein ist kein Fairnessbeweis.
- Datenreferenzen, IDs und Klassendefinitionen validiert; vorhandene Meridian/Lantern-Saves nicht umgedeutet.

Versionen: Inhalts-/Schemaänderung für Spieler-/Stammwahl; Generatoränderung nur bei kanonisch veränderter Karte/Platzierung, nicht bei rein kuratierter Fixture unter eigener Szenarioversion.

### P3 — Sichtkonforme Kampfgrundlage

**Voraussetzungen:** P2. Entscheidungsregister E2, E7 und E13 vor Code bestätigen.

Gesundheit, Bewegung/Angriffsbudget, drei Klassen, deterministische Vorschau, Nah-/Fernkampf, Schusslinie, Eingraben, Flanke, Konterbudget, Ruhe und Kontrollzone. Noch keine Stammesfähigkeiten.

Abnahme:

- Vorteil 6, neutral 4, Nachteil 3 als bestätigte Testfixture; Hügel/Eingraben, Flanke, Schutzreihenfolge und Mindestschaden stimmen zwischen Preview und Befehl überein.
- Tote Einheiten kontern nicht; zweite Nahattacke bekommt keinen zweiten Konter; Fernangriff löst keinen Nahkonter aus.
- Eigene Einheiten durchquerbar, Endfeld nie gestapelt; gleiche Wege reproduzierbar.
- Zonen-Eintritt, Start in Zone, Rückzug, Stadtfeld und eingeschränkter Teleport ausdrücklich getestet.
- Fog-Leaks über Zielwahl, Wegsuche, Schusslinien und Ablehnungsgründe ausgeschlossen; sichtbare Vorschau nicht aus Gegner-Wahrheit ableiten.

Versionen: Regeln und Befehls-/Transportschema bei neuen Befehlsformen; Zustandsprüfsumme umfasst Gesundheit und alle Budgets.

### P4 — Stadtangriff, Eroberung und Besetzung

**Voraussetzungen:** P3. E8 bestätigen.

Befestigung, Garnison, erlaubte Übernehmer, einfeldrige Vorrückausnahme, Zivilflucht/-gefangennahme, Besitztransfer, Besetzung und bezahlte Reparatur umsetzen. Im M2-Zwischenstand bisherige Materialwirtschaft verwenden.

Abnahme:

- Mauer 8/12/16 und Schaden 1/1/3 separat von Klassenschaden; kein Überlauf oder freier Stadtangriff.
- Leere Stadt nach Mauerbruch, letzte Garnison, Fernangreifer und Kontrollzone korrekt.
- Genau zwei qualifizierte Besetzungsabschlüsse, klar definierte Präsenz, Rundung und Befreiung.
- Gebäude, Nahrung und Gebiet bleiben; gegnerische gemeinsame Bestände werden nicht erbeutet.
- Fremde Produktion pausiert, keine Gratiserstattung oder fremde Fähigkeitssammlung.
- Zivilist nicht durch bloßes Gehen gelöscht; keine Entitäts- oder Besitzlücke bei atomarer Eroberung.

### P5 — Beacon-Sieg und vollständiges Partieende

**Voraussetzungen:** P4. E1 und Rundengrenzen bestätigen.

Aktivierung als Angriffsaktion für alle Kampfklassen, öffentlicher Besitz, unmittelbarer Reset, Sieg/Niederlage/Draw und Ergebnis-Sperre.

Abnahme:

- Zwei von drei über drei eigene Abschlüsse; Verlust unter zwei im Gegnerzug setzt sofort zurück.
- Wechsel des gehaltenen Paars ohne Unterschreiten zulässig; ziviler Späher aktiviert nicht, Fernkampf-Brecher schon.
- Keine Städte und keine Gründer verliert; verbliebener Gründer verhindert Niederlage.
- Niederlage vor Beacon-Sieg vor Draw; 40 vollständige Runden, zweiter Spieler darf am letzten Abschluss noch gewinnen.
- Import eines fertigen Ergebnisses idempotent; nach Ergebnis keine weiteren Spielbefehle.

### P6 — M2 von Gerät zu Gerät abnehmen

**Voraussetzungen:** P5.

Zwei menschliche Spieler führen eine Partie bis zum Ergebnis per Link/Code/Datei. Dieses Paket ist ein enges Integrations-Gate, kein neuer Funktionssammelbehälter.

Abnahme: Spielstart, vollständige Züge, Kampf, Stadtübernahme, Beacon-Rückeroberung, Sieg und Wiederaufnahme nachvollziehbar. Wiederholte, verspätete, beschädigte und falsche Pakete verändern keine Partie. Lange Befehlslogs und Speichergrenzen mit den neuen Befehlen testen. UI erklärt M2 ohne noch fehlende Wirtschaft und Stammesboni zu versprechen. Frische reale Screenshots jeder visuellen Änderung als eigene Visual overview.

### P7 — Sechs Ressourcen und Arbeiteraufträge

**Voraussetzungen:** P6. E4 bestätigen.

Generische Materialien durch versionierte Rohstoffvektoren ersetzen; kanonische Vorkommen, finite Ruinen, Verbesserungen, Arbeitstage und Anschluss. Grundpreise vor Sonderboni festlegen.

Abnahme:

- Alle sechs Ressourcen haben explizite Quelle, Bestand und Verwendung; Nahrung lokal, andere fünf global.
- Dekorative Apfel-/Fisch-/Steinklassifizierung ist nicht unbesehen die autoritative Wirtschaftsquelle.
- Keine seltene Ressource als Pflicht für Grundkonter; startbezogene Ressourcenverfügbarkeit getestet.
- Arbeiterbau wird bezahlt, unterbrochen und genau einmal fertig; Betrieb danach mit Bevölkerung, nicht stehender Arbeiterfigur.
- Fischerei vom eigenen Land aus; Straßen ändern Wasserpassierbarkeit nicht.
- Endlicher Ruinenvorrat, kein negativer Bestand und keine Recyclingarbitrage.

Versionen: Regel-, Inhalts- und Wirtschaftsschema; Generatorversion für kanonische Ressourcenplatzierung. Kein automatischer Altmaterial-Umtausch in laufenden Partien.

### P8 — Arbeitskräfte, Stadtgebiet und Bauwirtschaft

**Voraussetzungen:** P7. E3 und E5 bestätigen.

Zuweisungen und Pins, Grundzentrum, Wohnen, Speicher, Radiusfreischaltung, einzelne Expansionsprojekte, eigene Feldübertragung, Kostenreservierung und Abbruch.

Abnahme:

- Jede Bevölkerungskraft höchstens einmal belegt; unbewirtschafteter Besitz liefert keinen versteckten Ertrag.
- Start ohne Arbeitskräfte kann nicht wirtschaftlich festfahren.
- Bevölkerung 4/7 und Verwaltung erlauben Radius 2/3, aber verleihen keine ganzen Ringe.
- Küstenwasseranspruch und Fischerei ohne Land-Wasser-Bewegung; Gebiet verbunden und eindeutig.
- Stadtlimit samt Eroberungsausnahme, Abstand und umkämpfte Überlappung gemeinsam getestet.
- Reservierungen nie doppelt verfügbar; Abbruchformel, blockierter Truppenausgang und fremd bezahlte Aufträge ohne Materialvermehrung.

### P9 — Nahrung, Hunger und Armeeverpflichtung

**Voraussetzungen:** P8. E6 bestätigen.

Geordneter Abschluss ohne interstädtische Lieferungen zuerst: Erträge, Eigenbedarf, Unterhalt, Schuld, Hunger, Wachstum, Produktion. Speicher und tatsächliche Ausgabe sichtbar.

Abnahme:

- 2 Nahrung je Bevölkerung; Schwelle `8 + 4 * Bevölkerung`, höchstens ein Wachstum, Wohnraum geprüft, Überlauf angezeigt.
- Zweiter Hungerabschluss senkt Bevölkerung, danach höchstens eins pro Zug, Untergrenze 1 und Reset bei vollständiger Versorgung.
- 1 Nahrung je Kampftruppe; Stadtverlust, Neuzuweisung, Straßenunterbrechung und Stadtlosigkeit löschen Verpflichtung nicht.
- Keine taktischen Hungermali; Schuld- und Rekrutierungssperre sichtbar und serialisiert.
- Neu gewachsene Bevölkerung/gebautes Haus zählt nicht rückwirkend; Besetzungsrundung und Nahrungsausnahme korrekt.

### P10 — Begrenzte interstädtische Nahrungslieferungen

**Voraussetzungen:** P9.

Stehende Routen, Anschlussprüfung, Quelleigenbedarf, gemeinsame Export-Snapshots und Empfängerkapazität ergänzen. Dieses Paket kann vorläufig nach M4 verschoben werden, solange es nicht als bereits vorhandene Funktion beworben wird.

Abnahme: Mehrere Geber, knappe Empfängerspeicher, A→B→C, Kreisrouten, gekappte Exporte, Schuldenpriorität, Stadtverlust und Unterbrechung reproduzierbar. Keine neu empfangene Nahrung im selben Abschluss weiterreichen. Übertragungen erhalten Gesamtmenge; Verlust nur als ausdrücklich ausgewiesener Speicherüberlauf.

### P11 — Stammesdaten, Bauten und Zivilidentität

**Voraussetzungen:** P9. E9, E11 und erforderliche Inhaltsfreigaben E12 bestätigen.

Vier vollständige Stammesdefinitionen; alle Kataloge und gemeinsamen Funktionsäquivalente. Zuerst Gebäude-/Einheitenstufen ohne aktive Spezialfähigkeiten; keine Menge ungetesteter Sonderbefehle gleichzeitig.

Abnahme:

- Genau vier Zielstämme, kein zusätzlicher Steinwacht-/Gezeitenbund-Eintrag.
- Je drei Kampfklassen mit zwei Stufen, drei zivile Rollen, vier dreistufige Spezialketten.
- Alle Ketten konkrete Kosten, Arbeit, Vorstufen, Personalbedarf und Platzverbrauch; keine als null interpretierten Platzhalter.
- Pfadhaus und Vorratsnest konsistent benannt; Bergungstrupp bleibt Arbeiteraufwertung.
- Fremde eroberte Gebäude funktionieren nur über explizite gemeinsame Äquivalente; weder Wohnraumverlust durch falsche Stamm-ID noch Sammeln aller Boni.
- Bevölkerung wird für normale Truppen nicht verbraucht; keine geschlechtsabhängigen Werte.

### P12 — Begrenzte Stammesfähigkeiten

**Voraussetzungen:** P11.

Je Fähigkeit ein enges Implementierungsinkrement in einem gemeinsamen Budget-/Kostenrahmen. Erst dann Fähigkeiten kombinieren.

Abnahme: Kristall-/Holzkosten, einmalige Ladungen, Bewegung und Angriff korrekt; keine Schutz-/Heilstapelung, Nebelteleports, Zonen-Umgehung, Gratis-Reparatur oder Wiederaufladung durch Stadttausch. Ingenieure haben keine pauschale Statistiküberlegenheit. Waschbären können ohne Ruinen wirtschaften. Amazonen bezahlen ihren alternativen Anschluss mit Gebäudewahl. Zauberinnen besitzen ohne Kristalle weiterhin alle Grundkonter.

### P13 — M5-Paarungen, Ressourcen und Startspielervorteil

**Voraussetzungen:** P12; P10 zusätzlich, wenn Lieferungen zum getesteten Modus gehören.

Sechs ungeordnete Stammkombinationen: Amazonen–Waschbären, Amazonen–Ingenieure, Amazonen–Zauberinnen, Waschbären–Ingenieure, Waschbären–Zauberinnen, Ingenieure–Zauberinnen. Jede mindestens mit getauschten Startpositionen und Startspieler; 12 Partien sind nur eine erste vollständige Abdeckung, keine statistische Balancevalidierung. Startspieler und Position zusätzlich unabhängig kreuzen, wenn Szenario sie getrennt variieren lässt.

Abnahme: veröffentlichte Seeds, Versionen, Aufstellungen, Befehlslogs und Auswertung. Messen: erster Beacon-Kontakt, Dauer bis zum Sieg, effektive Konterverfügbarkeit, Ressourcenengpässe, Hunger/Schuld, Anteile der Klassen, Blockaden und erste-Zug-Siegquote. Vorab messbare Akzeptanzbereiche vereinbaren; keine Grenzwerte erst nach Sicht auf gute Ergebnisse auswählen. Balanceänderungen einzeln begründen und erneut mit vertauschten Bedingungen spielen.

## 5. Spätere, unabhängige Ausbaupakete

| Paket | Voraussetzungen | Umfang / Abnahme |
| --- | --- | --- |
| F1 Kleine Forschung | P11, Freigabe E10 | Gemeinsame überschaubare Voraussetzungen; keine Zyklen, alle Effekte sichtbar; Basiskonter bleiben zugänglich. Forschungsgerüst kann zunächst durch Szenariostufen ersetzt sein |
| F2 Gesellschaft/Politik | P9 und F1 | Wenige echte Entscheidungen; Unruhe/Stabilität nicht nur Zahlenlast; Besetzung nicht doppelt bestrafen |
| F3 Diplomatie | P6 und eigener Beschluss zur Beacon-Interaktion im Frieden | Frieden/Krieg/Nichtangriff konsistent serialisieren, ohne Kernmodus nachträglich zu blockieren |
| F4 KI | P13, optional F1 nur wenn KI diese Forschung spielen soll | Gleiche Befehle und Fog, deterministische begrenzte Suche, keine versteckten Boni; Worst-Case-Arbeit messen |
| F5 Weitere Ressourcen-/Weltregeln | P13 und konkrete Freigabe | Kahlschlag, Erschöpfung, Schiffe, Brücken oder weitere Siegarten einzeln; nie durch Grafik nebenbei hinzufügen |
| F6 Größere Verteilung/Plattformen | M5 und eigener Produktbeschluss | Bestehende Browser-/Messenger-Architektur nicht ohne Freigabe ersetzen; native Verpackung separat bewerten |

F1 vor P12 ist möglich, falls Stammesfreischaltungen schon im ersten Inhaltsinkrement erforscht statt über Teststufen bereitgestellt werden sollen. Das ist eine explizite Scope-Entscheidung: entweder M4-Testfixture mit fest freigegebenen Gebäudestufen oder Forschung als zusätzliches Gate; nicht halb implementierte Sperren mit unzugänglichen Upgrades.

## 6. Versions- und Persistenzplan

| Änderung | Regeln | Generator/Szenario | Inhalt | Schema/Transport |
| --- | --- | --- | --- | --- |
| Dokumentation | Nein | Nein | Nein | Nein |
| Hex-/Messenger-Basis | Bestehende Vorgängerversion erhalten | Bestehende v4 nicht neu nummerieren | Bestehende Definitionen | Bestehendes Format |
| Kampf, Sieg, Besetzung | Ja | Nur wenn kanonische Platzierung ändert | Klassen, Beacons, Befestigungen | Neue Befehle/Zustandsfelder prüfen |
| Kanonische Ressourcen | Ja | Ja bei generierter Verteilung | Sechs Ressourcen/Verbesserungen | Bestände, Vorräte, Reserven |
| Arbeit, Hunger, Versorgung | Ja | Normalerweise nein | Erträge/Kosten | Pins, Schuld, Hunger, Routen |
| Vier Stämme/Forschung | Ja bei Effekten | Nein ohne Platzierungsänderung | Ja | Spieler-/Stammtrennung, Ladungen/Fortschritt |
| Rein visuelles Asset | Nein, wenn wirklich ohne Domain-Effekt | Nein | Präsentationsversion nach Bedarf | Nein |

Exakte Versionsnummern erst beim jeweiligen Integrationsstand bestimmen. Nicht jede Zeile braucht ein neues unabhängiges Format; vorhandene Hüllen mit expliziter Inhaltsversion können genügen. Jede Wirkung auf Replay-Hash oder legalen Befehl braucht aber eine nachvollziehbare Kompatibilitätsentscheidung.

Für jeden Regelmeilenstein: altes lesbares Paket aufbewahren und explizite Ablehnung ohne Überschreiben testen; neues Paket exportieren/importieren; alle Befehle zweimal auf unabhängigen Zuständen wiedergeben; identische Zustands- und Kartenprüfsummen prüfen. Keine Migration durch Textaustausch von Fraktionsnamen.

Unbekannte Produkt-/Fähigkeits-IDs, ungültige Zahlen, negative Vorräte, doppelte IDs, falsche Zielreferenzen, ungültige Reihenfolge und übergroße Logs vor Annahme abweisen. Autoritative Zustände enthalten keine Babylon-Objekte, DOM-Daten oder Framezeiten.

## 7. Übergreifende Abnahme und Dokumentationspflege

### Prüfstrategie

Domain-Tests sind der erste Nachweis: gezielte Fälle pro neuer Regel, unveränderter Zustand bei Ablehnung und stabile Sortierung. Szenario-/Replaytests verbinden Systeme; Playwright prüft tatsächliche Bedienung, Information und Übergaben. Manuelle getauschte Partien liefern Balancefeedback, nicht Ersatz für deterministische Grenztests.

Die vorhandenen Befehle sind `npm run typecheck`, `npm run lint`, `npm run test:unit` und `npm run test:e2e`. Für Implementierungsinkremente zunächst kleinsten passenden Testumfang ausführen, anschließend die vom integrierten Repository vorgeschriebenen Gates. Diese Dokumentationsänderung ändert keine Skripte und behauptet keinen neuen Gameplay-Testlauf.

### Kritische Regressionen

| Bereich | Unverzichtbarer Randfall |
| --- | --- |
| Sieg | Sofortiger Reset im Gegnerzug, Paarwechsel, Sieg am letzten zweiten Zug, Gründer ohne Stadt |
| Kampf | Toter Verteidiger, verbrauchter Konter, Flanke zählt Angreifer, minimaler Schaden, blockierte Schusslinie |
| Bewegung/Fog | Zonenstart und Rückzug, Durchgang eigener Einheit, verborgenes Ziel, Teleportziel |
| Stadt | Letzte Mauer ohne Garnison, letzter Garnisonstod, Zivilflucht, fremde Queue, Rückeroberung |
| Wirtschaft | Ein Arbeitsplatz nicht doppelt, Hungerfolge/Reset, Wohnsperre, Überlauf, frisch fertiger Bau |
| Logistik | A→B→C ohne Transshipment, mehrere Geber, Straßenunterbrechung, Armeeschuld ohne Stadt |
| Material | Reservierung, vollständiger Abbruch, blockierter Spawn, Demontage/Markt/Beute ohne Kreislaufgewinn |
| Persistenz | Inkompatibler lesbarer Save bleibt bytegleich; doppelter/alter Import, Limits, Replay-Divergenz |
| Darstellung | Keine unbekannten Ressourcen oder Gegner in Pick/HUD, öffentliche Beacons ohne Sichtleck |

### Pro Paket zu pflegen

Spielkonzept: bestätigte Regeln und Entscheidungsregister. Englischer Game-Design-Text: tatsächlich implementierter Stand mit Zahlen. Architektur: Domain-/Schema-/Versionierungsentscheidungen. Roadmap: erreichter Meilenstein und noch blockierte Pakete. README: nutzbarer Funktionsumfang und Einstieg. Agent-Guidance: verbindliche Verträge, keine in Chat versteckte Sonderregel.

Für visuelle Änderungen immer frische Aufnahmen des laufenden Ergebnisses gesondert liefern; Referenzbilder sind keine Implementierungsnachweise. Azure-Release-Deployment bleibt unverändert. Keine PR-Eröffnung, Issue-Erzeugung, Merge-Aktion oder Release ohne gesonderten Auftrag.
