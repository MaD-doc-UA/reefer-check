import { useState } from 'preact/hooks';
import { BAY_GROUPS, TAGS, bayGroupLabel, pad2, plugBayOf, type Reefer, type Tag } from '../model';
import { markFound, setNote, setTags, toggleLoaded, useStore } from '../store';
import { CATEGORY_LABEL, categoryOf, fmtNum, fmtPos, fmtTemp } from '../view';

interface Props {
  reefer: Reefer;
  contextBay: number | null; // bay the user is checking right now
  onClose: () => void;
}

function fmtTime(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const ROW_ORDER = [14, 12, 10, 8, 6, 4, 2, 1, 3, 5, 7, 9, 11, 13];

/** Valid slots of a bay group split into tier -> row -> slot (40' / 20' fore / 20' aft). */
function slotTree(slots: string[], bay: number) {
  const inBay = slots.filter(p => plugBayOf(+p.slice(0, 2)) === bay);
  const tiers = [...new Set(inBay.map(p => +p.slice(4, 6)))].sort((a, b) => b - a);
  const rowsAt = (tier: number) =>
    ROW_ORDER.filter(r => inBay.some(p => +p.slice(4, 6) === tier && +p.slice(2, 4) === r));
  const sizesAt = (tier: number, row: number) =>
    inBay
      .filter(p => +p.slice(4, 6) === tier && +p.slice(2, 4) === row)
      .sort()
      .map(p => {
        const b = +p.slice(0, 2);
        return { pos: p, label: b % 2 ? (b < bay ? `20' fore (${pad2(b)})` : `20' aft (${pad2(b)})`) : `40' (${pad2(b)})` };
      });
  return { tiers, rowsAt, sizesAt };
}

export function ContainerSheet({ reefer: r, contextBay, onClose }: Props) {
  const { marks, plan, log } = useStore();
  const m = marks[r.cont];
  const [note, setNoteText] = useState(m?.note ?? '');
  const [picking, setPicking] = useState(false);
  const [bay, setBay] = useState<number>(contextBay ?? r.plugBay);
  const [tier, setTier] = useState<number>(0);
  const [row, setRow] = useState<number>(-1);
  const [pos, setPos] = useState<string>('');
  const cat = categoryOf(r);
  const otherBay = contextBay !== null && contextBay !== r.plugBay;
  const history = log.filter(e => e.cont === r.cont).slice(-20).reverse();
  const tree = slotTree(plan?.slots ?? [], bay);
  const rows = tier ? tree.rowsAt(tier) : [];
  const sizes = tier && row >= 0 ? tree.sizesAt(tier, row) : [];
  const pickTier = (t: number) => { setTier(t); setRow(-1); setPos(''); };
  const pickRow = (rw: number) => {
    setRow(rw);
    const s = rw >= 0 ? tree.sizesAt(tier, rw) : [];
    // one possible slot: take it; 40' + 20's: prefer the same size as planned
    const planned20 = r.bay % 2 === 1;
    const pref = s.find(x => (+x.pos.slice(0, 2) % 2 === 1) === planned20) ?? s[0];
    setPos(pref ? pref.pos : '');
  };

  const toggleTag = (t: Tag) => {
    const tags = m?.tags ?? [];
    setTags(r.cont, tags.includes(t) ? tags.filter(x => x !== t) : [...tags, t]);
  };
  const close = () => { setNote(r.cont, note); onClose(); };
  const startPick = (b: number) => { setBay(b); setTier(0); setRow(-1); setPos(''); setPicking(true); };
  const confirmFound = () => {
    markFound(r.cont, r.pos, bay, pos || undefined);
    setPicking(false);
  };

  return (
    <div class="sheet-backdrop" onClick={close}>
      <div class="sheet" role="dialog" aria-label={r.cont} onClick={e => e.stopPropagation()}>
        <div class="sheet-head">
          <div>
            <div class="cont-no">{r.cont.slice(0, 4)} <b>{r.cont.slice(4)}</b></div>
            <div class="muted">Bay {bayGroupLabel(r.plugBay)} · pos {fmtPos(r.pos)} · {r.deck ? 'DECK' : 'HOLD'}</div>
          </div>
          <button class="icon-btn" onClick={close} aria-label="Close">✕</button>
        </div>

        <div class="facts">
          <div><span>POL → POD</span><b>{r.pol} → {r.pod}</b></div>
          <div><span>Set temp</span><b class={r.tempDiff ? 'bad' : ''}>{fmtTemp(r.temp)}</b></div>
          {r.tempDiff && <div><span>Manifest temp</span><b class="bad">{fmtTemp(r.manTemp)} (differs)</b></div>}
          <div><span>Vent / Hum</span><b>{fmtNum(r.vent) || '0'} / {fmtNum(r.hum) || '0'}</b></div>
          {((r.o2 ?? 0) > 0 || (r.co2 ?? 0) > 0) && <div><span>O2 / CO2</span><b>{fmtNum(r.o2)} / {fmtNum(r.co2)} %</b></div>}
          <div><span>Type</span><b><i class={`dot c-${cat}`} />{CATEGORY_LABEL[cat]}{r.special && cat !== 'ct' && cat !== 'ca' ? ` (${r.special})` : ''}</b></div>
          {r.attention !== null && <div><span>Attention</span><b>{r.attention || 'listed'}</b></div>}
          {r.posNote && <div><span>Position note</span><b>{r.posNote}</b></div>}
          {r.restow && <div><span>Restow</span><b class="bad">{r.restow}</b></div>}
        </div>

        {m?.movedFrom && <div class="warn">Plan changed: you checked it at {fmtPos(m.movedFrom)}, new plan says {fmtPos(r.pos)}. Check again.</div>}
        {m?.foundBay !== undefined && (
          <div class="warn">
            Found {m.foundPos ? `at ${fmtPos(m.foundPos)} (bay ${bayGroupLabel(m.foundBay)})` : `in bay ${bayGroupLabel(m.foundBay)}`}, plan says {fmtPos(r.pos)}.
          </div>
        )}

        <button class={`big-btn ${m?.loaded ? 'on' : ''}`} onClick={() => toggleLoaded(r.cont, r.pos)}>
          {m?.loaded ? '✓ Loaded (tap to undo)' : 'Mark as loaded'}
        </button>
        {m?.loaded && m.loadedAt && <div class="muted small center">by {m.loadedBy || '?'} · {fmtTime(m.loadedAt)}</div>}

        {!picking && (
          <>
            {otherBay && (
              <button class="big-btn alt" onClick={() => startPick(contextBay!)}>Found here in bay {bayGroupLabel(contextBay!)}…</button>
            )}
            <button class="link-btn" onClick={() => startPick(contextBay ?? r.plugBay)}>Not in its planned slot? Set where it was found</button>
          </>
        )}

        {picking && (
          <div class="card pick">
            <h3>Where was it found?</h3>
            <div class="row-inline">
              <label class="muted" for="pickBay">Bay</label>
              <select id="pickBay" value={bay} onChange={e => { setBay(+(e.target as HTMLSelectElement).value); pickTier(0); }}>
                {BAY_GROUPS.map(b => <option value={b}>{bayGroupLabel(b)}</option>)}
              </select>
              <label class="muted" for="pickTier">Tier</label>
              <select id="pickTier" value={tier} onChange={e => pickTier(+(e.target as HTMLSelectElement).value)}>
                <option value={0}>?</option>
                {tree.tiers.map(t => <option value={t}>{pad2(t)}{t >= 80 ? ' deck' : ''}</option>)}
              </select>
              <label class="muted" for="pickRow">Row</label>
              <select id="pickRow" value={row} disabled={!tier} onChange={e => pickRow(+(e.target as HTMLSelectElement).value)}>
                <option value={-1}>?</option>
                {rows.map(rw => <option value={rw}>{pad2(rw)}</option>)}
              </select>
            </div>
            {sizes.length > 1 && (
              <div class="seg">
                {sizes.map(s => <button class={pos === s.pos ? 'on' : ''} onClick={() => setPos(s.pos)}>{s.label}</button>)}
              </div>
            )}
            {!pos && <p class="muted small">Leave tier / row as "?" if you only know the bay.</p>}
            {pos && plan?.reefers.some(x => x.pos === pos && x.cont !== r.cont) && (
              <p class="muted small">Planned there: {plan.reefers.filter(x => x.pos === pos).map(x => x.cont).join(', ')}</p>
            )}
            <div class="row-inline">
              <button class="small-btn primary" onClick={confirmFound}>Confirm{pos ? ` ${pad2(+pos.slice(0, 2))} ${pos.slice(2, 4)} ${pos.slice(4, 6)}` : ` bay ${bayGroupLabel(bay)}`}</button>
              <button class="small-btn" onClick={() => setPicking(false)}>Cancel</button>
            </div>
          </div>
        )}

        <div class="tags">
          {TAGS.map(t => (
            <button class={`tag ${m?.tags.includes(t) ? 'on' : ''}`} onClick={() => toggleTag(t)}>{t}</button>
          ))}
        </div>
        <textarea
          placeholder="Note (e.g. alarm code, set point out of range, plug damaged...)"
          value={note}
          onInput={e => setNoteText((e.target as HTMLTextAreaElement).value)}
          onBlur={() => setNote(r.cont, note)}
          rows={3}
        />

        {history.length > 0 && (
          <div class="history">
            <h3>History</h3>
            {history.map(e => (
              <div class="small"><span class="muted">{fmtTime(e.t)}</span> <b>{e.by}</b> {e.action}{e.detail ? `: ${e.detail}` : ''}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
