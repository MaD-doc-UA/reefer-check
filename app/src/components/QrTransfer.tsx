// Send / receive the plan and marks as a loop of QR codes (works offline, phone to phone).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { DENSITY, encodeFrames, FrameCollector, parseFrame, type Density, type TransferPayload } from '../qrTransfer';
import { applyTransfer, getState, isOlderPortPlan, portChangeOf, transferPayload } from '../store';
import { askPortChange } from '../portAsk';

/** Keep the screen on while sending / scanning (best effort). */
function useWakeLock() {
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null;
    let gone = false;
    const get = () => {
      const wl = (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
      wl?.request('screen').then(l => { if (gone) l.release(); else lock = l; }).catch(() => undefined);
    };
    get();
    const vis = () => { if (document.visibilityState === 'visible') get(); };
    document.addEventListener('visibilitychange', vis);
    return () => { gone = true; lock?.release().catch(() => undefined); document.removeEventListener('visibilitychange', vis); };
  }, []);
}

function drawQr(canvas: HTMLCanvasElement, text: string, cssPx: number) {
  const qr = QRCode.create([{ data: text, mode: 'alphanumeric' }], { errorCorrectionLevel: 'L' });
  const size = qr.modules.size;
  const quiet = 4;
  const dpr = window.devicePixelRatio || 1;
  const scale = Math.max(1, Math.floor((cssPx * dpr) / (size + quiet * 2)));
  const px = scale * (size + quiet * 2);
  canvas.width = px;
  canvas.height = px;
  canvas.style.width = `${px / dpr}px`;
  canvas.style.height = `${px / dpr}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = '#000';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (qr.modules.get(r, c)) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
    }
  }
}

// ---------------------------------------------------------------- send

export function QrSend({ withPlan: withPlan0, onClose }: { withPlan: boolean; onClose: () => void }) {
  const { plan, marks, log } = getState();
  const [withPlan, setWithPlan] = useState(withPlan0 && !!plan);
  const [withLog, setWithLog] = useState(true);
  const [density, setDensity] = useState<Density>('normal');
  const [fps, setFps] = useState(3);
  const [paused, setPaused] = useState(false);
  const [idx, setIdx] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  useWakeLock();

  const frames = useMemo(
    () => encodeFrames(transferPayload(withPlan, withLog), DENSITY[density]),
    [withPlan, withLog, density],
  );

  useEffect(() => setIdx(0), [frames]);

  useEffect(() => {
    if (paused || frames.length < 2) return;
    const t = setInterval(() => setIdx(i => (i + 1) % frames.length), 1000 / fps);
    return () => clearInterval(t);
  }, [paused, fps, frames]);

  useEffect(() => {
    if (!canvas.current) return;
    const cssPx = Math.min(window.innerWidth - 24, window.innerHeight * 0.62, 560);
    drawQr(canvas.current, frames[Math.min(idx, frames.length - 1)], cssPx);
  }, [idx, frames]);

  const loopSec = Math.ceil(frames.length / fps);

  return (
    <div class="qr-screen">
      <div class="qr-head">
        <b>Send by QR codes</b>
        <button class="icon-btn" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <p class="muted small qr-hint">On the other phone: Plan tab › <b>Receive by QR codes</b>, and point the camera here. Codes repeat until every one is caught.</p>
      <div class="qr-box"><canvas ref={canvas} /></div>
      <div class="qr-count">
        Code <b>{Math.min(idx, frames.length - 1) + 1}</b> / {frames.length}
        <span class="muted small"> · one loop ≈ {loopSec} s</span>
      </div>
      <div class="row-inline qr-controls">
        <button class="small-btn" onClick={() => setIdx(i => (i - 1 + frames.length) % frames.length)} disabled={!paused}>‹</button>
        <button class="small-btn" onClick={() => setPaused(!paused)}>{paused ? 'Play' : 'Pause'}</button>
        <button class="small-btn" onClick={() => setIdx(i => (i + 1) % frames.length)} disabled={!paused}>›</button>
      </div>
      <div class="qr-options">
        <div class="seg">
          <button class={withPlan ? 'on' : ''} onClick={() => setWithPlan(true)} disabled={!plan}>Plan + marks</button>
          <button class={!withPlan ? 'on' : ''} onClick={() => setWithPlan(false)}>Marks only</button>
        </div>
        <label class="switch"><input type="checkbox" checked={withLog} onChange={e => setWithLog((e.target as HTMLInputElement).checked)} /><span>Include activity log ({log.length} lines)</span></label>
        <div class="small muted">Speed</div>
        <div class="seg">
          {[2, 3, 5].map(f => <button class={fps === f ? 'on' : ''} onClick={() => setFps(f)}>{f} / s</button>)}
        </div>
        <div class="small muted">Code size</div>
        <div class="seg">
          {(['low', 'normal', 'high'] as Density[]).map(d => (
            <button class={density === d ? 'on' : ''} onClick={() => setDensity(d)}>{d === 'low' ? 'Simple' : d === 'normal' ? 'Normal' : 'Dense'}</button>
          ))}
        </div>
        <p class="muted small">{withPlan && plan ? `${plan.fileName} · ${plan.reefers.length} reefers · ` : ''}{Object.keys(marks).length} marks. If the camera can't read the codes: brighter screen, slower speed or "Simple" size.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- receive

type Detector = { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> };

async function makeDetector(): Promise<Detector | null> {
  const BD = (window as unknown as { BarcodeDetector?: { new(o: { formats: string[] }): Detector; getSupportedFormats?(): Promise<string[]> } }).BarcodeDetector;
  if (!BD) return null;
  try {
    const f = await BD.getSupportedFormats?.();
    if (f && !f.includes('qr_code')) return null;
    return new BD({ formats: ['qr_code'] });
  } catch {
    return null;
  }
}

export function QrReceive({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const collector = useRef(new FrameCollector());
  const [got, setGot] = useState(0);
  const [total, setTotal] = useState(0);
  const [have, setHave] = useState<Set<number>>(new Set());
  const [err, setErr] = useState('');
  const [result, setResult] = useState<TransferPayload | null>(null);
  useWakeLock();

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stop = false;
    let timer = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

    const onText = (text: string) => {
      const f = parseFrame(text);
      if (!f) return;
      const c = collector.current;
      if (!c.add(f)) return;
      setGot(c.parts.size);
      setTotal(c.n);
      setHave(new Set(c.parts.keys()));
      if (c.complete) {
        try {
          setResult(c.payload());
          stop = true;
          stream?.getTracks().forEach(t => t.stop());
        } catch (e) {
          setErr(`Transfer damaged, starting again: ${(e as Error).message}`);
          collector.current = new FrameCollector();
          setGot(0); setHave(new Set());
        }
      }
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setErr('Camera is not available here. Open the app from its https address (not a local file).');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch (e) {
        setErr(`Camera blocked: ${(e as Error).message}. Allow the camera for this app in the phone settings.`);
        return;
      }
      if (stop) { stream.getTracks().forEach(t => t.stop()); return; }
      const v = video.current!;
      v.srcObject = stream;
      await v.play().catch(() => undefined);
      const detector = await makeDetector();

      const tick = async () => {
        if (stop) return;
        if (v.readyState >= 2 && v.videoWidth) {
          try {
            if (detector) {
              for (const code of await detector.detect(v)) onText(code.rawValue);
            } else {
              // centre square of the picture, scaled down for speed
              const side = Math.min(v.videoWidth, v.videoHeight);
              const out = Math.min(side, 800);
              canvas.width = out; canvas.height = out;
              ctx.drawImage(v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, 0, 0, out, out);
              const img = ctx.getImageData(0, 0, out, out);
              const code = jsQR(img.data, out, out, { inversionAttempts: 'dontInvert' });
              if (code) onText(code.data);
            }
          } catch { /* next frame */ }
        }
        timer = window.setTimeout(tick, 60);
      };
      tick();
    })();

    return () => {
      stop = true;
      clearTimeout(timer);
      stream?.getTracks().forEach(t => t.stop());
    };
  }, []);

  const apply = () => {
    if (!result) return;
    const cur = getState().plan;
    let closeOld = false;
    if (result.plan && cur && cur.id !== result.plan.id && !isOlderPortPlan(result.plan)) {
      const ch = portChangeOf(result.plan);
      if (ch) {
        const a = askPortChange(ch);
        if (!a) return;
        closeOld = a === 'close';
      } else if (!confirm(`Replace your plan "${cur.fileName}" with "${result.plan.fileName}"? Your marks are kept and merged.`)) return;
    }
    const r = applyTransfer(result, closeOld);
    onDone(`Received from ${result.by || 'colleague'}: ` +
      (r.planApplied ? `plan ${result.plan!.fileName}, ` : r.oldPlan ? `plan of a port closed here not taken, ` : result.plan ? 'same plan, ' : '') +
      `${r.updated} containers updated, ${r.logAdded} log lines added` + (r.skipped ? `, ${r.skipped} marks of a closed port ignored.` : '.'));
  };

  if (result) {
    const cur = getState().plan;
    return (
      <div class="qr-screen">
        <div class="qr-head"><b>Received</b><button class="icon-btn" onClick={onClose} aria-label="Close">✕</button></div>
        <div class="card">
          <p>From <b>{result.by || '?'}</b>, {new Date(result.sentAt).toLocaleString('en-GB')}</p>
          <ul class="plain">
            {result.plan
              ? <li>Plan <b>{result.plan.fileName}</b> ({result.plan.reefers.length} reefers){cur?.id === result.plan.id ? ' — same as yours' : ''}</li>
              : <li>No plan (marks only)</li>}
            <li>{Object.keys(result.marks).length} marks (newest change per container wins)</li>
            {result.log && <li>{result.log.length} log lines</li>}
          </ul>
          {result.plan && cur && cur.id !== result.plan.id && <p class="warn">This replaces your plan "{cur.fileName}". Your marks are carried over.</p>}
          {!result.plan && !cur && <p class="warn">You have no plan yet: the marks are kept, but you need the plan to see them.</p>}
          <div class="row-inline">
            <button class="big-btn" onClick={apply}>Apply</button>
            <button class="small-btn" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div class="qr-screen">
      <div class="qr-head"><b>Receive by QR codes</b><button class="icon-btn" onClick={onClose} aria-label="Close">✕</button></div>
      <p class="muted small qr-hint">On the other phone: Plan tab › <b>Send by QR codes</b>. Hold this camera 20–30 cm from its screen.</p>
      <div class="qr-video"><video ref={video} playsInline muted autoPlay /><i class="qr-aim" /></div>
      <div class="qr-count">{total ? <>Caught <b>{got}</b> / {total}</> : 'Looking for codes…'}</div>
      {total > 0 && (
        <div class="qr-cells">
          {Array.from({ length: total }, (_, i) => <i class={have.has(i + 1) ? 'on' : ''} />)}
        </div>
      )}
      {err && <p class="msg bad">{err}</p>}
    </div>
  );
}
