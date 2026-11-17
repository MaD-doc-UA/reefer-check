// Presentation helpers: colour category (same priority as the Excel Overview) and port filter.
import type { Reefer } from './model';

export type Category = 'attention' | 'note' | 'ct' | 'ca' | 'pharma' | 'superfreezer' | 'gas' | 'normal';

export function categoryOf(r: Reefer): Category {
  if (r.attention !== null) return 'attention';
  if (r.posNote) return 'note';
  if (r.special) {
    const s = r.special.toUpperCase();
    if (s === 'CT') return 'ct';
    if (s === 'CA') return 'ca';
    return 'pharma';
  }
  if (r.temp !== null && r.temp <= -50) return 'superfreezer';
  if ((r.o2 ?? 0) > 0 || (r.co2 ?? 0) > 0) return 'gas';
  return 'normal';
}

export const CATEGORY_LABEL: Record<Category, string> = {
  attention: 'Attention',
  note: 'Position note',
  ct: 'CT',
  ca: 'CA',
  pharma: 'Pharma / special',
  superfreezer: 'Superfreezer',
  gas: 'O2 / CO2 set',
  normal: 'Normal',
};

export interface Filter {
  mode: 'all' | 'pol' | 'pod';
  port: string;
}

export function passes(r: Reefer, f: Filter): boolean {
  if (f.mode === 'all' || !f.port) return true;
  return f.mode === 'pol' ? r.pol === f.port : r.pod === f.port;
}

export function fmtNum(n: number | null, digits = 1): string {
  if (n === null) return '';
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}

export function fmtTemp(n: number | null): string {
  if (n === null) return '-';
  return `${n > 0 ? '+' : ''}${fmtNum(n)}°C`;
}

/** Short container label for a slot: last 4 characters of the number. */
export function shortNo(cont: string): string {
  return cont.slice(-4);
}

export function fmtPos(pos: string): string {
  return `${pos.slice(0, 2)} ${pos.slice(2, 4)} ${pos.slice(4, 6)}`;
}
