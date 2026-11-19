// Reefer sender: one offline HTML file for the work PC (nothing to install).
// 1) open the workbook -> loop of QR codes for the phone app (same format as phone-to-phone);
// 2) back from the phones: scan their "Marks only" QR codes (webcam) or open their marks .json,
//    see the merged list and save it as CSV for Excel.
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { parseWorkbook } from '../src/parseWorkbook';
import { DENSITY, encodeFrames, FrameCollector, parseFrame, type Density } from '../src/qrTransfer';
import { fmtLocal, logCsv, statusOf, type LogEntry, type Mark, type Marks, type Plan, type Reefer } from '../src/model';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------- send

let plan: Plan | null = null;
let frames: string[] = [];
let idx = 0;
let timer = 0;
let fps = 3;
let density: Density = 'normal';
let paused = false;

function drawQr(canvas: HTMLCanvasElement, text: string) {
  const qr = QRCode.create([{ data: text, mode: 'alphanumeric' }], { errorCorrectionLevel: 'L' });
  const size = qr.modules.size, quiet = 4;
  const box = canvas.parentElement!;
  const cssPx = Math.min(box.clientWidth, window.innerHeight * 0.75, 640);
  const dpr = window.devicePixelRatio || 1;
  const scale = Math.max(1, Math.floor((cssPx * dpr) / (size + quiet * 2)));
  const px = scale * (size + quiet * 2);
  canvas.width = px; canvas.height = px;
  canvas.style.width = `${px / dpr}px`; canvas.style.height = `${px / dpr}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = '#000';
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    if (qr.modules.get(r, c)) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
  }
}

function show() {
  if (!frames.length) return;
  idx = ((idx % frames.length) + frames.length) % frames.length;
  drawQr($('qr'), frames[idx]);
  $('count').innerHTML = `Code <b>${idx + 1}</b> / ${frames.length} <span class="muted">· one loop ≈ ${Math.ceil(frames.length / fps)} s</span>`;
}

function restart() {
  clearInterval(timer);
  if (!paused && frames.length > 1) timer = window.setInterval(() => { idx++; show(); }, 1000 / fps);
  $('pause').textContent = paused ? 'Play' : 'Pause';
  ($('prev') as HTMLButtonElement).disabled = !paused;
  ($('next') as HTMLButtonElement).disabled = !paused;
  show();
}

function rebuild() {
  if (!plan) return;
  frames = encodeFrames({ kind: 'reefer-qr', v: 1, by: 'PC', sentAt: new Date().toISOString(), plan, marks: {} }, DENSITY[density]);
  idx = 0;
  restart();
}

function seg(id: string, onPick: (v: string) => void) {
  const el = $(id);
  el.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    el.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    onPick(b.dataset.v!);
  });
}

async function openWorkbook(file: File) {
  $('wbMsg').textContent = 'Reading…';
  $('wbMsg').className = 'msg';
  try {
    plan = await parseWorkbook(file);
    const byPod = (list: Reefer[]) => {
      const pods = new Map<string, number>();
      for (const r of list) pods.set(r.pod, (pods.get(r.pod) ?? 0) + 1);
      return [...pods].map(([p, n]) => `${esc(p)} ${n}`).join(', ');
    };
    const final = plan.reefers.filter(r => !r.carried);
    const carried = plan.reefers.filter(r => r.carried);
    const moved = final.filter(r => r.arrPos).length;
    $('wbMsg').innerHTML = `<b>${esc(plan.fileName)}</b> · current port <b>${esc(plan.currentPort || '?')}</b>` +
      `<br>Final plan (LOADING): <b>${final.length}</b> reefers <span class="muted">· by POD: ${byPod(final)}</span>` +
      (plan.hasArrival
        ? `<br>Arrival plan only (to discharge): <b>${carried.length}</b>${carried.length ? ` <span class="muted">· by POD: ${byPod(carried)}</span>` : ''}` +
          (moved ? ` · ${moved} on board at another position than on arrival` : '')
        : `<br><span class="muted">No arrival plan (DISCHARGE) in this file: the phones keep the discharge list from their previous plan.</span>`) +
      (plan.cutoff ? `<br><span class="muted">Port closed in Excel ${esc(fmt(plan.cutoff))}: phone marks older than that are ignored below.</span>` : '');
    $('sendBox').hidden = false;
    rebuild();
  } catch (e) {
    plan = null;
    $('sendBox').hidden = true;
    clearInterval(timer);
    $('wbMsg').textContent = (e as Error).message;
    $('wbMsg').className = 'msg bad';
  }
}

// ---------------------------------------------------------------- back from phones

let marks: Marks = {};
let log: LogEntry[] = [];
const sources: string[] = [];

function mergeIn(incoming: Marks, inLog: LogEntry[] | undefined, from: string) {
  let updated = 0, old = 0;
  const cut = plan?.cutoff ?? '';
  for (const [cont, m] of Object.entries(incoming)) {
    if (cut && m.updatedAt < cut) { old++; continue; } // closed port (Excel CLOSE PORT would skip it too)
    const mine = marks[cont];
    if (!mine || mine.updatedAt < m.updatedAt) { marks[cont] = m; updated++; }
  }
  const key = (e: LogEntry) => `${e.t}|${e.by}|${e.action}|${e.cont ?? ''}|${e.detail ?? ''}`;
  const seen = new Set(log.map(key));
  for (const e of inLog ?? []) if (!seen.has(key(e)) && !(cut && e.t < cut)) log.push(e);
  log.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  sources.push(`${from}: ${Object.keys(incoming).length} marks (${updated} newer${old ? `, ${old} of the closed port ignored` : ''})`);
  renderMarks();
}

const fmt = (iso?: string) => fmtLocal(iso);

function rowsForExport() {
  const byCont = new Map(plan?.reefers.map(r => [r.cont, r]) ?? []);
  return Object.entries(marks)
    .map(([cont, m]: [string, Mark]) => {
      const r = byCont.get(cont);
      const st = statusOf(m) ?? '';
      const when = st === 'discharged' ? m.dischargedAt : st === 'disconnected' ? m.disconnectedAt : st === 'connected' ? m.loadedAt : m.updatedAt;
      const who = st === 'discharged' ? m.dischargedBy : st === 'disconnected' ? m.disconnectedBy : st === 'connected' ? m.loadedBy : m.updatedBy;
      return {
        cont, pos: r?.pos ?? m.checkedPos ?? '', pol: r?.pol ?? '', pod: r?.pod ?? '',
        status: st, when: fmt(when), by: who ?? m.updatedBy ?? '',
        found: m.foundPos || (m.foundBay !== undefined ? `bay ${m.foundBay}` : ''),
        tags: m.tags.join('; '), note: m.note,
        flag: m.notInPlan ? 'not in plan' : m.movedFrom ? `moved from ${m.movedFrom}` : '',
        updated: m.updatedAt,
      };
    })
    .sort((a, b) => a.pos.localeCompare(b.pos) || a.cont.localeCompare(b.cont));
}

function renderMarks() {
  const rows = rowsForExport();
  const count = (s: string) => rows.filter(r => r.status === s).length;
  $('srcList').innerHTML = sources.map(s => `<li>${esc(s)}</li>`).join('');
  $('backSum').innerHTML = rows.length
    ? `<b>${rows.length}</b> containers · connected ${count('connected')} · disconnected ${count('disconnected')} · discharged ${count('discharged')} · with notes/tags ${rows.filter(r => r.note || r.tags || r.found).length}`
    : 'Nothing received yet.';
  ($('saveCsv') as HTMLButtonElement).disabled = !rows.length;
  ($('saveLog') as HTMLButtonElement).disabled = !log.length;
  $('saveLog').textContent = `Save log CSV (${log.length})`;
  $('marksBody').innerHTML = rows.map(r =>
    `<tr class="st-${r.status}"><td>${esc(r.cont)}</td><td>${esc(r.pos)}</td><td>${esc(r.pod)}</td><td>${esc(r.status)}</td><td>${esc(r.when)}</td><td>${esc(r.by)}</td><td>${esc(r.found)}</td><td>${esc(r.tags)}</td><td>${esc(r.note)}</td><td>${esc(r.flag)}</td></tr>`,
  ).join('');
}

function download(text: string, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const t = fmtLocal(new Date().toISOString()); // yyyy-mm-dd hh:mm
  a.download = `${name}-${t.slice(0, 10).replace(/-/g, '')}-${t.slice(11).replace(':', '')}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Columns read by the Excel macro ImportPhoneMarks (by header name). UPDATED = newest change wins. */
function saveCsv() {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = ['CONTAINER,POSITION,POL,POD,STATUS,TIME,BY,FOUND AT,TAGS,NOTE,FLAG,UPDATED'];
  for (const r of rowsForExport()) lines.push([r.cont, r.pos, r.pol, r.pod, r.status, r.when, r.by, r.found, r.tags, r.note, r.flag, r.updated].map(q).join(','));
  download('﻿' + lines.join('\r\n'), 'reefer-marks');
}

function saveLogCsv() {
  download(logCsv(log), 'reefer-log');
}

async function openMarksFiles(files: FileList) {
  for (const f of Array.from(files)) {
    try {
      const data = JSON.parse(await f.text());
      if (data?.kind !== 'reefer-marks' || typeof data.marks !== 'object') throw new Error('not a marks file');
      mergeIn(data.marks, data.log, `${data.by || f.name} (file)`);
    } catch (e) {
      sources.push(`${f.name}: ${(e as Error).message}`);
      renderMarks();
    }
  }
}

// webcam scan of the phone's "Send by QR codes" -> Marks only
let stream: MediaStream | null = null;
let scanTimer = 0;

function stopScan() {
  clearTimeout(scanTimer);
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
  $('scanBox').hidden = true;
  $('scanBtn').textContent = 'Scan phone with webcam';
}

async function startScan() {
  if (stream) { stopScan(); return; }
  const msg = $('scanMsg');
  msg.textContent = '';
  if (!navigator.mediaDevices?.getUserMedia) { msg.textContent = 'This browser gives no camera access here.'; return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  } catch (e) {
    msg.textContent = `No webcam or camera blocked: ${(e as Error).message}. Use the marks file instead.`;
    return;
  }
  $('scanBox').hidden = false;
  $('scanBtn').textContent = 'Stop camera';
  const v = $('video') as HTMLVideoElement;
  v.srcObject = stream;
  await v.play().catch(() => undefined);
  const col = new FrameCollector();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const tick = () => {
    if (!stream) return;
    if (v.readyState >= 2 && v.videoWidth) {
      const w = Math.min(v.videoWidth, 960), h = Math.round(v.videoHeight * (w / v.videoWidth));
      canvas.width = w; canvas.height = h;
      ctx.drawImage(v, 0, 0, w, h);
      const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
      const f = code && parseFrame(code.data);
      if (f && col.add(f)) {
        $('scanCount').innerHTML = `Caught <b>${col.parts.size}</b> / ${col.n}`;
        if (col.complete) {
          try {
            const p = col.payload();
            mergeIn(p.marks, p.log, `${p.by || 'phone'} (QR)`);
            msg.textContent = `Received from ${p.by || 'phone'}. Next phone: just show its codes.`;
          } catch (e) {
            msg.textContent = `Damaged, try again: ${(e as Error).message}`;
          }
          col.sid = ''; col.n = 0; col.parts = new Map();
          $('scanCount').textContent = 'Looking for codes…';
        }
      }
    }
    scanTimer = window.setTimeout(tick, 80);
  };
  $('scanCount').textContent = 'Looking for codes…';
  tick();
}

// ---------------------------------------------------------------- wiring

function esc(s: string) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

function init() {
  const wb = $('wbFile') as HTMLInputElement;
  wb.addEventListener('change', () => wb.files?.[0] && openWorkbook(wb.files[0]));
  const drop = $('drop');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('over');
    const f = e.dataTransfer?.files?.[0];
    if (f) openWorkbook(f);
  });
  $('pause').addEventListener('click', () => { paused = !paused; restart(); });
  $('prev').addEventListener('click', () => { idx--; show(); });
  $('next').addEventListener('click', () => { idx++; show(); });
  seg('fps', v => { fps = +v; restart(); });
  seg('density', v => { density = v as Density; rebuild(); });
  window.addEventListener('resize', show);

  const mf = $('marksFile') as HTMLInputElement;
  mf.addEventListener('change', () => { if (mf.files?.length) openMarksFiles(mf.files); mf.value = ''; });
  $('scanBtn').addEventListener('click', startScan);
  $('saveCsv').addEventListener('click', saveCsv);
  $('saveLog').addEventListener('click', saveLogCsv);
  $('clearBack').addEventListener('click', () => {
    if (!confirm('Clear everything received from the phones on this page?')) return;
    marks = {}; log = []; sources.length = 0; renderMarks();
  });
  renderMarks();
}

init();
