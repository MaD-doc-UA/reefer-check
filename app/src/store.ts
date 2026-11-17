// Local persistence (only on this phone), activity log and merging marks into a new plan.
import { useEffect, useState } from 'preact/hooks';
import { emptyMark, hasIssue, nowIso, plugBayOf, type LogAction, type LogEntry, type Mark, type Marks, type Plan, type Tag } from './model';

const K_PLAN = 'reefer.plan.v1';
const K_MARKS = 'reefer.marks.v1';
const K_MERGE = 'reefer.merge.v1';
const K_USER = 'reefer.user.v1';
const K_LOG = 'reefer.log.v1';
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
}

interface State {
  plan: Plan | null;
  marks: Marks;
  lastMerge: MergeReport | null;
  user: string;
  log: LogEntry[];
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
};
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
  if (!next.loaded && !hasIssue(next)) delete marks[cont];
  else marks[cont] = next;
  state = { ...state, marks };
  save(K_MARKS, marks);
}

/** Toggle "loaded" and remember the position where it was checked. */
export function toggleLoaded(cont: string, pos: string) {
  const loaded = !state.marks[cont]?.loaded;
  writeMark(cont, loaded
    ? { loaded, checkedPos: pos, movedFrom: undefined, loadedAt: nowIso(), loadedBy: state.user || '?' }
    : { loaded, checkedPos: undefined, movedFrom: undefined, loadedAt: undefined, loadedBy: undefined, foundBay: undefined, foundPos: undefined });
  addLog([{ action: loaded ? 'loaded' : 'unmarked', cont, pos }]);
  emit();
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

/** Apply a new plan and carry the marks over by container number. */
export function applyPlan(plan: Plan): MergeReport {
  const old = state.plan;
  const oldSet = new Set(old?.reefers.map(r => r.cont) ?? []);
  const byCont = new Map(plan.reefers.map(r => [r.cont, r]));
  const marks: Marks = {};
  const report: MergeReport = {
    at: nowIso(), fileName: plan.fileName, total: plan.reefers.length,
    added: old ? plan.reefers.filter(r => !oldSet.has(r.cont)).length : plan.reefers.length,
    removedUnmarked: 0, moved: [], notInPlan: [], resolvedFound: [],
  };
  if (old) report.removedUnmarked = old.reefers.filter(r => !byCont.has(r.cont) && !state.marks[r.cont]).length;

  for (const [cont, m0] of Object.entries(state.marks)) {
    const m: Mark = { ...m0 };
    const r = byCont.get(cont);
    if (!r) {
      m.notInPlan = true;
      report.notInPlan.push(cont);
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
  addLog([{ action: 'plan', detail: `${plan.fileName}: ${plan.reefers.length} reefers` + (old ? `, ${report.moved.length} moved, ${report.notInPlan.length} not in plan` : '') }]);
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
  const marks = { ...state.marks };
  let updated = 0;
  for (const [cont, m] of Object.entries(data.marks as Marks)) {
    const mine = marks[cont];
    if (!mine || mine.updatedAt < m.updatedAt) { marks[cont] = m; updated++; }
  }
  const seen = new Set(state.log.map(logKey));
  const incoming = (Array.isArray(data.log) ? (data.log as LogEntry[]) : []).filter(e => !seen.has(logKey(e)));
  let log = [...state.log, ...incoming].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  if (log.length > LOG_MAX) log = log.slice(log.length - LOG_MAX);
  state = { ...state, marks, log };
  save(K_MARKS, marks);
  save(K_LOG, log);
  addLog([{ action: 'merge', detail: `from ${data.by || 'colleague'}: ${updated} containers, ${incoming.length} log lines` }]);
  emit();
  return { updated, logAdded: incoming.length };
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
