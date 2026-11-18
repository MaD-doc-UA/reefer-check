import { useState } from 'preact/hooks';
import { parseWorkbook } from '../parseWorkbook';
import { statusOf } from '../model';
import { applyPlan, clearAll, dismissMerge, dropCarried, exportLogCsv, exportMarks, importMarks, setRemindHours, setUser, useStore } from '../store';
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
  const { plan, marks, lastMerge, user, log, settings } = useStore();
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
      applyPlan(p);
      setMsg(`Loaded ${p.reefers.length} reefers from ${p.fileName}.` + (plan ? ` Marks kept: ${Object.keys(marks).length}.` : ''));
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
      setMsg(`Marks merged: ${res.updated} containers updated, ${res.logAdded} log lines added.`);
    } catch (err) {
      setMsg(`Could not read marks: ${(err as Error).message}`);
    }
  };

  const count = (s: string) => Object.values(marks).filter(m => statusOf(m) === s).length;
  const carried = plan ? plan.reefers.filter(r => r.carried) : [];
  const carriedLeft = carried.filter(r => statusOf(marks[r.cont]) !== 'discharged').length;

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
          <p class="muted">No plan yet. Save the spot plan in Excel (after IMPORT BAP and manifests), send the .xlsm to this phone and open it here.</p>
        )}
        <label class={`big-btn file ${busy ? 'busy' : ''}`}>
          {busy ? 'Reading…' : plan ? 'Open new plan (marks are kept)' : 'Open plan (.xlsm)'}
          <input type="file" accept=".xlsm,.xlsx,application/vnd.ms-excel.sheet.macroEnabled.12,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={openPlan} disabled={busy} hidden />
        </label>
        {msg && <p class="msg">{msg}</p>}
      </div>

      {carried.length > 0 && (
        <div class="card">
          <h3>Discharge list from the previous plan</h3>
          <p class="small">
            {carried.length} reefers for {carried[0].pod} are not in this plan but were in the previous one:
            <b> {carriedLeft} still to discharge</b>. They show in <b>DISCH</b> mode at their old positions.
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
            {(lastMerge.carried ?? 0) > 0 && <li>{lastMerge.carried} to discharge kept from the previous plan (DISCH mode)</li>}
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
