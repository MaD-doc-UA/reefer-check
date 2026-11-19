import { useState } from 'preact/hooks';
import { parseWorkbook } from '../parseWorkbook';
import { statusOf } from '../model';
import {
  applyPlan, archivedLogCsv, archivedMarksBlob, clearAll, closePort, deleteArchived, dismissMerge, dropCarried, exportLogCsv, getState,
  exportMarks, importMarks, isOlderPortPlan, portChangeOf, setRemindHours, setUser, useStore,
} from '../store';
import { askPortChange } from '../portAsk';
import { fmtPos } from '../view';
import { QrReceive, QrSend } from './QrTransfer';

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

export function PlanPanel() {
  const { plan, marks, lastMerge, user, log, settings, archive, closedPort } = useStore();
  const [name, setName] = useState(user);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [qr, setQr] = useState<'' | 'send' | 'receive'>('');

  const openPlan = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    setBusy(true); setMsg('');
    try {
      const p = await parseWorkbook(f);
      if (isOlderPortPlan(p) && !confirm(`This file is for ${p.currentPort} and was made before you closed ${closedPort} on this phone. Open it anyway?`)) return;
      const ch = portChangeOf(p);
      let closed = '';
      if (ch) {
        const a = askPortChange(ch);
        if (!a) return;
        if (a === 'close') {
          if (!closePort(p)) return;
          closed = ch.from;
        }
      }
      applyPlan(p);
      const st = getState();
      setMsg(`Loaded ${p.reefers.length - p.reefers.filter(r => r.carried).length} reefers from ${p.fileName}` +
        (p.hasArrival ? ` (+ arrival plan: ${p.reefers.filter(r => r.carried).length} to discharge).` : '.') +
        (closed ? ` ${closed} closed and archived, ${Object.keys(st.marks).length} tags/notes kept.` : plan ? ` Marks kept: ${Object.keys(st.marks).length}.` : ''));
    } catch (err) {
      setMsg(`Could not read the file: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const saveMarks = () => download(exportMarks(), `reefer-marks-${(user || 'phone').replace(/\W+/g, '_')}-${stamp()}.json`);
  const saveLog = () => download(exportLogCsv(), `reefer-log-${stamp()}.csv`);

  const loadMarks = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    try {
      const res = importMarks(await f.text());
      setMsg(`Marks merged: ${res.updated} containers updated, ${res.logAdded} log lines added.` + (res.skipped ? ` ${res.skipped} marks of a closed port ignored.` : ''));
    } catch (err) {
      setMsg(`Could not read marks: ${(err as Error).message}`);
    }
  };

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
                marks and log go to the archive below, tags and notes of reefers still on board stay.</p>
              <button class="small-btn" disabled={!portData} onClick={() => {
                if (confirm(`Close ${plan.currentPort || 'this port'} on this phone? Marks and log go to the archive (last 3 ports), tags and notes of reefers on board stay.`)) {
                  if (closePort()) setMsg(`${plan.currentPort} closed. Open the plan of the next port.`);
                }
              }}>Close port {plan.currentPort}</button>
            </>
          ) : (
            <p class="small">{closedPort} is closed on this phone. Open the plan of the next port (EXPORT TO PHONE in Excel).</p>
          )}
          {archive.length > 0 && <h4>Closed ports on this phone</h4>}
          {archive.map(a => (
            <div class="archive-row">
              <div class="small"><b>{a.port}</b> <span class="muted">closed {archDate(a.closedAt)} by {a.closedBy} · {Object.keys(a.marks).length} marks · {a.log.length} log lines</span></div>
              <div class="row-inline">
                <button class="small-btn" onClick={() => download(archivedMarksBlob(a), `reefer-marks-${safe(a.port)}-${safe(user || 'phone')}-${a.closedAt.slice(0, 10)}.json`)}>Marks file</button>
                <button class="small-btn" disabled={!a.log.length} onClick={() => download(archivedLogCsv(a), `reefer-log-${safe(a.port)}-${a.closedAt.slice(0, 10)}.csv`)}>Log CSV</button>
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
        <h3>Phone to phone (QR codes)</h3>
        <p class="muted small">Send the plan and marks to another phone (also iPhone) with no network: this screen shows a loop of QR codes, the other phone reads them with its camera.</p>
        <div class="row-inline">
          <button class="small-btn" onClick={() => setQr('send')} disabled={!plan && !Object.keys(marks).length}>Send by QR codes</button>
          <button class="small-btn" onClick={() => setQr('receive')}>Receive by QR codes</button>
        </div>
      </div>

      <div class="card">
        <h3>Share / backup marks</h3>
        <p class="muted small">Save your marks to a file, or merge a colleague's file (newest change per container wins).</p>
        <div class="row-inline">
          <button class="small-btn" onClick={saveMarks} disabled={!Object.keys(marks).length}>Save marks file</button>
          <label class="small-btn">Merge marks file<input type="file" accept=".json,application/json" onChange={loadMarks} hidden /></label>
        </div>
      </div>

      <div class="card">
        <h3>Activity log <span class="muted">({log.length})</span></h3>
        <p class="muted small">Every mark, tag, note and plan change with time and name. Save as CSV to open in Excel.</p>
        {log.slice(-8).reverse().map(e => (
          <div class="small log-line">
            <span class="muted">{new Date(e.t).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>{' '}
            <b>{e.by}</b> {e.action} {e.cont ?? ''}{e.detail ? `: ${e.detail}` : ''}
          </div>
        ))}
        <div class="row-inline">
          <button class="small-btn" onClick={saveLog} disabled={!log.length}>Save log (CSV)</button>
        </div>
      </div>

      <div class="card">
        <h3>Your name</h3>
        <p class="muted small">Written next to every mark in the log. Not an account: it is stored only on this phone.</p>
        <div class="row-inline">
          <input class="grow text" value={name} maxLength={40} placeholder="e.g. ETO Andrii" onInput={e => setName((e.target as HTMLInputElement).value)} />
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
          <span><i class="dot c-superfreezer" />superfreezer</span>
          <span><b class="restow-sample">R</b> restow</span>
          <span><b class="tdiff-sample">T</b> temp differs</span>
          <span><b class="ok">✓</b> connected</span>
          <span><b class="disc-sample">1h20</b> disconnected (time since)</span>
          <span><b>↓</b> grey = discharged</span>
        </div>
      </div>

      <div class="card">
        <button class="small-btn danger" onClick={() => { if (confirm('Delete the plan, ALL marks and the log from this phone? Save the log first if you need it.')) clearAll(); }}>Delete plan, marks and log from this phone</button>
        <p class="muted small">Data stays only on this phone. Nothing is sent anywhere.</p>
      </div>
    </div>
  );
}
