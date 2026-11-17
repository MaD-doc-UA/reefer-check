// Reads the Reefer spot plan workbook (.xlsm/.xlsx) saved by Excel.
// Uses the cached formula values, so the file must be saved in Excel after the last change.
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

export async function parseWorkbook(file: File): Promise<Plan> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, {
    type: 'array',
    sheets: ['LOADING', 'Special', 'ATTENTION', 'Notes', 'Home', 'PortGroups', 'positions'],
  });
  const loading = rowsOf(wb, 'LOADING');
  if (!loading.length) throw new WorkbookError('Sheet LOADING not found. Is this the reefer spot plan file?');

  const header = loading[0].map(h => str(h).toUpperCase());
  const col = (name: string) => header.indexOf(name);
  const C = {
    pos: col('POSITION'), id: col('ID'), number: col('NUMBER'), pol: col('POL'), pod: col('POD'),
    temp: col('TEMP'), vent: col('VENT'), hum: col('HUM'), o2: col('O2'), co2: col('CO2'),
    plugBay: col('PLUG BAY'), deck: col('DECK/HOLD'), full: col('FULL NO'), restow: col('RESTOW'),
    manTemp: col('MAN TEMP'), tempDiff: col('TEMP DIFF'),
  };
  if (C.pos < 0 || C.pol < 0 || C.pod < 0) throw new WorkbookError('LOADING header not recognised (POSITION / POL / POD missing).');

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

  let currentPort = '';
  for (const r of rowsOf(wb, 'Home')) {
    const i = r.findIndex(v => str(v).toUpperCase() === 'CURRENT PORT');
    if (i >= 0) { currentPort = str(r[i + 1]); break; }
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

  const reefers: Reefer[] = [];
  const seen = new Set<string>();
  for (const r of loading.slice(1)) {
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
      special: special.get(cont) ?? '',
      attention: attention.has(cont) ? attention.get(cont)! : null,
      posNote: posNotes.get(pos) ?? '',
      restow: C.restow >= 0 ? str(r[C.restow]) : '',
    });
  }
  if (!reefers.length) {
    throw new WorkbookError('No reefers found on LOADING. Import the BAP in Excel, let it recalculate, save the file and try again.');
  }

  // ports seen in the plan but missing from the voyage list go to the end
  for (const r of reefers) for (const p of [r.pol, r.pod]) if (p && !ports.includes(p)) ports.push(p);

  const slots: string[] = [];
  for (const r of rowsOf(wb, 'positions').slice(1)) {
    const p = str(r[0]);
    if (/^\d{5,6}$/.test(p)) slots.push(p.padStart(6, '0'));
  }

  const importedAt = nowIso();
  return { id: `${file.name}@${importedAt}`, fileName: file.name, importedAt, currentPort, ports, reefers, slots };
}
