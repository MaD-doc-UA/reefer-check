// Merge of marks from another phone (store.ts) or from several phones on the PC sender page (sender.ts).
// Each group of fields (status / found place / tags / note) is taken from the side that changed it last,
// so a colleague's newer status never brings back a note that was already cleared here, and the other way round.
// A cleared mark leaves a "cleared" time (tombstone), so an older copy from another phone does not come back.
import { MARK_GROUPS, emptyMark, hasContent, type Mark, type MarkGroup, type Marks } from './model';

export const GROUPS = Object.keys(MARK_GROUPS) as MarkGroup[];
export const GROUP_OF = new Map<string, MarkGroup>(GROUPS.flatMap(g => MARK_GROUPS[g].map(f => [f as string, g] as [string, MarkGroup])));

/** Time of the last change of a group (older data has only updatedAt). */
export const groupTime = (m: Mark, g: MarkGroup): string => m.at?.[g] ?? m.updatedAt;
export const allGroups = (t: string): Partial<Record<MarkGroup, string>> => Object.fromEntries(GROUPS.map(g => [g, t]));
/** A cleared mark as an empty mark with every group changed at the clear time. */
export const clearedMark = (t: string): Mark => ({ ...emptyMark(), updatedAt: t, at: allGroups(t) });

export type Cleared = Record<string, string>;

export interface MarksMerge {
  marks: Marks;
  cleared: Cleared;
  updated: number;  // containers changed by the incoming data
  same: number;     // nothing new for them
  skipped: number;  // older than the port close: ignored
}

const isMark = (m: unknown): m is Mark =>
  !!m && typeof (m as Mark).updatedAt === 'string' && Array.isArray((m as Mark).tags) && typeof (m as Mark).note === 'string';

/** Merge incoming marks (and their cleared times) into ours. Pure: returns new objects. cut = port close time ('' = none). */
export function mergeMarkSets(mineMarks: Marks, mineCleared: Cleared, incMarks: Marks, incCleared: Cleared, cut: string): MarksMerge {
  const marks = { ...mineMarks };
  const cleared = { ...mineCleared };
  let updated = 0, skipped = 0, same = 0;
  const conts = new Set([...Object.keys(incMarks ?? {}), ...Object.keys(incCleared ?? {})]);
  for (const cont of conts) {
    const real = incMarks?.[cont];
    const realOk = isMark(real);
    const tIn = typeof incCleared?.[cont] === 'string' ? incCleared[cont] : '';
    // a real mark and a cleared time for one container should not both come; the newer wins
    const inc = realOk && !(tIn > real.updatedAt) ? real : tIn ? clearedMark(tIn) : null;
    if (!inc) continue;
    if (cut && inc.updatedAt < cut) { if (realOk) skipped++; continue; }
    const mineReal = marks[cont];
    const mine = mineReal ?? (cleared[cont] ? clearedMark(cleared[cont]) : null);
    if (!mine) {
      if (inc === real) { marks[cont] = real; updated++; } else cleared[cont] = tIn;
      continue;
    }
    const out: Mark = { ...mine, tags: [...mine.tags], at: {} };
    if (!mineReal) out.notInPlan = inc.notInPlan;
    let changed = false;
    for (const g of GROUPS) {
      const a = groupTime(mine, g), b = groupTime(inc, g);
      if (b > a) {
        for (const f of MARK_GROUPS[g]) {
          if (JSON.stringify(mine[f]) !== JSON.stringify(inc[f])) changed = true;
          (out as unknown as Record<string, unknown>)[f] = Array.isArray(inc[f]) ? [...(inc[f] as unknown[])] : inc[f];
        }
        out.at![g] = b;
      } else out.at![g] = a;
    }
    out.updatedAt = GROUPS.map(g => out.at![g] ?? '').reduce((x, y) => (y > x ? y : x), mine.updatedAt);
    out.updatedBy = inc.updatedAt > mine.updatedAt ? inc.updatedBy : mine.updatedBy;
    if (!hasContent(out)) { delete marks[cont]; cleared[cont] = out.updatedAt; }
    else { marks[cont] = out; delete cleared[cont]; }
    if (changed) updated++; else same++;
  }
  return { marks, cleared, updated, same, skipped };
}
