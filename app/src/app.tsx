import { useEffect, useState } from 'preact/hooks';
import type { Reefer } from './model';
import { setUser, useStore } from './store';

function NameGate() {
  const [name, setName] = useState('');
  return (
    <div class="sheet-backdrop center-modal">
      <form class="sheet name-gate" onSubmit={e => { e.preventDefault(); if (name.trim()) setUser(name); }}>
        <h2>Who is using this phone?</h2>
        <p class="muted small">Your name is written next to every mark in the activity log, so the team can see who checked what. It stays on this phone only.</p>
        <input class="text" autoFocus value={name} maxLength={40} placeholder="e.g. ETO Andrii" onInput={e => setName((e.target as HTMLInputElement).value)} />
        <button class="big-btn" type="submit" disabled={!name.trim()}>Continue</button>
      </form>
    </div>
  );
}
import { passes, type Filter } from './view';
import { BayView } from './components/BayView';
import { BayList, Issues, Search } from './components/Lists';
import { ContainerSheet } from './components/ContainerSheet';
import { PlanPanel } from './components/PlanPanel';

type Tab = 'bays' | 'search' | 'issues' | 'plan';
const K_UI = 'reefer.ui.v1';

function loadUi(): { filter: Filter; quickMark: boolean } {
  try {
    const s = localStorage.getItem(K_UI);
    if (s) return JSON.parse(s);
  } catch { /* ignore */ }
  return { filter: { mode: 'all', port: '' }, quickMark: false };
}

export function App() {
  const { plan, marks, user } = useStore();
  const [tab, setTab] = useState<Tab>(plan ? 'bays' : 'plan');
  const [bay, setBay] = useState<number>(-1);
  const [open, setOpen] = useState<Reefer | null>(null);
  const ui0 = loadUi();
  const [filter, setFilter] = useState<Filter>(ui0.filter);
  const [quickMark, setQuickMark] = useState<boolean>(ui0.quickMark);

  useEffect(() => {
    try { localStorage.setItem(K_UI, JSON.stringify({ filter, quickMark })); } catch { /* ignore */ }
  }, [filter, quickMark]);

  useEffect(() => {
    // ask the browser not to evict our data
    navigator.storage?.persist?.().catch(() => undefined);
  }, []);

  const shown = plan ? plan.reefers.filter(r => passes(r, filter)) : [];
  const done = shown.filter(r => marks[r.cont]?.loaded).length;
  const filterLabel = filter.mode === 'all' ? 'All reefers' : `${filter.mode === 'pol' ? 'Load' : 'Disch.'} ${filter.port}`;

  return (
    <div class="app">
      <header class="top">
        <div class="title">
          <b>Reefer check</b>
          {plan && <span class="muted small">{filterLabel} · {done}/{shown.length} loaded</span>}
        </div>
        {plan && tab === 'bays' && (
          <label class="switch" title="Tap a slot to mark it loaded without opening it">
            <input type="checkbox" checked={quickMark} onChange={e => setQuickMark((e.target as HTMLInputElement).checked)} />
            <span>Quick mark</span>
          </label>
        )}
      </header>

      <main>
        {!plan && tab !== 'plan' && <p class="muted pad">Open a plan first (Plan tab).</p>}
        {plan && tab === 'bays' && (bay < 0
          ? <BayList plan={plan} filter={filter} onBay={setBay} />
          : <BayView plan={plan} bay={bay} filter={filter} quickMark={quickMark} onOpen={setOpen} onBay={setBay} />)}
        {plan && tab === 'search' && <Search plan={plan} onOpen={setOpen} bay={bay} />}
        {plan && tab === 'issues' && <Issues plan={plan} filter={filter} onOpen={setOpen} />}
        {tab === 'plan' && <PlanPanel filter={filter} setFilter={setFilter} />}
      </main>

      <nav class="tabs">
        {([['bays', 'Bays'], ['search', 'Search'], ['issues', 'Issues'], ['plan', 'Plan']] as [Tab, string][]).map(([t, label]) => (
          <button class={tab === t ? 'on' : ''} onClick={() => { setTab(t); if (t === 'bays' && tab === 'bays') setBay(-1); }}>{label}</button>
        ))}
      </nav>

      {!user && <NameGate />}
      {open && <ContainerSheet reefer={open} contextBay={bay >= 0 ? bay : null} onClose={() => setOpen(null)} />}
    </div>
  );
}
