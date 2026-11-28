// Opening a file in the app: a plan (.xlsx / .xlsm) or a marks file (.json), picked in the app or shared to it
// from another app (Android: Share > Reefer Check, see share_target in the manifest and sw.js).
import { parseWorkbook } from './parseWorkbook';
import { applyPlan, closePort, getState, importMarks, isOlderPortPlan, portChangeOf } from './store';
import { askPortChange } from './portAsk';

const fmtTime = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Opens a plan file; returns the message for the Plan tab ('' = cancelled by the user). */
export async function openPlanFile(f: File): Promise<string> {
  const p = await parseWorkbook(f);
  const { closedPort, plan } = getState();
  if (isOlderPortPlan(p) && !confirm(`This file is for ${p.currentPort} and was made before you closed ${closedPort} on this phone. Open it anyway?`)) return '';
  const ch = portChangeOf(p);
  let closed = '';
  if (ch) {
    const a = askPortChange(ch);
    if (!a) return '';
    if (a === 'close') {
      if (!closePort(p)) return '';
      closed = ch.from;
    }
  }
  applyPlan(p);
  const st = getState();
  const carried = p.reefers.filter(r => r.carried).length;
  return `Loaded ${p.reefers.length - carried} reefers from ${p.fileName}` +
    (p.hasArrival ? ` (+ arrival plan: ${carried} to discharge).` : '.') +
    (closed ? ` ${closed} closed and archived, ${Object.keys(st.marks).length} reefers on board kept (status, tags, notes).`
      : plan ? ` Marks kept: ${Object.keys(st.marks).length}.` : '');
}

/** Merges a marks file; returns the message for the Plan tab. */
export async function mergeMarksFile(f: File): Promise<string> {
  const r = importMarks(await f.text());
  const src = `${r.by || f.name}${r.port ? ` (archive of ${r.port})` : ''}`;
  const parts = [`Merged marks from ${src}: ${r.updated} containers updated`];
  if (r.same) parts.push(`${r.same} already up to date here`);
  parts.push(`${r.logAdded} log lines added`);
  let msg = parts.join(', ') + '.';
  if (r.skipped) msg += ` ${r.skipped} marks are older than the port close on this phone${r.cutoff ? ` (${fmtTime(r.cutoff)})` : ''} and were ignored: they belong to a closed port.`;
  if (!r.updated && !r.same && !r.skipped) msg += ' The file has no marks.';
  return msg;
}

/** Plan or marks file, told apart by the content (shared files may come without a usable name or type). */
export async function openAnyFile(f: File): Promise<string> {
  const head = new Uint8Array(await f.slice(0, 2).arrayBuffer());
  const zip = head[0] === 0x50 && head[1] === 0x4b; // "PK": .xlsx / .xlsm
  return zip ? openPlanFile(f) : mergeMarksFile(f);
}

const SHARED_CACHE = 'reefer-shared';

/** Files shared to the app (Android Share > Reefer Check): the service worker parked them in a cache. Taken once. */
export async function takeSharedFiles(): Promise<File[]> {
  if (!('caches' in window)) return [];
  const cache = await caches.open(SHARED_CACHE);
  const files: File[] = [];
  for (const req of await cache.keys()) {
    const res = await cache.match(req);
    if (res) {
      const name = decodeURIComponent(res.headers.get('X-File-Name') || 'shared-file');
      files.push(new File([await res.blob()], name, { type: res.headers.get('Content-Type') || '' }));
    }
    await cache.delete(req);
  }
  return files;
}
