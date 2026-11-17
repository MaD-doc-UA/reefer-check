import { useState } from 'preact/hooks';
import { BAY_GROUPS, bayGroupLabel, type Plan, type Reefer } from '../model';
import { forgetNotInPlan, useStore } from '../store';
import { categoryOf, fmtPos, fmtTemp, passes, type Filter } from '../view';

export function BayList({ plan, filter, onBay }: { plan: Plan; filter: Filter; onBay: (b: number) => void }) {
  const { marks } = useStore();
  return (
    <div class="bay-list">
      {BAY_GROUPS.map(b => {
        const rs = plan.reefers.filter(r => r.plugBay === b && passes(r, filter));
        const done = rs.filter(r => marks[r.cont]?.loaded).length;
        const issues = rs.filter(r => { const m = marks[r.cont]; return m && (m.tags.length || m.note || m.foundBay !== undefined || m.movedFrom); }).length;
        const pct = rs.length ? Math.round((done / rs.length) * 100) : 0;
        return (
          <button class={`bay-tile ${rs.length === 0 ? 'none' : done === rs.length ? 'complete' : ''}`} onClick={() => onBay(b)}>
            <span class="bay-name">{bayGroupLabel(b)}</span>
            <span class="bay-count">{done}/{rs.length}</span>
            {issues > 0 && <span class="badge">{issues}</span>}
            <span class="bar"><span style={{ width: `${pct}%` }} /></span>
          </button>
        );
      })}
    </div>
  );
}

function ReeferRow({ r, onOpen }: { r: Reefer; onOpen: (r: Reefer) => void }) {
  const { marks } = useStore();
  const m = marks[r.cont];
  return (
    <button class="list-item" onClick={() => onOpen(r)}>
      <i class={`dot c-${categoryOf(r)}`} />
      <span class="li-main">
        <b>{r.cont}</b>
        <span class="muted">bay {bayGroupLabel(r.plugBay)} · {fmtPos(r.pos)} · {r.pol}→{r.pod} · {fmtTemp(r.temp)}</span>
        {m?.foundBay !== undefined && <span class="li-note">found {m.foundPos ? fmtPos(m.foundPos) : `in bay ${bayGroupLabel(m.foundBay)}`}</span>}
        {m && (m.tags.length > 0 || m.note) && <span class="li-note">{[...m.tags, m.note].filter(Boolean).join(' · ')}</span>}
      </span>
      {m?.loaded && <span class="tick-big">✓</span>}
    </button>
  );
}

export function Search({ plan, onOpen, bay }: { plan: Plan; onOpen: (r: Reefer) => void; bay: number }) {
  const [q, setQ] = useState('');
  const needle = q.replace(/\s+/g, '').toUpperCase();
  const res = needle.length >= 3 ? plan.reefers.filter(r => r.cont.includes(needle) || r.pos.startsWith(needle)).slice(0, 50) : [];
  return (
    <div class="search">
      <input
        type="search"
        inputMode="text"
        autoFocus
        placeholder="Container no. (last 4+ digits) or position"
        value={q}
        onInput={e => setQ((e.target as HTMLInputElement).value)}
      />
      {bay >= 0 && <p class="muted small">Checking bay {bayGroupLabel(bay)}: open a result to mark it as found in this bay.</p>}
      {needle.length > 0 && needle.length < 3 && <p class="muted">Type at least 3 characters.</p>}
      {needle.length >= 3 && res.length === 0 && <p class="muted">Not in the plan. If the container is on board, note it on the bay where you found it.</p>}
      {res.map(r => <ReeferRow r={r} onOpen={onOpen} />)}
    </div>
  );
}

export function Issues({ plan, filter, onOpen }: { plan: Plan; filter: Filter; onOpen: (r: Reefer) => void }) {
  const { marks } = useStore();
  const byCont = new Map(plan.reefers.map(r => [r.cont, r]));
  const rs = (pred: (r: Reefer) => boolean) => plan.reefers.filter(r => passes(r, filter) && pred(r));
  const moved = rs(r => !!marks[r.cont]?.movedFrom);
  const found = rs(r => marks[r.cont]?.foundBay !== undefined);
  const noted = rs(r => { const m = marks[r.cont]; return !!m && (m.tags.length > 0 || m.note.trim() !== ''); });
  const notInPlan = Object.entries(marks).filter(([c, m]) => m.notInPlan && !byCont.has(c));
  const attention = rs(r => r.attention !== null);
  const tdiff = rs(r => r.tempDiff);
  const restow = rs(r => !!r.restow);
  const special = rs(r => ['ct', 'ca', 'pharma'].includes(categoryOf(r)));

  const section = (title: string, list: Reefer[], hint?: string) => list.length > 0 && (
    <div class="card">
      <h3>{title} <span class="muted">({list.length})</span></h3>
      {hint && <p class="muted small">{hint}</p>}
      {list.map(r => <ReeferRow r={r} onOpen={onOpen} />)}
    </div>
  );

  return (
    <div class="issues">
      {section('Position changed after new plan', moved, 'You marked these before the plan changed. Check them again.')}
      {notInPlan.length > 0 && (
        <div class="card">
          <h3>Marked but not in the new plan <span class="muted">({notInPlan.length})</span></h3>
          {notInPlan.map(([c, m]) => (
            <div class="list-item">
              <span class="li-main"><b>{c}</b><span class="muted">{m.loaded ? 'was marked loaded' : ''} {[...m.tags, m.note].filter(Boolean).join(' · ')}</span></span>
              <button class="small-btn" onClick={() => forgetNotInPlan(c)}>Remove</button>
            </div>
          ))}
        </div>
      )}
      {section('Found in another bay', found)}
      {section('Your notes and tags', noted)}
      {section('Attention list (Excel)', attention)}
      {section('Temperature differs (BAP vs manifest)', tdiff)}
      {section('Restow', restow)}
      {section('Special (pharma / CT / CA)', special)}
      {!moved.length && !notInPlan.length && !found.length && !noted.length && !attention.length && !tdiff.length && !restow.length && !special.length && (
        <p class="muted">Nothing to show for this filter.</p>
      )}
    </div>
  );
}
