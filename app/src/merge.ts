// Merge of marks from another phone (store.ts) or from several phones on the PC sender page (sender.ts).
// Each group of fields (status / found place / tags / note) is taken from the side with the higher version
// counter of that group (Lamport style: every local change sets it to the highest one seen + 1), so a wrong
// clock on a phone does not decide which change wins. A colleague's newer status never brings back a note
// that was already cleared here, and the other way round.
// Older data has no counters: then (and on equal counters) the change time decides, as before.
// A cleared mark leaves a "cleared" time + its counters (tombstone), so an older copy from another phone does not come back.
import { MARK_GROUPS, emptyMark, hasContent, type GroupVersions, type Mark, type MarkGroup, type Marks } from './model';

export const GROUPS = Object.keys(MARK_GROUPS) as MarkGroup[];
export const GROUP_OF = new Map<string, MarkGroup>(GROUPS.flatMap(g => MARK_GROUPS[g].map(f => [f as string, g] as [string, MarkGroup])));

/** Time of the last change of a group (older data has only updatedAt). */
export const groupTime = (m: Mark, g: MarkGroup): string => m.at?.[g] ?? m.updatedAt;
/** Version counter of a group; undefined = older data without counters. */
export const groupVer = (m: Mark, g: MarkGroup): number | undefined => {
  const v = m.v?.[g];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
};
export const allGroups = (t: string): Partial<Record<MarkGroup, string>> => Object.fromEntries(GROUPS.map(g => [g, t]));

/** Counters after a local change: changed groups get +1, the others keep theirs. */
export function bumpVersions(base: GroupVersions | undefined, changed: Iterable<MarkGroup>): GroupVersions {
  const v: GroupVersions = {};
  for (const g of GROUPS) if (typeof base?.[g] === 'number') v[g] = base[g];
  for (const g of changed) v[g] = (v[g] ?? 0) + 1;
  return v;
}

/** A cleared mark as an empty mark with every group changed at the clear time. */
export const clearedMark = (t: string, v?: GroupVersions): Mark => ({ ...emptyMark(), updatedAt: t, at: allGroups(t), ...(v ? { v: { ...v } } : {}) });

/** container -> time of clearing (the only part older app versions read) */
export type Cleared = Record<string, string>;
/** container -> version counters of the cleared mark */
export type ClearedV = Record<string, GroupVersions>;

export interface MarkSet {
  marks: Marks;
  cleared: Cleared;
  clearedV?: ClearedV;
}

export interface MarksMerge {
  marks: Marks;
  cleared: Cleared;
  clearedV: ClearedV;
  updated: number;  // containers changed by the incoming data
  same: number;     // nothing new for them
  skipped: number;  // older than the port close: ignored
}

const isMark = (m: unknown): m is Mark =>
  !!m && typeof (m as Mark).updatedAt === 'string' && Array.isArray((m as Mark).tags) && typeof (m as Mark).note === 'string';

const groupValue = (m: Mark, g: MarkGroup) => JSON.stringify(MARK_GROUPS[g].map(f => m[f] ?? null));

/**
 * Does the incoming side win this group? Higher counter wins; without counters on both sides, or on equal
 * counters, the later change time; on the same time too, the larger value (so every phone picks the same one).
 */
export function incomingWins(mine: Mark, inc: Mark, g: MarkGroup): boolean {
  const va = groupVer(mine, g), vb = groupVer(inc, g);
  if (va !== undefined && vb !== undefined && va !== vb) return vb > va;
  const a = groupTime(mine, g), b = groupTime(inc, g);
  if (a !== b) return b > a;
  return groupValue(inc, g) > groupValue(mine, g);
}

/** Clean copy of the counters in an incoming object (anything not a number is dropped). */
function readVersions(x: unknown): GroupVersions | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const v: GroupVersions = {};
  for (const g of GROUPS) { const n = (x as Record<string, unknown>)[g]; if (typeof n === 'number' && Number.isFinite(n)) v[g] = n; }
  return Object.keys(v).length ? v : undefined;
}

/** Merge incoming marks (and their tombstones) into ours. Pure: returns new objects. cut = port close time ('' = none). */
export function mergeMarkSets(mine: MarkSet, inc: MarkSet, cut: string): MarksMerge {
  const marks = { ...mine.marks };
  const cleared = { ...mine.cleared };
  const clearedV: ClearedV = { ...(mine.clearedV ?? {}) };
  const incMarks = inc.marks && typeof inc.marks === 'object' ? inc.marks : {};
  const incCleared = inc.cleared && typeof inc.cleared === 'object' ? inc.cleared : {};
  const incClearedV = inc.clearedV && typeof inc.clearedV === 'object' ? inc.clearedV : {};
  let updated = 0, skipped = 0, same = 0;
  const conts = new Set([...Object.keys(incMarks), ...Object.keys(incCleared)]);
  for (const cont of conts) {
    const real = incMarks[cont];
    const realOk = isMark(real);
    const tIn = typeof incCleared[cont] === 'string' ? incCleared[cont] : '';
    const vIn = tIn ? readVersions(incClearedV[cont]) : undefined;
    const tomb = tIn ? clearedMark(tIn, vIn) : null;
    // a real mark and a cleared time for one container should not both come; the newer wins
    const incM = realOk && !(tomb && GROUPS.some(g => incomingWins(real, tomb, g))) ? real : tomb;
    if (!incM) continue;
    if (cut && incM.updatedAt < cut) { if (realOk) skipped++; continue; }
    const mineReal = marks[cont];
    const mineM = mineReal ?? (cleared[cont] ? clearedMark(cleared[cont], clearedV[cont]) : null);
    if (!mineM) {
      if (incM === real) { marks[cont] = real; updated++; }
      else { cleared[cont] = tIn; if (vIn) clearedV[cont] = vIn; }
      continue;
    }
    const out: Mark = { ...mineM, tags: [...mineM.tags], at: {}, v: {} };
    if (!mineReal) out.notInPlan = incM.notInPlan;
    let changed = false;
    for (const g of GROUPS) {
      const from: Mark = incomingWins(mineM, incM, g) ? incM : mineM;
      if (from === incM) {
        for (const f of MARK_GROUPS[g]) {
          if (JSON.stringify(mineM[f]) !== JSON.stringify(incM[f])) changed = true;
          (out as unknown as Record<string, unknown>)[f] = Array.isArray(incM[f]) ? [...(incM[f] as unknown[])] : incM[f];
        }
      }
      out.at![g] = groupTime(from, g);
      const ver = groupVer(from, g);
      if (ver !== undefined) out.v![g] = ver;
    }
    if (!Object.keys(out.v!).length) delete out.v;
    out.updatedAt = GROUPS.map(g => out.at![g] ?? '').reduce((x, y) => (y > x ? y : x), mineM.updatedAt);
    out.updatedBy = incM.updatedAt > mineM.updatedAt ? incM.updatedBy : mineM.updatedBy;
    if (!hasContent(out)) {
      delete marks[cont];
      cleared[cont] = out.updatedAt;
      if (out.v) clearedV[cont] = out.v; else delete clearedV[cont];
    } else { marks[cont] = out; delete cleared[cont]; delete clearedV[cont]; }
    if (changed) updated++; else same++;
  }
  return { marks, cleared, clearedV, updated, same, skipped };
}
