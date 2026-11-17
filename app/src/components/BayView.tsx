import { DECK_TIERS, HOLD_TIERS, ROWS_ORDER, bayGroupLabel, pad2, plugBayOf, side20, type Plan, type Reefer } from '../model';
import { toggleLoaded, useStore } from '../store';
import { categoryOf, passes, shortNo, type Filter } from '../view';

interface Props {
  plan: Plan;
  bay: number;
  filter: Filter;
  quickMark: boolean;
  onOpen: (r: Reefer) => void;
  onBay: (bay: number) => void;
}

interface CellData {
  slot: boolean;      // a reefer plug exists here (any of 40'/20')
  c40?: Reefer;
  fore?: Reefer;
  aft?: Reefer;
}

export function BayView({ plan, bay, filter, quickMark, onOpen, onBay }: Props) {
  const { marks } = useStore();
  const cells = new Map<string, CellData>();
  const key = (row: number, tier: number) => `${row}-${tier}`;
  const get = (row: number, tier: number) => {
    const k = key(row, tier);
    let c = cells.get(k);
    if (!c) { c = { slot: false }; cells.set(k, c); }
    return c;
  };
  for (const p of plan.slots) {
    const b = +p.slice(0, 2);
    if (plugBayOf(b) === bay) get(+p.slice(2, 4), +p.slice(4, 6)).slot = true;
  }
  const inBay = plan.reefers.filter(r => r.plugBay === bay);
  for (const r of inBay) {
    const c = get(r.row, r.tier);
    c.slot = true;
    const s = side20(r.bay, r.plugBay);
    if (s === 'fore') c.fore = r; else if (s === 'aft') c.aft = r; else c.c40 = r;
  }

  const shown = inBay.filter(r => passes(r, filter));
  const done = shown.filter(r => marks[r.cont]?.loaded).length;
  const foundHere = Object.entries(marks).filter(([, m]) => m.foundBay === bay);

  const usedRows = ROWS_ORDER.filter(row => [...DECK_TIERS, ...HOLD_TIERS].some(t => cells.get(key(row, t))?.slot));
  const tiersWith = (tiers: number[]) => tiers.filter(t => usedRows.some(row => cells.get(key(row, t))?.slot));

  const tap = (r: Reefer) => {
    if (quickMark) toggleLoaded(r.cont, r.pos);
    else onOpen(r);
  };

  const box = (r: Reefer | undefined, half?: 'fore' | 'aft') => {
    if (!r) return half ? <div class="half empty" /> : null;
    const m = marks[r.cont];
    const dim = !passes(r, filter);
    const cls = [
      half ? 'half' : 'full', `c-${categoryOf(r)}`,
      m?.loaded ? 'loaded' : '', dim ? 'dim' : '',
      r.restow ? 'restow' : '', r.tempDiff ? 'tdiff' : '',
      m && (m.tags.length || m.note || m.foundBay !== undefined || m.movedFrom) ? 'issue' : '',
    ].join(' ');
    return (
      <button class={cls} onClick={() => tap(r)} title={`${r.cont} ${r.pol}-${r.pod}`}>
        <span class="no">{shortNo(r.cont)}</span>
        {!half && <span class="pod">{r.pod}</span>}
        {m?.loaded && <span class="tick">✓</span>}
      </button>
    );
  };

  const grid = (tiers: number[], label: string) => tiers.length > 0 && (
    <div class="grid-block">
      <div class="grid-label">{label}</div>
      <div class="grid-scroll">
        <table class="bay-grid">
          <thead>
            <tr><th />{usedRows.map(row => <th>{pad2(row)}</th>)}</tr>
          </thead>
          <tbody>
            {tiers.map(t => (
              <tr>
                <th>{pad2(t)}</th>
                {usedRows.map(row => {
                  const c = cells.get(key(row, t));
                  if (!c?.slot) return <td class="noslot" />;
                  return (
                    <td class="slot">
                      {c.c40 ? box(c.c40) : (c.fore || c.aft) ? <div class="split">{box(c.fore, 'fore')}{box(c.aft, 'aft')}</div> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div class="bay-view">
      <div class="bay-head">
        <button class="icon-btn" onClick={() => onBay(-1)} aria-label="All bays">‹</button>
        <h2>Bay {bayGroupLabel(bay)}</h2>
        <span class="progress-text">{done}/{shown.length}</span>
      </div>
      {grid(tiersWith(DECK_TIERS), 'DECK')}
      {grid(tiersWith(HOLD_TIERS), 'HOLD')}
      <p class="muted small">
        {plan.slots.some(p => { const b = +p.slice(0, 2); return b % 2 === 1 && plugBayOf(b) === bay; }) &&
          `20' slots are split: top = fore (${pad2(bay - 1)}), bottom = aft (${pad2(bay + 1)}). `}
        Faded = outside the port filter.
      </p>
      {foundHere.length > 0 && (
        <div class="card">
          <h3>Found in this bay (planned elsewhere)</h3>
          {foundHere.map(([c, m]) => {
            const r = plan.reefers.find(x => x.cont === c);
            const at = m.foundPos ? `found ${m.foundPos.slice(0, 2)} ${m.foundPos.slice(2, 4)} ${m.foundPos.slice(4, 6)} · ` : '';
            return r
              ? <button class="list-item" onClick={() => onOpen(r)}><b>{c}</b> <span class="muted">{at}plan: {r.pos.slice(0, 2)} {r.pos.slice(2, 4)} {r.pos.slice(4, 6)}</span></button>
              : <div class="list-item">{c}</div>;
          })}
        </div>
      )}
    </div>
  );
}
