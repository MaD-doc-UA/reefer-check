// Local persistence (only on this phone), activity log and merging marks into a new plan.
import { useEffect, useState } from 'preact/hooks';
import { emptyMark, hasContent, nowIso, plugBayOf, statusOf, type LogAction, type LogEntry, type Mark, type Marks, type Plan, type Status, type Tag } from './model';
import type { TransferPayload } from './qrTransfer';

const K_PLAN = 'reefer.plan.v1';
const K_MARKS = 'reefer.marks.v1';
const K_MERGE = 'reefer.merge.v1';
const K_USER = 'reefer.user.v1';
const K_LOG = 'reefer.log.v1';
const K_SETTINGS = 'reefer.settings.v1';

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
  carried?: number;         // kept from the previous plan to discharge at the current port
}

interface State {
  plan: Plan | null;
  marks: Marks;
  lastMerge: MergeReport | null;
  user: string;
  log: LogEntry[];
  settings: Settings;
}

function load<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error('storage failed', e);
    alert('Could not save on this phone (storage full or blocked).');
  }
}

let state: State = {
  plan: load<Plan | null>(K_PLAN, null),
  marks: load<Marks>(K_MARKS, {}),
  lastMerge: load<MergeReport | null>(K_MERGE, null),
  user: load<string>(K_USER, ''),
  log: load<LogEntry[]>(K_LOG, []),
  settings: { ...DEFAULT_SETTINGS, ...load<Partial<Settings>>(K_SETTINGS, {}) },
};

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
  const user = name.trim().slice(0, 40);
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
  const plan = withCarried(plan0, old, state.marks);
  const oldSet = new Set(old?.reefers.map(r => r.cont) ?? []);
  const byCont = new Map(plan.reefers.map(r => [r.cont, r]));
  const marks: Marks = {};
  const report: MergeReport = {
    at: nowIso(), fileName: plan.fileName, total: plan.reefers.length,
    added: old ? plan.reefers.filter(r => !r.carried && !oldSet.has(r.cont)).length : plan.reefers.length,
    removedUnmarked: 0, moved: [], notInPlan: [], resolvedFound: [],
    carried: plan.reefers.filter(r => r.carried).length,
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
  addLog([{ action: 'plan', detail: `${plan.fileName}: ${plan.reefers.length - (report.carried ?? 0)} reefers` + (report.carried ? `, ${report.carried} to discharge kept from previous plan` : '') + (old ? `, ${report.moved.length} moved, ${report.notInPlan.length} not in plan` : '') }]);
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

/** Deletes plan, marks and log (the name stays). */
export function clearAll() {
  state = { ...state, plan: null, marks: {}, lastMerge: null, log: [] };
  [K_PLAN, K_MARKS, K_MERGE, K_LOG].forEach(k => { try { localStorage.removeItem(k); } catch { /* ignore */ } });
  emit();
}

// ---------------------------------------------------------------- sharing

/** Marks + log as a JSON file (backup / sharing with a colleague). */
export function exportMarks(): Blob {
  const data = { kind: 'reefer-marks', version: 2, exportedAt: nowIso(), by: state.user, plan: state.plan?.fileName ?? '', marks: state.marks, log: state.log };
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

const logKey = (e: LogEntry) => `${e.t}|${e.by}|${e.action}|${e.cont ?? ''}|${e.detail ?? ''}`;

/** Merge marks from a colleague: newer change per container wins; logs are combined. */
export function importMarks(json: string): { updated: number; logAdded: number } {
  const data = JSON.parse(json);
  if (data?.kind !== 'reefer-marks' || typeof data.marks !== 'object') throw new Error('Not a marks file.');
  return mergeMarks(data.marks as Marks, Array.isArray(data.log) ? (data.log as LogEntry[]) : [], data.by);
}

function mergeMarks(incomingMarks: Marks, incomingLog: LogEntry[], from: string | undefined): { updated: number; logAdded: number } {
  const marks = { ...state.marks };
  let updated = 0;
  for (const [cont, m] of Object.entries(incomingMarks)) {
    const mine = marks[cont];
    if (!mine || mine.updatedAt < m.updatedAt) { marks[cont] = m; updated++; }
  }
  const seen = new Set(state.log.map(logKey));
  const incoming = incomingLog.filter(e => !seen.has(logKey(e)));
  let log = [...state.log, ...incoming].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  if (log.length > LOG_MAX) log = log.slice(log.length - LOG_MAX);
  state = { ...state, marks, log };
  save(K_MARKS, marks);
  save(K_LOG, log);
  addLog([{ action: 'merge', detail: `from ${from || 'colleague'}: ${updated} containers, ${incoming.length} log lines` }]);
  emit();
  return { updated, logAdded: incoming.length };
}

/** What a QR transfer carries (see qrTransfer.ts). */
export function transferPayload(withPlan: boolean, withLog: boolean): TransferPayload {
  return {
    kind: 'reefer-qr', v: 1, by: state.user, sentAt: nowIso(),
    plan: withPlan && state.plan ? state.plan : undefined,
    marks: state.marks,
    log: withLog ? state.log : undefined,
  };
}

/** Apply a received QR transfer: the plan (if sent and different from ours), then merge the marks. */
export function applyTransfer(p: TransferPayload): { planApplied: boolean; updated: number; logAdded: number } {
  let planApplied = false;
  if (p.plan && p.plan.id !== state.plan?.id) {
    applyPlan(p.plan);
    planApplied = true;
  }
  return { planApplied, ...mergeMarks(p.marks, p.log ?? [], p.by) };
}

/** Activity log as CSV (opens in Excel). */
export function exportLogCsv(): Blob {
  const q = (s: string | undefined) => `"${(s ?? '').replace(/"/g, '""')}"`;
  const lines = ['TIME,BY,ACTION,CONTAINER,POSITION,DETAIL'];
  for (const e of state.log) {
    lines.push([q(new Date(e.t).toLocaleString('en-GB')), q(e.by), q(e.action), q(e.cont), q(e.pos), q(e.detail)].join(','));
  }
  return new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
}
