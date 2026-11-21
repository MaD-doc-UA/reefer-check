import { useEffect, useRef, useState } from 'preact/hooks';
import { isOverdue, statusOf, type Reefer } from './model';
import { dismissStorageError, setUser, STORAGE_LIMIT, storagePercent, useStore } from './store';
import { doneLabel, isDone, passes, restowHere, type Filter } from './view';
import { BayView } from './components/BayView';
import { BayList, Issues, Search } from './components/Lists';
import { Overview } from './components/Overview';
import { ContainerSheet } from './components/ContainerSheet';
import { PlanPanel } from './components/PlanPanel';
import { isIOS, isStandalone } from './platform';
import { NAME_INPUT } from './nameInput';

/** iPhone browser tab (not the home-screen app): show the install hint. */
const iosTab = isIOS() && !isStandalone();

function NameGate() {
  const [name, setName] = useState('');
  return (
    <div class="sheet-backdrop center-modal">
      <form class="sheet name-gate" onSubmit={e => { e.preventDefault(); if (name.trim()) setUser(name); }}>
        <h2>Who is using this phone?</h2>
        <p class="muted small">Your name is written next to every mark in the activity log, so the team can see who checked what. It stays on this phone only.</p>
        <input class="text" autoFocus {...NAME_INPUT} onInput={e => setName((e.target as HTMLInputElement).value)} />
        <button class="big-btn" type="submit" disabled={!name.trim()}>Continue</button>
      </form>
    </div>
  );
}

type Tab = 'bays' | 'search' | 'issues' | 'plan';
const K_UI = 'reefer.ui.v1';

type BaysLayout = 'tiles' | 'overview';

function loadUi(): { filter: Filter; quickMark: boolean; layout?: BaysLayout } {
  try {
    const s = localStorage.getItem(K_UI);
    if (s) return JSON.parse(s);
  } catch { /* ignore */ }
  return { filter: { mode: 'all', port: '' }, quickMark: false };
}

/** Best effort: a system notification while the app is open or was used recently. */
function notify(text: string) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    navigator.serviceWorker?.getRegistration().then(reg => {
      if (reg) reg.showNotification('Reefer check', { body: text, tag: 'overdue', icon: './icon-192.png' });
      else new Notification('Reefer check', { body: text });
    }).catch(() => undefined);
  } catch { /* ignore */ }
}

export function App() {
  const { plan, marks, user, settings, storageError, storageUsed } = useStore();
  const [tab, setTab] = useState<Tab>(plan ? 'bays' : 'plan');
  const [bay, setBay] = useState<number>(-1);
  const [open, setOpen] = useState<Reefer | null>(null);
  const ui0 = loadUi();
  const [uiFilter, setFilter] = useState<Filter>(ui0.filter);
  const filter: Filter = { ...uiFilter, planPort: plan?.currentPort };
  const [quickMark, setQuickMark] = useState<boolean>(ui0.quickMark);
  const [layout, setLayout] = useState<BaysLayout>(ui0.layout === 'overview' ? 'overview' : 'tiles');
  const [now, setNow] = useState(Date.now());
  const notified = useRef(new Set<string>());

  useEffect(() => {
    try { localStorage.setItem(K_UI, JSON.stringify({ filter: uiFilter, quickMark, layout })); } catch { /* ignore */ }
  }, [uiFilter, quickMark, layout]);

  useEffect(() => {
    navigator.storage?.persist?.().catch(() => undefined); // ask the browser not to evict our data
    const t = setInterval(() => setNow(Date.now()), 60_000);
    const vis = () => { if (document.visibilityState === 'visible') setNow(Date.now()); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, []);

  // a port must be chosen in LOAD / DISCH mode
  useEffect(() => {
    if (plan && uiFilter.mode !== 'all' && !uiFilter.port) setFilter({ ...uiFilter, port: plan.currentPort || plan.ports[0] || '' });
  }, [plan, uiFilter]);

  const overdue = plan ? plan.reefers.filter(r => isOverdue(marks[r.cont], settings.remindHours, now)) : [];
  useEffect(() => {
    const fresh = overdue.filter(r => !notified.current.has(r.cont));
    if (fresh.length) {
      fresh.forEach(r => notified.current.add(r.cont));
      notify(`${overdue.length} reefer(s) disconnected over ${settings.remindHours} h: confirm discharge`);
    }
  }, [overdue.length]);

  const shown = plan ? plan.reefers.filter(r => passes(r, filter)) : [];
  const done = shown.filter(r => isDone(marks[r.cont], filter)).length;
  const disc = filter.mode === 'pod' ? shown.filter(r => statusOf(marks[r.cont]) === 'disconnected').length : 0;

  const setMode = (mode: Filter['mode']) =>
    setFilter({ mode, port: filter.port || plan?.currentPort || plan?.ports[0] || '' });

  return (
    <div class="app">
      <header class="top">
        <div class="title">
          <b>Reefer check</b>
          {plan && (
            <span class="muted small">
              {done}/{shown.length} {doneLabel(filter)}{filter.mode === 'pod' ? ` · ${disc} disconnected` : ''}
            </span>
          )}
        </div>
        {plan && tab === 'bays' && (
          <label class="switch" title="Tap a slot to do the next step without opening it">
            <input type="checkbox" checked={quickMark} onChange={e => setQuickMark((e.target as HTMLInputElement).checked)} />
            <span>Quick mark</span>
          </label>
        )}
      </header>

      {plan && tab !== 'plan' && (
        <div class={`modebar mode-${filter.mode}`}>
          <div class="seg">
            <button class={filter.mode === 'pol' ? 'on' : ''} onClick={() => setMode('pol')}>LOAD</button>
            <button class={filter.mode === 'pod' ? 'on' : ''} onClick={() => setMode('pod')}>DISCH</button>
            <button class={filter.mode === 'all' ? 'on' : ''} onClick={() => setMode('all')}>ALL</button>
          </div>
          {filter.mode !== 'all' && (
            <select value={filter.port} onChange={e => setFilter({ ...uiFilter, port: (e.target as HTMLSelectElement).value })} aria-label="Port">
              {plan.ports.map(p => <option value={p}>{p}</option>)}
            </select>
          )}
        </div>
      )}

      {storageError ? (
        <div class="storage-banner" role="alert">
          <span>⚠ {storageError}</span>
          <button class="small-btn" onClick={dismissStorageError}>OK</button>
        </div>
      ) : storageUsed > STORAGE_LIMIT * 0.8 && (
        <button class="storage-banner" onClick={() => setTab('plan')}>
          ⚠ Phone storage for this app is {storagePercent(storageUsed)}% full. Save the log and delete closed-port archives (Plan tab) ›
        </button>
      )}

      {iosTab && tab !== 'plan' && (
        <button class="install-banner" onClick={() => setTab('plan')}>
          iPhone: add the app to the home screen to get full screen and keep the data. How ›
        </button>
      )}

      {overdue.length > 0 && tab !== 'issues' && (
        <button class="overdue-banner" onClick={() => setTab('issues')}>
          ⚠ {overdue.length} reefer{overdue.length > 1 ? 's' : ''} disconnected over {settings.remindHours} h. Confirm discharge ›
        </button>
      )}

      <main>
        {!plan && tab !== 'plan' && <p class="muted pad">Open a plan first (Plan tab).</p>}
        {plan && tab === 'bays' && (bay < 0
          ? <>
              <div class="seg layout-seg">
                <button class={layout === 'tiles' ? 'on' : ''} onClick={() => setLayout('tiles')}>Tiles</button>
                <button class={layout === 'overview' ? 'on' : ''} onClick={() => setLayout('overview')}>Overview</button>
              </div>
              {layout === 'overview'
                ? <Overview plan={plan} filter={filter} onBay={setBay} />
                : <BayList plan={plan} filter={filter} onBay={setBay} now={now} />}
            </>
          : <BayView plan={plan} bay={bay} filter={filter} quickMark={quickMark} onOpen={setOpen} onBay={setBay} now={now} />)}
        {plan && tab === 'search' && <Search plan={plan} onOpen={setOpen} bay={bay} />}
        {plan && tab === 'issues' && <Issues plan={plan} filter={filter} onOpen={setOpen} now={now} />}
        {tab === 'plan' && <PlanPanel />}
      </main>

      <nav class="tabs">
        {([['bays', 'Bays'], ['search', 'Search'], ['issues', 'Issues'], ['plan', 'Plan']] as [Tab, string][]).map(([t, label]) => (
          <button class={tab === t ? 'on' : ''} onClick={() => { setTab(t); if (t === 'bays' && tab === 'bays') setBay(-1); }}>
            {label}{t === 'issues' && overdue.length > 0 ? <span class="tab-dot">{overdue.length}</span> : null}
          </button>
        ))}
      </nav>

      {!user && <NameGate />}
      {open && <ContainerSheet reefer={open} contextBay={bay >= 0 ? bay : null} mode={filter.mode} restow={restowHere(open, filter)} onClose={() => setOpen(null)} />}
    </div>
  );
}
