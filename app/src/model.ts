// Data model shared by the parser, the store and the UI.

export type SpecialType = 'CT' | 'CA' | 'PHARMA' | 'SF' | '';

export interface Reefer {
  cont: string;          // full container number, e.g. ABCU1234567 (key for marks)
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
  posNote: string;               // note from Notes sheet (any position note)
  restow: string;                // '' | AUTO | PLANNER | ABOVE PLANNER
  /** only in the arrival plan (DISCHARGE sheet, or the previous plan for old files): to discharge, not in the final plan */
  carried?: boolean;
  /** position in the arrival plan when it differs from pos (restow / moved) */
  arrPos?: string;
  /** POL in the arrival plan when the final plan gives it the current port as POL (restow re-planned by the planner) */
  arrPol?: string;
}

export interface Plan {
  id: string;            // file name + import time
  fileName: string;
  importedAt: string;
  currentPort: string;
  ports: string[];       // voyage order where known
  reefers: Reefer[];
  slots: string[];       // all valid reefer positions (sheet positions), for drawing empty plugs
  /** the file had the arrival plan (sheet DISCHARGE, workbook v24+): carried reefers come from it */
  hasArrival?: boolean;
  /** EXPORT TO PHONE file: time of the export (ISO) */
  exportedAt?: string;
  /** last CLOSE PORT in Excel (ISO): phone data older than this belongs to a closed port */
  cutoff?: string;
}

export type Tag = 'problem' | 'out of range' | 'alarm' | 'no power' | 'damaged';
export const TAGS: Tag[] = ['problem', 'out of range', 'alarm', 'no power', 'damaged'];

/**
 * Life of a reefer at the electro team's hands:
 * connected (on board, plugged in) -> disconnected (unplugged, still on board) -> discharged (gone).
 * A restowed reefer can go discharged -> connected again.
 */
export type Status = 'connected' | 'disconnected' | 'discharged';

export interface Mark {
  /** true only while status is 'connected' (kept for older data and simple checks) */
  loaded: boolean;
  status?: Status;
  disconnectedAt?: string;
  disconnectedBy?: string;
  dischargedAt?: string;
  dischargedBy?: string;
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
  /**
   * Time of the last change per group of fields (status / found place / tags / note).
   * Missing group = updatedAt (older data). Decides a merge only when the counters below cannot.
   */
  at?: Partial<Record<MarkGroup, string>>;
  /**
   * Version counter per group (Lamport): every change of a group sets it one above the highest seen,
   * so a merge takes each group from the later change whatever the phone clocks say. Missing = older data.
   */
  v?: GroupVersions;
}

export type MarkGroup = 'st' | 'found' | 'tags' | 'note';
export type GroupVersions = Partial<Record<MarkGroup, number>>;

/** Fields of each group (notInPlan is not here: every phone works it out from its own plan). */
export const MARK_GROUPS: Record<MarkGroup, (keyof Mark)[]> = {
  st: ['loaded', 'status', 'checkedPos', 'loadedAt', 'loadedBy', 'disconnectedAt', 'disconnectedBy', 'dischargedAt', 'dischargedBy', 'movedFrom'],
  found: ['foundBay', 'foundPos'],
  tags: ['tags'],
  note: ['note'],
};

export type Marks = Record<string, Mark>;

export type LogAction =
  | 'loaded' | 'connected' | 'disconnected' | 'discharged' | 'unmarked'
  | 'found' | 'tag+' | 'tag-' | 'note' | 'plan' | 'merge' | 'remove' | 'port';

export function statusOf(m: Mark | undefined): Status | undefined {
  if (!m) return undefined;
  return m.status ?? (m.loaded ? 'connected' : undefined);
}

/** Disconnected longer than the reminder time and not yet confirmed as discharged. */
export function isOverdue(m: Mark | undefined, remindHours: number, now = Date.now()): boolean {
  return statusOf(m) === 'disconnected' && !!m?.disconnectedAt &&
    now - Date.parse(m.disconnectedAt) >= remindHours * 3600_000;
}

export function fmtElapsed(iso: string | undefined, now = Date.now()): string {
  if (!iso) return '';
  const min = Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
  const h = Math.floor(min / 60);
  return h ? `${h}h${String(min % 60).padStart(2, '0')}` : `${min}m`;
}

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

/** Local time as "yyyy-mm-dd hh:mm[:ss]" (Excel reads it the same way in every language). */
export function fmtLocal(iso: string | undefined, seconds = false): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}` + (seconds ? `:${p(d.getSeconds())}` : '');
}

/** Activity log as CSV text (phone and PC sender use the same columns; the Excel macro reads them). */
export function logCsv(log: LogEntry[]): string {
  const q = (s: string | undefined) => `"${(s ?? '').replace(/"/g, '""')}"`;
  const lines = ['TIME,BY,ACTION,CONTAINER,POSITION,DETAIL'];
  for (const e of log) lines.push([q(fmtLocal(e.t, true)), q(e.by), q(e.action), q(e.cont), q(e.pos), q(e.detail)].join(','));
  return '﻿' + lines.join('\r\n');
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function emptyMark(): Mark {
  return { loaded: false, tags: [], note: '', updatedAt: nowIso() };
}

/** Worth keeping: has a status or something to look at. */
export function hasContent(m: Mark): boolean {
  return m.loaded || !!m.status || hasIssue(m);
}

export function hasIssue(m: Mark | undefined): boolean {
  return !!m && (m.tags.length > 0 || m.note.trim() !== '' || m.foundBay !== undefined || !!m.movedFrom || !!m.notInPlan);
}
