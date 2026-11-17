// Data model shared by the parser, the store and the UI.

export type SpecialType = 'CT' | 'CA' | 'PHARMA' | '';

export interface Reefer {
  cont: string;          // full container number, e.g. MNBU3595375 (key for marks)
  pos: string;           // BBRRTT, 6 digits
  bay: number;           // physical bay from the position (odd = 20')
  row: number;
  tier: number;
  plugBay: number;       // bay group (even), same as the bay sheet in Excel
  deck: boolean;
  pol: string;
  pod: string;
  temp: number | null;   // BAP set point
  manTemp: number | null;// manifest set point
  tempDiff: boolean;
  vent: number | null;
  hum: number | null;
  o2: number | null;
  co2: number | null;
  special: SpecialType | string; // type from Special sheet ('' = none)
  attention: string | null;      // note from ATTENTION sheet (null = not listed)
  posNote: string;               // note from Notes sheet (e.g. PIGTAIL)
  restow: string;                // '' | AUTO | PLANNER | ABOVE PLANNER
}

export interface Plan {
  id: string;            // file name + import time
  fileName: string;
  importedAt: string;
  currentPort: string;
  ports: string[];       // voyage order where known
  reefers: Reefer[];
  slots: string[];       // all valid reefer positions (sheet positions), for drawing empty plugs
}

export type Tag = 'problem' | 'out of range' | 'alarm' | 'no power' | 'damaged';
export const TAGS: Tag[] = ['problem', 'out of range', 'alarm', 'no power', 'damaged'];

export interface Mark {
  loaded: boolean;
  checkedPos?: string;   // position where the container was seen when marked
  foundBay?: number;     // bay group where it was physically found (if not the planned one)
  foundPos?: string;     // exact position where it was found (optional, BBRRTT)
  tags: Tag[];
  note: string;
  updatedAt: string;
  updatedBy?: string;
  loadedAt?: string;
  loadedBy?: string;
  // filled by the merge when a new plan arrives
  movedFrom?: string;    // planned position before the new plan
  notInPlan?: boolean;   // marked container no longer in the plan
}

export type Marks = Record<string, Mark>;

export type LogAction = 'loaded' | 'unmarked' | 'found' | 'tag+' | 'tag-' | 'note' | 'plan' | 'merge' | 'remove';

/** One line of the activity log (who did what and when). */
export interface LogEntry {
  t: string;        // ISO time
  by: string;       // name typed on this phone (not an account)
  action: LogAction;
  cont?: string;
  pos?: string;     // planned position at that moment
  detail?: string;
}

/** Bay groups exactly as the Excel bay sheets. */
export const BAY_GROUPS: number[] = [2, 6, 10, 14, 18, 22, 26, 30, 34, 38, 42, 46, 50, 54, 58, 62, 66];

export const ROWS_ORDER = [14, 12, 10, 8, 6, 4, 2, 1, 3, 5, 7, 9, 11, 13];
export const DECK_TIERS = [84, 82, 80];
export const HOLD_TIERS = [12, 10, 8, 6, 4, 2];

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function bayGroupLabel(g: number): string {
  if (g === 58 || g === 66) return pad2(g);
  return `${pad2(g)}.${pad2(g + 1)}`;
}

/** Plug bay (bay group) for any bay number - same rule as LOADING col P. */
export function plugBayOf(bay: number): number {
  if (bay % 2 === 0) return bay;
  return bay % 4 === 1 ? bay + 1 : bay - 1;
}

export function parsePos(pos: string): { bay: number; row: number; tier: number } {
  const p = pos.padStart(6, '0').slice(-6);
  return { bay: +p.slice(0, 2), row: +p.slice(2, 4), tier: +p.slice(4, 6) };
}

/** 20' slot side relative to the 40' bay: fore (lower bay no.) or aft. */
export function side20(bay: number, plugBay: number): 'fore' | 'aft' | null {
  if (bay % 2 === 0) return null;
  return bay < plugBay ? 'fore' : 'aft';
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function emptyMark(): Mark {
  return { loaded: false, tags: [], note: '', updatedAt: nowIso() };
}

export function hasIssue(m: Mark | undefined): boolean {
  return !!m && (m.tags.length > 0 || m.note.trim() !== '' || m.foundBay !== undefined || !!m.movedFrom || !!m.notInPlan);
}
