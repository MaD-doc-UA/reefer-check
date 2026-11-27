import { useEffect, useRef, useState } from 'preact/hooks';
import { statusOf } from '../model';
import {
  archivedLogCsv, archivedMarksBlob, clearAll, closePort, deleteArchived, dismissMerge, dropCarried, exportBackup, exportLogCsv,
  STORAGE_LIMIT, storagePercent, storagePersisted,
  exportMarks, setArchivePcDone, setRemindHours, setUser, useStore,
} from '../store';
import { mergeMarksFile, openAnyFile, openPlanFile, takeSharedFiles } from '../openFile';
import { saveFile, sendFile, type SendResult } from '../share';
import { fmtPos } from '../view';
import { QrReceive, QrSend } from './QrTransfer';
import { iosBrowser, isIOS, isStandalone } from '../platform';
import { NAME_INPUT } from '../nameInput';

/** iPhone in a browser tab: how to get the app on the home screen (own window, data kept). */
function IosInstall() {
  const br = iosBrowser();
  return (
    <div class="card install-card">
      <h3>Install on this iPhone</h3>
      <p class="small">Now the app runs in a {br === 'inapp' ? 'window of another app' : 'browser tab'}. Put it on the home screen
        and always open it from the icon: it gets its own full screen and the phone keeps its data.</p>
      <ol class="small steps">
        {br === 'inapp'
          ? <li>Open this page in <b>Safari</b>: in this app's menu (⋯ or the compass icon) tap <b>Open in Safari</b>.</li>
          : br === 'safari' && <li>Link opened from <b>WhatsApp / Telegram / mail</b>? First tap the <b>compass icon</b> (or ⋯ → <b>Open in Safari</b>):
            inside those apps there is no Add to Home Screen.</li>}
        <li>Tap <b>Share</b> (square with an arrow up){br === 'safari' ? ' in the bottom bar (or behind ⋯)' : ''}.</li>
        <li>Scroll down, tap <b>Add to Home Screen</b>.</li>
        <li>Keep <b>Open as Web App</b> switched on (if shown), tap <b>Add</b>.</li>
        <li>Close this tab and open <b>Reefers</b> from the home screen.</li>
      </ol>
      <p class="muted small">The home-screen app has its own storage: a plan and marks opened here in the browser are not there.
        Open the plan again in the app (or move marks with Save marks file / QR codes).</p>
    </div>
  );
}

/** A button that acts only after it is held down for `ms` (no accidental taps). */
function HoldButton({ ms, label, onDone }: { ms: number; label: string; onDone: () => void }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const stop = () => { clearTimeout(timer.current); setHolding(false); };
  const start = (e: Event) => {
    e.preventDefault();
    setHolding(true);
    timer.current = window.setTimeout(() => { setHolding(false); onDone(); }, ms);
  };
  useEffect(() => stop, []);
  return (
    <button class={`hold-btn ${holding ? 'holding' : ''}`} style={{ '--hold': `${ms}ms` }}
      onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop} onContextMenu={e => e.preventDefault()}>
      <span class="hold-fill" />
      <span class="hold-label">{holding ? 'Keep holding…' : label}</span>
    </button>
  );
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

export function PlanPanel() {
  const { plan, marks, lastMerge, user, log, settings, archive, closedPort, storageUsed } = useStore();
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const ios = isIOS();
  const standalone = isStandalone();
  useEffect(() => { storagePersisted().then(setPersisted); }, []);
  const [name, setName] = useState(user);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [qr, setQr] = useState<'' | 'send' | 'receive'>('');
  /** two-step port close: 'ask' = step 1 (send the log) shown, 'sent' = log sent, close allowed with no warning */
  const [closing, setClosing] = useState<'' | 'ask' | 'sent'>('');

  const run = async (job: () => Promise<string>, failText: string) => {
    setBusy(true); setMsg('');
    try {
      const m = await job();
      if (m) setMsg(m);
    } catch (err) {
      setMsg(`${failText}: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
    window.scrollTo(0, 0);
  };

  const pickedFile = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    return f;
  };
  const openPlan = (e: Event) => { const f = pickedFile(e); if (f) run(() => openPlanFile(f), 'Could not read the file'); };
  const loadMarks = (e: Event) => { const f = pickedFile(e); if (f) run(() => mergeMarksFile(f), 'Could not merge marks'); };

  // Android: a file shared to the app (Share > Reefers) arrives here once, after a reload with ?shared
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('shared')) return;
    history.replaceState(null, '', location.pathname + location.hash);
    takeSharedFiles().then(files => {
      if (!files.length) { setMsg('Nothing was received from the share. Try again, or open the file with the buttons below.'); return; }
      run(async () => {
        const out: string[] = [];
        for (const f of files) out.push(await openAnyFile(f).catch(e => `${f.name}: ${(e as Error).message}`));
        return out.filter(Boolean).join(' ');
      }, 'Could not open the shared file');
    });
  }, []);

  const who = () => (user || 'phone').replace(/\W+/g, '_');
  const sent = (r: SendResult, what: string) => {
    if (r === 'downloaded') setMsg(`${what} saved to this phone (Downloads). Send it from there.`);
  };
  const sendLog = async () => {
    const r = await sendFile(exportLogCsv(), `reefer-log-${who()}-${stamp()}.csv`);
    sent(r, 'Log CSV');
    return r !== 'cancel';
  };
  const sendMarks = async () => sent(await sendFile(exportMarks(), `reefer-marks-${who()}-${stamp()}.json`), 'Marks file');
  const sendArchivedLog = async (a: typeof archive[number]) => {
    const r = await sendFile(archivedLogCsv(a), `reefer-log-${safe(a.port)}-${who()}-${a.closedAt.slice(0, 10)}.csv`);
    sent(r, `Log of ${a.port}`);
    return r !== 'cancel';
  };
  const pcPending = archive.find(a => !a.pcDone && a.log.length > 0);

  const count = (s: string) => Object.values(marks).filter(m => statusOf(m) === s).length;
  const carried = plan ? plan.reefers.filter(r => r.carried) : [];
  const carriedLeft = carried.filter(r => statusOf(marks[r.cont]) !== 'discharged').length;
  const carriedPods = [...new Set(carried.map(r => r.pod))].join(', ');
  const portOpen = !!plan && !(closedPort && closedPort.toUpperCase() === plan.currentPort.toUpperCase());
  const portData = Object.keys(marks).length + log.filter(e => e.cont).length;
  const archDate = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const safe = (s: string) => s.replace(/\W+/g, '_');

  if (qr === 'send') return <QrSend withPlan onClose={() => setQr('')} />;
  if (qr === 'receive') return <QrReceive onClose={() => setQr('')} onDone={m => { setQr(''); setMsg(m); }} />;

  return (
    <div class="plan-panel">
      {ios && !standalone && <IosInstall />}
      {pcPending && (
        <div class="card pc-card">
          <h3>For the PC: log of {pcPending.port}</h3>
          <p class="small">{pcPending.port} was closed on this phone ({archDate(pcPending.closedAt)}). Send its log to the PC
            ({ios ? 'AirDrop / Files' : 'Bluetooth'}) and load it in Excel with <b>IMPORT PHONE LOG</b>. This one file is all Excel needs.</p>
          <div class="row-inline">
            <button class="big-btn" onClick={() => sendArchivedLog(pcPending)}>Send log to PC</button>
            <button class="small-btn" onClick={() => setArchivePcDone(pcPending.closedAt)}>Done, it is on the PC</button>
          </div>
        </div>
      )}
      <div class="card">
        <h3>Plan file</h3>
        {plan ? (
          <p>
            <b>{plan.fileName}</b><br />
            <span class="muted">opened {new Date(plan.importedAt).toLocaleString()} · {plan.reefers.length - carried.length} reefers · current port {plan.currentPort || '-'} · {count('connected')} connected · {count('disconnected')} disconnected · {count('discharged')} discharged</span>
          </p>
        ) : (
          <p class="muted">No plan yet. In Excel (after IMPORT BAP and manifests) press EXPORT TO PHONE, send the small .xlsx to this phone and open it here (the saved .xlsm works too).</p>
        )}
        <label class={`big-btn file ${busy ? 'busy' : ''}`}>
          {busy ? 'Reading…' : plan ? 'Open new plan (marks are kept)' : 'Open plan (.xlsx / .xlsm)'}
          <input type="file" accept=".xlsm,.xlsx,application/vnd.ms-excel.sheet.macroEnabled.12,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={openPlan} disabled={busy} hidden />
        </label>
        {msg && <p class="msg">{msg}</p>}
      </div>

      {carried.length > 0 && (
        <div class="card">
          <h3>{plan?.hasArrival ? 'Discharge list (arrival plan)' : 'Discharge list from the previous plan'}</h3>
          <p class="small">
            {carried.length} reefers (POD {carriedPods}) are {plan?.hasArrival ? 'in the arrival plan but not in the final plan' : 'not in this plan but were in the previous one'}:
            <b> {carriedLeft} still to discharge</b>. They show in <b>DISCH</b> mode at their arrival positions.
          </p>
          <button class="small-btn" onClick={() => {
            if (confirm(carriedLeft ? `${carriedLeft} are not marked as discharged. Close the list anyway? They will show as "not in plan".` : 'Close the discharge list?')) dropCarried();
          }}>Discharge finished: close the list</button>
        </div>
      )}

      {lastMerge && (
        <div class="card">
          <h3>What changed with the new plan</h3>
          <ul class="plain">
            <li>{lastMerge.total - (lastMerge.carried ?? 0)} reefers in the plan, {lastMerge.added} new</li>
            {(lastMerge.carried ?? 0) > 0 && <li>{lastMerge.carried} to discharge {lastMerge.fromArrival ? 'from the arrival plan' : 'kept from the previous plan'} (DISCH mode)</li>}
            <li>{lastMerge.removedUnmarked} removed (not marked)</li>
            <li class={lastMerge.moved.length ? 'bad' : ''}>{lastMerge.moved.length} marked containers changed position</li>
            <li class={lastMerge.notInPlan.length ? 'bad' : ''}>{lastMerge.notInPlan.length} marked containers no longer in the plan</li>
            {lastMerge.resolvedFound.length > 0 && <li>{lastMerge.resolvedFound.length} "found in another bay" now match the plan</li>}
            {(lastMerge.dischargedGone ?? 0) > 0 && <li>{lastMerge.dischargedGone} discharged containers left the plan (as expected)</li>}
          </ul>
          {lastMerge.moved.slice(0, 20).map(x => <div class="small">{x.cont}: {fmtPos(x.from)} → {fmtPos(x.to)}</div>)}
          <button class="small-btn" onClick={dismissMerge}>OK</button>
        </div>
      )}

      {plan && (
        <div class="card">
          <h3>Port {plan.currentPort || '-'}</h3>
          {portOpen ? (
            <>
              <p class="muted small">When the port is finished (Excel: CLOSE PORT), the next plan file asks to close it here too. Or close it now:
                marks and log go to the archive below; reefers still on board stay connected, with their tags and notes.</p>
              {!closing ? (
                <button class="small-btn" disabled={!portData} onClick={() => setClosing('ask')}>Close port {plan.currentPort}…</button>
              ) : (
                <div class="close-steps">
                  <p class="small"><b>1.</b> Send the log of {plan.currentPort} to the PC (Excel: IMPORT PHONE LOG).
                    {closing === 'sent' && <span class="ok"> ✓ sent</span>}</p>
                  <button class="small-btn" disabled={!log.length} onClick={async () => { if (await sendLog()) setClosing('sent'); }}>Send log to PC</button>
                  <p class="small"><b>2.</b> Close {plan.currentPort} on this phone. Its marks and log stay in the archive (last 3 ports);
                    reefers on board stay connected, with their tags and notes.</p>
                  <div class="row-inline">
                    <button class="small-btn" onClick={() => {
                      if (closing !== 'sent' && !confirm(`The log was not sent from here. Close ${plan.currentPort} anyway? You can still send it later from the archive.`)) return;
                      const a = closePort();
                      if (!a) return;
                      if (closing === 'sent') setArchivePcDone(a.closedAt);
                      setClosing('');
                      setMsg(`${plan.currentPort} closed. Open the plan of the next port.`);
                      window.scrollTo(0, 0);
                    }}>Close port {plan.currentPort}</button>
                    <button class="small-btn" onClick={() => setClosing('')}>Cancel</button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p class="small">{closedPort} is closed on this phone. Open the plan of the next port (EXPORT TO PHONE in Excel).</p>
          )}
          {archive.length > 0 && <h4>Closed ports on this phone</h4>}
          {archive.map(a => (
            <div class="archive-row">
              <div class="small"><b>{a.port}</b> <span class="muted">closed {archDate(a.closedAt)} by {a.closedBy} · {Object.keys(a.marks).length} marks · {a.log.length} log lines</span></div>
              <div class="row-inline">
                <button class="small-btn" disabled={!a.log.length} onClick={() => sendArchivedLog(a)}>Log to PC</button>
                <button class="small-btn" onClick={async () => sent(await sendFile(archivedMarksBlob(a), `reefer-marks-${safe(a.port)}-${who()}-${a.closedAt.slice(0, 10)}.json`), 'Marks file')}>Marks file (phones)</button>
                <button class="small-btn danger" onClick={() => { if (confirm(`Delete the archive of ${a.port} from this phone?`)) deleteArchived(a.closedAt); }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div class="card">
        <h3>Discharge reminder</h3>
        <p class="muted small">Remind to confirm "Discharged" when a reefer stays disconnected longer than:</p>
        <div class="seg">
          {[1, 2, 3, 4].map(h => (
            <button class={settings.remindHours === h ? 'on' : ''} onClick={() => setRemindHours(h)}>{h} h</button>
          ))}
        </div>
        <p class="muted small">The reminder shows as a red banner when you open the app. A phone notification is also tried, but phones may not deliver it while the app is closed.</p>
      </div>

      <div class="card">
        <h3>For the PC (Excel)</h3>
        <p class="muted small">Excel needs one file from each phone: the <b>log CSV</b> (statuses, tags, notes, found elsewhere).
          On the PC: <b>IMPORT PHONE LOG</b>. Several phones: send each log, or first gather the marks on one phone by QR.</p>
        <div class="row-inline">
          <button class="small-btn" onClick={sendLog} disabled={!log.length}>Send log to PC</button>
        </div>
        {closedPort && !portOpen && <p class="muted small">The log of a closed port is in the archive (Port card above: Log to PC).</p>}
      </div>

      <div class="card">
        <h3>For a colleague's phone</h3>
        <p class="muted small"><b>QR codes</b> (best, also iPhone, no network): this screen shows a loop of QR codes, the other phone reads them with its camera.
          Or send a <b>marks file</b> (any messenger / Bluetooth / AirDrop) and the other phone merges it. Newest change per container wins.</p>
        <div class="row-inline">
          <button class="small-btn" onClick={() => setQr('send')} disabled={!plan && !Object.keys(marks).length}>Send by QR codes</button>
          <button class="small-btn" onClick={() => setQr('receive')}>Receive by QR codes</button>
        </div>
        <div class="row-inline">
          <button class="small-btn" onClick={sendMarks} disabled={!Object.keys(marks).length}>Send marks file</button>
          <label class="small-btn">Merge marks file<input type="file" onChange={loadMarks} hidden /></label>
        </div>
      </div>

      <div class="card">
        <h3>Activity log <span class="muted">({log.length})</span></h3>
        <p class="muted small">Every mark, tag, note and plan change with time and name (the last ones below; the PC gets all of it with Send log to PC).</p>
        {log.slice(-8).reverse().map(e => (
          <div class="small log-line">
            <span class="muted">{new Date(e.t).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>{' '}
            <b>{e.by}</b> {e.action} {e.cont ?? ''}{e.detail ? `: ${e.detail}` : ''}
          </div>
        ))}
      </div>

      <div class="card">
        <h3>Your name</h3>
        <p class="muted small">Written next to every mark in the log. Not an account: it is stored only on this phone.</p>
        <div class="row-inline">
          <input class="grow text" defaultValue={user} {...NAME_INPUT} onInput={e => setName((e.target as HTMLInputElement).value)} />
          <button class="small-btn" onClick={() => setUser(name)} disabled={!name.trim() || name.trim() === user}>Save</button>
        </div>
      </div>

      <div class="card">
        <h3>Legend</h3>
        <div class="legend">
          <span><i class="dot c-normal" />normal</span>
          <span><i class="dot c-attention" />attention</span>
          <span><i class="dot c-note" />position note</span>
          <span><i class="dot c-pharma" />pharma</span>
          <span><i class="dot c-ct" />CT</span>
          <span><i class="dot c-ca" />CA / O2-CO2</span>
          <span><i class="dot c-superfreezer" />superfreezer (SF)</span>
          <span><b class="restow-sample">R</b> restow</span>
          <span><b class="tdiff-sample">T</b> temp differs</span>
          <span><b class="ok">✓</b> connected</span>
          <span><b class="disc-sample">1h20</b> disconnected (time since)</span>
          <span><b>↓</b> grey = discharged</span>
        </div>
      </div>

      <div class="card">
        <h3>Storage on this phone</h3>
        <p class="small">
          Used {(storageUsed / 1e6).toFixed(2)} of about {STORAGE_LIMIT / 1e6} MB ({storagePercent(storageUsed)}%) ·{' '}
          {persisted === true ? <span class="ok">protected</span>
            : ios && standalone ? <span class="ok">home-screen app</span>
            : persisted === false ? <span class="bad">not protected</span> : <span class="muted">protection unknown</span>}
        </p>
        {persisted !== true && ios && standalone && (
          <p class="muted small">iPhone does not clean the data of a home-screen app for disuse (it does for Safari tabs).
            Only deleting the app icon removes it. Still save the marks file and log CSV after each port.</p>
        )}
        {persisted !== true && ios && !standalone && (
          <p class="muted small">In a Safari tab the iPhone may delete this data after about 7 days without use.
            Install the app on the home screen (card at the top) and work from the icon.</p>
        )}
        {persisted !== true && !ios && (
          <p class="muted small">The phone may delete the data of a site it thinks is unused. Add the app to the home screen
            (Install / Add to Home Screen) and open it from there, and save the marks file and log CSV after each port.</p>
        )}
        <p class="muted small">Data stays only on this phone. Nothing is sent anywhere.</p>
      </div>

      <div class="card">
        <h3>About</h3>
        <p class="small">© 2026 Ledron-mf-dude &amp; MaD-doc-UA. All rights reserved.</p>
        <p class="muted small">Idea, workbook, testing: MaD-doc-UA<br />
          Macros, phone app and guides: built with Claude (Anthropic)<br />
          Manifest parser: <a href="https://github.com/Ledron-mf-dude" target="_blank" rel="noopener noreferrer">Ledron-mf-dude</a><br />
          Phone app: <a href="https://github.com/MaD-doc-UA/reefer-check" target="_blank" rel="noopener noreferrer">github.com/MaD-doc-UA/reefer-check</a><br />
          Backup link (if the main one does not open): <a href="https://reefer-check.pages.dev/" target="_blank" rel="noopener noreferrer">reefer-check.pages.dev</a><br />
          Based on an original spot plan (2012) by Lisische</p>
      </div>

      <div class="card danger-card">
        <h3>Reset this phone</h3>
        <p class="small">Deletes the plan, all marks, tags, notes, the log and the closed-port archive. Your name and the reminder setting stay.
          Use it to start clean (new test, new voyage) or after a mess. It cannot be undone.</p>
        <div class="row-inline">
          <button class="small-btn" onClick={() => saveFile(exportBackup(), `reefer-backup-${who()}-${stamp()}.json`)}
            disabled={!plan && !Object.keys(marks).length && !log.length && !archive.length}>Save backup first</button>
        </div>
        <p class="muted small">Backup: marks, log and archive in one file. "Merge marks file" brings its marks and log back.</p>
        <HoldButton ms={3000} label="Hold 3 s to reset this phone" onDone={() => { clearAll(); setMsg('This phone was reset. Open a plan to start.'); window.scrollTo(0, 0); }} />
      </div>
    </div>
  );
}
