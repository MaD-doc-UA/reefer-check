// Phone-to-phone transfer by a loop of QR codes (Android -> iPhone, no network, no Bluetooth).
// Payload JSON -> zlib (with checksum) -> Base45 (QR alphanumeric set) -> frames "RC1:SID:I:N:DATA".
import { strToU8, strFromU8, unzlibSync, zlibSync } from 'fflate';
import type { GroupVersions, LogEntry, Marks, Plan, Reefer } from './model';

export interface TransferPayload {
  kind: 'reefer-qr';
  v: 1;
  by: string;
  sentAt: string;
  plan?: Plan;
  marks: Marks;
  log?: LogEntry[];
  /** containers whose marks were cleared on the sender (container -> time), so they are cleared here too */
  cleared?: Record<string, string>;
  /** version counters of those cleared marks (container -> group counters); older apps ignore it */
  clearedV?: Record<string, GroupVersions>;
}

// ---------------------------------------------------------------- compact plan (columns instead of keys)

interface WirePlan extends Omit<Plan, 'reefers'> { cols: string[]; rows: unknown[][] }

function planToWire(p: Plan): WirePlan {
  const { reefers, ...rest } = p;
  const cols = [...new Set(reefers.flatMap(r => Object.keys(r)))];
  const rows = reefers.map(r => cols.map(c => (r as unknown as Record<string, unknown>)[c]));
  return { ...rest, cols, rows };
}

function planFromWire(w: WirePlan): Plan {
  const { cols, rows, ...rest } = w;
  const reefers = rows.map(row => Object.fromEntries(cols.map((c, i) => [c, row[i]])) as unknown as Reefer);
  return { ...rest, reefers };
}

// ---------------------------------------------------------------- Base45 (RFC 9285)

const B45 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

export function b45encode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 2) {
    if (i + 1 < bytes.length) {
      const n = bytes[i] * 256 + bytes[i + 1];
      out += B45[n % 45] + B45[Math.floor(n / 45) % 45] + B45[Math.floor(n / 2025)];
    } else {
      const n = bytes[i];
      out += B45[n % 45] + B45[Math.floor(n / 45)];
    }
  }
  return out;
}

export function b45decode(s: string): Uint8Array {
  const out = new Uint8Array(Math.floor(s.length / 3) * 2 + (s.length % 3 === 2 ? 1 : 0));
  let o = 0;
  const v = (ch: string) => {
    const x = B45.indexOf(ch);
    if (x < 0) throw new Error('Bad code data.');
    return x;
  };
  for (let i = 0; i < s.length; i += 3) {
    if (i + 2 < s.length) {
      const n = v(s[i]) + v(s[i + 1]) * 45 + v(s[i + 2]) * 2025;
      if (n > 0xffff) throw new Error('Bad code data.');
      out[o++] = n >> 8;
      out[o++] = n & 255;
    } else {
      out[o++] = v(s[i]) + v(s[i + 1]) * 45;
    }
  }
  return out;
}

// ---------------------------------------------------------------- frames

const PREFIX = 'RC1';

/** Characters of data per QR code. Bigger = fewer codes but harder to read from a screen. */
export const DENSITY = { low: 380, normal: 700, high: 1100 } as const;
export type Density = keyof typeof DENSITY;

export function encodeFrames(p: TransferPayload, chunk: number): string[] {
  const wire = { ...p, plan: p.plan ? planToWire(p.plan) : undefined };
  const data = b45encode(zlibSync(strToU8(JSON.stringify(wire)), { level: 9 }));
  const sid = Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, '0');
  const n = Math.max(1, Math.ceil(data.length / chunk));
  const frames: string[] = [];
  for (let i = 0; i < n; i++) frames.push(`${PREFIX}:${sid}:${i + 1}:${n}:${data.slice(i * chunk, (i + 1) * chunk)}`);
  return frames;
}

export interface Frame { sid: string; i: number; n: number; data: string }

export function parseFrame(text: string): Frame | null {
  const m = /^RC1:([0-9A-Z]{4}):(\d+):(\d+):(.*)$/s.exec(text);
  if (!m) return null;
  const i = +m[2], n = +m[3];
  if (!(n >= 1 && i >= 1 && i <= n && n < 10000)) return null;
  return { sid: m[1], i, n, data: m[4] };
}

/** Collects frames of one transfer in any order. A frame of another transfer starts over. */
export class FrameCollector {
  sid = '';
  n = 0;
  parts = new Map<number, string>();

  /** true when the frame was new */
  add(f: Frame): boolean {
    if (f.sid !== this.sid || f.n !== this.n) {
      this.sid = f.sid;
      this.n = f.n;
      this.parts = new Map();
    }
    if (this.parts.has(f.i)) return false;
    this.parts.set(f.i, f.data);
    return true;
  }

  get complete(): boolean {
    return this.n > 0 && this.parts.size === this.n;
  }

  payload(): TransferPayload {
    let s = '';
    for (let i = 1; i <= this.n; i++) s += this.parts.get(i) ?? '';
    const json = strFromU8(unzlibSync(b45decode(s))); // zlib checksum catches a damaged transfer
    const w = JSON.parse(json);
    if (w?.kind !== 'reefer-qr' || typeof w.marks !== 'object') throw new Error('Not a Reefer Check transfer.');
    return { ...w, plan: w.plan ? planFromWire(w.plan) : undefined };
  }
}
