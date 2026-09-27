// Der Timer fuer den laufenden Block - reine Rechnerei, kein Browser noetig.
//
// Idee: Fuer den Block, der gerade laeuft, stellt sich automatisch ein Timer.
// Er klingelt ein paar Minuten VOR dem Ende des Blocks, damit genug Zeit
// bleibt, das Naechste vorzubereiten. Beim Schlafen klingelt nichts - fuers
// Aufstehen ist der iPhone-Wecker da.

import { findeJetztUndNaechstes, blockStart, blockEnde } from './zeit.js';

/** In diesen Kategorien klingelt der Timer nie. */
export const TIMER_OHNE = ['schlaf'];

/** Die Auswahl in den Einstellungen: so viele Minuten vor dem Ende. */
export const VORLAUF_WAHL = [1, 2, 3, 5];

/**
 * Ein Zeitpunkt (Millisekunden) aus Tag und Minute im logischen Tag.
 * "29:00" am 20.09. ist der 21.09. um 05:00 - der Date-Konstruktor rechnet
 * den Ueberlauf selbst um und beachtet dabei auch die Sommerzeit.
 */
export function zeitpunkt(tagIso, minuten) {
  const [j, m, t] = tagIso.split('-').map(Number);
  return new Date(j, m - 1, t, 0, minuten).getTime();
}

/**
 * Der Timer fuer den Block, der gerade laeuft.
 * @param {(iso:string)=>Array} holeBloecke
 * @param {Date} jetzt
 * @param {{vorlaufMinuten?:number, ohne?:string[]}} optionen
 * @returns {null | {block, tag, schluessel, startUm, klingelnUm, endeUm, naechster, naechsterTag}}
 */
export function laufenderTimer(holeBloecke, jetzt, { vorlaufMinuten = 2, ohne = TIMER_OHNE } = {}) {
  const { aktuell, aktuellTag, naechster, naechsterTag } = findeJetztUndNaechstes(holeBloecke, jetzt);
  if (!aktuell || ohne.includes(aktuell.kategorie)) return null;

  const startUm = zeitpunkt(aktuellTag, blockStart(aktuell));
  const endeUm = zeitpunkt(aktuellTag, blockEnde(aktuell));
  // Bei sehr kurzen Bloecken nie vor dem Start klingeln.
  const klingelnUm = Math.max(startUm, endeUm - Math.max(0, vorlaufMinuten) * 60000);

  return {
    block: aktuell,
    tag: aktuellTag,
    schluessel: `${aktuellTag}|${aktuell.id}`,
    startUm,
    klingelnUm,
    endeUm,
    naechster,
    naechsterTag,
  };
}

/**
 * Soll jetzt geklingelt werden?
 * Ja, sobald die Klingelzeit erreicht ist - auch wenn man die App erst etwas
 * spaeter wieder oeffnet. Aber nur, solange der Block noch laeuft, und fuer
 * jeden Block nur einmal.
 * @param {object|null} timer          Ergebnis von laufenderTimer()
 * @param {number} jetztMs
 * @param {Set<string>} erledigt       Schluessel, fuer die schon geklingelt wurde (oder die stumm sind)
 */
export function sollKlingeln(timer, jetztMs, erledigt = new Set()) {
  if (!timer) return false;
  if (erledigt.has(timer.schluessel)) return false;
  return jetztMs >= timer.klingelnUm && jetztMs < timer.endeUm;
}

/** Restzeit als "4:05", "12:30" oder "1:02:03" - nie negativ. */
export function countdownText(ms) {
  const sekunden = Math.max(0, Math.ceil(ms / 1000));
  const std = Math.floor(sekunden / 3600);
  const min = Math.floor((sekunden % 3600) / 60);
  const sek = sekunden % 60;
  const zwei = (n) => String(n).padStart(2, '0');
  return std > 0 ? `${std}:${zwei(min)}:${zwei(sek)}` : `${min}:${zwei(sek)}`;
}

/** Ein Zeitpunkt als "14:58". */
export function uhrzeitText(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
