'use strict';

/* =====================================================================
   Wechselkalender – gemeinsamer Betreuungskalender ohne Server.
   Daten liegen lokal (localStorage). Austausch über Links, die per
   WhatsApp & Co. geteilt werden (Ereignis-Protokoll, idempotenter Merge).
   ===================================================================== */

/* ---------- Konstanten ---------- */

const LS_STATE = 'wk_state_v1';
const LS_SHARED = 'wk_shared_v1';
const LS_ARCHIVE = 'wk_archive_v1'; // eingefrorenes Kalenderbild (Lese-Archiv)
const LS_RESCUE = 'wk_rescue_v1';   // rohe Rettungskopien (die letzten 3)
const LS_THEME = 'wk_theme_v1';     // Design dieses Geräts: 'light'|'medium'|'dark' (fehlt = Auto)

/* ---------- Design (Hell / Mittel / Dunkel / Auto) ---------- */

function applyTheme(t) {
  if (t === 'light' || t === 'medium' || t === 'dark') document.documentElement.dataset.theme = t;
  else document.documentElement.removeAttribute('data-theme'); // Auto: Systemeinstellung entscheidet
}

function loadTheme() {
  let t = null;
  try { t = localStorage.getItem(LS_THEME); } catch (e) {}
  return t === 'light' || t === 'medium' || t === 'dark' ? t : 'auto';
}

function saveTheme(t) {
  try {
    if (t === 'auto') localStorage.removeItem(LS_THEME);
    else localStorage.setItem(LS_THEME, t);
  } catch (e) { /* dann gilt das Design eben nur bis zum Neuladen */ }
  applyTheme(t);
}

/* So früh wie möglich anwenden, damit beim Start nichts umspringt. */
applyTheme(loadTheme());

/* Wird beim Laden gesetzt, wenn gespeicherte Daten unlesbar waren –
   der Hinweis dazu kann erst nach dem Start angezeigt werden. */
let rescueHappened = false;

const DEFAULT_STATE = () => ({
  version: 1,
  profile: { me: null },           // 'A' | 'B'
  parents: {
    A: { name: 'Mama', color: '#d6336c' },
    B: { name: 'Papa', color: '#1a7f8e' },
    AB: { name: 'Beide', color: '#6741d9' },
    X: { name: 'Nicht da', color: '#78838f' },
    K: { name: 'Kind' },
  },
  handover: 'm',                   // Standard-Übergabe: 'm' früh | 'e' abends
  events: {},                      // id -> Ereignis
});

/* Ereignistypen:
   { t:'assign', id, by, ts, day:'YYYY-MM-DD', val:'A'|'B'|'AB'|'X'|null }
   { t:'ho',     id, by, ts, day, time:'m'|'e' }
   { t:'note',   id, by, ts, day, text }     // leerer Text = Notiz gelöscht
   { t:'school', id, by, ts, day, bring, pick, xwho, xnote }
                                  // Aufgaben: wer bringt/holt ('A'|'B'|'X'|null) und EINE
                                  // Sonderaufgabe: xwho übernimmt sie, xnote = optionaler
                                  // Kommentar („Mama beim Sport“)
   { t:'range',  id, by, ts, from:'YYYY-MM-DD', to, label }   // z. B. Ferien
   { t:'rangedel', id, by, ts, ref:<rangeId> }                // Zeitraum gelöscht
   { t:'req',    id, by, ts, days:['YYYY-MM-DD',...], val, note }
   { t:'res',    id, by, ts, req:<reqId>, ok:true|false }              */

/* ---------- Zustand ---------- */

let state = loadState();
let sharedIds = loadShared();

/* Fehlende Markierungs-Einträge ergänzen (ältere Stände, Links oder Backups
   kennen „Beide“ oder „Nicht da“ noch nicht als konfigurierbar). */
function ensureParentDefaults(p) {
  if (!p.AB) p.AB = { name: 'Beide', color: '#6741d9' };
  if (!p.AB.name) p.AB.name = 'Beide';
  if (!p.X) p.X = { name: 'Nicht da', color: '#78838f' };
  if (!p.K) p.K = { name: 'Kind' };
  return p;
}

let viewY, viewM;                 // angezeigter Monat
let selectedDays = new Set();     // Antippen wählt aus; Aktionen in der Leiste unten
let pendingImport = null;         // empfangener, noch nicht übernommener Stand (Vorschau-Modus)
let editPast = false;             // vergangene Monate sind standardmäßig schreibgeschützt

/* ---------- Laden / Speichern ---------- */

function loadState() {
  let raw = null;
  try {
    raw = localStorage.getItem(LS_STATE);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.version === 1 && s.parents && s.events) {
        ensureParentDefaults(s.parents);
        return s;
      }
    }
  } catch (e) { /* wird unten als Rettungskopie gesichert */ }
  if (raw) {
    // Unverständliche Daten (defekt oder künftiges Schema) nie
    // stillschweigend überschreiben, sondern wegsichern.
    pushRescue('Unlesbarer Stand', raw);
    rescueHappened = true;
  }
  return DEFAULT_STATE();
}

/* Rohe Rettungskopie des kompletten Standes anhängen (die letzten 3
   bleiben erhalten). Wird vor Updates und bei unlesbaren Daten
   geschrieben – so geht bei einem Versionswechsel nie etwas
   unwiederbringlich verloren. */
function pushRescue(label, raw) {
  try {
    const list = JSON.parse(localStorage.getItem(LS_RESCUE) || '[]');
    const last = list[list.length - 1];
    if (last && last.raw === raw) return; // unverändert – kein Duplikat
    list.push({ label, ts: Date.now(), raw });
    while (list.length > 3) list.shift();
    localStorage.setItem(LS_RESCUE, JSON.stringify(list));
  } catch (e) { /* Sicherung darf die App nie blockieren */ }
}

function loadRescues() {
  try { return JSON.parse(localStorage.getItem(LS_RESCUE) || '[]'); }
  catch (e) { return []; }
}

function saveState() {
  try { localStorage.setItem(LS_STATE, JSON.stringify(state)); }
  catch (e) { toast('Speichern fehlgeschlagen!'); }
}

function loadShared() {
  try { return new Set(JSON.parse(localStorage.getItem(LS_SHARED) || '[]')); }
  catch (e) { return new Set(); }
}

function saveShared() {
  try { localStorage.setItem(LS_SHARED, JSON.stringify([...sharedIds])); }
  catch (e) { /* unkritisch */ }
}

/* ---------- Datums-Helfer ---------- */

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

/* Erster Tag des aktuellen Monats – alles davor gilt als Vergangenheit. */
function monthStart() {
  const n = new Date();
  return ymd(new Date(n.getFullYear(), n.getMonth(), 1));
}
const isPast = (dayStr) => dayStr < monthStart();

function fmtShort(dayStr) {
  return parseDay(dayStr).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
}
function fmtLong(dayStr) {
  return parseDay(dayStr).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/* ---------- Ereignisse ---------- */

const newId = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

function addEvent(ev) {
  ev.id = ev.id || newId();
  ev.ts = ev.ts || Date.now();
  ev.by = ev.by || state.profile.me;
  state.events[ev.id] = ev;
  saveState();
  return ev;
}

/* ---------- Rückgängig / Wiederherstellen ----------
   Merkt sich vor jeder eigenen Aktion den Ereignis-Stand (nur im Speicher,
   bis zu 10 Schritte; nach einem Neuladen ist der Verlauf leer).
   Rückgängig legt den Stand auf den Wiederherstellen-Stapel; eine neue
   Aktion verwirft ihn. Beide Knöpfe sind immer sichtbar; ohne passenden
   Stapel-Eintrag nur ausgegraut. */

const undoStack = [];
const redoStack = [];

function pushUndo(label) {
  undoStack.push({ label, events: JSON.stringify(state.events) });
  if (undoStack.length > 10) undoStack.shift();
  redoStack.length = 0;
}

function popUndo() {
  undoStack.pop();
}

function undoLast() {
  const u = undoStack.pop();
  if (!u) { toast('Nichts zum Rückgängigmachen'); return; }
  redoStack.push({ label: u.label, events: JSON.stringify(state.events) });
  state.events = JSON.parse(u.events);
  saveState();
  clearSelection();
  renderAll();
  toast(`Rückgängig: ${u.label}`);
}

function redoLast() {
  const r = redoStack.pop();
  if (!r) { toast('Nichts zum Wiederherstellen'); return; }
  undoStack.push({ label: r.label, events: JSON.stringify(state.events) });
  state.events = JSON.parse(r.events);
  saveState();
  clearSelection();
  renderAll();
  toast(`Wiederhergestellt: ${r.label}`);
}

/* Effektive Zuordnung pro Tag: direkte Zuweisungen und angenommene
   Vorschläge konkurrieren; der jüngste Zeitstempel gewinnt. */
function computeAssignments() {
  return computeAssignmentsFrom(state.events);
}

/* Nur die Eltern (A/B) dürfen den Kalender ändern; Ereignisse anderer
   Autoren (Rolle „Kind“) zählen beim Zusammenführen nicht – selbst wenn
   sie per Link hereinkämen. Fehlendes by = Altbestand, bleibt gültig. */
const isParentAuthor = (by) => !by || by === 'A' || by === 'B';

/* Gleiche Ableitung über einen beliebigen Ereignis-Satz – wird auch für
   die Import-Vorschau genutzt („wie sähe der Kalender danach aus?“). */
function computeAssignmentsFrom(eventsObj) {
  const map = new Map(); // day -> {val, ts, id}
  const claim = (day, val, ts, id) => {
    const cur = map.get(day);
    if (!cur || ts > cur.ts || (ts === cur.ts && id > cur.id)) map.set(day, { val, ts, id });
  };
  const events = Object.values(eventsObj);
  for (const ev of events) {
    if (ev.t === 'assign' && isParentAuthor(ev.by)) claim(ev.day, ev.val, ev.ts, ev.id);
  }
  for (const ev of events) {
    if (ev.t !== 'res' || !ev.ok || !isParentAuthor(ev.by)) continue;
    const req = eventsObj[ev.req];
    if (!req || req.t !== 'req' || !isParentAuthor(req.by) || ev.by === req.by) continue; // nur der andere Elternteil kann annehmen
    for (const [day, val] of Object.entries(reqChanges(req))) claim(day, val, ev.ts, ev.id);
  }
  return map;
}

function requestStatus(req) {
  let latest = null;
  for (const ev of Object.values(state.events)) {
    if (ev.t === 'res' && ev.req === req.id && isParentAuthor(ev.by) && (!latest || ev.ts > latest.ts)) latest = ev;
  }
  if (!latest) return 'open';
  if (latest.ok && latest.by !== req.by) return 'accepted';
  if (!latest.ok && latest.by === req.by) return 'withdrawn';
  if (!latest.ok) return 'declined';
  return 'open';
}

/* Ziel-Zuordnungen einer Anfrage als { tag: wert } – unterstützt auch das
   alte Format (days + ein val für alle). */
function reqChanges(req) {
  if (req.changes) return req.changes;
  const map = {};
  (req.days || []).forEach((d) => (map[d] = req.val));
  return map;
}

/* ---------- Aufräumen (Kompaktierung) ----------
   Hält das Ereignis-Protokoll dauerhaft klein, damit weder der lokale
   Speicher noch der Abgleich-Link über die Jahre wachsen:
   1. Überholte Zuweisungen (ein neuerer Anspruch auf denselben Tag
      gewinnt ohnehin) werden gelöscht – sie haben keinerlei Wirkung.
   2. Entschiedene Vorschläge werden 90 Tage als Verlauf behalten und
      danach zu normalen Zuweisungen zusammengefasst (deterministische
      IDs, damit beide Handys beim Aufräumen dasselbe Ergebnis haben
      und sich über Links weiterhin sauber abgleichen). */

const KEEP_DECIDED_MS = 90 * 24 * 3600 * 1000;

function compactEvents() {
  let removed = 0;

  // 0. Migration: alte Übergabe-Zuweisungen ('A2B:m' …) ins neue Modell
  //    überführen (Tag gehört dem Übernehmenden + 'ho'-Zeit-Ereignis).
  for (const ev of Object.values(state.events)) {
    if (ev.t !== 'assign') continue;
    const ho = parseHandover(ev.val);
    if (!ho) continue;
    const wasShared = sharedIds.has(ev.id);
    delete state.events[ev.id];
    sharedIds.delete(ev.id);
    const aid = 'mig-' + ev.id;
    const hid = 'migho-' + ev.id;
    state.events[aid] = { t: 'assign', id: aid, by: ev.by, ts: ev.ts, day: ev.day, val: ho.to };
    state.events[hid] = { t: 'ho', id: hid, by: ev.by, ts: ev.ts, day: ev.day, time: ho.time };
    if (wasShared) { sharedIds.add(aid); sharedIds.add(hid); }
    removed++;
  }

  const winners = computeAssignments(); // day -> {val, ts, id}
  const evs = Object.values(state.events);

  // 1. Zuweisungen ohne Wirkung löschen.
  for (const ev of evs) {
    if (ev.t !== 'assign') continue;
    const w = winners.get(ev.day);
    if (w && w.id !== ev.id) {
      delete state.events[ev.id];
      sharedIds.delete(ev.id);
      removed++;
    }
  }

  // 1b. Überholte Übergabe-Zeit-Ereignisse löschen.
  const hoWinners = computeHoOverrides(state.events);
  for (const ev of evs) {
    if (ev.t !== 'ho') continue;
    const w = hoWinners.get(ev.day);
    if (w && w.id !== ev.id) {
      delete state.events[ev.id];
      sharedIds.delete(ev.id);
      removed++;
    }
  }

  // 1c. Überholte Notizen löschen (pro Tag und Autor); eine gelöschte (leere)
  //     Notiz bleibt 90 Tage als Löschmarke erhalten und verschwindet danach.
  const noteWinners = computeNotes(state.events);
  for (const ev of evs) {
    if (ev.t !== 'note') continue;
    const perDay = noteWinners.get(ev.day);
    const w = perDay && perDay.get(ev.by || 'A');
    const superseded = w && w.id !== ev.id;
    const emptyOld = w && w.id === ev.id && !w.text && Date.now() - ev.ts > KEEP_DECIDED_MS;
    if (superseded || emptyOld) {
      delete state.events[ev.id];
      sharedIds.delete(ev.id);
      removed++;
    }
  }

  // 1d. Überholte Aufgaben-Marker löschen; ein entfernter (leerer) Marker
  //     bleibt 90 Tage als Löschmarke und verschwindet danach ganz.
  const schoolWinners = computeSchool(state.events);
  for (const ev of evs) {
    if (ev.t !== 'school') continue;
    const w = schoolWinners.get(ev.day);
    const superseded = w && w.id !== ev.id;
    const emptyOld = w && w.id === ev.id && schoolEmpty(w) && Date.now() - ev.ts > KEEP_DECIDED_MS;
    if (superseded || emptyOld) {
      delete state.events[ev.id];
      sharedIds.delete(ev.id);
      removed++;
    }
  }

  // 1e. Abgelaufene Zeiträume (Ferien) 90 Tage nach ihrem Ende löschen,
  //     ebenso Löschmarken, deren Zeitraum nicht mehr existiert.
  for (const ev of evs) {
    if (ev.t === 'range' && Date.now() - parseDay(ev.to).getTime() > KEEP_DECIDED_MS) {
      delete state.events[ev.id];
      sharedIds.delete(ev.id);
      removed++;
    }
  }
  for (const ev of evs) {
    if (ev.t === 'rangedel' && !state.events[ev.ref] && Date.now() - ev.ts > KEEP_DECIDED_MS) {
      delete state.events[ev.id];
      sharedIds.delete(ev.id);
      removed++;
    }
  }

  // 2. Alte entschiedene Vorschläge zusammenfassen.
  const now = Date.now();
  for (const req of evs) {
    if (req.t !== 'req' || !state.events[req.id]) continue;
    const status = requestStatus(req);
    if (status === 'open') continue;
    const ress = evs.filter((e) => e.t === 'res' && e.req === req.id);
    const latest = ress.reduce((a, b) => (!a || b.ts > a.ts ? b : a), null);
    if (!latest || now - latest.ts < KEEP_DECIDED_MS) continue;

    if (status === 'accepted') {
      for (const [day, val] of Object.entries(reqChanges(req))) {
        const w = winners.get(day);
        if (w && w.id === latest.id) {
          const mid = `m-${latest.id}-${day}`;
          state.events[mid] = { t: 'assign', id: mid, by: latest.by, ts: latest.ts, day, val };
          sharedIds.add(mid);
        }
      }
    }
    for (const r of ress) { delete state.events[r.id]; sharedIds.delete(r.id); removed++; }
    delete state.events[req.id];
    sharedIds.delete(req.id);
    removed++;
  }

  if (removed) { saveState(); saveShared(); }
  return removed;
}

function openRequestDays() {
  const set = new Set();
  for (const ev of Object.values(state.events)) {
    if (ev.t === 'req' && requestStatus(ev) === 'open') Object.keys(reqChanges(ev)).forEach((d) => set.add(d));
  }
  return set;
}

/* ---------- Anzeige-Helfer ---------- */

const COLOR_X = '#78838f'; // „Nicht da“ (bei Dritten: Oma, Klassenfahrt …)

/* Übergabe-Tage: Wert z. B. 'A2B:m' = von A zu B, Übergabe früh (morgens),
   'B2A:e' = von B zu A, Übergabe abends. */
function parseHandover(val) {
  const m = typeof val === 'string' && val.match(/^([AB])2([AB]):([me])$/);
  return m ? { from: m[1], to: m[2], time: m[3] } : null;
}

function valName(val) {
  if (val === 'A') return state.parents.A.name;
  if (val === 'B') return state.parents.B.name;
  if (val === 'AB') return (state.parents.AB && state.parents.AB.name) || 'Beide';
  if (val === 'X') return (state.parents.X && state.parents.X.name) || 'Nicht da';
  const ho = parseHandover(val);
  if (ho) return `${state.parents[ho.from].name} → ${state.parents[ho.to].name} (${ho.time === 'm' ? 'früh' : 'abends'})`;
  return 'frei';
}

function valColor(val) {
  if (val === 'A') return state.parents.A.color;
  if (val === 'B') return state.parents.B.color;
  if (val === 'AB') return (state.parents.AB && state.parents.AB.color) || '#6741d9';
  if (val === 'X') return (state.parents.X && state.parents.X.color) || COLOR_X;
  const ho = parseHandover(val);
  if (ho) {
    // Tagesverlauf von oben nach unten: oben der abgebende, unten der
    // übernehmende Elternteil; „früh“ = schmaler oberer Streifen.
    const cut = ho.time === 'm' ? '25%' : '75%';
    return `linear-gradient(180deg, ${state.parents[ho.from].color} 0 ${cut}, ${state.parents[ho.to].color} ${cut} 100%)`;
  }
  return '';
}

const other = (p) => (p === 'A' ? 'B' : 'A');
const isKid = () => state.profile.me === 'K';

/* Anzeigename eines Ereignis-Autors (A/B/K). */
function authorName(by) {
  if (by === 'K') return (state.parents.K && state.parents.K.name) || 'Kind';
  return (state.parents[by] && state.parents[by].name) || by || '?';
}

/* ---------- Rendering ---------- */

const $ = (id) => document.getElementById(id);

function renderAll() {
  document.documentElement.style.setProperty('--colA', state.parents.A.color);
  document.documentElement.style.setProperty('--colB', state.parents.B.color);
  renderCalendar();
  renderLegend();
  renderRequests();
  renderShareBadge();
  renderSelectBar();
  renderPreviewBar();
}

/* Im Vorschau-Modus zeigt der Kalender den empfangenen (noch nicht
   übernommenen) Stand, sonst den eigenen. */
function currentAssigns() {
  return pendingImport ? pendingImport.after : computeAssignments();
}

function currentHoMap() {
  return pendingImport ? pendingImport.afterHo : computeHoOverrides(state.events);
}

function currentNotes() {
  return pendingImport ? pendingImport.afterNotes : computeNotes(state.events);
}

/* Tages-Notizen ('note'-Ereignisse): eine pro Tag UND Autor (Mama, Papa,
   Kind schreiben nebeneinander, keiner überschreibt den anderen);
   pro Autor gewinnt die jüngste, leerer Text löscht die eigene. */
function computeNotes(eventsObj) {
  const map = new Map(); // day -> Map(autor -> {text, ts, id})
  for (const ev of Object.values(eventsObj)) {
    if (ev.t !== 'note') continue;
    const by = ev.by || 'A';
    let perDay = map.get(ev.day);
    if (!perDay) { perDay = new Map(); map.set(ev.day, perDay); }
    const cur = perDay.get(by);
    if (!cur || ev.ts > cur.ts || (ev.ts === cur.ts && ev.id > cur.id)) {
      perDay.set(by, { text: ev.text || '', ts: ev.ts, id: ev.id });
    }
  }
  return map;
}

/* Aufgaben-Marker ('school'-Ereignisse): wer bringt/holt (Schule) und EINE
   Sonderaufgabe mit Kommentar (z. B. „Mama beim Sport“); pro Tag das
   jüngste, alles leer = Marker entfernt. Nur Eltern setzen. */
function computeSchool(eventsObj) {
  const map = new Map(); // day -> {bring, pick, xwho, xnote, ts, id}
  for (const ev of Object.values(eventsObj)) {
    if (ev.t !== 'school' || !isParentAuthor(ev.by)) continue;
    const cur = map.get(ev.day);
    if (!cur || ev.ts > cur.ts || (ev.ts === cur.ts && ev.id > cur.id)) {
      map.set(ev.day, {
        bring: ev.bring || null,
        pick: ev.pick || null,
        // Übergangsweise auch alte Formate (am/pm) lesen.
        xwho: ev.xwho || ev.am || ev.pm || null,
        xnote: ev.xnote || ev.amNote || ev.pmNote || '',
        ts: ev.ts, id: ev.id,
      });
    }
  }
  return map;
}

const schoolEmpty = (s) => !s || (!s.bring && !s.pick && !s.xwho);

function currentSchool() {
  return pendingImport ? pendingImport.afterSchool : computeSchool(state.events);
}

/* Schul-Marker lassen sich in den Einstellungen ausblenden. */
const schoolOn = () => state.school !== false;

/* Zeiträume ('range'-Ereignisse, z. B. Ferien): alle nicht gelöschten. */
function computeRanges(eventsObj) {
  const dels = new Set();
  for (const ev of Object.values(eventsObj)) {
    if (ev.t === 'rangedel' && isParentAuthor(ev.by)) dels.add(ev.ref);
  }
  return Object.values(eventsObj)
    .filter((ev) => ev.t === 'range' && isParentAuthor(ev.by) && !dels.has(ev.id))
    .sort((a, b) => (a.from < b.from ? -1 : 1));
}

function currentRanges() {
  return pendingImport ? pendingImport.afterRanges : computeRanges(state.events);
}

/* Label des Zeitraums, in den ein Tag fällt (oder null). */
function rangeFor(ranges, dayStr) {
  for (const r of ranges) {
    if (dayStr >= r.from && dayStr <= r.to) return r;
  }
  return null;
}

/* ---------- Feiertage (offline berechnet, pro Bundesland) ---------- */

const LAND_NAMES = {
  BW: 'Baden-Württemberg', BY: 'Bayern', BE: 'Berlin', BB: 'Brandenburg',
  HB: 'Bremen', HH: 'Hamburg', HE: 'Hessen', MV: 'Mecklenburg-Vorpommern',
  NI: 'Niedersachsen', NW: 'Nordrhein-Westfalen', RP: 'Rheinland-Pfalz',
  SL: 'Saarland', SN: 'Sachsen', ST: 'Sachsen-Anhalt',
  SH: 'Schleswig-Holstein', TH: 'Thüringen',
};

/* Ostersonntag nach der Gauß-Formel. */
function easterSunday(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}

const holidayCache = {};

function holidaysForYear(y, land) {
  if (!land) return new Map();
  const key = y + land;
  if (holidayCache[key]) return holidayCache[key];
  const map = new Map();
  const add = (d, name, lands) => { if (!lands || lands.includes(land)) map.set(ymd(d), name); };
  const E = easterSunday(y);
  const off = (days) => { const d = new Date(E); d.setDate(d.getDate() + days); return d; };
  add(new Date(y, 0, 1), 'Neujahr');
  add(new Date(y, 0, 6), 'Heilige Drei Könige', ['BW', 'BY', 'ST']);
  add(new Date(y, 2, 8), 'Internationaler Frauentag', ['BE', 'MV']);
  add(off(-2), 'Karfreitag');
  add(off(1), 'Ostermontag');
  add(new Date(y, 4, 1), 'Tag der Arbeit');
  add(off(39), 'Christi Himmelfahrt');
  add(off(50), 'Pfingstmontag');
  add(off(60), 'Fronleichnam', ['BW', 'BY', 'HE', 'NW', 'RP', 'SL']);
  add(new Date(y, 7, 15), 'Mariä Himmelfahrt', ['SL']);
  add(new Date(y, 8, 20), 'Weltkindertag', ['TH']);
  add(new Date(y, 9, 3), 'Tag der Deutschen Einheit');
  add(new Date(y, 9, 31), 'Reformationstag', ['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH']);
  add(new Date(y, 10, 1), 'Allerheiligen', ['BW', 'BY', 'NW', 'RP', 'SL']);
  if (land === 'SN') { // Buß- und Bettag: Mittwoch vor dem 23.11.
    const d = new Date(y, 10, 22);
    while (d.getDay() !== 3) d.setDate(d.getDate() - 1);
    map.set(ymd(d), 'Buß- und Bettag');
  }
  add(new Date(y, 11, 25), '1. Weihnachtstag');
  add(new Date(y, 11, 26), '2. Weihnachtstag');
  holidayCache[key] = map;
  return map;
}

function holidayFor(dayStr) {
  if (!state.land) return null;
  return holidaysForYear(Number(dayStr.slice(0, 4)), state.land).get(dayStr) || null;
}

/* Weiße Symbole für die Aufgaben-Badges. */
const BACKPACK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M9 6a3 3 0 0 1 6 0"/><rect x="5.5" y="6" width="13" height="14" rx="4"/>' +
  '<path d="M5.5 13.5h13"/><path d="M9.5 17h5"/></svg>';
const STAR_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.8L12 16.9l-5.3 2.7 1.1-5.8-4.3-4.1 5.9-.8z"/></svg>';

/* Nicht-leere Notizen eines Tages als Liste [{by, text}], Eltern zuerst. */
function dayNotes(notesMap, day) {
  const perDay = notesMap.get(day);
  if (!perDay) return [];
  const order = { A: 0, B: 1, K: 2 };
  return [...perDay.entries()]
    .filter(([, n]) => n.text)
    .sort(([a], [b]) => (order[a] ?? 9) - (order[b] ?? 9))
    .map(([by, n]) => ({ by, text: n.text }));
}

/* Übergabe-Zeit-Abweichungen pro Tag ('ho'-Ereignisse): jüngste gewinnt. */
function computeHoOverrides(eventsObj) {
  const map = new Map(); // day -> {time, ts, id}
  for (const ev of Object.values(eventsObj)) {
    if (ev.t !== 'ho' || !isParentAuthor(ev.by)) continue;
    const cur = map.get(ev.day);
    if (!cur || ev.ts > cur.ts || (ev.ts === cur.ts && ev.id > cur.id)) {
      map.set(ev.day, { time: ev.time, ts: ev.ts, id: ev.id });
    }
  }
  return map;
}

function prevDayStr(dayStr) {
  const d = parseDay(dayStr);
  d.setDate(d.getDate() - 1);
  return ymd(d);
}

function nextDayStr(dayStr) {
  const d = parseDay(dayStr);
  d.setDate(d.getDate() + 1);
  return ymd(d);
}

/* Übergabe wird abgeleitet, nicht zugewiesen: Ein Wechsel liegt zwischen
   zwei Tagen mit unterschiedlichem Zustand – egal ob Mama, Papa, Beide oder
   Nicht da (nur „frei“ zählt nicht, da gibt es nichts zu übergeben).
   Die Zeit: 'm' = früh am Morgen des neuen Tages, 'e' = abends am Vortag
   (dem letzten Tag der alten Seite). Gespeichert ist sie am neuen Tag. */
function handoverFor(dayStr, assigns, hoMap) {
  const cur = assigns.get(dayStr);
  const v = cur && cur.val;
  if (!v) return null;
  const prev = assigns.get(prevDayStr(dayStr));
  const pv = prev && prev.val;
  if (!pv || pv === v) return null;
  const o = hoMap.get(dayStr);
  return { from: pv, to: v, time: (o && o.time) || state.handover || 'm' };
}

/* Hintergrund einer Kachel: Grundfarbe ist immer die Seite, der der Tag
   gehört. Ein schmales Band (12,5 %) sitzt dort, wo eine Übergabe stattfindet:
   „früh“ = oben auf dem ersten Tag der neuen Seite (Farbe der abgebenden
   Seite), „abends“ = unten auf dem letzten Tag der alten Seite (Farbe der
   übernehmenden Seite). Eine Kachel kann beides zeigen (morgens angekommen,
   abends weitergegeben). */
function dayBackground(dayStr, val, assigns, hoMap) {
  const bands = [];
  const hoIn = handoverFor(dayStr, assigns, hoMap);
  if (hoIn && hoIn.time === 'm') bands.push(`${bgImage(hoIn.from)} top / 100% 12.5% no-repeat`);
  const hoOut = handoverFor(nextDayStr(dayStr), assigns, hoMap);
  if (hoOut && hoOut.time === 'e') bands.push(`${bgImage(hoOut.to)} bottom / 100% 12.5% no-repeat`);
  if (!bands.length) return bgBase(val);
  return `${bands.join(', ')}, ${bgBase(val)}`;
}

function bgImage(val) {
  const c = valColor(val);
  return `linear-gradient(${c}, ${c})`;
}

function bgBase(val) {
  return valColor(val);
}

function renderCalendar() {
  const wd = $('weekdays');
  if (!wd.childElementCount) {
    for (const n of ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']) {
      const el = document.createElement('div');
      el.textContent = n;
      wd.appendChild(el);
    }
  }

  $('monthLabel').textContent = new Date(viewY, viewM, 1)
    .toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

  const assigns = currentAssigns();
  const hoMap = currentHoMap();
  const notes = currentNotes();
  const school = schoolOn() ? currentSchool() : new Map();
  const ranges = currentRanges();
  const pending = openRequestDays();
  const todayStr = ymd(new Date());

  const first = new Date(viewY, viewM, 1);
  const offset = (first.getDay() + 6) % 7; // Montag = 0

  const grid = $('grid');
  grid.innerHTML = '';
  for (let i = 0; i < 42; i++) {
    const date = new Date(viewY, viewM, 1 - offset + i);
    const dayStr = ymd(date);
    const cell = document.createElement('div');
    cell.className = 'day';
    cell.textContent = date.getDate();
    cell.dataset.day = dayStr;
    if (date.getMonth() !== viewM) cell.classList.add('out');
    if (dayStr === todayStr) cell.classList.add('today');
    if (selectedDays.has(dayStr)) cell.classList.add('selected');

    const a = assigns.get(dayStr);
    let fz = null;
    if (a && a.val) {
      cell.classList.add('assigned');
      cell.style.background = dayBackground(dayStr, a.val, assigns, hoMap);
    } else {
      // Vergangenheit, die nur noch das Archiv kennt: statisch anzeigen.
      fz = frozenFor(dayStr, assigns);
      if (fz) {
        cell.classList.add('assigned', 'frozen');
        cell.style.background = fz.farbe || '#888';
        const tp = [`📦 ${fz.wer || '?'} (Archiv – nur lesen)`];
        if (fz.aufgaben) tp.push(`🎒 ${fz.aufgaben}`);
        for (const n of fz.notizen || []) tp.push(`💬 ${n}`);
        cell.title = tp.join('\n');
      }
    }
    if (pending.has(dayStr)) {
      const p = document.createElement('span');
      p.className = 'pend';
      p.textContent = '⏳';
      cell.appendChild(p);
    }
    const dn = dayNotes(notes, dayStr);
    if (dn.length) {
      cell.classList.add('noted');        // Eck-Marker links oben
      cell.title = dn.map((n) => `${authorName(n.by)}: ${n.text}`).join('\n'); // Tooltip am PC
    }
    // Aufgaben-Badges: 🎒 links (bringt oben, holt unten),
    // Sonderaufgabe als Stern rechts in der Mitte.
    const sc = school.get(dayStr);
    if (!schoolEmpty(sc)) {
      const tp = [];
      for (const [kind, who, icon, label] of [
        ['bring', sc.bring, BACKPACK_SVG, 'Bringt'],
        ['pick', sc.pick, BACKPACK_SVG, 'Holt'],
        ['extra', sc.xwho, STAR_SVG, 'Extra'],
      ]) {
        if (!who) continue;
        const s = document.createElement('span');
        s.className = 'sdot ' + kind;
        s.style.background = valColor(who);
        s.innerHTML = icon;
        cell.appendChild(s);
        const n = kind === 'extra' ? sc.xnote : '';
        tp.push(`${label}: ${valName(who)}${n ? ' – ' + n : ''}`);
      }
      cell.title = (cell.title ? cell.title + '\n' : '') + tp.join(' · ');
    }
    // Feiertag (rote Unterstreichung) und Ferien (gepunktete Unterstreichung).
    const holiday = holidayFor(dayStr);
    if (holiday) {
      cell.classList.add('holiday');
      cell.title = `📅 ${holiday}` + (cell.title ? '\n' + cell.title : '');
    }
    const range = rangeFor(ranges, dayStr);
    if (range) {
      cell.classList.add('ferien');
      cell.title = `🏖 ${range.label}` + (cell.title ? '\n' + cell.title : '');
    }
    if (pendingImport && pendingImport.diffDays.has(dayStr)) {
      // Randfarbe = bisherige Zuordnung, Füllung = künftige.
      cell.classList.add('changed');
      const oldVal = pendingImport.oldVals.get(dayStr);
      const oldHo = parseHandover(oldVal);
      if (oldHo) cell.style.setProperty('--oldcol', state.parents[oldHo.from].color);
      else cell.style.setProperty('--oldcol', oldVal ? valColor(oldVal) : 'var(--text-dim)');
    }
    cell.addEventListener('click', (e) => {
      if (fz) {
        const parts = [fz.wer || '?'];
        if (fz.aufgaben) parts.push(`🎒 ${fz.aufgaben}`);
        for (const n of fz.notizen || []) parts.push(`💬 ${n}`);
        toast(`📦 ${parts.join(' · ')} (Archiv – nur lesen)`);
        return;
      }
      onDayTap(dayStr, e);
    });
    grid.appendChild(cell);
  }
}

function renderLegend() {
  const assigns = currentAssigns();
  const counts = { A: 0, B: 0, AB: 0, X: 0 };
  let frozen = 0;
  const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const dayStr = ymd(new Date(viewY, viewM, d));
    const a = assigns.get(dayStr);
    if (!a || !a.val) {
      if (frozenFor(dayStr, assigns)) frozen++;
      continue;
    }
    counts[a.val]++;
  }
  const chip = (color, label, n) =>
    `<span class="chip"><span class="dot" style="background:${color}"></span><b>${esc(label)}</b> ${n} Tag${n === 1 ? '' : 'e'}</span>`;
  $('legend').innerHTML =
    chip(state.parents.A.color, state.parents.A.name, counts.A + counts.AB) +
    chip(state.parents.B.color, state.parents.B.name, counts.B + counts.AB) +
    (counts.AB ? chip(valColor('AB'), valName('AB'), counts.AB) : '') +
    (counts.X ? chip(valColor('X'), valName('X'), counts.X) : '') +
    (frozen ? chip('#888', '📦 Archiv (nur lesen)', frozen) : '');
}

/* Unter dem Kalender stehen nur offene Vorschläge (die brauchen eine
   Antwort). Alles Entschiedene liegt im Verlauf-Dialog. */
function renderRequests() {
  const box = $('requests');
  const reqs = Object.values(state.events)
    .filter((e) => e.t === 'req')
    .sort((a, b) => b.ts - a.ts);

  const open = reqs.filter((r) => requestStatus(r) === 'open');
  const decided = reqs.filter((r) => requestStatus(r) !== 'open').slice(0, 3);

  let html = '';
  if (open.length) html += '<h2>Offene Vorschläge</h2>';
  for (const r of open) html += reqCard(r, 'open');
  if (decided.length) html += '<h2>Erledigt</h2>';
  for (const r of decided) html += reqCard(r, requestStatus(r));
  box.innerHTML = html;

  box.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => onRequestAction(btn.dataset.req, btn.dataset.act));
  });
}

function openHistory() {
  const decided = Object.values(state.events)
    .filter((e) => e.t === 'req' && requestStatus(e) !== 'open')
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 30);
  const html = decided.map((r) => reqCard(r, requestStatus(r))).join('');
  openSheet(`
    <h2>Verlauf</h2>
    <p class="sub">Entschiedene Vorschläge der letzten 90 Tage – ältere werden automatisch zum Endstand zusammengefasst.</p>
    <div class="requests" style="margin-top:4px">${html || '<p class="sub">Noch nichts im Verlauf.</p>'}</div>
  `);
}

function reqCard(r, status) {
  const mine = r.by === state.profile.me;
  const who = esc(authorName(r.by));
  const entries = Object.entries(reqChanges(r)).sort(([a], [b]) => (a < b ? -1 : 1));
  const lines = entries.map(([d, v]) => `${fmtShort(d)} → <b>${esc(valName(v))}</b>`);
  const body = lines.join(lines.length > 2 ? '<br>' : ' &nbsp;·&nbsp; ');
  const when = new Date(r.ts).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });

  let actions = '';
  if (status === 'open' && !isKid()) {
    actions = mine
      ? `<button class="btn ghost" data-req="${r.id}" data-act="withdraw">Zurückziehen</button>
         <button class="btn" data-req="${r.id}" data-act="reshare">Link erneut teilen</button>`
      : `<button class="btn primary" data-req="${r.id}" data-act="accept">Annehmen</button>
         <button class="btn danger-ghost" data-req="${r.id}" data-act="decline">Ablehnen</button>
         <button class="btn ghost" data-req="${r.id}" data-act="counter">Gegenvorschlag…</button>`;
  }

  const statusTxt = {
    open: '',
    accepted: '<span class="status ok">✓ angenommen</span>',
    declined: '<span class="status no">✗ abgelehnt</span>',
    withdrawn: '<span class="status">zurückgezogen</span>',
  }[status];

  return `<div class="req${status !== 'open' ? ' decided' : ''}">
    <div class="req-head"><span>${r.re ? 'Gegenvorschlag' : 'Vorschlag'} von <b>${who}</b></span><span>${when} ${statusTxt}</span></div>
    <div class="req-body">${body}</div>
    ${r.note ? `<div class="req-note">„${esc(r.note)}“</div>` : ''}
    ${actions ? `<div class="req-actions">${actions}</div>` : ''}
  </div>`;
}

function renderShareBadge() {
  const n = unsharedEvents().length;
  const badge = $('shareBadge');
  badge.textContent = n;
  badge.classList.toggle('hidden', n === 0);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- Interaktion: Tage ----------
   Antippen wählt Tage aus (einen oder mehrere); die Leiste unten
   bietet dann Zuordnung oder Tauschanfrage für die Auswahl an. */

function onDayTap(dayStr, ev) {
  if (pendingImport) { toast('Vorschau aktiv – erst übernehmen oder verwerfen'); return; }
  if (!editPast && isPast(dayStr)) { toast('Vergangene Monate sind gesperrt – im ⋮-Menü entsperren'); return; }

  // Übergabe-Zeit direkt an der Kachel einstellen (nur wenn gerade keine
  // Auswahl läuft): Der Tipp landet genau dort, wo die Übergabe hin soll –
  // oberes Drittel des neuen Tages = früh an diesem Morgen, unteres Drittel
  // des alten Tages = abends an diesem Abend.
  if (ev && !isKid() && selectedDays.size === 0) {
    const assigns = currentAssigns();
    const hoMap = currentHoMap();
    const rect = ev.currentTarget.getBoundingClientRect();
    const relY = (ev.clientY - rect.top) / rect.height;
    if (relY < 0.33) {
      const hoIn = handoverFor(dayStr, assigns, hoMap);
      if (hoIn) {
        if (hoIn.time !== 'm') {
          pushUndo('Übergabe-Zeit');
          addEvent({ t: 'ho', day: dayStr, time: 'm' });
          toast(`Übergabe früh am ${fmtShort(dayStr)}`);
          renderAll();
        } else {
          toast(`Übergabe ist bereits früh am ${fmtShort(dayStr)}`);
        }
        return;
      }
    } else if (relY > 0.67) {
      const next = nextDayStr(dayStr);
      const hoOut = handoverFor(next, assigns, hoMap);
      if (hoOut) {
        if (hoOut.time !== 'e') {
          pushUndo('Übergabe-Zeit');
          addEvent({ t: 'ho', day: next, time: 'e' });
          toast(`Übergabe abends am ${fmtShort(dayStr)}`);
          renderAll();
        } else {
          toast(`Übergabe ist bereits abends am ${fmtShort(dayStr)}`);
        }
        return;
      }
    }
  }

  if (selectedDays.has(dayStr)) selectedDays.delete(dayStr);
  else selectedDays.add(dayStr);
  renderCalendar();
  renderSelectBar();
}

function clearSelection() {
  selectedDays.clear();
  renderSelectBar();
}

function setAssignment(days, val) {
  const assigns = computeAssignments();
  pushUndo(`Zuordnung (${valName(val)})`);
  let changed = 0;
  for (const day of days) {
    const cur = assigns.get(day);
    if ((cur ? cur.val : null) === val) continue;
    addEvent({ t: 'assign', day, val });
    changed++;
  }
  if (changed) toast(`${changed} Tag${changed === 1 ? '' : 'e'} → ${valName(val)}`);
  else popUndo();
  clearSelection();
  renderAll();
}

function renderSelectBar() {
  const any = selectedDays.size > 0;
  $('selectbar').classList.toggle('hidden', !any);
  $('btnShare').classList.toggle('hidden', any || !!pendingImport);
  const hideFabs = any || !!pendingImport;
  $('btnUndo').classList.toggle('hidden', hideFabs);
  $('btnRedo').classList.toggle('hidden', hideFabs);
  $('btnUndo').classList.toggle('fab-off', !undoStack.length);
  $('btnRedo').classList.toggle('fab-off', !redoStack.length);
  if (!any) return;

  $('selectInfo').textContent =
    `${selectedDays.size} Tag${selectedDays.size === 1 ? '' : 'e'} ausgewählt${isKid() ? '' : ' – gehört zu:'}`;

  // Feiertag/Ferien des gewählten Tages anzeigen.
  const infoEl = $('selectDayInfo');
  const singleDay = selectedDays.size === 1 ? [...selectedDays][0] : null;
  const infoParts = [];
  if (singleDay) {
    const h = holidayFor(singleDay);
    if (h) infoParts.push(`📅 ${esc(h)}`);
    const rg = rangeFor(currentRanges(), singleDay);
    if (rg) infoParts.push(`🏖 ${esc(rg.label)}`);
  }
  infoEl.innerHTML = infoParts.join(' &nbsp;·&nbsp; ');
  infoEl.classList.toggle('hidden', !infoParts.length);

  // Notizen des gewählten Tages anzeigen (der „Tooltip“ fürs Handy).
  const noteEl = $('selectNote');
  const single = selectedDays.size === 1 ? [...selectedDays][0] : null;
  const noteList = single ? dayNotes(currentNotes(), single) : [];
  noteEl.innerHTML = noteList.map((n) => `💬 <b>${esc(authorName(n.by))}:</b> ${esc(n.text)}`).join('<br>');
  noteEl.classList.toggle('hidden', !noteList.length);

  // Aufgaben-Marker des gewählten Tages anzeigen.
  const schoolEl = $('selectSchool');
  const sc = single && schoolOn() ? currentSchool().get(single) : null;
  const scParts = [];
  if (sc) {
    if (sc.bring) scParts.push(`Bringt: <b>${esc(valName(sc.bring))}</b>`);
    if (sc.pick) scParts.push(`Holt: <b>${esc(valName(sc.pick))}</b>`);
    if (sc.xwho) scParts.push(`Extra: <b>${esc(valName(sc.xwho))}</b>${sc.xnote ? ' – ' + esc(sc.xnote) : ''}`);
  }
  schoolEl.innerHTML = scParts.length ? '🎒 ' + scParts.join(' &nbsp;·&nbsp; ') : '';
  schoolEl.classList.toggle('hidden', !scParts.length);

  const acts = $('selectActions');
  acts.innerHTML = '';
  const mk = (label, bg, fn, cls = '') => {
    const b = document.createElement('button');
    b.className = 'btn ' + cls;
    if (bg) { b.style.background = bg; b.style.color = '#fff'; b.style.textShadow = '0 1px 2px rgba(0,0,0,0.25)'; }
    b.textContent = label;
    b.addEventListener('click', fn);
    acts.appendChild(b);
  };
  const days = () => [...selectedDays].sort();
  if (!isKid()) {
    // Kalender ändern können nur die Eltern; im Kind-Modus bleibt die Notiz.
    mk(state.parents.A.name, state.parents.A.color, () => setAssignment(days(), 'A'));
    mk(state.parents.B.name, state.parents.B.color, () => setAssignment(days(), 'B'));
    mk(valName('AB'), valColor('AB'), () => setAssignment(days(), 'AB'));
    mk(valName('X'), valColor('X'), () => setAssignment(days(), 'X'));
    mk('Frei', '', () => setAssignment(days(), null));
    mk('Vorschlag…', '', () => openRequestSheet(days()));
    if (schoolOn()) mk('🎒 Aufgaben', '', () => openSchoolSheet(days()));
  }
  if (single) mk('💬 Notiz', '', () => openNoteSheet(single));
  mk('✕', '', () => { clearSelection(); renderCalendar(); }, 'ghost');
}

/* --- Ferien & Feiertage: Bundesland für die (offline berechneten)
   Feiertage wählen und Ferien-Zeiträume pflegen. Zeiträume syncen per
   Link; das Bundesland ist eine lokale Einstellung pro Gerät. --- */

function openFerienSheet() {
  const kid = isKid();
  const ranges = computeRanges(state.events);
  const landOpts = ['<option value="">– kein Bundesland –</option>']
    .concat(Object.entries(LAND_NAMES).map(([k, n]) =>
      `<option value="${k}"${state.land === k ? ' selected' : ''}>${n}</option>`)).join('');
  const list = ranges.length
    ? ranges.map((r) => `<div class="reqrow"><span>🏖 <b>${esc(r.label)}</b> &nbsp;${fmtShort(r.from)} – ${fmtShort(r.to)}</span>
        ${kid ? '' : `<button class="btn ghost" data-del="${r.id}">Löschen</button>`}</div>`).join('')
    : '<p class="sub">Noch keine Ferien eingetragen.</p>';

  const sheet = openSheet(`
    <h2>Ferien &amp; Feiertage</h2>
    <label>Bundesland (für Feiertage, gilt für dieses Gerät)</label>
    <select id="landSel" class="selectfield">${landOpts}</select>
    <label style="margin-top:14px">Ferien-Zeiträume</label>
    <div class="reqrows">${list}</div>
    ${kid ? '' : `
    <label style="margin-top:14px">Neuen Zeitraum eintragen</label>
    <input type="text" id="rangeLabel" maxlength="30" placeholder="z. B. Herbstferien">
    <div class="row" style="margin-top:8px">
      <input type="date" id="rangeFrom" style="flex:1">
      <input type="date" id="rangeTo" style="flex:1">
    </div>
    <div class="row" style="margin-top:10px">
      <button class="btn primary block" id="rangeAdd">Hinzufügen</button>
    </div>`}
  `);

  sheet.querySelector('#landSel').onchange = (e) => {
    state.land = e.target.value || null;
    saveState();
    renderCalendar();
    toast(state.land ? `Feiertage: ${LAND_NAMES[state.land]}` : 'Feiertage ausgeblendet');
  };
  sheet.querySelectorAll('[data-del]').forEach((btn) => (btn.onclick = () => {
    pushUndo('Ferien gelöscht');
    addEvent({ t: 'rangedel', ref: btn.dataset.del });
    closeSheet();
    renderAll();
    toast('Zeitraum gelöscht');
  }));
  const add = sheet.querySelector('#rangeAdd');
  if (add) add.onclick = () => {
    const label = sheet.querySelector('#rangeLabel').value.trim();
    const from = sheet.querySelector('#rangeFrom').value;
    const to = sheet.querySelector('#rangeTo').value;
    if (!label || !from || !to || to < from) { toast('Bitte Name und gültigen Zeitraum angeben'); return; }
    pushUndo('Ferien eingetragen');
    addEvent({ t: 'range', from, to, label });
    closeSheet();
    renderAll();
    toast(`„${label}“ eingetragen`);
  };
}

/* --- Muster-Assistent: füllt einen Zeitraum mit einem Wechsel-Rhythmus.
   Erzeugt ganz normale Zuweisungs-Ereignisse – danach lässt sich jeder
   Tag wie gewohnt einzeln ändern. --- */

function openPatternSheet() {
  const p = state.parents;
  const today = new Date();
  const defFrom = ymd(today);
  const defTo = ymd(new Date(today.getFullYear(), today.getMonth() + 3, today.getDate()));
  let rhythm = 'w1';
  let wd = 5;      // Wechseltag: Freitag
  let startP = 'A';

  const WD = [['1', 'Mo'], ['2', 'Di'], ['3', 'Mi'], ['4', 'Do'], ['5', 'Fr'], ['6', 'Sa'], ['0', 'So']];

  const sheet = openSheet(`
    <h2>Muster anwenden</h2>
    <p class="sub">Füllt den Zeitraum mit einem Rhythmus und überschreibt dort vorhandene Markierungen (der ↩-Knopf unten links macht es rückgängig). Einzelne Tage änderst du danach wie gewohnt.</p>
    <label>Von</label>
    <input type="date" id="patFrom" value="${defFrom}">
    <label>Bis</label>
    <input type="date" id="patTo" value="${defTo}">
    <label>Rhythmus</label>
    <div class="reqrow-pills" style="justify-content:flex-start" id="patRhythm">
      <div class="minipill" data-r="w1">Wöchentlich</div>
      <div class="minipill" data-r="w2">14-täglich</div>
      <div class="minipill" data-r="223">2-2-3</div>
      <div class="minipill" data-r="2255">2-2-5-5</div>
      <div class="minipill" data-r="3443">3-4-4-3</div>
      <div class="minipill" data-r="we2">Jedes 2. WE</div>
    </div>
    <div id="patDayBlock">
      <label>Wechseltag</label>
      <div class="reqrow-pills" style="justify-content:flex-start" id="patDays">
        ${WD.map(([v, l]) => `<div class="minipill" data-wd="${v}">${l}</div>`).join('')}
      </div>
    </div>
    <label id="patStartLabel">Wer hat das Kind am ersten Tag?</label>
    <div class="radio-row" id="patStart">
      <div class="radio-pill" data-p="A">${esc(p.A.name)}</div>
      <div class="radio-pill" data-p="B">${esc(p.B.name)}</div>
    </div>
    <div class="row" style="margin-top:16px">
      <button class="btn primary block" id="patApply">Anwenden</button>
    </div>
  `);

  const syncAll = () => {
    sheet.querySelectorAll('#patRhythm .minipill').forEach((el) => el.classList.toggle('sel', el.dataset.r === rhythm));
    sheet.querySelectorAll('#patDays .minipill').forEach((el) => el.classList.toggle('sel', Number(el.dataset.wd) === wd));
    sheet.querySelectorAll('#patStart .radio-pill').forEach((el) => el.classList.toggle('sel', el.dataset.p === startP));
    // Wechseltag nur bei Wochen-Rhythmen; Zyklen und WE-Modell brauchen keinen.
    sheet.querySelector('#patDayBlock').style.display = (rhythm === 'w1' || rhythm === 'w2') ? '' : 'none';
    sheet.querySelector('#patStartLabel').textContent = rhythm === 'we2'
      ? 'Bei wem lebt das Kind hauptsächlich?'
      : 'Wer hat das Kind am ersten Tag?';
  };
  sheet.querySelectorAll('#patRhythm .minipill').forEach((el) => (el.onclick = () => { rhythm = el.dataset.r; syncAll(); }));
  sheet.querySelectorAll('#patDays .minipill').forEach((el) => (el.onclick = () => { wd = Number(el.dataset.wd); syncAll(); }));
  sheet.querySelectorAll('#patStart .radio-pill').forEach((el) => (el.onclick = () => { startP = el.dataset.p; syncAll(); }));
  syncAll();

  sheet.querySelector('#patApply').onclick = () => {
    const fromStr = sheet.querySelector('#patFrom').value;
    const toStr = sheet.querySelector('#patTo').value;
    if (!fromStr || !toStr || toStr < fromStr) { toast('Bitte gültigen Zeitraum wählen'); return; }
    const from = parseDay(fromStr), to = parseDay(toStr);
    const span = Math.round((to - from) / 86400000) + 1;
    if (span > 400) { toast('Zeitraum bitte auf gut ein Jahr begrenzen'); return; }

    const assigns = computeAssignments();
    pushUndo('Muster');
    let cur = startP;
    let changed = 0;
    let wdCount = 0;
    // 14-Tage-Zyklen (0 = Start-Elternteil, 1 = der andere).
    const cycles = {
      '223':  [0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1],
      '2255': [0, 0, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1],
      '3443': [0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1],
    };
    // „Jedes 2. WE“: erster Samstag im Zeitraum gehört dem anderen Elternteil.
    const satAnchor = new Date(from);
    while (satAnchor.getDay() !== 6) satAnchor.setDate(satAnchor.getDate() + 1);
    for (let i = 0; i < span; i++) {
      const d = new Date(from);
      d.setDate(d.getDate() + i);
      const dayStr = ymd(d);
      if (cycles[rhythm]) {
        cur = cycles[rhythm][i % 14] === 0 ? startP : other(startP);
      } else if (rhythm === 'we2') {
        const dow = d.getDay();
        if (dow === 6 || dow === 0) {
          const sat = new Date(d);
          if (dow === 0) sat.setDate(sat.getDate() - 1);
          const weeks = Math.round((sat - satAnchor) / (7 * 86400000));
          cur = ((weeks % 2) + 2) % 2 === 0 ? other(startP) : startP;
        } else {
          cur = startP;
        }
      } else if (i > 0 && d.getDay() === wd) {
        // Wechseltag erreicht: wöchentlich jedes Mal, 14-täglich jedes zweite Mal.
        wdCount++;
        if (rhythm === 'w1' || wdCount % 2 === 1) cur = other(cur);
      }
      if (!editPast && isPast(dayStr)) continue;
      const have = assigns.get(dayStr);
      if ((have ? have.val : null) === cur) continue;
      addEvent({ t: 'assign', day: dayStr, val: cur });
      changed++;
    }
    closeSheet();
    if (changed) {
      toast(`Muster angewendet: ${changed} Tag${changed === 1 ? '' : 'e'} gesetzt`);
      renderAll();
    } else {
      popUndo();
      toast('Keine Änderung – alles war schon so markiert');
    }
  };
}

/* --- Bilanz: Tage, Wochenendtage und ganze Wochenenden pro Seite ---
   für den angezeigten Monat und das angezeigte Kalenderjahr. --- */

function statsFor(assigns, from, to) {
  const c = {};
  for (const k of ['A', 'B', 'AB', 'X']) c[k] = { d: 0, wd: 0, we: 0 };
  const d = new Date(from);
  while (d <= to) {
    const a = assigns.get(ymd(d));
    const v = a && a.val;
    if (v && c[v]) {
      c[v].d++;
      if (d.getDay() === 0 || d.getDay() === 6) c[v].wd++;
      // Ganze Wochenenden am Samstag zählen (Sa + So bei derselben Seite).
      if (d.getDay() === 6) {
        const sun = assigns.get(ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)));
        if (sun && sun.val === v) c[v].we++;
      }
    }
    d.setDate(d.getDate() + 1);
  }
  return c;
}

function openStats() {
  const assigns = computeAssignments();
  const monthName = new Date(viewY, viewM, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  const m = statsFor(assigns, new Date(viewY, viewM, 1), new Date(viewY, viewM + 1, 0));
  const y = statsFor(assigns, new Date(viewY, 0, 1), new Date(viewY, 11, 31));

  const table = (c) => {
    const row = (key) => {
      const s = c[key];
      if (!s.d) return '';
      return `<tr><td><span class="dot" style="background:${valColor(key)}"></span> ${esc(valName(key))}</td>
        <td>${s.d}</td><td>${s.wd}</td><td>${s.we}</td></tr>`;
    };
    return `<table class="stats-table">
      <tr><th></th><th>Tage</th><th>Sa/So</th><th>Ganze WE</th></tr>
      ${row('A')}${row('B')}${row('AB')}${row('X')}
    </table>`;
  };

  const copyText = () => {
    const line = (c, key) => c[key].d ? `  ${valName(key)}: ${c[key].d} Tage, ${c[key].wd} Wochenendtage, ${c[key].we} ganze Wochenenden\n` : '';
    const block = (title, c) => `${title}\n` + ['A', 'B', 'AB', 'X'].map((k) => line(c, k)).join('');
    return block(monthName, m) + block(`Jahr ${viewY}`, y);
  };

  const sheet = openSheet(`
    <h2>Bilanz</h2>
    <p class="sub">Ganze Wochenenden = Samstag und Sonntag bei derselben Seite.</p>
    <h3 class="stats-h">${esc(monthName)}</h3>
    ${table(m)}
    <h3 class="stats-h">Jahr ${viewY}</h3>
    ${table(y)}
    <div class="row" style="margin-top:14px">
      <button class="btn block" id="statsCopy">Als Text kopieren</button>
    </div>
  `);
  sheet.querySelector('#statsCopy').onclick = () => {
    navigator.clipboard?.writeText(copyText()).then(
      () => toast('Bilanz kopiert'),
      () => toast('Kopieren nicht möglich')
    );
  };
}

/* --- Schul-Marker: wer bringt (Punkt oben) und holt (Punkt unten);
   gilt für alle gerade ausgewählten Tage auf einmal. --- */

function openSchoolSheet(days) {
  days = [...days].sort();
  const cur = days.length === 1 ? computeSchool(state.events).get(days[0]) : null;
  const sel = {
    bring: (cur && cur.bring) || null,
    pick: (cur && cur.pick) || null,
    xwho: (cur && cur.xwho) || null,
  };

  const opts = [
    ['A', state.parents.A.name, state.parents.A.color],
    ['B', state.parents.B.name, state.parents.B.color],
    ['X', valName('X'), valColor('X')],
    ['', '–', ''],
  ];
  const row = (group) => opts.map(([v, label, color]) =>
    `<div class="minipill" data-group="${group}" data-val="${v}" style="--pc:${color || 'var(--accent)'}">${esc(label)}</div>`).join('');

  const sheet = openSheet(`
    <h2>🎒 Aufgaben</h2>
    <p class="sub">Wer übernimmt was ${days.length === 1 ? `am ${fmtShort(days[0])}` : `an den ${days.length} gewählten Tagen`}?
      Bringen/Holen (Schule, Kita) plus eine Sonderaufgabe mit Kommentar. „–“ entfernt den Marker.</p>
    <label>Bringt (🎒 oben links)</label>
    <div class="reqrow-pills" style="justify-content:flex-start">${row('bring')}</div>
    <label>Holt (🎒 unten links)</label>
    <div class="reqrow-pills" style="justify-content:flex-start">${row('pick')}</div>
    <label>Sonderaufgabe (⭐ rechts)</label>
    <div class="reqrow-pills" style="justify-content:flex-start">${row('xwho')}</div>
    <input type="text" id="xNote" maxlength="40" placeholder="Kommentar (optional), z. B. Mama beim Sport"
      value="${esc((cur && cur.xnote) || '')}" style="margin-top:8px">
    <div class="row" style="margin-top:16px">
      <button class="btn primary block" id="schoolSave">Speichern</button>
    </div>
  `);

  const sync = () => sheet.querySelectorAll('.minipill').forEach((el) => {
    const v = el.dataset.val || null;
    el.classList.toggle('sel', sel[el.dataset.group] === v);
  });
  sheet.querySelectorAll('.minipill').forEach((el) => (el.onclick = () => {
    sel[el.dataset.group] = el.dataset.val || null;
    sync();
  }));
  sync();

  sheet.querySelector('#schoolSave').onclick = () => {
    const map = computeSchool(state.events);
    pushUndo('Aufgaben-Marker');
    const xnote = sheet.querySelector('#xNote').value.trim();
    const anySet = sel.bring || sel.pick || sel.xwho;
    let changed = 0;
    for (const day of days) {
      const c = map.get(day);
      const same = ((c && c.bring) || null) === sel.bring
        && ((c && c.pick) || null) === sel.pick
        && ((c && c.xwho) || null) === sel.xwho
        && (!sel.xwho || ((c && c.xnote) || '') === xnote);
      if (same) continue;                      // unverändert
      if (!c && !anySet) continue;             // nichts da, nichts zu löschen
      const ev = { t: 'school', day, bring: sel.bring, pick: sel.pick, xwho: sel.xwho };
      if (sel.xwho && xnote) ev.xnote = xnote;
      addEvent(ev);
      changed++;
    }
    closeSheet();
    if (changed) {
      toast(`Aufgaben-Marker für ${changed} Tag${changed === 1 ? '' : 'e'} ${anySet ? 'gesetzt' : 'entfernt'}`);
      clearSelection();
      renderAll();
    } else {
      popUndo();
      toast('Keine Änderung');
    }
  };
}

/* --- Tages-Notiz: kurzer Kommentar, als Eck-Marker sichtbar, Text beim
   Antippen des Tages in der Leiste (am PC zusätzlich als Hover-Tooltip). --- */

function openNoteSheet(day) {
  const me = state.profile.me || 'A';
  const perDay = computeNotes(state.events).get(day);
  const own = perDay && perDay.get(me);
  const cur = (own && own.text) || '';
  const sheet = openSheet(`
    <h2>Notiz für ${fmtShort(day)}</h2>
    <p class="sub">Kurzer Kommentar zum Tag (z. B. „Oma holt ab“) – jeder schreibt seine eigene Notiz; sie wandert beim Teilen mit und ist beim Antippen des Tages sichtbar.</p>
    <input type="text" id="noteText" value="${esc(cur)}" maxlength="120" placeholder="Notiz …">
    <div class="row" style="margin-top:14px">
      <button class="btn primary block" id="noteSave">Speichern</button>
      ${cur ? '<button class="btn block" id="noteDelete">Notiz löschen</button>' : ''}
    </div>
  `);
  const input = sheet.querySelector('#noteText');
  input.focus();
  const save = (text) => {
    closeSheet();
    if (text === cur) return;
    pushUndo('Notiz');
    addEvent({ t: 'note', day, text });
    toast(text ? 'Notiz gespeichert' : 'Notiz gelöscht');
    clearSelection();
    renderAll();
  };
  sheet.querySelector('#noteSave').onclick = () => save(input.value.trim());
  const del = sheet.querySelector('#noteDelete');
  if (del) del.onclick = () => save('');
}

/* ---------- Sheets (Bottom-Dialoge) ---------- */

function openSheet(html, { dismissable = true } = {}) {
  const sheet = $('sheet');
  const overlay = $('overlay');
  sheet.innerHTML = html;
  sheet.classList.remove('hidden');
  overlay.classList.remove('hidden');
  overlay.onclick = dismissable ? closeSheet : null;
  return sheet;
}

function closeSheet() {
  $('sheet').classList.add('hidden');
  $('overlay').classList.add('hidden');
}

/* --- Tauschanfrage erstellen --- */

function openRequestSheet(days, opts = {}) {
  const counter = !!opts.counterTo;
  days = [...days].sort();
  const changes = {};
  // Vorauswahl: beim Gegenvorschlag der Stand des anderen, sonst „ich hätte die Tage gern“.
  days.forEach((d) => (changes[d] = (opts.prefill && opts.prefill[d]) || state.profile.me));

  const pill = (day, val, label, color) =>
    `<div class="minipill" data-day="${day}" data-val="${val}" style="--pc:${color}">${esc(label)}</div>`;

  const rows = days.map((d) => `
    <div class="reqrow">
      <span class="reqrow-day">${fmtShort(d)}</span>
      <div class="reqrow-pills">
        ${pill(d, 'A', state.parents.A.name, state.parents.A.color)}
        ${pill(d, 'B', state.parents.B.name, state.parents.B.color)}
        ${pill(d, 'AB', valName('AB'), valColor('AB'))}
        ${pill(d, 'X', valName('X'), valColor('X'))}
      </div>
    </div>`).join('');

  const sheet = openSheet(`
    <h2>${counter ? 'Gegenvorschlag' : 'Änderung vorschlagen'}</h2>
    <p class="sub">${counter
      ? 'Passe an, wie die Tage stattdessen sein sollen. Beim Senden wird der ursprüngliche Vorschlag abgelehnt und deine Variante zurückgeschickt.'
      : 'Für jeden Tag wählen, wie er künftig sein soll – auch gemischt, z. B. ein Wochenende zu dir und dafür eins zum anderen. Der andere Elternteil kann annehmen, ablehnen oder einen Gegenvorschlag schicken.'}</p>
    <div class="reqrows">${rows}</div>
    <label>Nachricht (optional):</label>
    <input type="text" id="reqNote" maxlength="200" placeholder="z. B. Oma hat Geburtstag …">
    <div class="row" style="margin-top:14px">
      <button class="btn primary block" id="reqSend">${counter ? 'Gegenvorschlag' : 'Vorschlag'} erstellen &amp; teilen</button>
    </div>
  `);
  const pills = sheet.querySelectorAll('.minipill');
  const sync = () => pills.forEach((p) => p.classList.toggle('sel', changes[p.dataset.day] === p.dataset.val));
  pills.forEach((p) => (p.onclick = () => { changes[p.dataset.day] = p.dataset.val; sync(); }));
  sync();
  sheet.querySelector('#reqSend').onclick = async () => {
    const note = sheet.querySelector('#reqNote').value.trim();
    if (counter) addEvent({ t: 'res', req: opts.counterTo, ok: false }); // Original ablehnen
    addEvent({ t: 'req', changes, note, re: opts.counterTo });
    closeSheet();
    clearSelection();
    renderAll();
    // Der Vorschlags-Dialog war bereits die Vorschau – direkt senden.
    await shareEvents(unsharedEvents(), counter ? 'Gegenvorschlag' : 'Vorschlag', note);
  };
}

/* --- Aktionen auf Anfragen --- */

async function onRequestAction(reqId, act) {
  const req = state.events[reqId];
  if (!req) return;
  if (act === 'counter') {
    // Gegenvorschlag: Composer vorbefüllt mit dem Vorschlag des anderen;
    // das Original wird erst beim Senden abgelehnt.
    openRequestSheet(Object.keys(reqChanges(req)).sort(), { prefill: reqChanges(req), counterTo: reqId });
    return;
  }
  if (act === 'accept') addEvent({ t: 'res', req: reqId, ok: true });
  if (act === 'decline') addEvent({ t: 'res', req: reqId, ok: false });
  if (act === 'withdraw') addEvent({ t: 'res', req: reqId, ok: false });
  renderAll();
  if (act === 'reshare') {
    const related = Object.values(state.events).filter((e) => e.id === reqId || (e.t === 'res' && e.req === reqId));
    openShareReview(related, 'Vorschlag');
  } else {
    await shareUnshared();
  }
}

/* ---------- Teilen (Link-Sync) ---------- */

function unsharedEvents() {
  return Object.values(state.events).filter((e) => !sharedIds.has(e.id));
}

async function shareUnshared() {
  const evts = unsharedEvents();
  if (!evts.length) {
    openFullSyncSheet();
    return;
  }
  openShareReview(evts, 'Änderungen');
}

/* Abgleich: kompletter Stand ab dem aktuellen Monat (die Vergangenheit
   ist abgehakt und bleibt lokal – so bleibt der Link klein). */
function shareAll() {
  const cutoff = monthStart();
  const evts = Object.values(state.events).filter((ev) => {
    if (ev.t === 'assign') return ev.day >= cutoff;
    if (ev.t === 'req') return Object.keys(reqChanges(ev)).some((d) => d >= cutoff);
    if (ev.t === 'res') {
      const req = state.events[ev.req];
      return !!req && Object.keys(reqChanges(req)).some((d) => d >= cutoff);
    }
    return false;
  });
  if (!evts.length) { toast('Ab diesem Monat ist nichts eingetragen'); return; }
  openShareReview(evts, 'Abgleich');
}

/* Vorschau vor dem Senden: Was geht raus, plus optionale Nachricht.
   Ein Workflow für alles – Zuweisungen, Vorschläge und Antworten. */
function openShareReview(evts, kindLabel) {
  // Zuweisungen pro Tag deduplizieren (nur der letzte Stand zählt).
  const byDay = new Map();
  const hoByDay = new Map();
  const noteByDay = new Map();
  const schoolByDay = new Map();
  const reqs = [];
  const ress = [];
  for (const ev of evts) {
    if (ev.t === 'assign') {
      const cur = byDay.get(ev.day);
      if (!cur || ev.ts > cur.ts) byDay.set(ev.day, ev);
    } else if (ev.t === 'ho') {
      const cur = hoByDay.get(ev.day);
      if (!cur || ev.ts > cur.ts) hoByDay.set(ev.day, ev);
    } else if (ev.t === 'note') {
      const k = ev.day + '|' + (ev.by || 'A');
      const cur = noteByDay.get(k);
      if (!cur || ev.ts > cur.ts) noteByDay.set(k, ev);
    } else if (ev.t === 'school') {
      const cur = schoolByDay.get(ev.day);
      if (!cur || ev.ts > cur.ts) schoolByDay.set(ev.day, ev);
    } else if (ev.t === 'req') reqs.push(ev);
    else if (ev.t === 'res') ress.push(ev);
  }

  const lines = [];
  for (const day of [...byDay.keys()].sort()) {
    lines.push(`${fmtShort(day)} → <b>${esc(valName(byDay.get(day).val))}</b>`);
  }
  for (const day of [...hoByDay.keys()].sort()) {
    const t = hoByDay.get(day).time;
    lines.push(t === 'm'
      ? `Übergabe <b>früh</b> am ${fmtShort(day)}`
      : `Übergabe <b>abends</b> am ${fmtShort(prevDayStr(day))}`);
  }
  for (const k of [...noteByDay.keys()].sort()) {
    const n = noteByDay.get(k);
    lines.push(n.text
      ? `Notiz ${fmtShort(n.day)} (${esc(authorName(n.by))}): „${esc(n.text)}“`
      : `Notiz ${fmtShort(n.day)} (${esc(authorName(n.by))}) <b>gelöscht</b>`);
  }
  for (const day of [...schoolByDay.keys()].sort()) {
    const s = schoolByDay.get(day);
    const parts = [];
    if (s.bring) parts.push(`bringt <b>${esc(valName(s.bring))}</b>`);
    if (s.pick) parts.push(`holt <b>${esc(valName(s.pick))}</b>`);
    const xw = s.xwho || s.am || s.pm;
    if (xw) {
      const n = s.xnote || s.amNote || s.pmNote || '';
      parts.push(`extra <b>${esc(valName(xw))}</b>${n ? ` („${esc(n)}“)` : ''}`);
    }
    lines.push(`🎒 ${fmtShort(day)}: ${parts.join(', ') || 'Marker <b>entfernt</b>'}`);
  }
  for (const ev of evts) {
    if (ev.t === 'range') lines.push(`🏖 <b>${esc(ev.label)}</b> ${fmtShort(ev.from)} – ${fmtShort(ev.to)}`);
    else if (ev.t === 'rangedel') {
      const r = state.events[ev.ref];
      lines.push(`🏖 Zeitraum ${r ? `„${esc(r.label)}“ ` : ''}<b>gelöscht</b>`);
    }
  }
  for (const r of reqs) {
    const ch = Object.entries(reqChanges(r)).map(([d, v]) => `${fmtShort(d)} → ${esc(valName(v))}`);
    lines.push(`${r.re ? 'Gegenvorschlag' : 'Vorschlag'}: ${ch.join(', ')}${r.note ? ` („${esc(r.note)}“)` : ''}`);
  }
  for (const r of ress) {
    const req = state.events[r.req];
    const status = r.ok ? 'angenommen ✓' : (req && r.by === req.by ? 'zurückgezogen' : 'abgelehnt ✗');
    lines.push(`Antwort auf Vorschlag: <b>${status}</b>`);
  }

  const sheet = openSheet(`
    <h2>${esc(kindLabel)} teilen</h2>
    <p class="sub">Das geht an den anderen Elternteil:</p>
    <ul class="import-list">${lines.map((l) => `<li>${l}</li>`).join('')}</ul>
    <label>Nachricht dazu (optional):</label>
    <input type="text" id="shareMsg" maxlength="200" placeholder="z. B. hab den Dezember eingetragen …">
    <div class="row" style="margin-top:12px">
      <button class="btn primary block" id="shareGo">Als Link teilen</button>
    </div>
    <div class="row">
      <button class="btn secondary block" id="shareCopy">📋 Link kopieren</button>
    </div>
  `);
  sheet.querySelector('#shareGo').onclick = async () => {
    const msg = sheet.querySelector('#shareMsg').value.trim();
    closeSheet();
    await shareEvents(evts, kindLabel, msg);
  };
  sheet.querySelector('#shareCopy').onclick = async () => {
    const msg = sheet.querySelector('#shareMsg').value.trim();
    const url = await buildShareLink(evts, msg);
    await copyToClipboard(shareText(url, msg));
    markShared(evts);
    closeSheet();
    toast('Link kopiert – einfach einfügen und abschicken');
  };
}

async function buildShareLink(evts, msg = '') {
  const payload = {
    v: 1,
    from: state.profile.me,
    parents: state.parents,
    msg: msg || undefined,
    events: evts,
  };
  const encoded = await encodePayload(payload);
  const base = location.href.split('#')[0];
  return `${base}#s=${encoded}`;
}

function shareText(url, msg = '') {
  const myName = state.parents[state.profile.me].name;
  return `📅 Wechselkalender – ${myName}${msg ? `: „${msg}“` : ''}\n${url}`;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); ta.remove();
  }
}

async function shareEvents(evts, kindLabel, msg = '') {
  const url = await buildShareLink(evts, msg);
  const text = shareText(url, msg);

  let sharedOk = false;
  if (navigator.share) {
    try { await navigator.share({ text }); sharedOk = true; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  if (!sharedOk) openShareFallback(url, evts);
  else markShared(evts);
}

function openShareFallback(url, evts) {
  const sheet = openSheet(`
    <h2>Link teilen</h2>
    <p class="sub">Diesen Link an den anderen Elternteil schicken (z. B. per WhatsApp). Beim Antippen werden die Änderungen dort übernommen.</p>
    <div class="linkbox">${esc(url)}</div>
    <div class="row">
      <button class="btn primary block" id="btnCopy">Link kopieren</button>
    </div>
  `);
  sheet.querySelector('#btnCopy').onclick = async () => {
    await copyToClipboard(url);
    toast('Link kopiert');
    markShared(evts);
    closeSheet();
  };
}

function markShared(evts) {
  evts.forEach((e) => sharedIds.add(e.id));
  saveShared();
  renderShareBadge();
}

function openFullSyncSheet() {
  const sheet = openSheet(`
    <h2>Nichts Neues zu teilen</h2>
    <p class="sub">Alle Änderungen wurden bereits geteilt. Du kannst stattdessen den kompletten Stand ab dem aktuellen Monat als Abgleich-Link senden – z. B. beim ersten Einrichten auf dem anderen Handy oder wenn dort Links verpasst wurden.</p>
    <div class="row">
      <button class="btn primary block" id="btnFull">Abgleich teilen</button>
    </div>
  `);
  sheet.querySelector('#btnFull').onclick = () => { closeSheet(); shareAll(); };
}

/* ---------- Import (Link empfangen) ---------- */

async function checkIncoming() {
  const m = location.hash.match(/^#s=(.+)$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  let payload;
  try { payload = await decodePayload(m[1]); }
  catch (e) { toast('Link konnte nicht gelesen werden'); return; }
  if (!payload || payload.v !== 1 || !Array.isArray(payload.events)) {
    toast('Ungültiger Link'); return;
  }
  const fresh = payload.events.filter((e) => e && e.id && !state.events[e.id]);
  const senderName = payload.parents?.[payload.from]?.name || 'Partner';

  if (!fresh.length) {
    toast('Keine neuen Änderungen im Link');
    return;
  }

  // Wie würde sich der Kalender durch die Übernahme ändern? (alt → neu pro Tag)
  const before = computeAssignments();
  const merged = { ...state.events };
  fresh.forEach((e) => (merged[e.id] = e));
  const after = computeAssignmentsFrom(merged);
  const afterHo = computeHoOverrides(merged);
  const afterNotes = computeNotes(merged);
  const afterSchool = computeSchool(merged);
  const afterRanges = computeRanges(merged);

  const allDays = new Set([...before.keys(), ...after.keys()]);
  const diffDays = new Set();
  const oldVals = new Map();
  const diffs = [];
  for (const day of [...allDays].sort()) {
    const o = before.has(day) ? before.get(day).val : null;
    const n = after.has(day) ? after.get(day).val : null;
    if (o !== n) {
      diffDays.add(day);
      oldVals.set(day, o);
      diffs.push(`${fmtShort(day)}: ${esc(valNameIn(payload, o))} → <b>${esc(valNameIn(payload, n))}</b>`);
    }
  }
  // Geänderte Übergabe-Zeiten ebenfalls anzeigen und markieren – am Tag,
  // auf dem der Streifen sichtbar ist (abends = Vortag des Wechsels).
  for (const ev of fresh) {
    if (ev.t !== 'ho') continue;
    const shownDay = ev.time === 'm' ? ev.day : prevDayStr(ev.day);
    diffDays.add(shownDay);
    diffs.push(`${fmtShort(shownDay)}: Übergabe <b>${ev.time === 'm' ? 'früh' : 'abends'}</b>`);
  }
  // Neue oder geänderte Notizen anzeigen und markieren.
  const authorNameIn = (by) => payload.parents?.[by]?.name || (by === 'K' ? 'Kind' : by);
  for (const ev of fresh) {
    if (ev.t !== 'note') continue;
    diffDays.add(ev.day);
    diffs.push(ev.text
      ? `${fmtShort(ev.day)}: Notiz (${esc(authorNameIn(ev.by))}) „${esc(ev.text)}“`
      : `${fmtShort(ev.day)}: Notiz (${esc(authorNameIn(ev.by))}) <b>gelöscht</b>`);
  }
  // Neue oder geänderte Aufgaben-Marker anzeigen und markieren.
  for (const ev of fresh) {
    if (ev.t !== 'school') continue;
    diffDays.add(ev.day);
    const parts = [];
    if (ev.bring) parts.push(`bringt <b>${esc(valNameIn(payload, ev.bring))}</b>`);
    if (ev.pick) parts.push(`holt <b>${esc(valNameIn(payload, ev.pick))}</b>`);
    const xw = ev.xwho || ev.am || ev.pm;
    if (xw) {
      const n = ev.xnote || ev.amNote || ev.pmNote || '';
      parts.push(`extra <b>${esc(valNameIn(payload, xw))}</b>${n ? ` („${esc(n)}“)` : ''}`);
    }
    diffs.push(`${fmtShort(ev.day)}: 🎒 ${parts.join(', ') || 'Marker <b>entfernt</b>'}`);
  }
  // Neue oder gelöschte Ferien-Zeiträume.
  for (const ev of fresh) {
    if (ev.t === 'range') diffs.push(`🏖 <b>${esc(ev.label)}</b> ${fmtShort(ev.from)} – ${fmtShort(ev.to)}`);
    else if (ev.t === 'rangedel') {
      const r = merged[ev.ref];
      diffs.push(`🏖 Zeitraum ${r ? `„${esc(r.label)}“ ` : ''}<b>gelöscht</b>`);
    }
  }

  const reqLines = fresh.filter((e) => e.t === 'req').map((ev) => {
    const ch = Object.entries(reqChanges(ev)).map(([d, v]) => `${fmtShort(d)} → <b>${esc(valNameIn(payload, v))}</b>`);
    return `${ch.join(', ')}${ev.note ? ` <span class="req-note">„${esc(ev.note)}“</span>` : ''}`;
  });

  // Vorschau-Modus starten: Kalender zeigt den empfangenen Stand,
  // geänderte Tage bekommen einen Farbrand; übernommen wird erst auf Klick.
  pendingImport = { payload, fresh, after, afterHo, afterNotes, afterSchool, afterRanges, diffDays, oldVals, diffs, reqLines, senderName };
  selectedDays.clear();

  // Zum Monat der ersten Änderung springen.
  let firstDay = [...diffDays].sort()[0];
  if (!firstDay) {
    const fr = fresh.find((e) => e.t === 'req');
    if (fr) firstDay = Object.keys(reqChanges(fr)).sort()[0];
  }
  if (firstDay) {
    const d = parseDay(firstDay);
    viewY = d.getFullYear();
    viewM = d.getMonth();
  }
  renderAll();
}

function applyImport() {
  if (!pendingImport) return;
  const { fresh, payload } = pendingImport;
  const firstRun = !state.profile.me;
  for (const ev of fresh) { state.events[ev.id] = ev; sharedIds.add(ev.id); }
  // Namen, Farben & Co. gelten pro Gerät: nur bei der Ersteinrichtung über
  // einen Partner-Link werden sie einmalig als Startwerte übernommen.
  if (firstRun && payload.parents) state.parents = payload.parents;
  ensureParentDefaults(state.parents);
  if (firstRun) state.profile.me = other(payload.from); // Erststart über Partner-Link
  saveState(); saveShared();
  pendingImport = null;
  closeSheet();
  renderAll();
  toast('Übernommen ✓');
}

function discardImport() {
  pendingImport = null;
  closeSheet();
  renderAll();
  toast('Verworfen – nichts geändert');
}

function renderPreviewBar() {
  const bar = $('previewbar');
  if (!pendingImport) { bar.classList.add('hidden'); return; }
  const p = pendingImport;
  $('selectbar').classList.add('hidden');
  $('btnShare').classList.add('hidden');
  bar.classList.remove('hidden');

  const parts = [];
  if (p.diffDays.size) parts.push(`${p.diffDays.size} Tag${p.diffDays.size === 1 ? '' : 'e'} markiert (Randfarbe = bisher)`);
  if (p.reqLines.length) parts.push(`${p.reqLines.length} neue${p.reqLines.length === 1 ? 'r' : ''} Vorschlag${p.reqLines.length === 1 ? '' : 'e'}`);
  bar.innerHTML = `
    <div class="selectbar-info"><b>Vorschau</b> – Änderungen von <b>${esc(p.senderName)}</b>${p.payload.msg ? `: „${esc(p.payload.msg)}“` : ''}${parts.length ? '<br>' + parts.join(', ') : ''}</div>
    <div class="selectbar-actions">
      <button class="btn primary" id="pvOk">Übernehmen</button>
      <button class="btn danger-ghost" id="pvNo">Verwerfen</button>
      <button class="btn ghost" id="pvInfo">Details</button>
    </div>`;
  bar.querySelector('#pvOk').onclick = applyImport;
  bar.querySelector('#pvNo').onclick = discardImport;
  bar.querySelector('#pvInfo').onclick = openImportDetails;
}

function openImportDetails() {
  const p = pendingImport;
  if (!p) return;
  let html = '';
  if (p.diffs.length) {
    html += `<p class="sub" style="margin:10px 0 2px">Dein Kalender ändert sich an ${p.diffs.length} Tag${p.diffs.length === 1 ? '' : 'en'}:</p>
      <ul class="import-list">${p.diffs.map((l) => `<li>${l}</li>`).join('')}</ul>`;
  }
  if (p.reqLines.length) {
    html += `<p class="sub" style="margin:10px 0 2px">Neue Vorschläge zum Beantworten:</p>
      <ul class="import-list">${p.reqLines.map((l) => `<li>${l}</li>`).join('')}</ul>`;
  }
  if (!html) html = '<p class="sub" style="margin:10px 0 2px">Keine Auswirkung auf deinen Kalender – die Stände sind bereits identisch.</p>';

  const sheet = openSheet(`
    <h2>Änderungen von ${esc(p.senderName)}</h2>
    ${p.payload.msg ? `<p class="req-note" style="margin:2px 0 0">„${esc(p.payload.msg)}“</p>` : ''}
    ${html}
    <div class="row" style="margin-top:12px">
      <button class="btn primary block" id="impOk">Übernehmen</button>
    </div>
    <div class="row">
      <button class="btn ghost block" id="impNo">Verwerfen</button>
    </div>
    <div class="row">
      <button class="btn block" id="impBack">Zurück zur Vorschau</button>
    </div>
  `);
  sheet.querySelector('#impOk').onclick = applyImport;
  sheet.querySelector('#impNo').onclick = discardImport;
  sheet.querySelector('#impBack').onclick = closeSheet;
}

function valNameIn(payload, val) {
  if (val === 'A') return payload.parents?.A?.name || 'A';
  if (val === 'B') return payload.parents?.B?.name || 'B';
  if (val === 'AB') return payload.parents?.AB?.name || 'Beide';
  if (val === 'X') return payload.parents?.X?.name || 'Nicht da';
  const ho = parseHandover(val);
  if (ho) {
    const n = (p) => payload.parents?.[p]?.name || p;
    return `${n(ho.from)} → ${n(ho.to)} (${ho.time === 'm' ? 'früh' : 'abends'})`;
  }
  return 'frei';
}

/* ---------- Kodierung (JSON -> deflate -> base64url) ---------- */

function b64url(u8) {
  let s = '';
  u8.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function encodePayload(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream === 'function') {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    const buf = await new Response(stream).arrayBuffer();
    return 'z' + b64url(new Uint8Array(buf));
  }
  return 'j' + b64url(bytes);
}

async function decodePayload(str) {
  const kind = str[0];
  const data = unb64url(str.slice(1));
  let bytes = data;
  if (kind === 'z') {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/* ---------- Einstellungen / Onboarding ---------- */

function openSettings(onboarding = false) {
  const p = state.parents;
  let me = state.profile.me || 'A';
  let ho = state.handover || 'm';

  // Name + Farbwähler in einer Zeile; Farbe über den System-Farbdialog.
  const nameColor = (key, name, color, fallback) => `
    <div class="name-color">
      <input type="text" id="name${key}" value="${esc(name)}" maxlength="20" placeholder="${fallback}">
      <input type="color" id="col${key}" value="${color}" aria-label="Farbe wählen">
    </div>`;

  const sheet = openSheet(`
    <h2>${onboarding ? 'Willkommen! 👋' : 'Einstellungen'}</h2>
    ${onboarding ? `<p class="sub">Der Wechselkalender läuft komplett auf diesem Handy – ohne Konto und ohne Server. Änderungen teilt ihr euch gegenseitig als Link (z. B. per WhatsApp).</p>` : ''}
    <label>Elternteil 1 – Name und Farbe</label>
    ${nameColor('A', p.A.name, p.A.color, 'Mama')}
    <label>Elternteil 2 – Name und Farbe</label>
    ${nameColor('B', p.B.name, p.B.color, 'Papa')}
    <label>Gemeinsame Tage</label>
    ${nameColor('AB', (p.AB && p.AB.name) || 'Beide', (p.AB && p.AB.color) || '#6741d9', 'Beide')}
    <label>Abwesend (Oma, Klassenfahrt …)</label>
    ${nameColor('X', (p.X && p.X.name) || 'Nicht da', (p.X && p.X.color) || COLOR_X, 'Nicht da')}
    <label>Kind – Name (für Notizen)</label>
    <input type="text" id="nameK" value="${esc((p.K && p.K.name) || 'Kind')}" maxlength="20" placeholder="Kind">
    <label>Standard-Übergabe</label>
    <div class="radio-row" id="hoRow">
      <div class="radio-pill" data-ho="m">Früh</div>
      <div class="radio-pill" data-ho="e">Abends</div>
    </div>
    <label>🎒 Aufgaben-Marker (bringt/holt, Sonderaufgabe)</label>
    <div class="radio-row" id="schoolRow">
      <div class="radio-pill" data-school="1">An</div>
      <div class="radio-pill" data-school="0">Aus</div>
    </div>
    <label>Aussehen (nur dieses Handy)</label>
    <div class="radio-row" id="themeRow">
      <div class="radio-pill" data-th="auto">Auto</div>
      <div class="radio-pill" data-th="light">Hell</div>
      <div class="radio-pill" data-th="medium">Mittel</div>
      <div class="radio-pill" data-th="dark">Dunkel</div>
    </div>
    <label>Wer bist du (auf diesem Handy)?</label>
    <div class="radio-row" id="meRow">
      <div class="radio-pill" data-me="A">${esc(p.A.name)}</div>
      <div class="radio-pill" data-me="B">${esc(p.B.name)}</div>
      <div class="radio-pill" data-me="K">${esc((p.K && p.K.name) || 'Kind')}</div>
    </div>
    <label>PIN für den Kind-Modus${state.pin ? ' (gesetzt – leer lassen zum Behalten)' : ''}</label>
    <input type="password" id="pinField" inputmode="numeric" autocomplete="off" maxlength="12" placeholder="${state.pin ? 'unverändert' : 'z. B. 4 Ziffern'}">
    <div class="row" style="margin-top:16px">
      <button class="btn primary block" id="btnSave">Speichern</button>
    </div>
    ${onboarding ? '' : `<button class="btn danger-ghost block" id="btnReset" style="margin-top:24px">🗑 App zurücksetzen – alle Daten löschen…</button>`}
  `, { dismissable: !onboarding });

  const nameA = sheet.querySelector('#nameA');
  const nameB = sheet.querySelector('#nameB');
  const nameK = sheet.querySelector('#nameK');
  const mePills = sheet.querySelectorAll('#meRow .radio-pill');
  const syncMe = () => mePills.forEach((el) => {
    el.classList.toggle('sel', el.dataset.me === me);
    if (el.dataset.me === 'A') el.textContent = nameA.value || 'Elternteil 1';
    else if (el.dataset.me === 'B') el.textContent = nameB.value || 'Elternteil 2';
    else el.textContent = nameK.value || 'Kind';
  });
  mePills.forEach((el) => (el.onclick = () => { me = el.dataset.me; syncMe(); }));
  nameA.oninput = syncMe;
  nameB.oninput = syncMe;
  nameK.oninput = syncMe;
  syncMe();

  const hoPills = sheet.querySelectorAll('#hoRow .radio-pill');
  const syncHo = () => hoPills.forEach((el) => el.classList.toggle('sel', el.dataset.ho === ho));
  hoPills.forEach((el) => (el.onclick = () => { ho = el.dataset.ho; syncHo(); }));
  syncHo();

  let school = schoolOn();
  const schoolPills = sheet.querySelectorAll('#schoolRow .radio-pill');
  const syncSchool = () => schoolPills.forEach((el) => el.classList.toggle('sel', (el.dataset.school === '1') === school));
  schoolPills.forEach((el) => (el.onclick = () => { school = el.dataset.school === '1'; syncSchool(); }));
  syncSchool();

  // Das Design wirkt sofort und wird direkt gemerkt – es gilt nur für dieses
  // Gerät und hängt darum nicht am Speichern-Knopf.
  let theme = loadTheme();
  const themePills = sheet.querySelectorAll('#themeRow .radio-pill');
  const syncTheme = () => themePills.forEach((el) => el.classList.toggle('sel', el.dataset.th === theme));
  themePills.forEach((el) => (el.onclick = () => { theme = el.dataset.th; saveTheme(theme); syncTheme(); }));
  syncTheme();

  const resetBtn = sheet.querySelector('#btnReset');
  if (resetBtn) resetBtn.onclick = () => openResetConfirm();

  sheet.querySelector('#btnSave').onclick = () => {
    const name = (key, fb) => sheet.querySelector('#name' + key).value.trim() || fb;
    const col = (key) => sheet.querySelector('#col' + key).value.toLowerCase();
    const cols = ['A', 'B', 'AB', 'X'].map(col);
    // Alle vier Markierungen müssen im Kalender unterscheidbar bleiben.
    if (new Set(cols).size < 4) { toast('Bitte vier unterschiedliche Farben wählen'); return; }
    const pinVal = sheet.querySelector('#pinField').value.trim();
    if (me === 'K' && !state.pin && !pinVal) {
      toast('Bitte eine PIN setzen – sie schützt die Einstellungen im Kind-Modus');
      return;
    }
    state.parents.A = { name: name('A', 'Mama'), color: cols[0] };
    state.parents.B = { name: name('B', 'Papa'), color: cols[1] };
    state.parents.AB = { name: name('AB', 'Beide'), color: cols[2] };
    state.parents.X = { name: name('X', 'Nicht da'), color: cols[3] };
    state.parents.K = { name: name('K', 'Kind') };
    if (pinVal) state.pin = pinHash(pinVal);
    state.profile.me = me;
    state.handover = ho;
    state.school = school;
    saveState();
    closeSheet();
    renderAll();
    if (onboarding) toast(me === 'K' ? 'Eingerichtet! Tage antippen, um Notizen zu lesen oder zu schreiben.' : 'Los geht’s! Tage antippen und unten die Farbe wählen.');
  };
}

/* ---------- Komplett zurücksetzen ---------- */

function openResetConfirm() {
  const sheet = openSheet(`
    <h2>App zurücksetzen</h2>
    <p class="sub">Löscht auf diesem Handy <b>alles</b>: Kalender, Vorschläge, Einstellungen,
    das eingefrorene Archiv und die Rettungskopien. Das lässt sich nicht rückgängig machen.
    Der Stand auf dem anderen Handy bleibt unberührt.</p>
    <p class="sub">Tipp: vorher im Menü (⋮) „Backup exportieren" nutzen.</p>
    <div class="row" style="margin-top:16px">
      <button class="btn ghost block" id="rsCancel">Abbrechen</button>
    </div>
    <div class="row">
      <button class="btn danger block" id="rsGo">Ja, alles löschen</button>
    </div>
  `);
  sheet.querySelector('#rsCancel').onclick = () => closeSheet();
  sheet.querySelector('#rsGo').onclick = () => {
    // Alle Schlüssel der App entfernen – auch künftige, solange sie mit wk_ beginnen.
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('wk_')) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
    } catch (e) {}
    applyTheme('auto');
    // Frischer Start ohne #hash → Begrüßung wie beim ersten Öffnen.
    location.replace(location.pathname);
  };
}

/* ---------- Menü ---------- */

function openMenu() {
  const kid = isKid();
  // Im Kind-Modus bleiben nur Lese-Aktionen (plus PIN-geschützte Einstellungen).
  const sheet = openSheet(`
    <div class="menu-list">
      <button class="menu-item" id="mHelp"><span class="mi">❓</span> So funktioniert’s</button>
      <button class="menu-item" id="mSettings"><span class="mi">⚙️</span> Einstellungen${kid ? ' (PIN)' : ''}</button>
      ${kid ? '' : `<button class="menu-item" id="mFull"><span class="mi">🔄</span> Abgleich teilen (ab diesem Monat)</button>`}
      <div class="menu-sep">Planung &amp; Statistik</div>
      ${kid ? '' : `<button class="menu-item" id="mPattern"><span class="mi">🧩</span> Muster anwenden…</button>`}
      <button class="menu-item" id="mFerien"><span class="mi">🏖</span> Ferien &amp; Feiertage</button>
      <button class="menu-item" id="mStats"><span class="mi">📊</span> Bilanz</button>
      <button class="menu-item" id="mHistory"><span class="mi">🕘</span> Verlauf</button>
      ${kid ? '' : `<button class="menu-item" id="mLock"><span class="mi">${editPast ? '🔒' : '🔓'}</span> ${editPast ? 'Vergangene Monate wieder sperren' : 'Vergangene Monate bearbeiten'}</button>`}
      <div class="menu-sep">Export &amp; Druck</div>
      ${kid ? '' : `<button class="menu-item" id="mIcs"><span class="mi">📆</span> Kalender-Export (.ics)</button>`}
      <button class="menu-item" id="mPrint"><span class="mi">🖨</span> Monat drucken</button>
      <button class="menu-item" id="mExport"><span class="mi">💾</span> Backup exportieren</button>
      ${kid ? '' : `<button class="menu-item" id="mImport"><span class="mi">📂</span> Backup importieren</button>`}
      ${loadRescues().length ? `<button class="menu-item" id="mRescue"><span class="mi">🧯</span> Rettungskopien als Datei sichern</button>` : ''}
    </div>
  `);
  const on = (sel, fn) => { const el = sheet.querySelector(sel); if (el) el.onclick = fn; };
  on('#mPattern', () => openPatternSheet());
  on('#mStats', () => openStats());
  on('#mFerien', () => openFerienSheet());
  on('#mPrint', () => { closeSheet(); setTimeout(() => window.print(), 100); });
  on('#mIcs', () => { closeSheet(); exportIcs(); });
  on('#mHistory', () => openHistory());
  on('#mFull', () => { closeSheet(); shareAll(); });
  on('#mLock', () => {
    editPast = !editPast;
    closeSheet();
    toast(editPast ? 'Vergangene Monate sind jetzt bearbeitbar' : 'Vergangene Monate sind wieder gesperrt');
  });
  on('#mExport', () => { closeSheet(); exportBackup(); });
  on('#mRescue', () => { closeSheet(); exportRescues(); });
  on('#mImport', () => { closeSheet(); importBackup(); });
  on('#mSettings', () => {
    if (isKid() && state.pin) openPinPrompt(() => openSettings(false));
    else openSettings(false);
  });
  on('#mHelp', () => openHelp());
}

/* ---------- PIN (Alltagssperre für den Kind-Modus) ----------
   Bewusst nur ein leichter Schutz gegen Verstellen – echte Sicherheit ist
   ohne Server nicht möglich, die Daten liegen lokal auf dem Gerät. */

function pinHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return 'p' + h.toString(36);
}

function openPinPrompt(onOk) {
  const sheet = openSheet(`
    <h2>PIN eingeben</h2>
    <p class="sub">Die Einstellungen sind im Kind-Modus geschützt.</p>
    <input type="password" id="pinIn" inputmode="numeric" autocomplete="off" maxlength="12" placeholder="PIN">
    <div class="row" style="margin-top:14px">
      <button class="btn primary block" id="pinOk">Weiter</button>
    </div>
  `);
  const input = sheet.querySelector('#pinIn');
  input.focus();
  const check = () => {
    if (pinHash(input.value) === state.pin) { closeSheet(); onOk(); }
    else { toast('Falsche PIN'); input.value = ''; }
  };
  sheet.querySelector('#pinOk').onclick = check;
  input.onkeydown = (e) => { if (e.key === 'Enter') check(); };
}

function openHelp() {
  openSheet(`
    <h2>So funktioniert’s</h2>
    <p class="sub">Kurz erklärt</p>
    <ul class="import-list">
      <li><b>Tage antippen</b> (einen oder mehrere) → unten wählen, zu wem sie gehören – auch „Nicht da“ (Oma, Klassenfahrt …).</li>
      <li><b>Übergabe-Streifen</b> erscheinen automatisch an jedem Wechsel – auch bei „Beide“ und „Nicht da“ (Standard früh/abends einstellbar). Der Streifen sitzt dort, wo die Übergabe stattfindet: <b>früh</b> = oben auf dem ersten Tag der neuen Seite, <b>abends</b> = unten auf dem letzten Tag der alten Seite. Zum Umstellen genau an diese Stelle tippen.</li>
      <li><b>Notiz</b> → einen Tag auswählen und 💬 tippen: kurzer Kommentar zum Tag (z. B. „Oma holt ab“). Jeder schreibt seine eigene Notiz; Tage mit Notiz haben eine weiße Ecke, Antippen zeigt die Texte unten in der Leiste.</li>
      <li><b>Aufgaben-Marker</b> → Tage auswählen und 🎒 tippen: Wer bringt/holt (Rucksack-Badges links oben/unten) plus eine <b>Sonderaufgabe</b> (Stern-Badge rechts) mit optionalem Kommentar, z. B. „Papa – Mama beim Sport“. Alles in der Farbe der Person; in den Einstellungen aus-/einschaltbar.</li>
      <li><b>Kind-Modus</b> → in den Einstellungen bei „Wer bist du?“ <b>Kind</b> wählen und eine PIN vergeben. Das Kind sieht den ganzen Kalender und bekommt Stände wie gewohnt per Link – schreiben kann es nur eigene Notizen. Einstellungen sind dann PIN-geschützt; den Kalender ändern können nur die Eltern.</li>
      <li><b>Vorschlag</b> → gewünschte Änderung pro Tag wählbar (auch gemischt, z. B. ein Wochenende hin, eins zurück); der andere sieht vorab, was sich ändert, und kann annehmen, ablehnen oder einen Gegenvorschlag schicken.</li>
      <li><b>Teilen-Knopf</b> → zeigt erst, was rausgeht (Nachricht dazu optional), dann als Link verschicken (z. B. per WhatsApp). Der andere tippt den Link an – fertig.</li>
      <li><b>Muster anwenden</b> (Menü) füllt einen Zeitraum mit eurem Rhythmus (wöchentlich, 14-täglich, 2-2-3, 2-2-5-5, 3-4-4-3 oder jedes 2. Wochenende) – einzelne Tage danach einfach umtippen. Der <b>↩-Knopf unten links</b> nimmt die letzte Aktion zurück, <b>↪</b> stellt sie wieder her (ausgegraut, wenn gerade nichts zurückzunehmen bzw. wiederherzustellen ist).</li>
      <li><b>Bilanz</b> (Menü) zählt Tage, Wochenendtage und ganze Wochenenden pro Seite für Monat und Jahr – als Text kopierbar.</li>
      <li><b>Ferien &amp; Feiertage</b> (Menü): Bundesland wählen (Feiertage rot unterstrichen, offline berechnet) und Ferien als Zeiträume eintragen (gepunktet unterstrichen). <b>Kalender-Export (.ics)</b> bringt den Plan lesend in Google-/Arbeitskalender, <b>Monat drucken</b> z. B. an den Kühlschrank.</li>
      <li><b>Vergangene Monate</b> sind gegen versehentliches Ändern gesperrt – im Menü lassen sie sich entsperren.</li>
      <li><b>Eingefrorene Vergangenheit</b> → die App sichert das fertige Kalenderbild automatisch (eine Kopie, zwingend vor jedem Update). Sollte eine künftige Version die alten Daten nicht mehr lesen können, zeigt der Kalender vergangene Monate einfach weiter an – statisch und nur zum Lesen (📦 in der Legende). Zusätzlich bleiben rohe Rettungskopien erhalten (über das Menü als Datei sicherbar).</li>
      <li>Die Daten liegen <b>nur auf euren Handys</b>. Es gibt keinen Server und kein Konto. Deshalb regelmäßig teilen – und ab und zu ein Backup exportieren.</li>
    </ul>
    <div class="row"><button class="btn block" onclick="document.getElementById('overlay').click()">Alles klar</button></div>
  `);
}

/* ---------- Archiv (Sicherheitsnetz für Updates) ----------
   Das fertig berechnete Kalenderbild (Tag → Name/Farbe/Notizen/Aufgaben)
   wird unter einem eigenen Schlüssel eingefroren. Das Format ist bewusst
   dumm und bleibt für immer stabil (v1, höchstens additive Ergänzungen):
   So kann jede künftige App-Version die Vergangenheit direkt im Kalender
   anzeigen – selbst wenn sie das Ereignis-Modell nicht mehr versteht.
   Es ist EINE Kopie, die überschrieben wird (nichts sammelt sich an);
   geschrieben bei jedem Start und verpflichtend vor jedem Update, aber
   nur, wenn sich wirklich etwas geändert hat. */

let archiveCache; // undefined = noch nicht gelesen

function getArchive() {
  if (archiveCache === undefined) {
    try { archiveCache = JSON.parse(localStorage.getItem(LS_ARCHIVE) || 'null'); }
    catch (e) { archiveCache = null; }
  }
  return archiveCache;
}

/* Eingefrorener Archiv-Eintrag für einen Tag – nur in der Vergangenheit
   und nur, wenn die aktuellen Daten den Tag gar nicht kennen (auch kein
   bewusstes „frei“). Normalbetrieb: nie der Fall; nach einem
   Versionsbruch: genau die Tage, die sonst verloren wären. */
function frozenFor(dayStr, assigns) {
  if (dayStr >= monthStart()) return null;
  if (assigns.has(dayStr)) return null; // aktuelle Daten haben das Sagen
  const arch = getArchive();
  return (arch && arch.days && arch.days[dayStr]) || null;
}

function writeArchiveSnapshot() {
  try {
    const assigns = computeAssignments();
    const notes = computeNotes(state.events);
    const school = computeSchool(state.events);
    const days = {};
    const touch = (day) => (days[day] = days[day] || {});
    for (const [day, a] of assigns) {
      if (!a.val) continue;
      const d = touch(day);
      d.wer = valName(a.val);
      d.farbe = valColor(a.val);
    }
    for (const [day, perAuthor] of notes) {
      const list = [...perAuthor.entries()]
        .filter(([, n]) => n.text)
        .map(([by, n]) => `${authorName(by)}: ${n.text}`);
      if (list.length) touch(day).notizen = list;
    }
    for (const [day, s] of school) {
      if (schoolEmpty(s)) continue;
      const parts = [];
      if (s.bring) parts.push(`Bringt: ${valName(s.bring)}`);
      if (s.pick) parts.push(`Holt: ${valName(s.pick)}`);
      if (s.xwho) parts.push(`⭐ ${valName(s.xwho)}${s.xnote ? ` – ${s.xnote}` : ''}`);
      touch(day).aufgaben = parts.join(' · ');
    }
    const old = getArchive();
    const today = monthStart();
    // Vergangene Tage, die nur noch das alte Archiv kennt, mitnehmen –
    // so überlebt die eingefrorene Vergangenheit jedes Neuschreiben.
    if (old && old.days) {
      for (const [day, d] of Object.entries(old.days)) {
        if (day < today && !days[day] && !assigns.has(day)) days[day] = d;
      }
    }
    if (!Object.keys(days).length && old) {
      // Einen leeren Stand (z. B. direkt nach einer Datenrettung) nie über
      // ein vorhandenes Archiv schreiben – das letzte gute Bild behalten.
      return;
    }
    const ranges = computeRanges(state.events).map((r) => ({ label: r.label, from: r.from, to: r.to }));
    if (old && old.ranges) {
      for (const r of old.ranges) {
        if (r.to < today && !ranges.some((x) => x.from === r.from && x.to === r.to && x.label === r.label)) ranges.push(r);
      }
      ranges.sort((a, b) => (a.from < b.from ? -1 : 1));
    }
    if (old && JSON.stringify(old.days) === JSON.stringify(days)
        && JSON.stringify(old.ranges) === JSON.stringify(ranges)) {
      return; // nichts geändert – Kopie bleibt wie sie ist
    }
    const payload = { v: 1, stand: Date.now(), days, ranges };
    localStorage.setItem(LS_ARCHIVE, JSON.stringify(payload));
    archiveCache = payload;
  } catch (e) { /* Archiv darf die App nie blockieren */ }
}

/* Rohe Rettungskopien als Datei sichern (nur im Menü sichtbar, wenn
   welche existieren – also nach einer Datenrettung oder einem Update). */
function exportRescues() {
  const rescues = loadRescues();
  if (!rescues.length) { toast('Keine Rettungskopien vorhanden'); return; }
  const blob = new Blob([JSON.stringify(rescues, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `wechselkalender-rettungskopie-${ymd(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Rettungskopien gespeichert');
}

/* ---------- Backup ---------- */

/* Kalender als .ics exportieren: zusammenhängende Tage derselben Seite
   werden zu ganztägigen Terminen zusammengefasst (z. B. für den
   Google-/Arbeitskalender, nur lesend). */
function exportIcs() {
  const assigns = computeAssignments();
  const days = [...assigns.keys()].filter((d) => assigns.get(d).val).sort();
  const blocks = [];
  for (const day of days) {
    const val = assigns.get(day).val;
    const last = blocks[blocks.length - 1];
    if (last && last.val === val && nextDayStr(last.to) === day) last.to = day;
    else blocks.push({ from: day, to: day, val });
  }
  const compact = (d) => d.replaceAll('-', '');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Wechselkalender//DE', 'CALSCALE:GREGORIAN'];
  for (const b of blocks) {
    lines.push('BEGIN:VEVENT',
      `UID:wk-${b.from}-${b.val}@wechselkalender`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(b.from)}`,
      `DTEND;VALUE=DATE:${compact(nextDayStr(b.to))}`,
      `SUMMARY:Kind bei ${valName(b.val)}`,
      'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  for (const r of computeRanges(state.events)) {
    lines.push('BEGIN:VEVENT',
      `UID:wk-range-${r.id}@wechselkalender`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(r.from)}`,
      `DTEND;VALUE=DATE:${compact(nextDayStr(r.to))}`,
      `SUMMARY:${r.label.replace(/[\n,;]/g, ' ')}`,
      'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `wechselkalender-${ymd(new Date())}.ics`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Kalenderdatei (.ics) erstellt');
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `wechselkalender-backup-${ymd(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Backup erstellt');
}

function importBackup() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const s = JSON.parse(reader.result);
        if (!s || s.version !== 1 || !s.events || !s.parents) throw new Error('bad');
        // Ereignisse zusammenführen statt überschreiben – sicherer.
        Object.assign(state.events, s.events);
        state.parents = ensureParentDefaults(s.parents);
        if (!state.profile.me && s.profile?.me) state.profile.me = s.profile.me;
        saveState();
        renderAll();
        toast('Backup übernommen ✓');
      } catch (e) {
        toast('Datei konnte nicht gelesen werden');
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

/* ---------- Toast ---------- */

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

/* ---------- Monatsnavigation & Gesten ---------- */

function gotoMonth(delta) {
  viewM += delta;
  while (viewM < 0) { viewM += 12; viewY--; }
  while (viewM > 11) { viewM -= 12; viewY++; }
  renderCalendar();
  renderLegend();
}

function setupSwipe() {
  let x0 = null, y0 = null;
  const grid = $('grid');
  grid.addEventListener('touchstart', (e) => {
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
  }, { passive: true });
  grid.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) gotoMonth(dx < 0 ? 1 : -1);
  }, { passive: true });
}

/* ---------- Start ---------- */

function init() {
  const now = new Date();
  viewY = now.getFullYear();
  viewM = now.getMonth();

  $('btnPrev').onclick = () => gotoMonth(-1);
  $('btnNext').onclick = () => gotoMonth(1);
  $('monthLabel').onclick = () => { viewY = now.getFullYear(); viewM = now.getMonth(); renderCalendar(); renderLegend(); };
  $('btnMenu').onclick = openMenu;
  $('btnShare').onclick = () => shareUnshared();
  $('btnUndo').onclick = () => undoLast();
  $('btnRedo').onclick = () => redoLast();

  setupSwipe();
  compactEvents();
  renderAll();

  // Eingehenden Link verarbeiten; sonst ggf. Ersteinrichtung zeigen.
  checkIncoming().then(() => {
    if (!state.profile.me && !location.hash) openSettings(true);
  });

  window.addEventListener('hashchange', () => checkIncoming());

  // Sicherheitsnetz: aktuelles Kalenderbild als Lese-Archiv ablegen.
  writeArchiveSnapshot();
  if (rescueHappened) {
    toast('Daten waren unlesbar – Rettungskopie angelegt, die Vergangenheit bleibt im Kalender sichtbar');
  }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    // Auto-Update: Übernimmt eine neue Version die Kontrolle, einmal neu
    // laden – außer der Nutzer ist gerade mitten in einem Dialog/Import.
    // Vorher schreibt die ALTE (noch laufende) Version verpflichtend
    // Archiv + Rettungskopie: kein Update ohne Schnappschuss.
    const preUpdateSnapshot = () => {
      writeArchiveSnapshot();
      pushRescue('Vor Update', JSON.stringify(state));
    };
    let hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) { hadController = true; return; } // Erstinstallation
      preUpdateSnapshot();
      if (pendingImport || !$('sheet').classList.contains('hidden')) return;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js').then((reg) => {
      // Feuert, sobald eine neue Version gefunden wird (die alte läuft noch).
      reg.addEventListener('updatefound', () => preUpdateSnapshot());
    }).catch(() => { /* offline-Cache optional */ });
  }
}

init();
