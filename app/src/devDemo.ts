// DEV ONLY: open http://localhost:5173/#demo to load the local test workbook (localtest/v21.xlsm).
import { parseWorkbook } from './parseWorkbook';
import { applyPlan } from './store';

export async function loadDemo(name = 'v21.xlsm') {
  const res = await fetch(`/localtest/${name}`);
  if (!res.ok) throw new Error(`demo file: HTTP ${res.status}`);
  const file = new File([await res.arrayBuffer()], name);
  const plan = await parseWorkbook(file);
  applyPlan(plan);
  (window as unknown as { __plan: unknown }).__plan = plan;
  console.info('[demo] loaded', plan.reefers.length, 'reefers');
}
