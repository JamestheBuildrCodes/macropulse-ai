import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/* MACROPULSE AI — engine. Calendar sync, alert dispatch, briefings, reviews,
   post-release reads, projection scoring, correlations.
   User-facing commands live in the macroBot function. */

const TZ = 'Africa/Lagos';
const CCYS = ['USD', 'EUR', 'GBP', 'JPY', 'AUD'];
const CAL = 'https://showmytrades.com/api/public/calendar/v1';
const DAYS = 10;
const SYNC_MIN = 900;
const RETENTION = 45;
const WRITE_BUDGET = 55;
const MAX_POST = 12;
const SEND_CAP = 400;
const SEND_CONC = 8;
const TD_KEY = () => (Deno.env.get('TWELVEDATA_API_KEY') || '').trim();
const TG = () => (Deno.env.get('MACROPULSE_BOT_TOKEN') || '').trim();

const WDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WMON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DNAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const D = 86400;
const nowSec = () => Math.floor(Date.now() / 1000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const r1 = (n: number) => Math.round(n * 10) / 10;

function ari(ts: number) { return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ts * 1000)).map((p) => p.value).join(''); }
function tzOff(ts: number) {
  const p: any = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ts * 1000))) p[x.type] = x.value;
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - ts * 1000) / 60000);
}
function wat(ts: number) { const d = new Date((ts + tzOff(ts) * 60) * 1000); return { d, y: d.getUTCFullYear(), m: d.getUTCMonth(), dd: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes(), dow: d.getUTCDay() }; }
const fmtTime = (ts: number) => { const w = wat(ts); return `${String(w.hh).padStart(2, '0')}:${String(w.mm).padStart(2, '0')}`; };
const fmtDay = (ts: number) => { const w = wat(ts); return `${WDAYS[w.dow]} ${String(w.dd).padStart(2, '0')} ${WMON[w.m]}`; };
const fmtStamp = (ts: number) => { const w = wat(ts); return `${WDAYS[w.dow]} ${String(w.dd).padStart(2, '0')} ${WMON[w.m]} ${String(w.hh).padStart(2, '0')}:${String(w.mm).padStart(2, '0')}`; };
const watDate = (ts: number) => { const w = wat(ts); return `${w.y}-${String(w.m + 1).padStart(2, '0')}-${String(w.dd).padStart(2, '0')}`; };
const dayStart = (ts: number) => { const w = wat(ts); return Math.floor((Date.UTC(w.y, w.m, w.dd) - tzOff(ts) * 60000) / 1000); };
function isoUTC(ts: number) { return new Date(ts * 1000).toISOString().replace('.000Z', 'Z'); }

function parseVal(s: any) {
  if (s === null || s === undefined) return null;
  const t = String(s).replace(/,/g, '').trim();
  if (!t || /^(n\/a|na|-|--|—)$/i.test(t)) return null;
  const m = t.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  let n = parseFloat(m[0]);
  if (/[Kk]$/.test(t)) n *= 1e3; else if (/[Mm]$/.test(t)) n *= 1e6; else if (/[Bb]$/.test(t)) n *= 1e9;
  return Number.isFinite(n) ? n : null;
}

const FAMS: [string, RegExp][] = [
  ['inflation', /cpi|inflation|price index|ppi|pce/i],
  ['employment', /employment|payroll|jobless|unemployment|wage|earnings|jobs/i],
  ['growth', /gdp|gross domestic|economic growth/i],
  ['retail', /retail sales|consumer spending/i],
  ['pmi', /pmi|purchasing manager|\bism\b/i],
  ['rates', /interest rate|rate decision|policy rate|bank rate/i],
  ['trade', /trade balance|current account|exports|imports/i],
  ['sentiment', /confidence|sentiment|expectations/i],
  ['housing', /home|housing|mortgage|building permits/i],
];
const UPCATS = new Set(['inflation', 'employment', 'growth', 'retail', 'pmi', 'rates', 'trade', 'sentiment', 'housing']);
function family(title: string) {
  const t = String(title || '');
  if (/speech|speaks|press conference|testimony|remarks|statement|minutes|bulletin/i.test(t)) return 'speech';
  for (const [k, rx] of FAMS) if (rx.test(t)) return k;
  return 'other';
}
function surprise(actual: any, forecast: any, previous: any, fam: string) {
  const a = parseVal(actual), f = parseVal(forecast), p = parseVal(previous);
  if (a === null) return null;
  const ref = f !== null ? f : p;
  if (ref === null) return { actual: a, forecast: f, previous: p, delta: null, pct: null, word: 'no forecast', dir: 0 };
  const delta = a - ref;
  const pct = ref === 0 ? null : (delta / Math.abs(ref)) * 100;
  const scale = Math.abs(pct ?? delta);
  let word = 'in line';
  if (scale >= 15) word = 'large'; else if (scale >= 6) word = 'significant'; else if (scale >= 1.5) word = 'modest'; else if (scale > 0.05) word = 'small';
  const dir = delta === 0 ? 0 : (UPCATS.has(fam) ? Math.sign(delta) : 0);
  return { actual: a, forecast: f, previous: p, delta, pct, word, dir };
}

/* ---------- telegram ---------- */
async function tg(method: string, payload: any) {
  const t = TG(); if (!t) return { ok: false };
  try {
    const r = await fetch(`https://api.telegram.org/bot${t}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return await r.json();
  } catch (e) { return { ok: false, error: String(e).slice(0, 160) }; }
}
function tgSend(chat: any, text: string, keyboard?: any) {
  const body: any = { chat_id: chat, text: String(text).slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true };
  if (keyboard) body.reply_markup = keyboard;
  return tg('sendMessage', body);
}

/* ---------- state + memo ---------- */
let MEMO: any = null;
function resetMemo() { MEMO = { states: new Map<string, any>(), settings: null, subs: null, prices: null }; }

async function getState(db: any, key: string) {
  if (MEMO && MEMO.states.has(key)) return MEMO.states.get(key);
  let row: any = null;
  try { const rows = await db.ScannerState.filter({ key }); row = rows && rows.length ? rows[0] : null; } catch { row = null; }
  if (MEMO) MEMO.states.set(key, row);
  return row;
}
async function setState(db: any, key: string, value: string, description = '') {
  const row = await getState(db, key);
  const payload = { key, value, description, updated_at: new Date().toISOString() };
  const res = row ? await db.ScannerState.update(row.id, payload) : await db.ScannerState.create(payload);
  if (MEMO) MEMO.states.set(key, { ...(row || {}), ...payload, id: row ? row.id : (res as any)?.id });
  return res;
}

const DEFAULT_SETTINGS = {
  owner_telegram_user_id: '', chat_id: null, connected: false,
  currencies: CCYS, high_impact_enabled: true, medium_impact_enabled: true,
  daily_briefing_time: '06:00', alert_lead_times: [60, 30, 15],
  daily_review_time: '22:00', weekly_review_time: '21:00', weekly_preview_time: '18:00',
  timezone: TZ, instruments: ['DXY', 'XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'EURJPY', 'GBPJPY', 'EURGBP'],
  verbosity: 'standard', alerts_paused: false, ai_analysis_enabled: false,
};
async function getSettings(db: any) {
  if (MEMO && MEMO.settings) return MEMO.settings;
  let s: any = (await db.MacroUserSettings.list('-created_date', 5)) || [];
  s = s && s.length ? s[0] : null;
  if (!s) { try { s = await db.MacroUserSettings.create({ ...DEFAULT_SETTINGS }); } catch { s = { ...DEFAULT_SETTINGS }; } }
  if (MEMO) MEMO.settings = s;
  return s;
}

async function listAll(db: any, name: string, sort = '-created_date', pageSize = 50, maxPages = 24) {
  const out: any[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < maxPages; i++) {
    let page: any[] = [];
    try { page = (await db[name].list(sort, pageSize, i * pageSize)) || []; } catch { break; }
    let fresh = 0;
    for (const r of page) {
      const k = String(r.id || JSON.stringify(r).slice(0, 40));
      if (!seen.has(k)) { seen.add(k); out.push(r); fresh++; }
    }
    if (page.length < pageSize || fresh === 0) break;
  }
  return out;
}

/* ---------- subscribers + fan-out ---------- */
async function getSubs(db: any) {
  if (MEMO && MEMO.subs) return MEMO.subs;
  const rows = await listAll(db, 'MacroUser', '-created_date', 50, 40);
  const out = rows.filter((u: any) => u.alerts_enabled !== false && (u.chat_id || u.telegram_user_id));
  if (!out.length) {
    const s = await getSettings(db);
    if (s.chat_id) out.push({ chat_id: s.chat_id });
  }
  if (MEMO) MEMO.subs = out;
  return out;
}

async function pump(db: any, key: string) {
  const rows = (await db.MacroNotificationLog.filter({ idempotency_key: key })) || [];
  const log = rows[0];
  if (!log) return 'no_log';
  if (log.delivery_status === 'sent') return 'sent';
  const subs = await getSubs(db);
  if (!subs.length) return 'no_subscribers';
  const cur = await getState(db, `fan|${key}`);
  const start = Number(cur?.value || 0) || 0;
  const slice = subs.slice(start, start + SEND_CAP);
  let ok = 0, bad = 0;
  for (let i = 0; i < slice.length; i += SEND_CONC) {
    const batch = slice.slice(i, i + SEND_CONC);
    const res = await Promise.allSettled(batch.map((u: any) => tgSend(String(u.chat_id || u.telegram_user_id), log.message_preview)));
    for (const r of res) { if (r.status === 'fulfilled' && (r.value as any)?.ok) ok++; else bad++; }
  }
  const next = start + slice.length;
  if (next >= subs.length) {
    try {
      await db.MacroNotificationLog.update(log.id, {
        delivery_status: ok ? 'sent' : 'failed', sent_at: new Date().toISOString(),
        retry_count: (log.retry_count || 0) + 1,
        error_message: bad ? `${bad} of ${slice.length} not delivered` : '',
        telegram_message_id: ok ? 1 : 0,
      });
      await setState(db, `fan|${key}`, '0', 'delivery cursor');
    } catch {}
    return ok ? `sent:${ok}` : 'failed';
  }
  await setState(db, `fan|${key}`, String(next), 'delivery cursor');
  return `partial:${ok}/${subs.length}`;
}

async function claim(db: any, key: string, kind: string, text: string, eventId = '') {
  const prior = (await db.MacroNotificationLog.filter({ idempotency_key: key })) || [];
  if (prior.length) {
    const p = prior[0];
    if (p.delivery_status === 'sent') return 'duplicate';
    if (p.delivery_status === 'queued') return await pump(db, key);
    if (p.delivery_status === 'failed' && (p.retry_count || 0) < 2) {
      try { await db.MacroNotificationLog.update(p.id, { delivery_status: 'queued', message_preview: text.slice(0, 3900), error_message: '' }); } catch {}
      return await pump(db, key);
    }
    return 'gave_up';
  }
  try {
    await db.MacroNotificationLog.create({ idempotency_key: key, event_id: eventId, stage: kind, channel: 'telegram', chat_id: 'all', delivery_status: 'queued', message_preview: text.slice(0, 3900), retry_count: 0 });
  } catch { return 'claim_failed'; }
  return await pump(db, key);
}

/* ---------- prices ---------- */
const TD: Record<string, string> = { EURUSD: 'EUR/USD', GBPUSD: 'GBP/USD', USDJPY: 'USD/JPY', AUDUSD: 'AUD/USD', XAUUSD: 'XAU/USD' };
async function tdSeries(sym: string, interval: string, size = 90) {
  const k = TD_KEY(); if (!k) throw new Error('no price key');
  const u = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sym)}&interval=${interval}&outputsize=${size}&timezone=UTC&apikey=${k}`;
  const r = await fetch(u);
  const j: any = await r.json();
  if (j.status === 'error') throw new Error(String(j.message || 'provider error').slice(0, 160));
  return (j.values || []).map((v: any) => ({ t: v.datetime, close: Number(v.close) })).filter((v: any) => Number.isFinite(v.close));
}
async function budget(db: any) {
  const s = await getState(db, 'mp_price_budget');
  let b: any = { day: '', used: 0 };
  try { b = JSON.parse(s?.value || '{}'); } catch { b = { day: '', used: 0 }; }
  const today = watDate(nowSec());
  if (b.day !== today) b = { day: today, used: 0 };
  return { ...b, ok: b.used < 380 };
}
async function budgetUse(db: any, n = 1) {
  const b = await budget(db);
  await setState(db, 'mp_price_budget', JSON.stringify({ day: b.day, used: b.used + n }), 'daily price call count');
}

async function dailyChange(db: any) {
  if (MEMO && MEMO.prices) return MEMO.prices;
  const today = watDate(nowSec());
  let rows: any[] = [];
  try { rows = (await db.PriceSnapshot.filter({ interval: 'day', bar_time: today })) || []; } catch {}
  if (rows.length >= 4) { if (MEMO) MEMO.prices = rows; return rows; }
  const have = new Set(rows.map((r: any) => r.instrument));
  const out = [...rows];
  for (const inst of Object.keys(TD)) {
    if (have.has(inst)) continue;
    const b = await budget(db);
    if (!b.ok) break;
    try {
      const s = await tdSeries(TD[inst], '1day', 2);
      if (s.length >= 2) {
        const rec = { instrument: inst, interval: 'day', bar_time: today, open: 0, high: 0, low: 0, close: s[0].close, source: 'twelvedata', fetched_at: new Date().toISOString() };
        const row = (await db.PriceSnapshot.create(rec)) || rec;
        out.push(row);
      }
      await budgetUse(db, 1);
    } catch { await budgetUse(db, 1); }
  }
  if (MEMO) MEMO.prices = out;
  return out;
}
function priceLine(rows: any[]) {
  const out: string[] = [];
  const order = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'XAUUSD'];
  const by = new Map(rows.map((r: any) => [r.instrument, r]));
  for (const i of order) {
    const r: any = by.get(i);
    if (!r || !r.close) continue;
    out.push(`${i} ${Number(r.close).toFixed(i === 'XAUUSD' ? 2 : 4)}`);
  }
  return out;
}

/* ---------- calendar ---------- */
async function fetchCal() {
  const r = await fetch(`${CAL}?days=${DAYS}&impact=high,medium`, { headers: { Accept: 'application/json' } });
  if (!r.ok) {
    const r2 = await fetch(`${CAL}?days=${DAYS}`, { headers: { Accept: 'application/json' } });
    if (!r2.ok) throw new Error(`calendar HTTP ${r.status}`);
    const j2: any = await r2.json();
    return j2.events || [];
  }
  const j: any = await r.json();
  return j.events || [];
}
function normEvent(raw: any): any {
  const ts = Number(raw.timestamp ?? raw.ts ?? raw.date ?? raw.time);
  const ccy = String(raw.currency ?? '').toUpperCase();
  const id = String(raw.id ?? raw.event_id ?? `${ccy}-${String(raw.title || '').toLowerCase().slice(0, 30)}-${ts}`);
  const impact = String(raw.impact ?? '').toLowerCase();
  return {
    event_id: id,
    title: String(raw.title ?? ''),
    currency: ccy,
    country: String(raw.country ?? ''),
    impact: /high/.test(impact) ? 'high' : /medium/.test(impact) ? 'medium' : 'low',
    ts,
    scheduled_utc: isoUTC(ts),
    scheduled_wat: isoUTC(ts + tzOff(ts) * 60).replace('Z', ''),
    previous: raw.previous != null ? String(raw.previous) : '',
    forecast: raw.forecast != null ? String(raw.forecast) : '',
    actual: raw.actual != null ? String(raw.actual) : '',
    revision_info: '', event_status: 'scheduled',
    source_provider: 'showmytrades', source_url: String(raw.url ?? ''),
    indicator_family: family(raw.title),
    notified_60: false, notified_30: false, notified_15: false, post_release_done: false,
    analysis_version: 0, briefed_date: '', first_seen_at: new Date().toISOString(), last_updated_at: new Date().toISOString(),
  };
}

async function sync(db: any) {
  const out: any = { fetched: 0, inserted: 0, updated: 0, moved: 0, cancelled: 0, partial: false, errors: [] };
  let raws: any[] = [];
  try { raws = await fetchCal(); } catch (e) { out.errors.push(String(e).slice(0, 200)); return out; }
  const nut = raws.map(normEvent).filter((e: any) => Number.isFinite(e.ts) && e.ts > 0 && CCYS.includes(e.currency) && (e.impact === 'high' || e.impact === 'medium'));
  out.fetched = nut.length;

  const existing = await listAll(db, 'EconomicEvent', '-ts', 50, 30);
  const byId = new Map<string, any>();
  for (const e of existing) byId.set(String(e.event_id), e);

  let writes = 0;
  for (const p of nut) {
    if (writes >= WRITE_BUDGET) { out.partial = true; break; }
    const cur = byId.get(p.event_id);
    try {
      if (!cur) {
        await db.EconomicEvent.create({ ...p });
        byId.set(p.event_id, p);
        out.inserted++; writes++;
      } else {
        const patch: any = {};
        for (const k of ['title', 'currency', 'country', 'impact', 'ts', 'scheduled_utc', 'scheduled_wat', 'previous', 'forecast', 'actual', 'indicator_family', 'event_status']) {
          if (String((cur as any)[k] ?? '') !== String((p as any)[k] ?? '')) patch[k] = (p as any)[k];
        }
        if (patch.ts !== undefined && patch.ts !== cur.ts) {
          out.moved++; patch.notified_60 = false; patch.notified_30 = false; patch.notified_15 = false;
          patch.post_release_done = false;
        }
        if (patch.actual !== undefined && patch.actual) patch.post_release_done = false;
        if (cur.previous && p.previous && String(cur.previous) !== String(p.previous)) patch.revision_info = `was ${cur.previous}, now ${p.previous}`;
        if (Object.keys(patch).length) {
          patch.last_updated_at = new Date().toISOString();
          await db.EconomicEvent.update(cur.id, patch);
          out.updated++; writes++;
          byId.set(p.event_id, { ...cur, ...patch });
        }
      }
    } catch (e) { out.errors.push(String(e).slice(0, 120)); out.partial = true; break; }
  }

  const n = nowSec();
  const seen = new Set(nut.map((e: any) => e.event_id));
  for (const e of existing) {
    if (e.ts > n && !seen.has(String(e.event_id)) && e.event_status !== 'cancelled' && e.source_provider === 'showmytrades') {
      if (writes >= WRITE_BUDGET + 15) { out.partial = true; break; }
      try { await db.EconomicEvent.update(e.id, { event_status: 'cancelled' }); out.cancelled++; writes++; } catch { break; }
    }
  }

  if (!out.partial) {
    const cutoff = n - RETENTION * D;
    const old = existing.filter((e: any) => e.ts < cutoff);
    for (const e of old.slice(0, 40)) { try { await db.EconomicEvent.delete(e.id); } catch { break; } }
    await setState(db, 'mp_last_sync_ts', String(n), 'last complete calendar sync');
  }
  try {
    await db.ApiHealthLog.create({ check_type: 'calendar_sync', status: out.errors.length ? 'degraded' : 'ok', detail: `fetched ${out.fetched}, new ${out.inserted}, changed ${out.updated}, rescheduled ${out.moved}, cancelled ${out.cancelled}`, events_received: out.fetched, checked_at: new Date().toISOString() });
  } catch {}
  return out;
}

async function dedupe(db: any) {
  const rows = await listAll(db, 'EconomicEvent', '-ts', 50, 30);
  const groups = new Map<string, any[]>();
  for (const r of rows) {
    const k = String(r.event_id);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  let removed = 0;
  for (const [, list] of groups) {
    if (list.length < 2) continue;
    list.sort((a, b) => {
      const score = (x: any) => (x.actual ? 2 : 0) + (x.post_release_done ? 1 : 0) + (x.notified_60 ? 0.5 : 0);
      const d = score(b) - score(a);
      if (d !== 0) return d;
      return new Date(a.created_date || 0).getTime() - new Date(b.created_date || 0).getTime();
    });
    for (const dup of list.slice(1)) {
      try { await db.EconomicEvent.delete(dup.id); removed++; } catch { return { removed, error: 'delete failed' }; }
    }
  }
  return { removed, groups: groups.size, rows: rows.length };
}

/* ---------- post-release ---------- */
function instrumentsFor(ccy: string) {
  if (ccy === 'USD') return ['EURUSD', 'XAUUSD', 'USDJPY'];
  if (ccy === 'EUR') return ['EURUSD'];
  if (ccy === 'GBP') return ['GBPUSD'];
  if (ccy === 'JPY') return ['USDJPY'];
  if (ccy === 'AUD') return ['AUDUSD'];
  return [];
}

function releaseText(e: any) {
  const s = surprise(e.actual, e.forecast, e.previous, e.indicator_family);
  const out: string[] = [];
  out.push(`<b>${esc(e.title)}</b>`);
  out.push(`${esc(e.currency)} · ${fmtStamp(e.ts)} WAT`);
  out.push('');
  if (e.actual) out.push(`Came in at <b>${esc(e.actual)}</b>`);
  if (e.forecast) out.push(`Expected ${esc(e.forecast)}`);
  if (e.previous) out.push(`Last time ${esc(e.previous)}`);
  out.push('');
  if (s && s.delta !== null) {
    const sign = s.delta > 0 ? '+' : '';
    out.push(`<b>Against forecast</b>`);
    out.push(`${sign}${r1(s.delta)}${s.pct !== null ? ` (${sign}${r1(s.pct)}%)` : ''} — ${s.word}.`);
    out.push('');
    if (s.dir !== 0) {
      const strong = s.dir > 0;
      out.push(`<b>Plain read</b>`);
      out.push(strong
        ? `That is a stronger ${esc(e.currency)} than expected. Firmer data usually nudges rate expectations up, which supports the currency.`
        : `That is a weaker ${esc(e.currency)} than expected. Softer data usually pulls rate expectations down, which weighs on the currency.`);
      out.push('');
    }
  } else if (e.actual) {
    out.push(`No forecast was published, so there is nothing to compare it against. Treat it as context rather than a surprise.`);
    out.push('');
  }
  const insts = instrumentsFor(e.currency);
  if (insts.length) {
    out.push(`<b>Worth watching now</b>`);
    out.push(insts.map((i) => `• ${i}`).join('\n'));
    out.push('');
  }
  out.push(`<i>Information only. A surprise is not a trade signal, and the market often does the opposite of the textbook reaction.</i>`);
  return out.join('\n');
}

async function postRelease(db: any, settings: any) {
  const n = nowSec();
  const due = (await listAll(db, 'EconomicEvent', '-ts', 50, 10))
    .filter((e: any) => e.actual && !e.post_release_done && e.ts <= n && e.ts > n - 3 * D && e.event_status !== 'cancelled')
    .slice(0, MAX_POST);
  const sent: any[] = [];
  for (const e of due) {
    const key = `${e.event_id}|post_release`;
    let res = 'skipped';
    if (e.impact === 'high' && !settings.alerts_paused) res = await claim(db, key, 'post_release', releaseText(e), e.event_id);
    else { try { await db.MacroNotificationLog.create({ idempotency_key: key, event_id: e.event_id, stage: 'post_release', channel: 'internal', delivery_status: 'sent', message_preview: '[logged only]', sent_at: new Date().toISOString() }); } catch {} }
    try { await db.EconomicEvent.update(e.id, { post_release_done: true }); } catch {}
    if (e.impact === 'high') await recordProjection(db, e);
    sent.push({ event: e.event_id, result: res });
  }
  return sent;
}

async function recordProjection(db: any, e: any) {
  const s = surprise(e.actual, e.forecast, e.previous, e.indicator_family);
  if (!s || s.dir === 0) return;
  const rows = await listAll(db, 'HistoricalProjection', '-recorded_at', 50, 6);
  const have = new Set(rows.map((p: any) => `${p.event_id}|${p.instrument}`));
  for (const inst of instrumentsFor(e.currency)) {
    const k = `${e.event_id}|${inst}`;
    if (have.has(k)) continue;
    try {
      await db.HistoricalProjection.create({
        event_id: e.event_id, event_title: e.title, currency: e.currency,
        indicator_family: e.indicator_family, impact: e.impact, instrument: inst,
        projected_bias: inst === 'XAUUSD' ? (s.dir > 0 ? 'down' : 'up') : (inst.startsWith('USD') && !inst.startsWith('USD/') ? (s.dir > 0 ? 'up' : 'down') : (inst.endsWith('USD') ? (s.dir > 0 ? 'down' : 'up') : (s.dir > 0 ? 'up' : 'down'))),
        confidence_category: s.word, empirical_probability: null, sample_size: 0,
        method: 'directional read from the data surprise; no historical sample used',
        projection_text: `Actual ${e.actual} versus forecast ${e.forecast ?? 'n/a'} (${s.word}).`,
        actual_value: e.actual, forecast_value: e.forecast, surprise: s.delta,
        outcome: 'pending', recorded_at: new Date().toISOString(),
      });
    } catch {}
  }
}

async function evaluate(db: any) {
  const pend = (await listAll(db, 'HistoricalProjection', '-recorded_at', 50, 4)).filter((p: any) => p.outcome === 'pending').slice(0, 10);
  if (!pend.length) return { considered: 0, evaluated: 0 };
  const events = new Map<string, any>();
  for (const e of await listAll(db, 'EconomicEvent', '-ts', 50, 10)) events.set(String(e.event_id), e);
  let done = 0;
  for (const p of pend) {
    const e = events.get(String(p.event_id));
    if (!e) continue;
    const sym = TD[p.instrument];
    if (!sym) continue;
    const b = await budget(db);
    if (!b.ok) break;
    try {
      const rows = await tdSeries(sym, '1h', 48);
      await budgetUse(db, 1);
      const after = rows.filter((r: any) => new Date(r.t.replace(' ', 'T') + 'Z').getTime() / 1000 > e.ts + 900).sort((a: any, c: any) => a.t.localeCompare(c.t));
      if (after.length < 2) continue;
      const base = after[0].close;
      const at = (mins: number) => after.find((r: any) => new Date(r.t.replace(' ', 'T') + 'Z').getTime() / 1000 >= e.ts + mins * 60)?.close ?? null;
      const m15 = at(15), m60 = at(60);
      const move = (m15 ?? m60) !== null ? (((m15 ?? m60) as number) - base) / base * 100 : null;
      if (move === null) continue;
      const realised = move > 0.02 ? 'up' : move < -0.02 ? 'down' : 'flat';
      const hit = p.projected_bias === realised ? 'correct' : realised === 'flat' ? 'inconclusive' : 'wrong';
      await db.HistoricalProjection.update(p.id, {
        outcome: hit, realized_direction: realised, reaction_m15: m15, reaction_m60: m60, evaluated_at: new Date().toISOString(),
      });
      done++;
    } catch { await budgetUse(db, 1); }
  }
  return { considered: pend.length, evaluated: done };
}

/* ---------- reports ---------- */
function lines(events: any[], max = 14) {
  const out: string[] = [];
  for (const e of events.slice(0, max)) {
    const bits = [e.forecast ? `expected ${esc(e.forecast)}` : '', e.previous ? `last ${esc(e.previous)}` : ''].filter(Boolean).join(', ');
    out.push(`${e.impact === 'high' ? '🔴' : '🟠'} <b>${fmtTime(e.ts)}</b> ${e.currency} ${esc(e.title)}${bits ? ` <i>(${bits})</i>` : ''}`);
  }
  if (events.length > max) out.push(`<i>…and ${events.length - max} more</i>`);
  return out.join('\n');
}

async function briefing(db: any) {
  const n = nowSec(), start = dayStart(n), end = start + D;
  const all = (await listAll(db, 'EconomicEvent', '-ts', 50, 20)).filter((e: any) => e.ts >= start && e.ts < end && e.event_status !== 'cancelled');
  const high = all.filter((e: any) => e.impact === 'high');
  const med = all.filter((e: any) => e.impact === 'medium');
  const out: string[] = [];
  out.push(`<b>Good morning — here is today</b>`);
  out.push(`${fmtDay(n)} · ${all.length} releases for USD, EUR, GBP, JPY and AUD`);
  out.push('');
  if (!all.length) { out.push(`Nothing on the calendar today. Quiet days are useful — nothing here needs your attention.`); return out.join('\n'); }
  if (high.length) { out.push(`<b>High impact</b>`); out.push(lines(high)); out.push(''); }
  if (med.length) { out.push(`<b>Medium impact</b>`); out.push(lines(med, 10)); out.push(''); }
  out.push(`You will get three reminders before each release: 60, 30 and 15 minutes. I will also send a plain read of what actually came out.`);
  out.push('');
  out.push(`<i>Times are WAT. Information only, never advice.</i>`);
  return out.join('\n');
}

async function dailyReview(db: any) {
  const n = nowSec(), start = dayStart(n);
  const today = (await listAll(db, 'EconomicEvent', '-ts', 50, 20)).filter((e: any) => e.ts >= start && e.ts <= n + 900 && e.event_status !== 'cancelled');
  const done = today.filter((e: any) => e.actual);
  const out: string[] = [];
  out.push(`<b>Your day in review</b>`);
  out.push(`${fmtDay(n)} · ${done.length} release${done.length === 1 ? '' : 's'} with numbers`);
  out.push('');
  if (!done.length) {
    out.push(`No economic data was published for the currencies you follow today.`);
    out.push('');
    out.push(`Days like this are worth noting: when nothing is released, price is usually driven by positioning and whatever was said earlier in the week.`);
  } else {
    out.push(`<b>What came out</b>`);
    for (const e of done.slice(0, 10)) {
      const s = surprise(e.actual, e.forecast, e.previous, e.indicator_family);
      const cmp = s && s.delta !== null ? ` vs ${esc(e.forecast)} expected — ${s.word}` : '';
      out.push(`• ${e.currency} ${esc(e.title)}: <b>${esc(e.actual)}</b>${cmp}`);
    }
    out.push('');
    const tally: Record<string, number> = {};
    for (const e of done) {
      const s = surprise(e.actual, e.forecast, e.previous, e.indicator_family);
      if (s && s.dir) tally[e.currency] = (tally[e.currency] || 0) + s.dir;
    }
    const reads = Object.entries(tally).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3);
    if (reads.length) {
      out.push(`<b>Where that leaves the currencies</b>`);
      for (const [ccy, v] of reads) out.push(`• ${ccy} — data leaned ${v > 0 ? 'stronger' : 'weaker'} overall today`);
      out.push('');
    }
  }
  const prices = await dailyChange(db);
  if (prices.length) {
    out.push(`<b>Prices</b>`);
    out.push(priceLine(prices).join(' · '));
    out.push('');
  }
  out.push(`<b>What we learned</b>`);
  out.push(done.length
    ? `The releases that surprised were the ones that moved expectations. Where the market did not follow the textbook direction, the surprise was probably already priced in.`
    : `A quiet calendar does not mean a quiet market. Positioning takes over when data is absent.`);
  out.push('');
  out.push(`<i>Times are WAT. Information only, never advice.</i>`);
  return out.join('\n');
}

async function weeklyReview(db: any) {
  const n = nowSec(), start = dayStart(n) - 6 * D, end = dayStart(n) + D;
  const week = (await listAll(db, 'EconomicEvent', '-ts', 50, 25)).filter((e: any) => e.ts >= start && e.ts < end && e.event_status !== 'cancelled');
  const done = week.filter((e: any) => e.actual);
  const out: string[] = [];
  out.push(`<b>Your week in review</b>`);
  out.push(`${fmtDay(start)} to ${fmtDay(end - 1)}`);
  out.push('');
  out.push(`${week.length} releases tracked, ${done.length} with numbers.`);
  out.push('');
  if (done.length) {
    out.push(`<b>Biggest surprises</b>`);
    const scored = done.map((e: any) => ({ e, s: surprise(e.actual, e.forecast, e.previous, e.indicator_family) }))
      .filter((x: any) => x.s && x.s.delta !== null)
      .sort((a: any, b: any) => Math.abs(b.s.pct ?? b.s.delta) - Math.abs(a.s.pct ?? a.s.delta));
    if (scored.length) {
      for (const x of scored.slice(0, 5)) out.push(`• ${x.e.currency} ${esc(x.e.title)}: ${esc(x.e.actual)} vs ${esc(x.e.forecast ?? 'n/a')} expected — ${x.s.word}`);
    } else out.push(`• Nothing landed far enough from forecast to count as a surprise.`);
    out.push('');
  }
  const prices = await dailyChange(db);
  if (prices.length) { out.push(`<b>Where prices sit</b>`); out.push(priceLine(prices).join(' · ')); out.push(''); }
  const ahead = (await listAll(db, 'EconomicEvent', '-ts', 50, 25)).filter((e: any) => e.ts > n && e.ts < n + 8 * D && e.impact === 'high');
  if (ahead.length) {
    out.push(`<b>Next week's most important</b>`);
    for (const e of ahead.slice(0, 5)) out.push(`🔴 ${fmtDay(e.ts)} ${fmtTime(e.ts)} — ${e.currency} ${esc(e.title)}`);
    out.push('');
  }
  out.push(`<i>Times are WAT. Information only, never advice.</i>`);
  return out.join('\n');
}

async function preview(db: any) {
  const n = nowSec(), start = dayStart(n) + D, end = start + 7 * D;
  const week = (await listAll(db, 'EconomicEvent', '-ts', 50, 25)).filter((e: any) => e.ts >= start && e.ts < end && e.event_status !== 'cancelled');
  const out: string[] = [];
  out.push(`<b>The week ahead</b>`);
  out.push(`${fmtDay(start)} to ${fmtDay(end - 1)} · ${week.length} releases`);
  out.push('');
  const high = week.filter((e: any) => e.impact === 'high');
  if (high.length) { out.push(`<b>Do not miss</b>`); for (const e of high.slice(0, 5)) out.push(`🔴 ${fmtDay(e.ts)} ${fmtTime(e.ts)} — ${e.currency} ${esc(e.title)}`); out.push(''); }
  const byDay = new Map<string, any[]>();
  for (const e of week) { const k = watDate(e.ts); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k)!.push(e); }
  for (const d of [...byDay.keys()].sort().slice(0, 5)) {
    const evs = byDay.get(d)!;
    const w = wat(new Date(`${d}T12:00:00Z`).getTime() / 1000);
    out.push(`<b>${DNAME[w.dow]} ${w.dd} ${WMON[w.m]}</b>`);
    out.push(lines(evs, 8));
    out.push('');
  }
  out.push(`<i>Times are WAT. Information only, never advice.</i>`);
  return out.join('\n');
}

/* ---------- correlations ---------- */
async function correlations(db: any) {
  const syms = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'XAUUSD'];
  const raw: any = {};
  let calls = 0;
  for (const inst of syms) {
    const b = await budget(db);
    if (!b.ok) break;
    if (calls > 0) await sleep(8500);
    try {
      const s = await tdSeries(TD[inst], '1day', 90);
      await budgetUse(db, 1); calls++;
      if (s.length >= 25) raw[inst] = s;
    } catch { await budgetUse(db, 1); calls++; }
  }
  const byDate: Record<string, Record<string, number>> = {};
  for (const k of Object.keys(raw)) {
    const m: Record<string, number> = {};
    for (const r of raw[k]) m[String(r.t).slice(0, 10)] = r.close;
    byDate[k] = m;
  }
  const keys = Object.keys(byDate);
  if (!keys.length) return { error: 'no price series' };
  const common = Object.keys(byDate[keys[0]]).filter((d) => keys.every((k) => byDate[k][d] !== undefined)).sort();
  if (common.length < 25) return { error: 'insufficient overlap' };
  const ser: Record<string, number[]> = {};
  for (const k of keys) ser[k] = common.map((d) => byDate[k][d]);
  const mul = (a: number[], b: number[]) => a.map((v, i) => v * b[i]);
  const div = (a: number[], b: number[]) => a.map((v, i) => v / b[i]);
  if (ser.EURUSD && ser.USDJPY) ser.EURJPY = mul(ser.EURUSD, ser.USDJPY);
  if (ser.GBPUSD && ser.USDJPY) ser.GBPJPY = mul(ser.GBPUSD, ser.USDJPY);
  if (ser.EURUSD && ser.GBPUSD) ser.EURGBP = div(ser.EURUSD, ser.GBPUSD);
  const ret = (a: number[]) => a.slice(1).map((v, i) => (v - a[i]) / a[i]);
  const corr = (x: number[], y: number[]) => {
    const n = Math.min(x.length, y.length);
    const mx = x.slice(0, n).reduce((s, v) => s + v, 0) / n, my = y.slice(0, n).reduce((s, v) => s + v, 0) / n;
    let sx = 0, sy = 0, sxy = 0;
    for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; sx += a * a; sy += b * b; sxy += a * b; }
    return sx && sy ? sxy / Math.sqrt(sx * sy) : 0;
  };
  const usd = ser.EURUSD ? ret(ser.EURUSD).map((v) => -v) : null;
  const gold = ser.XAUUSD ? ret(ser.XAUUSD) : null;
  const out: any[] = [];
  for (const p of Object.keys(ser)) {
    const rr = ret(ser[p]);
    const vsUsd = usd ? corr(rr, usd) : null;
    const vsGold = gold && p !== 'XAUUSD' ? corr(rr, gold) : null;
    out.push({ pair: p, base: p.slice(0, 3), quote: p.slice(3), window_days: common.length, coefficient: Number((vsUsd ?? 0).toFixed(3)), sample_size: rr.length, method: p.length > 6 ? 'derived from currency identities' : 'daily close returns', vsGold: vsGold !== null ? Number(vsGold.toFixed(3)) : null, period_start: common[0], period_end: common[common.length - 1] });
  }
  for (const r of out) {
    try {
      const prior = (await db.PairCorrelation.filter({ pair: r.pair })) || [];
      const payload = { ...r, computed_at: new Date().toISOString(), notes: r.vsGold !== null ? `correlation with gold ${r.vsGold}` : '' };
      if (prior.length) await db.PairCorrelation.update(prior[0].id, payload);
      else await db.PairCorrelation.create(payload);
    } catch {}
  }
  return out;
}

/* ---------- alerts ---------- */
const STAGES = [
  { flag: 'notified_60', lead: 60, tag: 'alert_60' },
  { flag: 'notified_30', lead: 30, tag: 'alert_30' },
  { flag: 'notified_15', lead: 15, tag: 'alert_15' },
];
function alertText(e: any, lead: number) {
  const out: string[] = [];
  out.push(lead >= 60 ? `⏰ <b>In one hour</b>` : lead >= 30 ? `⏰ <b>In 30 minutes</b>` : `⏰ <b>In 15 minutes</b>`);
  out.push('');
  out.push(`<b>${esc(e.title)}</b>`);
  out.push(`${esc(e.currency)} · ${e.impact === 'high' ? 'high impact' : 'medium impact'} · ${fmtTime(e.ts)} WAT`);
  out.push('');
  if (e.forecast) out.push(`Expected <b>${esc(e.forecast)}</b>`);
  if (e.previous) out.push(`Last time ${esc(e.previous)}`);
  const insts = instrumentsFor(e.currency);
  if (insts.length) { out.push(''); out.push(`Watch: ${insts.join(', ')}`); }
  return out.join('\n');
}

async function dispatch(db: any, settings: any) {
  const n = nowSec();
  const upcoming = (await listAll(db, 'EconomicEvent', '-ts', 50, 20)).filter((e: any) => {
    if (e.event_status === 'cancelled') return false;
    if (e.impact === 'high' && !settings.high_impact_enabled) return false;
    if (e.impact === 'medium' && !settings.medium_impact_enabled) return false;
    return e.ts > n - 300;
  });
  const sent: any[] = [];
  for (const e of upcoming) {
    for (const s of STAGES) {
      if (e[s.flag]) continue;
      const diff = e.ts - n;
      if (diff > s.lead * 60 || diff < s.lead * 60 - 300) continue;
      const key = `${e.event_id}|${s.tag}`;
      const res = await claim(db, key, s.tag, alertText(e, s.lead), e.event_id);
      if (res !== 'duplicate' && res !== 'gave_up') {
        try { await db.EconomicEvent.update(e.id, { [s.flag]: true }); } catch {}
      }
      sent.push({ event: e.event_id, stage: s.tag, result: res });
    }
  }
  return sent;
}

/* ---------- tick ---------- */
async function tick(db: any) {
  const started = Date.now();
  const out: any = { started: new Date().toISOString(), sync: null, alerts: [], reports: [], post: [], evaluate: null, errors: [] };
  resetMemo();
  const lock = await getState(db, 'mp_lock');
  if (lock && Number(lock.value) > nowSec()) return { skipped: 'locked', at: lock.value };
  await setState(db, 'mp_lock', String(nowSec() + 240), 'tick lock');
  try {
    const settings = await getSettings(db);

    const lastSync = await getState(db, 'mp_last_sync_ts');
    const lastVal = Number(lastSync?.value || 0);
    if (nowSec() - lastVal >= SYNC_MIN) {
      try { out.sync = await sync(db); } catch (e) { out.errors.push('sync: ' + String(e).slice(0, 150)); }
    }

    const queued = (await db.MacroNotificationLog.filter({ delivery_status: 'queued' })) || [];
    for (const q of queued.slice(0, 4)) {
      const r = await pump(db, q.idempotency_key);
      out.alerts.push({ event: q.event_id, stage: q.stage, result: r });
    }

    try { out.post = await postRelease(db, settings); } catch (e) { out.errors.push('post: ' + String(e).slice(0, 150)); }
    if (!settings.alerts_paused) {
      try { out.alerts.push(...(await dispatch(db, settings))); } catch (e) { out.errors.push('alerts: ' + String(e).slice(0, 150)); }
    }

    const w = wat(nowSec());
    const mins = w.hh * 60 + w.mm;
    const jobs = [
      { kind: 'briefing', at: settings.daily_briefing_time, win: 180, key: `briefing|${watDate(nowSec())}` },
      { kind: 'daily', at: settings.daily_review_time, win: 240, key: `daily|${watDate(nowSec())}` },
      { kind: 'weekly', at: settings.weekly_review_time, win: 180, key: `weekly|${watDate(nowSec())}`, dow: 5 },
      { kind: 'preview', at: settings.weekly_preview_time, win: 180, key: `preview|${watDate(nowSec())}`, dow: 0 },
    ];
    for (const j of jobs) {
      const [h, m] = String(j.at).split(':').map(Number);
      const target = h * 60 + m;
      if (j.dow !== undefined && w.dow !== j.dow) continue;
      if (mins < target || mins > target + j.win) continue;
      try {
        const text = j.kind === 'briefing' ? await briefing(db) : j.kind === 'daily' ? await dailyReview(db) : j.kind === 'weekly' ? await weeklyReview(db) : await preview(db);
        const res = await claim(db, j.key, j.kind, text);
        out.reports.push({ kind: j.kind, result: res });
      } catch (e) { out.errors.push(j.kind + ': ' + String(e).slice(0, 150)); }
    }

    try { out.evaluate = await evaluate(db); } catch (e) { out.errors.push('eval: ' + String(e).slice(0, 150)); }

    try {
      await db.ApiHealthLog.create({ check_type: 'dispatcher', status: out.errors.length ? 'degraded' : 'ok', detail: `alerts ${out.alerts.length}, reports ${out.reports.length}, post ${out.post.length}`, latency_ms: Date.now() - started, checked_at: new Date().toISOString() });
    } catch {}
  } finally {
    try { await setState(db, 'mp_lock', '0', 'tick lock'); } catch {}
  }
  return out;
}

/* ---------- self-test ---------- */
function selftest() {
  const results: any[] = [];
  const t = (name: string, pass: boolean, detail: any = '') => results.push({ name, pass, detail: String(detail).slice(0, 120) });
  const noon = Date.UTC(2026, 10, 10, 12, 0, 0) / 1000;
  t('time is UTC+1 in November', tzOff(noon) === 60, tzOff(noon));
  t('clock reads 13:00', fmtTime(noon) === '13:00', fmtTime(noon));
  t('day starts at midnight local', dayStart(noon) === noon - 13 * 3600, (noon - dayStart(noon)) / 3600);
  t('percent parsed', parseVal('0.3%') === 0.3, parseVal('0.3%'));
  t('negative percent parsed', parseVal('-1.2%') === -1.2, parseVal('-1.2%'));
  t('millions parsed', parseVal('1.33M') === 1330000, parseVal('1.33M'));
  t('empty is null', parseVal('') === null, '');
  t('cpi is inflation', family('Consumer Price Index MoM') === 'inflation', family('Consumer Price Index MoM'));
  t('payrolls is employment', family('Non Farm Payrolls') === 'employment', family('Non Farm Payrolls'));
  t('speech detected', family("ECB's Lagarde speech") === 'speech', family("ECB's Lagarde speech"));
  const s = surprise('0.4%', '0.3%', '0.2%', 'inflation');
  t('upside surprise is positive', !!s && s.delta > 0 && s.dir > 0, JSON.stringify(s));
  const down = surprise('-0.1%', '0.2%', '0.3%', 'inflation');
  t('downside surprise is negative', !!down && down.dir < 0, JSON.stringify(down));
  t('missing actual is null', surprise('', '0.3%', '0.2%', 'inflation') === null, '');
  t('utc iso formatted', isoUTC(noon) === '2026-11-10T12:00:00Z', isoUTC(noon));
  t('escape protects html', esc('<b>&') === '&lt;b&gt;&amp;', esc('<b>&'));
  const failed = results.filter((r) => !r.pass);
  return { passed: results.length - failed.length, failed: failed.length, results };
}

/* ---------- router ---------- */
Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ ok: true, service: 'macropulse' }), { headers: { 'Content-Type': 'application/json' } });
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const base44 = createClientFromRequest(req);
  const db = base44.asServiceRole.entities;
  const action = String(body.action || 'snapshot');
  try {
    if (action === 'selftest') return Response.json({ ...selftest(), now: new Date().toISOString() });
    resetMemo();
    if (action === 'snapshot') {
      const subs = await getSubs(db);
      const s = await getSettings(db);
      const rows = await listAll(db, 'EconomicEvent', '-ts', 50, 30);
      const n = nowSec();
      return Response.json({
        now: fmtStamp(n), today: watDate(n), subscribers: subs.length,
        event_count: rows.length, upcoming_count: rows.filter((e: any) => e.ts > n).length,
        settings: s, bot_configured: !!TG(), price_key: !!TD_KEY(),
        last_sync: (await getState(db, 'mp_last_sync_ts'))?.value || 'never',
      });
    }
    if (action === 'sync') return Response.json(await sync(db));
    if (action === 'dedupe') return Response.json(await dedupe(db));
    if (action === 'tick') return Response.json(await tick(db));
    if (action === 'report') {
      const k = String(body.kind || 'briefing');
      const text = k === 'briefing' ? await briefing(db) : k === 'daily' ? await dailyReview(db) : k === 'weekly' ? await weeklyReview(db) : await preview(db);
      return Response.json({ kind: k, text });
    }
    if (action === 'prices') return Response.json(await dailyChange(db));
    if (action === 'correlations') return Response.json(await correlations(db));
    if (action === 'eval') return Response.json(await evaluate(db));
    if (action === 'post') return Response.json(await postRelease(db, await getSettings(db)));
    if (action === 'health') {
      const rows = await listAll(db, 'ApiHealthLog', '-checked_at', 50, 2);
      return Response.json({ checks: rows.slice(0, 20) });
    }
    if (action === 'users') return Response.json({ subscribers: (await getSubs(db)).length });
    if (action === 'simulate') {
      const offs = Array.isArray(body.offsets_min) && body.offsets_min.length ? body.offsets_min : [60, 30, 15];
      const n = nowSec();
      const created: any[] = [];
      for (const o of offs) {
        const ts = n + Number(o) * 60;
        const rec = { ...normEvent({ id: `TEST-${o}-${ts}`, title: `[TEST] Simulated release in ${o} minutes`, currency: 'USD', impact: 'high', timestamp: ts, previous: '0.2%', forecast: '0.3%' }), source_provider: 'simulation' };
        const row = (await db.EconomicEvent.create(rec)) || {};
        created.push({ id: row.id, event_id: rec.event_id, at: fmtStamp(ts) });
      }
      return Response.json({ created });
    }
    if (action === 'cleanup_tests') {
      const rows = await listAll(db, 'EconomicEvent', '-ts', 50, 20);
      let deleted = 0;
      for (const e of rows) if (String(e.event_id || '').startsWith('TEST-')) { try { await db.EconomicEvent.delete(e.id); deleted++; } catch {} }
      return Response.json({ deleted });
    }
    return Response.json({ error: 'unknown action', action }, 200);
  } catch (e) {
    return Response.json({ error: String(e).slice(0, 400) }, 200);
  }
});
