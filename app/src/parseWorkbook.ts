// Reads the Reefer spot plan workbook (.xlsm) saved by Excel, or its EXPORT TO PHONE file (.xlsx, values only).
// The .xlsm gives the cached formula values, so it must be saved in Excel after the last change.
import * as XLSX from 'xlsx';
import { nowIso, parsePos, plugBayOf, type Plan, type Reefer } from './model';

type Row = unknown[];

function rowsOf(wb: XLSX.WorkBook, name: string): Row[] {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<Row>(ws, { header: 1, defval: '', blankrows: false, raw: true });
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim();
}

function num(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function contNo(v: unknown): string {
  return str(v).replace(/\s+/g, '').toUpperCase();
}

export class WorkbookError extends Error {}

/** Excel local time text "yyyy-mm-dd hh:mm[:ss]" -> ISO (the phone is in the same time zone as the PC). */
function excelLocalToIso(v: unknown): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(str(v));
  if (!m) return undefined;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Excel date serial (local time) -> ISO. */
function excelSerialToIso(serial: number): string | undefined {
  if (!(serial > 0)) return undefined;
  const p = XLSX.SSF.parse_date_code(serial);
  if (!p) return undefined;
  return new Date(p.y, p.m - 1, p.d, p.H, p.M, Math.floor(p.S)).toISOString();
}

interface Lists {
  special: Map<string, string>;
  attention: Map<string, string>;
  posNotes: Map<string, string>;
}

/** Reefers of one plan sheet (LOADING = final plan, DISCHARGE = arrival plan, same columns). */
function planReefers(rows: Row[], sheet: string, lists: Lists): Reefer[] {
  if (!rows.length) return [];
  const header = rows[0].map(h => str(h).toUpperCase());
  const col = (name: string) => header.indexOf(name);
  const C = {
    pos: col('POSITION'), id: col('ID'), number: col('NUMBER'), pol: col('POL'), pod: col('POD'),
    temp: col('TEMP'), vent: col('VENT'), hum: col('HUM'), o2: col('O2'), co2: col('CO2'),
    plugBay: col('PLUG BAY'), deck: col('DECK/HOLD'), full: col('FULL NO'), restow: col('RESTOW'),
    manTemp: col('MAN TEMP'), tempDiff: col('TEMP DIFF'),
  };
  if (C.pos < 0 || C.pol < 0 || C.pod < 0) throw new WorkbookError(`${sheet} header not recognised (POSITION / POL / POD missing).`);

  const reefers: Reefer[] = [];
  const seen = new Set<string>();
  for (const r of rows.slice(1)) {
    const rawPos = str(r[C.pos]);
    if (!/^\d{5,7}$/.test(rawPos)) continue;
    const pos = rawPos.padStart(6, '0').slice(-6);
    const cont = C.full >= 0 && contNo(r[C.full]) ? contNo(r[C.full]) : contNo(str(r[C.id]) + str(r[C.number]));
    if (!cont || seen.has(cont)) continue;
    seen.add(cont);
    const { bay, row, tier } = parsePos(pos);
    const plug = num(r[C.plugBay]);
    reefers.push({
      cont, pos, bay, row, tier,
      plugBay: plug ?? plugBayOf(bay),
      deck: C.deck >= 0 ? str(r[C.deck]).toUpperCase() === 'DECK' : tier >= 80,
      pol: str(r[C.pol]), pod: str(r[C.pod]),
      temp: num(r[C.temp]),
      manTemp: C.manTemp >= 0 ? num(r[C.manTemp]) : null,
      tempDiff: C.tempDiff >= 0 && str(r[C.tempDiff]).toUpperCase() === 'DIFF',
      vent: num(r[C.vent]), hum: num(r[C.hum]), o2: num(r[C.o2]), co2: num(r[C.co2]),
      special: lists.special.get(cont) ?? '',
      attention: lists.attention.has(cont) ? lists.attention.get(cont)! : null,
      posNote: lists.posNotes.get(pos) ?? '',
      restow: C.restow >= 0 ? str(r[C.restow]) : '',
    });
  }
  return reefers;
}

/**
 * LOADING = final plan (what stays on board and what is loaded). DISCHARGE (workbook v24+) = arrival plan:
 * its reefers that are not in LOADING are added as "carried" (to discharge; DISCH mode, at their arrival slot).
 */
export async function parseWorkbook(file: File): Promise<Plan> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, {
    type: 'array',
    sheets: ['LOADING', 'DISCHARGE', 'Special', 'ATTENTION', 'Notes', 'Home', 'PortGroups', 'positions', 'EXPORT'],
  });
  if (!wb.Sheets['LOADING']) throw new WorkbookError('Sheet LOADING not found. Is this the reefer spot plan file?');

  // Lists by container number
  const special = new Map<string, string>();
  for (const r of rowsOf(wb, 'Special').slice(1)) {
    const c = contNo(r[0]);
    if (c.length >= 10) special.set(c, str(r[1]).toUpperCase() || 'PHARMA');
  }
  const attention = new Map<string, string>();
  for (const r of rowsOf(wb, 'ATTENTION').slice(1)) {
    const c = contNo(r[0]);
    if (c.length >= 10) attention.set(c, str(r[1]));
  }
  const posNotes = new Map<string, string>();
  for (const r of rowsOf(wb, 'Notes').slice(1)) {
    const p = str(r[0]);
    if (/^\d{5,6}$/.test(p)) posNotes.set(p.padStart(6, '0'), str(r[1]));
  }
  const lists = { special, attention, posNotes };

  let currentPort = '';
  for (const r of rowsOf(wb, 'Home')) {
    const i = r.findIndex(v => str(v).toUpperCase() === 'CURRENT PORT');
    if (i >= 0) { currentPort = str(r[i + 1]); break; }
  }

  // EXPORT TO PHONE info; the full workbook keeps the CLOSE PORT time in the hidden name PhoneCutoff
  let exportedAt: string | undefined;
  let cutoff: string | undefined;
  for (const r of rowsOf(wb, 'EXPORT')) {
    const k = str(r[0]).toUpperCase();
    if (k === 'EXPORTED') exportedAt = excelLocalToIso(r[1]);
    if (k === 'PHONE CUTOFF') cutoff = excelLocalToIso(r[1]);
  }
  if (!cutoff) {
    const nm = wb.Workbook?.Names?.find(n => n.Name === 'PhoneCutoff');
    if (nm) cutoff = excelSerialToIso(Number(String(nm.Ref).replace(/^=/, '')));
  }

  const ports: string[] = [];
  const pg = rowsOf(wb, 'PortGroups');
  const pgHead = pg.findIndex(r => r.some(v => str(v).toUpperCase().startsWith('ROTATION')));
  if (pgHead >= 0) {
    const ci = pg[pgHead].findIndex(v => str(v).toUpperCase().startsWith('ROTATION'));
    for (const r of pg.slice(pgHead + 1)) {
      const p = str(r[ci]);
      if (p && !ports.includes(p)) ports.push(p);
    }
  }

  const final = planReefers(rowsOf(wb, 'LOADING'), 'LOADING', lists);
  const arrival = wb.Sheets['DISCHARGE'] ? planReefers(rowsOf(wb, 'DISCHARGE'), 'DISCHARGE', lists) : [];
  const hasArrival = arrival.length > 0;
  let reefers: Reefer[];
  if (!final.length) {
    reefers = arrival; // only the arrival plan imported so far: it is the plan
  } else {
    const byCont = new Map(final.map(r => [r.cont, r]));
    const carried: Reefer[] = [];
    for (const a of arrival) {
      const f = byCont.get(a.cont);
      if (!f) carried.push({ ...a, carried: true, restow: '' });
      else if (f.pos !== a.pos) f.arrPos = a.pos;
    }
    reefers = [...final, ...carried];
  }
  if (!reefers.length) {
    throw new WorkbookError('No reefers found on LOADING / DISCHARGE. Import the BAP in Excel, let it recalculate, save the file (or EXPORT TO PHONE) and try again.');
  }

  // ports seen in the plan but missing from the voyage list go to the end
  for (const r of reefers) for (const p of [r.pol, r.pod]) if (p && !ports.includes(p)) ports.push(p);

  const slots: string[] = [];
  for (const r of rowsOf(wb, 'positions').slice(1)) {
    const p = str(r[0]);
    if (/^\d{5,6}$/.test(p)) slots.push(p.padStart(6, '0'));
  }

  const importedAt = nowIso();
  return {
    id: `${file.name}@${importedAt}`, fileName: file.name, importedAt, currentPort, ports, reefers, slots,
    hasArrival, exportedAt, cutoff,
  };
}
