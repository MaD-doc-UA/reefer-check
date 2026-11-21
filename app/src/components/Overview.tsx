// All bays on one page, like the Overview sheet of the workbook: plug slots light, reefers in their category colour.
import { BAY_GROUPS, DECK_TIERS, HOLD_TIERS, ROWS_ORDER, bayGroupLabel, pad2, plugBayOf, type Plan, type Reefer } from '../model';
import { useStore } from '../store';
import { CATEGORY_LABEL, categoryOf, isDone, passes, type Category, type Filter } from '../view';
import { bayCells, cellKey, type CellData } from '../bayCells';

const LEGEND: Category[] = ['normal', 'attention', 'note', 'pharma', 'ct', 'ca', 'superfreezer'];

export function Overview({ plan, filter, onBay }: { plan: Plan; filter: Filter; onBay: (b: number) => void }) {
  const { marks } = useStore();

  // tiers that have plugs anywhere on the ship: every panel uses the same grid, as on the sheet
  const tiers = new Set(plan.slots.map(p => +p.slice(4, 6)));
  const deckTiers = DECK_TIERS.filter(t => tiers.has(t));
  const holdTiers = HOLD_TIERS.filter(t => tiers.has(t));

  const shown = plan.reefers.filter(r => passes(r, filter));
  const ports = plan.ports.filter(p => shown.some(r => r.pol === p || r.pod === p));

  const box = (r: Reefer, half?: 'F' | 'A') =>
    <i class={`c-${categoryOf(r)}${half ? ' ov-half' : ''}`} title={`${r.cont} ${r.pol}-${r.pod}`} />;

  const cellContent = (c: CellData) => {
    if (c.c40) return box(c.c40);
    if (c.fore && c.aft) return <>{box(c.fore, 'F')}{box(c.aft, 'A')}</>;
    if (c.fore) return box(c.fore);
    if (c.aft) return box(c.aft);
    return null;
  };

  const block = (cells: Map<string, CellData>, ts: number[]) => (
    <div class="ov-block">
      {ts.map(t => (
        <>
          <span class="ov-tier">{pad2(t)}</span>
          {ROWS_ORDER.map(row => {
            const c = cells.get(cellKey(row, t));
            return c?.slot ? <span class="ov-cell slot">{cellContent(c)}</span> : <span class="ov-cell" />;
          })}
        </>
      ))}
    </div>
  );

  return (
    <div class="overview">
      <div class="ov-bays">
        {BAY_GROUPS.map(b => {
          const { cells, inBay } = bayCells(plan, b, filter);
          const hasDeck = plan.slots.some(p => plugBayOf(+p.slice(0, 2)) === b && +p.slice(4, 6) >= 80);
          const hasHold = plan.slots.some(p => plugBayOf(+p.slice(0, 2)) === b && +p.slice(4, 6) < 80);
          const rs = inBay.filter(r => passes(r, filter));
          const done = rs.filter(r => isDone(marks[r.cont], filter)).length;
          return (
            <button class={`ov-bay ${rs.length === 0 ? 'none' : ''}`} onClick={() => onBay(b)}>
              <div class="ov-inner">
              <div class="ov-block ov-head">
                <span class="ov-tier" />
                {ROWS_ORDER.map(row => <span class="ov-rowno">{pad2(row)}</span>)}
              </div>
              {hasDeck && block(cells, deckTiers)}
              {hasHold && <div class="ov-gap" />}
              {hasHold && block(cells, holdTiers)}
              <span class="ov-label">BAY {bayGroupLabel(b)}<span class="muted"> · {done}/{rs.length}</span></span>
              </div>
            </button>
          );
        })}
      </div>

      {ports.length > 0 && (
        <div class="card ov-ports">
          <table>
            <tbody>
              <tr><th>PORT</th>{ports.map(p => <th>{p}</th>)}</tr>
              <tr><th>POL</th>{ports.map(p => <td>{shown.filter(r => r.pol === p).length}</td>)}</tr>
              <tr><th>POD</th>{ports.map(p => <td>{shown.filter(r => r.pod === p).length}</td>)}</tr>
            </tbody>
          </table>
          <p class="muted small">Counts the reefers shown above ({shown.length}).</p>
        </div>
      )}

      <div class="ov-legend small">
        {LEGEND.map(c => <span><i class={`dot c-${c}`} />{c === 'ca' ? 'CA / O2-CO2' : CATEGORY_LABEL[c]}</span>)}
        <span><i class="dot ov-free" />free reefer slot</span>
      </div>
      <p class="muted small">Tap a bay to open it.</p>
    </div>
  );
}
