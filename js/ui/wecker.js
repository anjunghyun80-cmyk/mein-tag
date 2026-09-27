// Der Wecker fuer den laufenden Block: Ton, Vollbild-Nachricht und
// "Bildschirm anlassen".
//
// Wann geklingelt wird, rechnet js/logik/timer.js aus. Hier passiert nur,
// was der Browser dafuer braucht:
//
// - Ton: Das iPhone spielt Toene erst ab, nachdem man einmal in die App
//   getippt hat. Deshalb schalten wir den Ton beim ersten Tippen frei
//   (tonFreischalten). Der Weckton ist selbst erzeugt - vier kurze Pieptoene,
//   dann eine Pause, immer wieder, bis man "Stopp" drueckt.
// - Grenzen: Ist die App zu oder das iPhone gesperrt, schlaeft die Seite.
//   Dann kann keine Web-App klingeln. "Bildschirm anlassen" (Wake Lock)
//   verhindert, dass das iPhone von selbst sperrt, solange die App offen ist.

import { el } from './dom.js';
import { icon } from './icons.js';
import { laufenderTimer, sollKlingeln, uhrzeitText, countdownText } from '../logik/timer.js';
import { schalteErledigt, istErledigt } from '../logik/zustand.js';
import { zuText, blockStart } from '../logik/zeit.js';

const MERKER = 'mein-tag/geklingelt';

let kontext = null;
let klingelTakt = null;
let klingelSchluss = null;
let wachSperre = null;
let offen = null;

/** Bloecke, fuer die man den Timer ausgeschaltet hat (nur bis die App neu startet). */
const stumm = new Set();
/** Bloecke, fuer die schon geklingelt wurde - auch ueber einen Neustart hinweg. */
const geklingelt = ladeGeklingelt();

function ladeGeklingelt() {
  try {
    return new Set(JSON.parse(localStorage.getItem(MERKER)) ?? []);
  } catch {
    return new Set();
  }
}

function merkeGeklingelt(schluessel) {
  geklingelt.add(schluessel);
  try {
    // Nur die letzten 40 merken - aeltere Tage interessieren nicht mehr.
    localStorage.setItem(MERKER, JSON.stringify([...geklingelt].slice(-40)));
  } catch { /* privater Modus - dann eben nur bis zum Neustart */ }
}

// ---------------------------------------------------------------------------
// Ton
// ---------------------------------------------------------------------------

/** Muss aus einem Tippen heraus aufgerufen werden - erst dann darf es klingen. */
export function tonFreischalten() {
  const Klasse = window.AudioContext || window.webkitAudioContext;
  if (!Klasse) return;
  if (!kontext) kontext = new Klasse();
  if (kontext.state === 'running') return;
  kontext.resume().catch(() => {});
  // Ein stiller Mini-Ton - so merkt sich das iPhone, dass Ton erlaubt ist.
  const quelle = kontext.createBufferSource();
  quelle.buffer = kontext.createBuffer(1, 1, 22050);
  quelle.connect(kontext.destination);
  quelle.start(0);
}

/** Ist der Ton freigeschaltet? */
export function tonBereit() {
  return Boolean(kontext) && kontext.state === 'running';
}

/** Schaltet den Ton beim naechsten Tippen frei - auch nach der Rueckkehr aus dem Hintergrund. */
export function beobachteTippen() {
  const los = () => tonFreischalten();
  document.addEventListener('pointerdown', los, { passive: true });
  document.addEventListener('touchend', los, { passive: true });
  document.addEventListener('keydown', los);
}

function piep(start, frequenz) {
  const ton = kontext.createOscillator();
  const lautstaerke = kontext.createGain();
  ton.type = 'square';
  ton.frequency.value = frequenz;
  // Weich ein- und ausblenden, sonst knackt es.
  lautstaerke.gain.setValueAtTime(0.0001, start);
  lautstaerke.gain.exponentialRampToValueAtTime(0.2, start + 0.01);
  lautstaerke.gain.setValueAtTime(0.2, start + 0.09);
  lautstaerke.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
  ton.connect(lautstaerke).connect(kontext.destination);
  ton.start(start);
  ton.stop(start + 0.13);
}

function spieleMuster() {
  if (!kontext) return;
  if (kontext.state !== 'running') kontext.resume().catch(() => {});
  const beginn = kontext.currentTime + 0.03;
  for (let i = 0; i < 4; i += 1) piep(beginn + i * 0.16, i % 2 ? 1175 : 988);
}

/** Klingelt, bis stoppeKlingeln() kommt - hoechstens `sekunden` lang. */
export function starteKlingeln(sekunden = 120) {
  stoppeKlingeln();
  try {
    // Wie ein echter Wecker: auch klingeln, wenn der Stumm-Schalter an ist.
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
  } catch { /* aeltere iPhones kennen das nicht */ }
  spieleMuster();
  klingelTakt = setInterval(spieleMuster, 1300);
  klingelSchluss = setTimeout(stoppeKlingeln, sekunden * 1000);
  try { navigator.vibrate?.([200, 100, 200]); } catch { /* das iPhone kann das nicht */ }
}

export function stoppeKlingeln() {
  clearInterval(klingelTakt);
  clearTimeout(klingelSchluss);
  klingelTakt = null;
  klingelSchluss = null;
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'auto';
  } catch { /* egal */ }
}

// ---------------------------------------------------------------------------
// Bildschirm anlassen
// ---------------------------------------------------------------------------

export function wachBleibenMoeglich() {
  return 'wakeLock' in navigator;
}

/**
 * Haelt den Bildschirm an (oder laesst ihn wieder los). Das iPhone gibt die
 * Sperre frei, sobald die App in den Hintergrund geht - deshalb ruft app.js
 * das beim Zurueckkommen erneut auf.
 */
export async function setzeWachBleiben(an) {
  if (!wachBleibenMoeglich()) return false;
  if (!an) {
    if (wachSperre) await wachSperre.release().catch(() => {});
    wachSperre = null;
    return true;
  }
  if (wachSperre || document.visibilityState !== 'visible') return true;
  try {
    wachSperre = await navigator.wakeLock.request('screen');
    wachSperre.addEventListener('release', () => { wachSperre = null; });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Timer des laufenden Blocks
// ---------------------------------------------------------------------------

/** Der Timer fuer den laufenden Block - oder null (aus, Schlafen, nichts geplant). */
export function aktuellerTimer(app, jetzt = app.jetzt()) {
  const e = app.zustand.einstellungen;
  if (!e.timerAn) return null;
  return laufenderTimer(app.bloecke, jetzt, { vorlaufMinuten: e.timerVorlauf });
}

export function istStumm(schluessel) {
  return stumm.has(schluessel);
}

export function schalteStumm(schluessel) {
  if (stumm.has(schluessel)) stumm.delete(schluessel);
  else stumm.add(schluessel);
}

/** Jede Sekunde aus app.js: Ist es Zeit zu klingeln? */
export function pruefeWecker(app, jetzt = app.jetzt()) {
  if (offen) return;
  const timer = aktuellerTimer(app, jetzt);
  if (!sollKlingeln(timer, jetzt.getTime(), new Set([...geklingelt, ...stumm]))) return;
  merkeGeklingelt(timer.schluessel);
  zeigeWecker(app, timer);
}

// ---------------------------------------------------------------------------
// Die Vollbild-Nachricht - wie beim iPhone-Timer
// ---------------------------------------------------------------------------

function zeigeWecker(app, timer) {
  starteKlingeln();

  const schliessen = () => {
    stoppeKlingeln();
    overlay.remove();
    offen = null;
    document.body.style.overflow = '';
  };

  const knoepfe = [
    el('button', { class: 'knopf akzent gross', onclick: schliessen }, [el('span', { text: 'Stopp' })]),
  ];

  if (timer.block.abhakbar && !istErledigt(app.zustand, timer.tag, timer.block.id)) {
    knoepfe.push(
      el(
        'button',
        {
          class: 'knopf rand gross',
          onclick: () => {
            app.aktualisiere(schalteErledigt(app.zustand, timer.tag, timer.block.id));
            schliessen();
            app.toast(`${timer.block.titel} erledigt`);
          },
        },
        [icon('haken', 19), el('span', { text: 'Erledigt – abhaken' })],
      ),
    );
  }

  const overlay = el('div', { class: 'wecker', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'wecker-titel' }, [
    el('div', { class: 'wecker-karte' }, [
      el('div', { class: 'wecker-marke' }, [icon('glocke', 17), el('span', { text: 'Timer' })]),
      el('div', {
        class: 'wecker-rest',
        dataset: { countdown: String(timer.endeUm) },
        text: countdownText(timer.endeUm - Date.now()),
      }),
      el('h2', { class: 'wecker-titel', id: 'wecker-titel', text: timer.block.titel }),
      el('p', { class: 'wecker-text', text: `ist um ${uhrzeitText(timer.endeUm)} vorbei. Komm langsam zum Ende und bereite das Nächste vor.` }),
      timer.naechster
        ? el('div', { class: 'wecker-naechstes' }, [
            el('span', { class: 'etikett', text: 'Als Nächstes' }),
            el('b', { text: `${zuText(blockStart(timer.naechster))}  ${timer.naechster.titel}` }),
          ])
        : null,
      el('div', { class: 'wecker-knoepfe' }, knoepfe),
      tonBereit()
        ? null
        : el('p', { class: 'wecker-hinweis', text: 'Kein Ton? Tippe nach dem Öffnen der App einmal irgendwo hin – dann darf sie klingeln.' }),
    ]),
  ]);

  offen = overlay;
  document.body.style.overflow = 'hidden';
  document.body.append(overlay);
  overlay.querySelector('.knopf')?.focus({ preventScroll: true });
}
