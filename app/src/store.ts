// Local persistence (only on this phone), activity log and merging marks into a new plan.
import { useEffect, useState } from 'preact/hooks';
import { emptyMark, hasContent, logCsv, nowIso, plugBayOf, statusOf, type LogAction, type LogEntry, type Mark, type Marks, type Plan, type Status, type Tag } from './model';
import type { TransferPayload } from './qrTransfer';

const K_PLAN = 'reefer.plan.v1';
const K_MARKS = 'reefer.marks.v1';
const K_MERGE = 'reefer.merge.v1';
const K_USER = 'reefer.user.v1';
const K_LOG = 'reefer.log.v1';
const K_SETTINGS = 'reefer.settings.v1';
const K_PORT = 'reefer.port.v1';       // time this phone closed the last port (ISO)
const K_ARCHIVE = 'reefer.archive.v1'; // closed ports: marks + log
const ARCHIVE_MAX = 3;

export interface Settings {
  remindHours: number; // reminder after "disconnected" without "discharged"
}
const DEFAULT_SETTINGS: Settings = { remindHours: 2 };
const LOG_MAX = 20000;

export interface MergeReport {
  at: string;
  fileName: string;
  total: number;
  added: number;            // containers new in this plan
  removedUnmarked: number;  // dropped from the plan, had no marks
  moved: { cont: string; from: string; to: string }[];   // marked, position changed
  notInPlan: string[];      // marked, no longer in the plan
  resolvedFound: string[];  // "found in bay X / position" now matches the plan
  dischargedGone?: number;  // confirmed discharged and no longer in the plan (expected, not a problem)
  carried?: number;         // only in the arrival plan (DISCHARGE sheet or previous plan): to discharge
  fromArrival?: boolean;    // carried come from the DISCHARGE sheet of the file
}

/** Marks and log of a port closed on this phone (kept for saving later). */
export interface ArchivedPort {
  port: string;
  closedAt: string;
  closedBy: string;
  fileName: string;
  marks: Marks;
  log: LogEntry[];
  /** the user said its log is on the PC (or sent it before closing): the "For the PC" card is gone */
  pcDone?: boolean;
}

interface State {
  plan: Plan | null;
  marks: Marks;
  lastMerge: MergeReport | null;
  user: string;
  log: LogEntry[];
  settings: Settings;
  /** this phone closed a port at this time: older marks / log lines are not merged in again */
  since: string | null;
  /** port closed at `since` (the open plan may still be of that port until the next plan comes) */
  closedPort: string;
  archive: ArchivedPort[];
  /** characters this app keeps in localStorage */
  storageUsed: number;
  /** last failed save (shown as a red banner until dismissed) */
  storageError: string;
}

/** Characters stored per key (localStorage is limited to about 5 million per site on phones). */
const sizes: Record<string, number> = {};
export const STORAGE_LIMIT = 5_000_000;
/** Percent of the usual phone limit (some browsers allow more, so it is capped at 99). */
export const storagePercent = (used: number) => Math.min(99, Math.round(used / STORAGE_LIMIT * 100));
const usedChars = () => Object.values(sizes).reduce((a, b) => a + b, 0);

function load<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    sizes[key] = s ? s.length + key.length : 0;
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Writes one key; false (and a red banner) if the phone refused. */
function store(key: string, json: string): boolean {
  try {
    localStorage.setItem(key, json);
    sizes[key] = json.length + key.length;
    state = { ...state, storageUsed: usedChars() };
    return true;
  } catch (e) {
    console.error('storage failed', e);
    state = { ...state, storageError: 'Could not save on this phone (storage full or blocked). The last change may be lost if the app is closed. Save the marks file and the log CSV now.' };
    return false;
  }
}

function save(key: string, value: unknown) {
  store(key, JSON.stringify(value));
}

function drop(key: string) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
  sizes[key] = 0;
}

let state: State = {
  plan: load<Plan | null>(K_PLAN, null),
  marks: load<Marks>(K_MARKS, {}),
  lastMerge: load<MergeReport | null>(K_MERGE, null),
  user: load<string>(K_USER, ''),
  log: load<LogEntry[]>(K_LOG, []),
  settings: { ...DEFAULT_SETTINGS, ...load<Partial<Settings>>(K_SETTINGS, {}) },
  since: load<{ at?: string } | null>(K_PORT, null)?.at ?? null,
  closedPort: load<{ port?: string } | null>(K_PORT, null)?.port ?? '',
  archive: load<ArchivedPort[]>(K_ARCHIVE, []),
  storageUsed: 0,
  storageError: '',
};
state.storageUsed = usedChars();

export function dismissStorageError() {
  state = { ...state, storageError: '' };
  emit();
}

/** true / false = the browser will / may evict our data; null = cannot tell. */
export async function storagePersisted(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persisted) return null;
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return null;
  }
}

export function setRemindHours(h: number) {
  const settings = { ...state.settings, remindHours: h };
  state = { ...state, settings };
  save(K_SETTINGS, settings);
  emit();
}
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach(l => l());
}

export function useStore(): State {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick(t => t + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return state;
}

export function getState(): State {
  return state;
}

// ---------------------------------------------------------------- user + log

export function setUser(name: string) {
  const user = name.trim().replace(/\s+/g, ' ').slice(0, 60);
  state = { ...state, user };
  save(K_USER, user);
  emit();
}

function addLog(entries: Omit<LogEntry, 't' | 'by'>[]) {
  if (!entries.length) return;
  const t = nowIso();
  const by = state.user || '?';
  let log = [...state.log, ...entries.map(e => ({ t, by, ...e }))];
  if (log.length > LOG_MAX) log = log.slice(log.length - LOG_MAX);
  state = { ...state, log };
  save(K_LOG, log);
}

function planPos(cont: string): string | undefined {
  return state.plan?.reefers.find(r => r.cont === cont)?.pos;
}

// ---------------------------------------------------------------- marks

function writeMark(cont: string, change: Partial<Mark>) {
  const prev = state.marks[cont] ?? emptyMark();
  const next: Mark = { ...prev, ...change, updatedAt: nowIso(), updatedBy: state.user || '?' };
  const marks = { ...state.marks };
  if (!hasContent(next)) delete marks[cont];
  else marks[cont] = next;
  state = { ...state, marks };
  save(K_MARKS, marks);
}

/**
 * Set the status of a reefer (undefined = clear it).
 * pos = planned position now, remembered as the checked position when connecting.
 */
export function setStatus(cont: string, pos: string, status: Status | undefined) {
  const by = state.user || '?';
  const t = nowIso();
  const prev = statusOf(state.marks[cont]);
  if (prev === status) return;
  let change: Partial<Mark>;
  switch (status) {
    case 'connected':
      change = { status, loaded: true, checkedPos: pos, movedFrom: undefined, loadedAt: t, loadedBy: by };
      break;
    case 'disconnected':
      change = { status, loaded: false, disconnectedAt: t, disconnectedBy: by, dischargedAt: undefined, dischargedBy: undefined };
      break;
    case 'discharged':
      change = { status, loaded: false, dischargedAt: t, dischargedBy: by };
      break;
    default:
      change = {
        status: undefined, loaded: false, checkedPos: undefined, movedFrom: undefined, loadedAt: undefined, loadedBy: undefined,
        disconnectedAt: undefined, disconnectedBy: undefined, dischargedAt: undefined, dischargedBy: undefined,
        foundBay: undefined, foundPos: undefined,
      };
  }
  writeMark(cont, change);
  addLog([{ action: status ?? 'unmarked', cont, pos, detail: prev ? `was ${prev}` : undefined }]);
  emit();
}

/** Toggle "connected" (loading mode). */
export function toggleLoaded(cont: string, pos: string) {
  setStatus(cont, pos, statusOf(state.marks[cont]) === 'connected' ? undefined : 'connected');
}

/**
 * Container physically found in another place than planned.
 * bay = bay group, pos = exact position if known. Found in the planned slot = plain "loaded".
 */
export function markFound(cont: string, plannedPos: string, bay: number, pos?: string) {
  const plannedBay = plugBayOf(+plannedPos.slice(0, 2));
  const samePlace = pos ? pos === plannedPos : bay === plannedBay;
  const cur = state.marks[cont];
  writeMark(cont, {
    loaded: true,
    status: 'connected',
    loadedAt: cur?.loaded ? cur.loadedAt : nowIso(),
    loadedBy: cur?.loaded ? cur.loadedBy : state.user || '?',
    foundBay: samePlace ? undefined : bay,
    foundPos: samePlace ? undefined : pos,
    checkedPos: samePlace ? plannedPos : undefined,
    movedFrom: undefined,
  });
  addLog([{ action: 'found', cont, pos: plannedPos, detail: samePlace ? 'as planned' : pos ? `at ${pos}` : `in bay ${String(bay).padStart(2, '0')}` }]);
  emit();
}

export function setTags(cont: string, tags: Tag[]) {
  const before = state.marks[cont]?.tags ?? [];
  writeMark(cont, { tags });
  addLog([
    ...tags.filter(t => !before.includes(t)).map(t => ({ action: 'tag+' as LogAction, cont, pos: planPos(cont), detail: t })),
    ...before.filter(t => !tags.includes(t)).map(t => ({ action: 'tag-' as LogAction, cont, pos: planPos(cont), detail: t })),
  ]);
  emit();
}

export function setNote(cont: string, note: string) {
  if ((state.marks[cont]?.note ?? '') === note) return;
  writeMark(cont, { note });
  addLog([{ action: 'note', cont, pos: planPos(cont), detail: note }]);
  emit();
}

/**
 * The loading plan from the planner no longer has the reefers to discharge here, but they are still on board.
 * Keep them from the previous (arrival) plan: POD = current port, not in the new plan, not yet discharged.
 * They are shown in DISCH mode only, at their old position, until discharged (then the next plan drops them).
 */
function withCarried(plan: Plan, old: Plan | null, marks: Marks): Plan {
  if (!old) return plan;
  const port = plan.currentPort || old.currentPort;
  if (!port) return plan;
  const inNew = new Set(plan.reefers.map(r => r.cont));
  const carried = old.reefers
    .filter(r => !inNew.has(r.cont) && r.pod === port && statusOf(marks[r.cont]) !== 'discharged')
    .map(r => ({ ...r, carried: true }));
  if (!carried.length) return plan;
  return { ...plan, reefers: [...plan.reefers, ...carried] };
}

/** Drop the reefers kept from the previous plan (the officer says discharge is over). */
export function dropCarried() {
  const plan = state.plan;
  if (!plan) return;
  const gone = plan.reefers.filter(r => r.carried).map(r => r.cont);
  const next = { ...plan, reefers: plan.reefers.filter(r => !r.carried) };
  const marks = { ...state.marks };
  for (const c of gone) if (marks[c]) marks[c] = { ...marks[c], notInPlan: statusOf(marks[c]) !== 'discharged' };
  for (const c of gone) if (marks[c] && statusOf(marks[c]) === 'discharged') delete marks[c];
  state = { ...state, plan: next, marks };
  save(K_PLAN, next);
  save(K_MARKS, marks);
  addLog([{ action: 'plan', detail: `discharge list from previous plan closed (${gone.length} reefers)` }]);
  emit();
}

/** Apply a new plan and carry the marks over by container number. */
export function applyPlan(plan0: Plan): MergeReport {
  const old = state.plan;
  // files with the arrival plan (DISCHARGE) bring their own discharge list; older files: carry from the previous plan
  const plan = plan0.hasArrival ? plan0 : withCarried(plan0, old, state.marks);
  const oldSet = new Set(old?.reefers.map(r => r.cont) ?? []);
  const byCont = new Map(plan.reefers.map(r => [r.cont, r]));
  const marks: Marks = {};
  const report: MergeReport = {
    at: nowIso(), fileName: plan.fileName, total: plan.reefers.length,
    added: old ? plan.reefers.filter(r => !r.carried && !oldSet.has(r.cont)).length : plan.reefers.length,
    removedUnmarked: 0, moved: [], notInPlan: [], resolvedFound: [],
    carried: plan.reefers.filter(r => r.carried).length,
    fromArrival: !!plan.hasArrival,
  };
  if (old) report.removedUnmarked = old.reefers.filter(r => !byCont.has(r.cont) && !state.marks[r.cont]).length;

  for (const [cont, m0] of Object.entries(state.marks)) {
    const m: Mark = { ...m0 };
    const r = byCont.get(cont);
    const st = statusOf(m);
    if (!r) {
      if (st === 'discharged') {
        // confirmed off board and gone from the plan: expected, keep only the log
        report.dischargedGone = (report.dischargedGone ?? 0) + 1;
        continue;
      }
      m.notInPlan = true;
      report.notInPlan.push(cont);
    } else if (st === 'disconnected' || st === 'discharged') {
      // being discharged / restowed: the new position does not matter yet
      m.notInPlan = false;
      m.movedFrom = undefined;
    } else {
      m.notInPlan = false;
      if (m.foundBay !== undefined) {
        // seen in another place than planned: resolved when the new plan agrees with what we saw
        const agrees = m.foundPos ? m.foundPos === r.pos : m.foundBay === r.plugBay;
        if (agrees) {
          m.foundBay = undefined;
          m.foundPos = undefined;
          m.checkedPos = r.pos;
          m.movedFrom = undefined;
          report.resolvedFound.push(cont);
        }
      } else if (m.checkedPos && m.checkedPos !== r.pos) {
        m.movedFrom = m.checkedPos;
        report.moved.push({ cont, from: m.checkedPos, to: r.pos });
      } else if (m.checkedPos === r.pos) {
        m.movedFrom = undefined;
      }
    }
    marks[cont] = m;
  }
  state = { ...state, plan, marks, lastMerge: old ? report : null };
  save(K_PLAN, plan);
  save(K_MARKS, marks);
  save(K_MERGE, state.lastMerge);
  addLog([{ action: 'plan', detail: `${plan.fileName}: ${plan.reefers.length - (report.carried ?? 0)} reefers` + (report.carried ? `, ${report.carried} to discharge ${plan.hasArrival ? 'from the arrival plan' : 'kept from previous plan'}` : '') + (old ? `, ${report.moved.length} moved, ${report.notInPlan.length} not in plan` : '') }]);
  emit();
  return report;
}

export function dismissMerge() {
  state = { ...state, lastMerge: null };
  save(K_MERGE, null);
  emit();
}

export function forgetNotInPlan(cont: string) {
  const marks = { ...state.marks };
  delete marks[cont];
  state = { ...state, marks };
  save(K_MARKS, marks);
  addLog([{ action: 'remove', cont, detail: 'not in plan, removed from list' }]);
  emit();
}

/** Reset this phone: deletes plan, marks, log and closed-port archive (the name and settings stay). */
export function clearAll() {
  [K_PLAN, K_MARKS, K_MERGE, K_LOG, K_PORT, K_ARCHIVE].forEach(drop);
  state = { ...state, plan: null, marks: {}, lastMerge: null, log: [], since: null, closedPort: '', archive: [], storageError: '', storageUsed: usedChars() };
  emit();
}

/** Everything a reset deletes, as one file. "Merge marks file" reads its marks and log back. */
export function exportBackup(): Blob {
  const data = {
    kind: 'reefer-marks', version: 2, backup: true, exportedAt: nowIso(), by: state.user, plan: state.plan?.fileName ?? '',
    marks: state.marks, log: state.log, archive: state.archive,
  };
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

/**
 * Marks and log of the open port only: what was marked before the last port close (on this phone or
 * CLOSE PORT in Excel) is not passed on, so a colleague never gets old ports back.
 */
function currentSession(): { marks: Marks; log: LogEntry[] } {
  const cut = cutoffTime();
  if (!cut) return { marks: state.marks, log: state.log };
  const marks: Marks = {};
  for (const [c, m] of Object.entries(state.marks)) if (m.updatedAt >= cut) marks[c] = m;
  return { marks, log: state.log.filter(e => e.t >= cut) };
}

// ---------------------------------------------------------------- sharing

/** Marks + log as a JSON file (backup / sharing with a colleague). */
export function exportMarks(): Blob {
  const data = { kind: 'reefer-marks', version: 2, exportedAt: nowIso(), by: state.user, plan: state.plan?.fileName ?? '', ...currentSession() };
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

const logKey = (e: LogEntry) => `${e.t}|${e.by}|${e.action}|${e.cont ?? ''}|${e.detail ?? ''}`;

/** Merge marks from a colleague: newer change per container wins; logs are combined. */
export interface MergeResult {
  updated: number;   // containers taken from the file (newer than ours)
  same: number;      // already the same or newer on this phone
  logAdded: number;
  skipped: number;   // older than the last port close: ignored
  cutoff: string;    // that port close time ('' = none)
}

/** Merge a marks file (Save marks file, archived port, backup) from a colleague or this phone. */
export function importMarks(json: string): MergeResult & { by: string; port?: string } {
  let data;
  try { data = JSON.parse(json); } catch { throw new Error('This is not a marks file (not readable as JSON).'); }
  if (data?.kind === 'reefer-qr') throw new Error('This is a QR transfer, not a marks file.');
  if (data?.kind !== 'reefer-marks' || typeof data.marks !== 'object') throw new Error('This is not a marks file of this app.');
  const by = String(data.by || '');
  return { ...mergeMarks(data.marks as Marks, Array.isArray(data.log) ? (data.log as LogEntry[]) : [], by), by, port: data.port };
}

/** Marks / log lines older than this belong to a closed port (closed on this phone, or CLOSE PORT in Excel). */
export function cutoffTime(): string {
  const a = state.since ?? '', b = state.plan?.cutoff ?? '';
  return a > b ? a : b;
}

function mergeMarks(incomingMarks: Marks, incomingLog: LogEntry[], from: string | undefined): MergeResult {
  const marks = { ...state.marks };
  const cut = cutoffTime();
  let updated = 0, skipped = 0, same = 0;
  for (const [cont, m] of Object.entries(incomingMarks)) {
    if (!m || typeof m.updatedAt !== 'string') continue;
    if (cut && m.updatedAt < cut) { skipped++; continue; }
    const mine = marks[cont];
    if (!mine || mine.updatedAt < m.updatedAt) { marks[cont] = m; updated++; } else same++;
  }
  const seen = new Set(state.log.map(logKey));
  const incoming = incomingLog.filter(e => !seen.has(logKey(e)) && !(cut && e.t < cut));
  let log = [...state.log, ...incoming].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  if (log.length > LOG_MAX) log = log.slice(log.length - LOG_MAX);
  state = { ...state, marks, log };
  save(K_MARKS, marks);
  save(K_LOG, log);
  addLog([{ action: 'merge', detail: `from ${from || 'colleague'}: ${updated} containers, ${incoming.length} log lines` + (skipped ? `, ${skipped} marks of a closed port ignored` : '') }]);
  emit();
  return { updated, same, logAdded: incoming.length, skipped, cutoff: cut };
}

/** What a QR transfer carries (see qrTransfer.ts). */
export function transferPayload(withPlan: boolean, withLog: boolean): TransferPayload {
  const cur = currentSession();
  return {
    kind: 'reefer-qr', v: 1, by: state.user, sentAt: nowIso(),
    plan: withPlan && state.plan ? state.plan : undefined,
    marks: cur.marks,
    log: withLog ? cur.log : undefined,
  };
}

/**
 * Apply a received QR transfer: the plan (if sent, different from ours and not of a port closed here), then merge the marks.
 * closeOld: the plan is for another port and the user chose to close the open port first.
 */
export function applyTransfer(p: TransferPayload, closeOld = false): { planApplied: boolean; oldPlan: boolean } & MergeResult {
  let planApplied = false;
  const oldPlan = !!p.plan && isOlderPortPlan(p.plan);
  if (p.plan && p.plan.id !== state.plan?.id && !oldPlan) {
    if (closeOld && !closePort(p.plan)) return { planApplied, oldPlan, updated: 0, same: 0, logAdded: 0, skipped: 0, cutoff: '' };
    applyPlan(p.plan);
    planApplied = true;
  }
  return { planApplied, oldPlan, ...mergeMarks(p.marks, p.log ?? [], p.by) };
}

// ---------------------------------------------------------------- close port

const samePort = (a?: string, b?: string) => (a ?? '').trim().toUpperCase() === (b ?? '').trim().toUpperCase();

/** The plan is for another port than the open one and this phone has marks or log lines of the open port. */
export function portChangeOf(next: Plan): { from: string; to: string } | null {
  const cur = state.plan;
  if (!cur || !cur.currentPort || !next.currentPort || samePort(cur.currentPort, next.currentPort)) return null;
  if (state.closedPort && samePort(state.closedPort, cur.currentPort)) return null; // closed already (button)
  if (!Object.keys(state.marks).length && !state.log.some(e => e.cont)) return null;
  return { from: cur.currentPort, to: next.currentPort };
}

/** A plan of another port made before this phone closed its port (e.g. from a colleague who has not closed yet). */
export function isOlderPortPlan(p: Plan): boolean {
  return !!state.since && !samePort(p.currentPort, state.plan?.currentPort) && (p.exportedAt ?? p.importedAt) < state.since;
}

function saveArchive(list: ArchivedPort[]): ArchivedPort[] | null {
  for (let n = list.length; n >= 1; n--) {
    try {
      const json = JSON.stringify(list.slice(0, n));
      localStorage.setItem(K_ARCHIVE, json);
      sizes[K_ARCHIVE] = json.length + K_ARCHIVE.length;
      return list.slice(0, n);
    } catch { /* too big: drop the oldest */ }
  }
  return null;
}

/**
 * Close the open port on this phone: its marks and log go to the archive (last 3 ports), the working
 * marks and log are cleared. Reefers still on board (in `next`, or the open plan) keep their status
 * (connected / disconnected), found place, tags and notes, stamped with the close time, so Excel (PhoneCutoff) takes them for the next port.
 * Returns null (nothing changed) if the archive could not be saved.
 */
export function closePort(next?: Plan): ArchivedPort | null {
  const cur = state.plan;
  const t = nowIso();
  const entry: ArchivedPort = {
    port: cur?.currentPort || '?', closedAt: t, closedBy: state.user || '?', fileName: cur?.fileName ?? '',
    marks: state.marks, log: state.log,
  };
  const archive = saveArchive([entry, ...state.archive].slice(0, ARCHIVE_MAX));
  if (!archive) {
    state = { ...state, storageError: 'Could not close the port: no room to archive it on this phone. Save the marks file and the log CSV, delete old archives (Plan tab), then try again.' };
    emit();
    return null;
  }
  const onBoard = new Set((next ?? cur)?.reefers.map(r => r.cont) ?? []);
  const marks: Marks = {};
  for (const [c, m] of Object.entries(state.marks)) {
    if (!onBoard.has(c)) continue;
    const st = statusOf(m);
    // still on board: a connected (or disconnected) reefer stays so at the next port; discharged ones start clean
    const keepStatus = st === 'connected' || st === 'disconnected';
    if (!keepStatus && !m.tags.length && !m.note.trim()) continue;
    marks[c] = keepStatus
      ? { ...m, tags: [...m.tags], movedFrom: undefined, notInPlan: undefined, updatedAt: t }
      : { ...emptyMark(), tags: [...m.tags], note: m.note, updatedAt: t, updatedBy: m.updatedBy };
  }
  state = { ...state, marks, log: [], since: t, closedPort: entry.port, archive, lastMerge: null };
  save(K_MARKS, marks);
  save(K_LOG, []);
  save(K_PORT, { at: t, port: entry.port });
  save(K_MERGE, null);
  addLog([{ action: 'port', detail: `closed ${entry.port}: ${Object.keys(entry.marks).length} marks and ${entry.log.length} log lines archived, ${Object.keys(marks).length} reefers on board kept` }]);
  emit();
  return entry;
}

export function setArchivePcDone(closedAt: string) {
  const archive = state.archive.map(a => a.closedAt === closedAt ? { ...a, pcDone: true } : a);
  state = { ...state, archive };
  save(K_ARCHIVE, archive);
  emit();
}

export function deleteArchived(closedAt: string) {
  const archive = state.archive.filter(a => a.closedAt !== closedAt);
  state = { ...state, archive };
  save(K_ARCHIVE, archive);
  emit();
}

/** Archived marks as a marks file (the PC sender page and "Merge marks file" read it). */
export function archivedMarksBlob(a: ArchivedPort): Blob {
  const data = { kind: 'reefer-marks', version: 2, exportedAt: nowIso(), by: state.user, plan: a.fileName, port: a.port, closedAt: a.closedAt, marks: a.marks, log: a.log };
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

export function archivedLogCsv(a: ArchivedPort): Blob {
  return new Blob([logCsv(a.log)], { type: 'text/csv;charset=utf-8' });
}

/** Activity log as CSV (opens in Excel). */
export function exportLogCsv(): Blob {
  return new Blob([logCsv(state.log)], { type: 'text/csv;charset=utf-8' });
}
