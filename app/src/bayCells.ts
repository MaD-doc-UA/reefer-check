// What sits in each slot of one bay for the current mode: shared by the bay plan and the Overview.
import { plugBayOf, side20, type Plan, type Reefer } from './model';
import { passes, placed, type Filter } from './view';

export interface CellData {
  slot: boolean;      // a reefer plug exists here (any of 40'/20')
  c40?: Reefer;
  fore?: Reefer;
  aft?: Reefer;
}

export const cellKey = (row: number, tier: number) => `${row}-${tier}`;

/**
 * Slots of a plug bay and the reefers drawn in them. In LOAD / DISCH only the reefers of the work at the port
 * are drawn (others leave the slot empty). `inBay` = every reefer placed in the bay for this mode, drawn or not.
 */
export function bayCells(plan: Plan, bay: number, filter: Filter): { cells: Map<string, CellData>; inBay: Reefer[] } {
  const cells = new Map<string, CellData>();
  const get = (row: number, tier: number) => {
    const k = cellKey(row, tier);
    let c = cells.get(k);
    if (!c) { c = { slot: false }; cells.set(k, c); }
    return c;
  };
  for (const p of plan.slots) {
    const b = +p.slice(0, 2);
    if (plugBayOf(b) === bay) get(+p.slice(2, 4), +p.slice(4, 6)).slot = true;
  }
  // reefers kept from the arrival plan exist only in DISCH mode; there they sit in their old slot,
  // and so do moved reefers (restow) in DISCH mode (a loading reefer planned for the same slot comes later, so it gives way)
  const atArrival = (r: Reefer) => !!r.carried || placed(r, filter) !== r;
  const inBay = plan.reefers
    .filter(r => placed(r, filter).plugBay === bay && (!r.carried || filter.mode === 'pod'))
    .sort((a, b) => Number(atArrival(a)) - Number(atArrival(b)));
  for (const r of inBay) {
    const p = placed(r, filter);
    const c = get(p.row, p.tier);
    c.slot = true;
    if (!passes(r, filter)) continue; // LOAD / DISCH: other ports' reefers are not drawn (the slot stays empty)
    const s = side20(p.bay, p.plugBay);
    if (atArrival(r)) { c.c40 = undefined; if (s !== 'aft') c.fore = undefined; if (s !== 'fore') c.aft = undefined; }
    if (s === 'fore') c.fore = r; else if (s === 'aft') c.aft = r; else c.c40 = r;
  }
  return { cells, inBay };
}
