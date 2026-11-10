import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/* MACROPULSE AI — bot front end.
   On-screen keyboard, inline menus, plain-English explainer.
   Scheduler and delivery live in the macroPulse function; this only talks to users. */

const TZ = 'Africa/Lagos';
const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'AUD'];
const TG = () => (Deno.env.get('MACROPULSE_BOT_TOKEN') || '').trim();
const SECRET = () => (Deno.env.get('MACROPULSE_WEBHOOK_SECRET') || '').trim();

const WDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WMON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DNAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function json(o: any, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
}
function esc(s: any) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function tzOffsetMin(ts: number) {
  const d = new Date(ts * 1000);
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d);
  const g: any = {};
  for (const x of p) g[x.type] = x.value;
  const asUTC = Date.UTC(+g.year, +g.month - 1, +g.day, +g.hour % 24, +g.minute, +g.second);
  return Math.round((asUTC - d.getTime()) / 60000);
}
function fmtTime(ts: number) {
  const d = new Date((ts + tzOffsetMin(ts) * 60) * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
function fmtDate(ts: number) {
  const d = new Date((ts + tzOffsetMin(ts) * 60) * 1000);
  return `${WDAYS[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')} ${WMON[d.getUTCMonth()]}`;
}
function fmtStamp(ts: number) {
  const d = new Date((ts + tzOffsetMin(ts) * 60) * 1000);
  return `${WDAYS[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')} ${WMON[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
function watDate(ts: number) {
  return new Date((ts + tzOffsetMin(ts) * 60) * 1000).toISOString().slice(0, 10);
}
function dayStart(ts: number) {
  return Math.floor((ts + tzOffsetMin(ts) * 60) / 86400) * 86400 - tzOffsetMin(ts) * 60;
}
const nowSec = () => Math.floor(Date.now() / 1000);

/* ---------- plain-English knowledge base ---------- */

const FAMILY: Record<string, { what: string; why: string; watch: string }> = {
  inflation: {
    what: 'how quickly prices for everyday goods and services are rising.',
    why: 'inflation is the number central banks react to most strongly, and interest rates drive currencies.',
    watch: 'the core figure rather than the headline, and whether the move is large enough to change what the central bank does next.',
  },
  employment: {
    what: 'how many people were hired, and how many are still looking for work.',
    why: 'central banks watch jobs closely before cutting or raising rates.',
    watch: 'wages and unemployment alongside the headline count, because a strong hiring number with weak wages reads very differently.',
  },
  growth: {
    what: 'the total size of the economy and how fast it is changing.',
    why: 'weak growth usually pulls expectations of rate cuts forward, and strong growth does the opposite.',
    watch: 'revisions to earlier figures, and whether growth is broad or concentrated in one sector.',
  },
  retail: {
    what: 'how much households actually spent.',
    why: 'consumer spending is the largest part of most developed economies.',
    watch: 'whether the increase is real spending or just prices rising, which the volume figure separates.',
  },
  pmi: {
    what: 'a monthly survey of purchasing managers. Above 50 means activity is expanding, below 50 means it is shrinking.',
    why: 'it arrives before the official data, so markets react to it early.',
    watch: 'the direction of the change more than the level, and the gap between new orders and output.',
  },
  rates: {
    what: "the central bank's decision on the cost of borrowing.",
    why: 'it sets the price of money for everything else in an economy.',
    watch: 'the wording about future decisions more than the number itself, which is usually expected in advance.',
  },
  trade: {
    what: 'the gap between what a country exports and what it imports.',
    why: 'trade flows create direct demand for the currency.',
    watch: 'energy price effects, which can distort the headline in both directions.',
  },
  sentiment: {
    what: 'a survey of how households or businesses feel about the economy.',
    why: 'confidence often shows up in spending before it shows up in official data.',
    watch: 'whether the survey lines up with actual spending numbers, or contradicts them.',
  },
  housing: {
    what: 'home sales, building activity and house prices.',
    why: 'housing is the most interest-rate-sensitive part of an economy.',
    watch: 'mortgage rates and inventory, which explain most of the month-to-month swings.',
  },
  speech: {
    what: 'a central bank official speaking in public.',
    why: 'a single sentence can move expectations about future interest rates.',
    watch: 'whether they repeat or contradict the last official policy statement.',
  },
  other: {
    what: 'an economic indicator that matters to this currency.',
    why: 'it feeds into how markets judge the economy and therefore interest rate expectations.',
    watch: 'the gap between what was expected and what was delivered.',
  },
};

const SPEECH_RE = /speech|speaks|press conference|testimony|remarks|statement|minutes|bulletin/i;

function familyOf(e: any) {
  if (e.indicator_family && FAMILY[e.indicator_family]) return e.indicator_family;
  const t = String(e.title || '');
  if (SPEECH_RE.test(t)) return 'speech';
  const f = [
    ['inflation', /cpi|inflation|price index|ppi|pce/i],
    ['employment', /employment|payroll|jobless|unemployment|wage|earnings|jobs/i],
    ['growth', /gdp|gross domestic|economic growth/i],
    ['retail', /retail sales|consumer spending/i],
    ['pmi', /pmi|purchasing manager|ism/i],
    ['rates', /interest rate|rate decision|policy rate|bank rate/i],
    ['trade', /trade balance|current account|exports|imports/i],
    ['sentiment', /confidence|sentiment|expectations/i],
    ['housing', /home|housing|mortgage|building permits/i],
  ];
  for (const [k, rx] of f) if ((rx as RegExp).test(t)) return k;
  return 'other';
}

function parseVal(s: any) {
  if (s === null || s === undefined) return null;
  const t = String(s).replace(/,/g, '').trim();
  if (!t || /^(n\/a|na|-|--|—)$/i.test(t)) return null;
  const m = t.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  let n = parseFloat(m[0]);
  if (/[Kk]$/.test(t)) n *= 1e3;
  else if (/[Mm]$/.test(t)) n *= 1e6;
  else if (/[Bb]$/.test(t)) n *= 1e9;
  return Number.isFinite(n) ? n : null;
}

const DIRECTION = {
  inflation: 'up', employment: 'up', growth: 'up', retail: 'up', pmi: 'up', rates: 'up',
  trade: 'up', sentiment: 'up', housing: 'up', speech: 'neutral', other: 'up',
} as Record<string, string>;

function strengthLine(ccy: string, fam: string, text: string) {
  if (text === '') return `A stronger ${ccy} than expected.`;
  return `A ${text} ${ccy} than expected.`;
}

/* ---------- telegram ---------- */

async function tg(method: string, payload: any) {
  const t = TG();
  if (!t) return { ok: false, error: 'no_bot_token' };
  try {
    const r = await fetch(`https://api.telegram.org/bot${t}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    return await r.json();
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 200) };
  }
}

function send(chat: any, text: string, extra: any = {}) {
  return tg('sendMessage', {
    chat_id: chat, text: text.slice(0, 4000), parse_mode: 'HTML',
    disable_web_page_preview: true, ...extra,
  });
}
function edit(chat: any, msgId: any, text: string, extra: any = {}) {
  return tg('editMessageText', {
    chat_id: chat, message_id: msgId, text: text.slice(0, 4000), parse_mode: 'HTML',
    disable_web_page_preview: true, ...extra,
  });
}

const MAIN_KEYS = {
  keyboard: [
    [{ text: '📅 Today' }, { text: '🗓 This week' }],
    [{ text: '🎯 High impact' }, { text: '🌍 Medium impact' }],
    [{ text: '💱 Currencies' }, { text: '📈 Market' }],
    [{ text: '🔔 My alerts' }, { text: '💛 Support' }],
    [{ text: '❓ Help' }],
  ],
  resize_keyboard: true,
  is_persistent: true,
  input_field_placeholder: 'Pick something below, or type a currency like USD',
};

const BTN_TO_COMMAND: Record<string, string> = {
  '📅 Today': '/today', '🗓 This week': '/week', '🎯 High impact': '/high',
  '🌍 Medium impact': '/medium', '💱 Currencies': '/outlook', '📈 Market': '/market',
  '🔔 My alerts': '/settings', '💛 Support': '/donate', '❓ Help': '/help',
};

function menuText(name: string) {
  return [
    `<b>MacroPulse</b> — plain-English forex news intelligence.`,
    ``,
    `I watch every high and medium impact release for USD, EUR, GBP, JPY and AUD, and tell you what it means before and after it lands.`,
    ``,
    `<b>What you can open</b>`,
    `📅 Today — what is due today, in order`,
    `🗓 This week — the week ahead, day by day`,
    `🎯 High impact — only the releases that really move price`,
    `🌍 Medium impact — the steadier background data`,
    `💱 Currencies — how the dollar, euro, pound, yen and Aussie are set up`,
    `📈 Market — current prices and which pairs move together`,
    `🔔 My alerts — turn alerts on or off`,
    `💛 Support — keep it running`,
    ``,
    `You get a reminder 60, 30 and 15 minutes before each release, then a plain read of what actually came out.`,
    `Everything is free. Times are West Africa Time (WAT).`,
    ``,
    `<i>Information only, never advice.</i>`,
  ].join('\n');
}

const EVENT_KEYS = (id: string) => ({
  inline_keyboard: [
    [{ text: '💡 Explain this simply', callback_data: `ex:${id}` }],
    [{ text: '📈 What it moves', callback_data: `mv:${id}` }, { text: '⏰ Remind me', callback_data: `rm:${id}` }],
  ],
});

/* ---------- data ---------- */

async function getEvents(db: any, query: any, sort = 'ts', limit = 60) {
  try { return (await db.EconomicEvent.filter(query, sort, limit)) || []; } catch { return []; }
}

function liveOnly(list: any[]) {
  return list.filter((e) => e.event_status !== 'cancelled' && e.event_status !== 'rejected');
}

function lineFor(e: any) {
  const bits: string[] = [];
  const fc = e.forecast ? `expected ${esc(e.forecast)}` : '';
  const pv = e.previous ? `last ${esc(e.previous)}` : '';
  const tail = [fc, pv].filter(Boolean).join(', ');
  return `${e.impact === 'high' ? '🔴' : '🟠'} <b>${fmtTime(e.ts)}</b> ${e.currency} ${esc(e.title)}${tail ? ` <i>(${tail})</i>` : ''}`;
}

function groupByDay(events: any[]) {
  const map = new Map<string, any[]>();
  for (const e of events) {
    const k = watDate(e.ts);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(e);
  }
  return map;
}

/* ---------- cards ---------- */

function explainCard(e: any) {
  const fam = familyOf(e);
  const k = FAMILY[fam] || FAMILY.other;
  const dir = DIRECTION[fam] || 'up';
  const ccy = e.currency || '';
  const higherIsStronger = dir === 'up';

  const out: string[] = [];
  out.push(`<b>${esc(e.title)}</b>`);
  out.push(`${esc(ccy)} · ${e.impact === 'high' ? 'high impact' : 'medium impact'} · ${fmtStamp(e.ts)} WAT`);
  out.push('');

  out.push(`<b>In one sentence</b>`);
  out.push(`This release shows ${k.what}`);
  out.push('');

  out.push(`<b>Why traders care</b>`);
  out.push(`${k.why.charAt(0).toUpperCase()}${k.why.slice(1)}`);
  out.push('');

  if (e.forecast || e.previous) {
    out.push(`<b>Where it stands</b>`);
    if (e.previous) out.push(`Last time it was ${esc(e.previous)}.`);
    if (e.forecast) out.push(`The market expects ${esc(e.forecast)}.`);
    out.push('');
  }

  out.push(`<b>What the number would mean</b>`);
  if (fam === 'speech') {
    out.push(`There is no number to beat here. Listen for whether the official sounds more worried about inflation or about growth.`);
    out.push(`Talking up inflation tends to lift ${esc(ccy)}. Talking up weakness tends to pull it down.`);
  } else {
    out.push(higherIsStronger
      ? `Coming in <b>above</b> expectation is usually read as strength for ${esc(ccy)}.`
      : `Coming in <b>above</b> expectation is usually read as weakness for ${esc(ccy)}.`);
    out.push(higherIsStronger
      ? `Coming in <b>below</b> expectation is usually read as weakness for ${esc(ccy)}.`
      : `Coming in <b>below</b> expectation is usually read as strength for ${esc(ccy)}.`);
  }
  out.push('');

  out.push(`<b>What actually matters</b>`);
  out.push(`${k.watch.charAt(0).toUpperCase()}${k.watch.slice(1)}`);
  out.push('');

  if (ccy === 'USD') {
    out.push(`<b>What to watch alongside it</b>`);
    out.push(`A stronger dollar usually presses on gold and lifts USDJPY. A weaker dollar usually does the reverse.`);
  } else if (['EUR', 'GBP', 'AUD'].includes(ccy)) {
    out.push(`<b>What to watch alongside it</b>`);
    out.push(`Strength in ${esc(ccy)} usually shows up as a higher ${esc(ccy)}USD. Check whether the dollar is moving at the same time, because that can hide the effect.`);
  } else if (ccy === 'JPY') {
    out.push(`<b>What to watch alongside it</b>`);
    out.push(`Yen moves are usually driven by interest rate gaps with the US, so read this next to US data, not alone.`);
  }
  out.push('');
  out.push(`<i>Information only. No forecast here is a guarantee, and nothing here is advice.</i>`);
  return out.join('\n');
}

function movesCard(e: any) {
  const ccy = e.currency || '';
  const map: Record<string, string[]> = {
    USD: ['US dollar index (shown as a EURUSD-based proxy)', 'Gold (XAUUSD)', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD'],
    EUR: ['EURUSD', 'EURJPY', 'EURGBP', 'Gold (XAUUSD)'],
    GBP: ['GBPUSD', 'GBPJPY', 'EURGBP'],
    JPY: ['USDJPY', 'EURJPY', 'GBPJPY'],
    AUD: ['AUDUSD', 'Gold (XAUUSD)'],
  };
  const list = map[ccy] || ['the currency itself'];
  const fam = familyOf(e);
  const out: string[] = [];
  out.push(`<b>What ${esc(e.title)} tends to move</b>`);
  out.push('');
  out.push(list.map((x) => `• ${x}`).join('\n'));
  out.push('');
  if (fam === 'speech') {
    out.push(`Because this is a speech rather than a number, the effect depends entirely on how far the official strays from the last official position. Quiet markets often ignore it.`);
  } else {
    out.push(`The size of the move depends on how far the release lands from what was expected, not on the number by itself. A release that matches expectations often moves nothing at all.`);
  }
  out.push('');
  out.push(`These are the usual relationships, measured on average. They are not rules, and they can break on any given day.`);
  return out.join('\n');
}

/* ---------- listing ---------- */

async function todayView(db: any, impact?: string) {
  const n = nowSec();
  const start = dayStart(n);
  const end = start + 86400;
  const all = liveOnly(await getEvents(db, { ts: { $gte: start, $lt: end } }, 'ts', 100));
  const list = impact ? all.filter((e) => e.impact === impact) : all;
  if (!list.length) {
    return `📅 <b>${fmtDate(n)}</b>\n\nNothing on the calendar today${impact ? ` at ${impact} impact` : ''} for USD, EUR, GBP, JPY or AUD.\n\nQuiet days are useful. Nothing here needs your attention.`;
  }
  const now = list.filter((e) => e.ts >= n - 900);
  const done = list.filter((e) => e.ts < n - 900);
  const out: string[] = [`📅 <b>${fmtDate(n)}</b> · ${list.length} release${list.length === 1 ? '' : 's'}`, ''];
  if (now.length) {
    out.push('<b>Still to come</b>');
    for (const e of now) out.push(lineFor(e));
    out.push('');
  }
  if (done.length) {
    out.push('<b>Already released</b>');
    for (const e of done.slice(-8)) {
      const act = e.actual ? ` came in at <b>${esc(e.actual)}</b>` : ' released';
      out.push(`• ${fmtTime(e.ts)} ${e.currency} ${esc(e.title)}${act}`);
    }
    out.push('');
  }
  const high = list.filter((e) => e.impact === 'high').length;
  out.push(`<i>${high} high impact. Reminders go out 60, 30 and 15 minutes before each one. Times are WAT.</i>`);
  return out.join('\n');
}

async function weekView(db: any) {
  const n = nowSec();
  const start = dayStart(n);
  const end = start + 7 * 86400;
  const all = liveOnly(await getEvents(db, { ts: { $gte: start, $lt: end } }, 'ts', 200));
  if (!all.length) return `🗓 <b>This week</b>\n\nNo tracked releases in the next seven days.`;
  const byDay = groupByDay(all);
  const out: string[] = [`🗓 <b>This week</b> · ${all.length} releases`, ''];
  const days = [...byDay.keys()].sort();
  for (const d of days.slice(0, 4)) {
    const dayEvents = byDay.get(d)!;
    const dt = new Date(`${d}T12:00:00Z`).getTime() / 1000;
    out.push(`<b>${DNAME[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${new Date(`${d}T12:00:00Z`).getUTCDate()} ${WMON[new Date(`${d}T12:00:00Z`).getUTCMonth()]}</b>`);
    for (const e of dayEvents.slice(0, 6)) out.push(lineFor(e));
    if (dayEvents.length > 6) out.push(`<i>…and ${dayEvents.length - 6} more that day</i>`);
    out.push('');
  }
  if (days.length > 4) out.push(`<i>Showing the first four days. ${all.length} releases across the week.</i>`);
  out.push(`<i>Times are WAT.</i>`);
  return out.join('\n');
}

async function highView(db: any, impact: string) {
  const n = nowSec();
  const all = liveOnly(await getEvents(db, { ts: { $gte: n - 3600 }, impact }, 'ts', 40));
  if (!all.length) {
    return `Nothing at ${impact} impact is scheduled in the next stretch.`;
  }
  const title = impact === 'high' ? '🎯 High impact ahead' : '🌍 Medium impact ahead';
  const out: string[] = [`<b>${title}</b>`, '',];
  for (const e of all.slice(0, 10)) {
    out.push(lineFor(e));
  }
  out.push('');
  out.push(`Tap any release in Today for a plain-English explanation.`);
  return out.join('\n');
}

/* ---------- user records ---------- */

async function getUser(db: any, tgId: string) {
  const rows = (await db.MacroUser.filter({ telegram_user_id: tgId })) || [];
  return rows[0] || null;
}

async function register(db: any, from: any, chat: any) {
  const tgId = String(from.id);
  const nowIso = new Date().toISOString();
  const existing = await getUser(db, tgId);
  if (!existing) {
    const rec = {
      telegram_user_id: tgId,
      chat_id: String(chat?.id || from.id),
      username: from.username || '',
      first_name: from.first_name || '',
      joined_at: nowIso,
      last_seen_at: nowIso,
      alerts_enabled: true,
      impact_filter: 'both',
      timezone: TZ,
      is_owner: false,
      commands_used: 1,
    };
    try {
      const created = await db.MacroUser.create(rec);
      return created || rec;
    } catch {
      return rec;
    }
  }
  const patch: any = {};
  if (String(existing.chat_id || '') !== String(chat?.id || from.id)) patch.chat_id = String(chat?.id || from.id);
  if ((existing.username || '') !== (from.username || '')) patch.username = from.username || '';
  if (!existing.first_name && from.first_name) patch.first_name = from.first_name;
  if (!existing.last_seen_at || Date.now() - new Date(existing.last_seen_at).getTime() > 21600000) patch.last_seen_at = nowIso;
  if (Object.keys(patch).length) { try { await db.MacroUser.update(existing.id, patch); } catch {} }
  return { ...existing, ...patch };
}

/* ---------- donate ---------- */

async function donateStars(amount: number, label: string) {
  const r = await tg('createInvoiceLink', {
    title: 'Support MacroPulse',
    description: 'MacroPulse is free for everyone. If it earns you money, you can chip in.',
    payload: `donate_${amount}_${Date.now()}`,
    currency: 'XTR',
    prices: [{ label, amount }],
  });
  return r?.ok ? r.result : '';
}

async function donateView() {
  const tiers = [
    { amount: 100, label: 'Buy a coffee' },
    { amount: 500, label: 'Cover a week of data' },
    { amount: 1500, label: 'Cover a month of data' },
  ];
  const links: any[] = [];
  for (const t of tiers) {
    const url = await donateStars(t.amount, t.label);
    if (url) links.push([{ text: `${t.label} — ${t.amount} ⭐`, url }]);
  }
  const out: string[] = [];
  out.push(`💛 <b>Support MacroPulse</b>`);
  out.push('');
  out.push(`Everything here is free and stays free: every release, every alert, every explanation, every review.`);
  out.push('');
  out.push(`Running it costs me real money each month for market data and server time. If MacroPulse is useful to you, a small contribution keeps it alive for everyone.`);
  out.push('');
  out.push(`Payments go through Telegram Stars, so it takes two taps and I never see your card details. Completely optional, and nothing changes if you skip it.`);
  const kb = links.length ? { inline_keyboard: links } : undefined;
  return { text: out.join('\n'), kb };
}

/* ---------- settings ---------- */

async function settingsView(u: any) {
  const on = u.alerts_enabled !== false;
  const impact = u.impact_filter === 'high' ? 'high impact only' : 'high and medium impact';
  const out: string[] = [];
  out.push(`🔔 <b>Your alerts</b>`);
  out.push('');
  out.push(`Alerts are <b>${on ? 'on' : 'off'}</b>.`);
  out.push(`You receive <b>${impact}</b>.`);
  out.push(`Reminder times: 60, 30 and 15 minutes before each release, then a read of the number once it lands.`);
  out.push('');
  out.push(`Your account is linked to your Telegram ID, so there is nothing to log into and nothing to pay.`);
  out.push('');
  out.push(`<i>Times are WAT.</i>`);
  return {
    text: out.join('\n'),
    kb: {
      inline_keyboard: [
        [{ text: on ? '🔕 Turn alerts off' : '🔔 Turn alerts on', callback_data: `st:alerts:${on ? 'off' : 'on'}` }],
        [
          { text: `${u.impact_filter === 'high' ? '✅ ' : ''}High impact only`, callback_data: 'st:impact:high' },
          { text: `${u.impact_filter !== 'high' ? '✅ ' : ''}Both`, callback_data: 'st:impact:both' },
        ],
      ],
    },
  };
}

/* ---------- market ---------- */

async function marketView(db: any) {
  const today = watDate(nowSec());
  let rows: any[] = [];
  try { rows = (await db.PriceSnapshot.filter({ interval: 'day', bar_time: today })) || []; } catch {}
  if (!rows.length) {
    try { rows = (await db.PriceSnapshot.list('-bar_time', 12)) || []; } catch {}
  }
  if (!rows.length) return { text: `📈 <b>Market</b>\n\nNo price snapshot stored yet. Prices refresh on the next daily cycle.` };
  const dayRows = (await (async () => {
    try { return (await db.PriceSnapshot.filter({ interval: 'day', bar_time: today })) || []; } catch { return []; }
  })());
  const out: string[] = [`📈 <b>Market now</b>`, ''];
  const order = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'XAUUSD'];
  const byName = new Map(rows.map((r) => [r.instrument, r]));
  for (const inst of order) {
    const r = byName.get(inst);
    if (!r) continue;
    let tail = '';
    const prev = (dayRows as any[]).find((x) => x.instrument === inst);
    if (prev && prev.close) {
      const pct = ((r.close - prev.close) / prev.close) * 100;
      tail = ` ${pct >= 0 ? '▲' : '▼'} ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
    }
    out.push(`${inst} <b>${Number(r.close).toFixed(inst === 'XAUUSD' ? 2 : 4)}</b>${tail}`);
  }
  out.push('');
  out.push(`<i>The dollar index is not available on the current data plan, so I show EURUSD as a dollar proxy. Prices are daily closes.</i>`);
  return { text: out.join('\n') };
}

async function pairsView(db: any) {
  let rows: any[] = [];
  try { rows = (await db.PairCorrelation.list('-computed_at', 20)) || []; } catch {}
  if (!rows.length) return { text: `📈 <b>Which pairs move together</b>\n\nNot measured yet. Tap this again after the next weekly refresh.` };
  const out: string[] = [`📈 <b>Which pairs move together</b>`, ''];
  out.push(`Measured on daily closes over the last ${rows[0].window_days || 90} days. A reading near -1 means the pair usually moves opposite to dollar strength; near +1 means it moves with it.`);
  out.push('');
  for (const r of rows) {
    if (!r.pair || r.pair === 'DXY') continue;
    out.push(`${r.pair} <b>${Number(r.coefficient).toFixed(2)}</b> <i>(${r.sample_size || 'n/a'} days)</i>`);
  }
  out.push('');
  out.push(`<i>Measured relationships, not guarantees. They drift when the macro backdrop changes.</i>`);
  return { text: out.join('\n') };
}

async function outlookView(db: any) {
  const n = nowSec();
  const upcoming = liveOnly(await getEvents(db, { ts: { $gte: n } }, 'ts', 60));
  const out: string[] = [`💱 <b>Where each currency stands</b>`, ''];
  out.push(`Based on what is scheduled and what has already surprised, not on price prediction.`);
  out.push('');
  for (const ccy of CURRENCIES) {
    const mine = upcoming.filter((e) => e.currency === ccy);
    const high = mine.filter((e) => e.impact === 'high');
    if (!mine.length) {
      out.push(`<b>${ccy}</b> — quiet. Nothing tracked in the days ahead.`);
      continue;
    }
    const next = high[0] || mine[0];
    out.push(`<b>${ccy}</b> — ${mine.length} release${mine.length === 1 ? '' : 's'} ahead, ${high.length} high impact. Next: ${esc(next.title)} on ${fmtDate(next.ts)} at ${fmtTime(next.ts)}.`);
  }
  out.push('');
  out.push(`<i>Times are WAT.</i>`);
  return { text: out.join('\n') };
}

/* ---------- on-demand reviews ---------- */

async function briefView(db: any, kind: string) {
  const n = nowSec();
  const all = liveOnly(await getEvents(db, { ts: { $gte: n - 8 * 86400 } }, 'ts', 300));
  const done = all.filter((e) => e.actual && e.ts <= n);
  const out: string[] = [];

  if (kind === 'intel') {
    const upcoming = liveOnly(await getEvents(db, { ts: { $gte: n } }, 'ts', 120));
    out.push(`🧠 <b>Market intelligence</b>`);
    out.push(``);
    out.push(`What the calendar is weighted towards, and what has already surprised.`);
    out.push(``);
    const counts: Record<string, number> = {};
    for (const e of upcoming) counts[e.currency] = (counts[e.currency] || 0) + 1;
    const rank = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (rank.length) {
      out.push(`<b>Busiest calendars</b>`);
      for (const [c, v] of rank.slice(0, 3)) out.push(`• ${c} — ${v} releases ahead`);
      out.push(``);
    }
    const highs = upcoming.filter((e) => e.impact === 'high').slice(0, 5);
    if (highs.length) {
      out.push(`<b>Next high impact</b>`);
      for (const e of highs) out.push(`🔴 ${fmtStamp(e.ts)} — ${e.currency} ${esc(e.title)}${e.forecast ? ` <i>(expected ${esc(e.forecast)})</i>` : ''}`);
      out.push(``);
    }
    const lean: Record<string, number> = {};
    for (const e of done) {
      const s = surpriseOf(e);
      if (s && s.dir) lean[e.currency] = (lean[e.currency] || 0) + s.dir;
    }
    const l = Object.entries(lean).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    if (l.length) {
      out.push(`<b>Where data has leaned</b>`);
      for (const [c, v] of l.slice(0, 3)) out.push(`• ${c} — ${v > 0 ? 'stronger' : 'weaker'} over the last releases`);
      out.push(``);
    }
    out.push(`<i>Read from the data, not from price. Information only.</i>`);
    return out.join('\n');
  }

  if (kind === 'weekly') {
    const start = n - 7 * 86400;
    const week = done.filter((e) => e.ts >= start);
    out.push(`📈 <b>Week in review</b>`);
    out.push(`${week.length} releases with numbers over the last seven days`);
    out.push(``);
    const scored = week.map((e) => ({ e, s: surpriseOf(e) })).filter((x) => x.s && x.s.delta !== null)
      .sort((a, b) => Math.abs(b.s!.pct ?? b.s!.delta ?? 0) - Math.abs(a.s!.pct ?? a.s!.delta ?? 0));
    if (scored.length) {
      out.push(`<b>Biggest surprises</b>`);
      for (const x of scored.slice(0, 6)) out.push(`• ${x.e.currency} ${esc(x.e.title)}: ${esc(x.e.actual)} vs ${esc(x.e.forecast ?? 'n/a')} expected — ${x.s!.word}`);
      out.push(``);
    } else {
      out.push(`Nothing moved far enough from forecast to count as a surprise.`);
      out.push(``);
    }
    const ahead = liveOnly(await getEvents(db, { ts: { $gte: n } }, 'ts', 120)).filter((e) => e.impact === 'high').slice(0, 5);
    if (ahead.length) {
      out.push(`<b>Coming next</b>`);
      for (const e of ahead) out.push(`🔴 ${fmtStamp(e.ts)} — ${e.currency} ${esc(e.title)}`);
      out.push(``);
    }
    out.push(`<i>Times are WAT. Information only, never advice.</i>`);
    return out.join('\n');
  }

  const start = dayStart(n);
  const today = done.filter((e) => e.ts >= start);
  out.push(`📊 <b>Day in review</b>`);
  out.push(`${fmtDate(n)} · ${today.length} release${today.length === 1 ? '' : 's'} with numbers`);
  out.push(``);
  if (!today.length) {
    out.push(`No tracked data has printed yet today.`);
    out.push(``);
    out.push(`When nothing is released, price usually follows positioning and whatever was said earlier in the week.`);
  } else {
    out.push(`<b>What came out</b>`);
    for (const e of today.slice(0, 10)) {
      const s = surpriseOf(e);
      out.push(`• ${e.currency} ${esc(e.title)}: <b>${esc(e.actual)}</b>${s && s.delta !== null ? ` vs ${esc(e.forecast)} expected — ${s.word}` : ''}`);
    }
    out.push(``);
    const lean: Record<string, number> = {};
    for (const e of today) { const s = surpriseOf(e); if (s && s.dir) lean[e.currency] = (lean[e.currency] || 0) + s.dir; }
    const l = Object.entries(lean).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    if (l.length) {
      out.push(`<b>Where that leaves the currencies</b>`);
      for (const [c, v] of l) out.push(`• ${c} — data leaned ${v > 0 ? 'stronger' : 'weaker'}`);
      out.push(``);
    }
  }
  out.push(`<i>Times are WAT. Information only, never advice.</i>`);
  return out.join('\n');
}

function surpriseOf(e: any) {
  const a = parseNum(e.actual), f = parseNum(e.forecast) ?? parseNum(e.previous);
  if (a === null || f === null) return null;
  const delta = a - f;
  if (delta === 0) return { delta: 0, pct: 0, word: 'in line', dir: 0 };
  const pct = f === 0 ? null : (delta / Math.abs(f)) * 100;
  const scale = Math.abs(pct ?? delta);
  const word = scale < 1.5 ? 'in line' : scale < 6 ? 'modest' : scale < 15 ? 'significant' : 'large';
  const fam = familyOf(e);
  const dir = fam === 'speech' || fam === 'other' ? 0 : Math.sign(delta);
  return { delta, pct, word, dir };
}

function parseNum(v: any) {
  if (v === null || v === undefined) return null;
  const t = String(v).replace(/,/g, '').trim();
  if (!t || /^(n\/a|na|-|--)$/i.test(t)) return null;
  const m = t.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  let n = parseFloat(m[0]);
  if (/[Kk]$/.test(t)) n *= 1e3; else if (/[Mm]$/.test(t)) n *= 1e6; else if (/[Bb]$/.test(t)) n *= 1e9;
  return Number.isFinite(n) ? n : null;
}

/* ---------- router ---------- */

async function handleUpdate(db: any, u: any) {
  if (u.callback_query) {
    const cq = u.callback_query;
    const chat = cq.message?.chat?.id;
    const msgId = cq.message?.message_id;
    const data = String(cq.data || '');
    await tg('answerCallbackQuery', { callback_query_id: cq.id });
    const user = await register(db, cq.from, cq.message?.chat);
    if (data.startsWith('ex:') || data.startsWith('mv:') || data.startsWith('rm:')) {
      const [, kind, id] = data.split(':');
      const rows = (await db.EconomicEvent.filter({ id })) || [];
      const e = rows[0];
      if (!e) {
        await send(chat, 'I could not find that release any more. It may have been removed from the calendar.');
        return { ok: true };
      }
      if (kind === 'ex') await send(chat, explainCard(e));
      else if (kind === 'mv') await send(chat, movesCard(e));
      else {
        await send(chat, [
          `⏰ <b>Reminder set</b>`,
          ``,
          `${esc(e.title)} — ${esc(e.currency)}, ${fmtStamp(e.ts)} WAT.`,
          ``,
          `You will get three nudges: 60 minutes before, 30 minutes before and 15 minutes before. Then a plain read of the number once it lands.`,
        ].join('\n'));
      }
      return { ok: true };
    }
    if (data.startsWith('st:')) {
      const [, field, val] = data.split(':');
      const patch: any = {};
      if (field === 'alerts') patch.alerts_enabled = val === 'on';
      if (field === 'impact') patch.impact_filter = val === 'high' ? 'high' : 'both';
      if (user?.id) {
        try { await db.MacroUser.update(user.id, patch); } catch {}
      }
      const fresh = { ...(user || {}), ...patch };
      const v = await settingsView(fresh);
      if (msgId) await edit(chat, msgId, v.text, { reply_markup: v.kb });
      return { ok: true };
    }
    return { ok: true };
  }

  const m = u.message;
  if (!m || !m.chat) return { ok: true };
  if (m.successful_payment) {
    await send(m.chat.id, `💛 <b>Thank you</b>\n\nYour support genuinely keeps this free for everyone. I appreciate it.`);
    return { ok: true };
  }
  const text = String(m.text || '').trim();
  if (!text) return { ok: true };

  const user = await register(db, m.from, m.chat);
  const chat = m.chat.id;
  const routed = BTN_TO_COMMAND[text] || text;
  const cmd = routed.split(/\s+/)[0].toLowerCase().replace(/@\w+$/, '');
  const arg = routed.split(/\s+/).slice(1).join(' ').trim();

  if (cmd === '/start' || cmd === '/menu') {
    await send(chat, menuText(m.from?.first_name || ''), { reply_markup: MAIN_KEYS });
    return { ok: true };
  }
  if (cmd === '/help') {
    await send(chat, menuText(''), { reply_markup: MAIN_KEYS });
    return { ok: true };
  }
  if (cmd === '/today') {
    const v = await todayView(db, arg.toLowerCase().includes('high') ? 'high' : undefined);
    const upcoming = liveOnly(await getEvents(db, { ts: { $gte: nowSec() } }, 'ts', 12));
    const kb = upcoming.length
      ? { inline_keyboard: upcoming.slice(0, 3).map((e) => [{ text: `💡 Explain: ${e.currency} ${String(e.title).slice(0, 28)}`, callback_data: `ex:${e.id}` }]) }
      : undefined;
    await send(chat, v, kb ? { reply_markup: kb } : {});
    return { ok: true };
  }
  if (cmd === '/week') {
    await send(chat, await weekView(db));
    return { ok: true };
  }
  if (cmd === '/high') {
    await send(chat, await highView(db, 'high'));
    return { ok: true };
  }
  if (cmd === '/medium') {
    await send(chat, await highView(db, 'medium'));
    return { ok: true };
  }
  if (cmd === '/market' || cmd === '/dxy' || cmd === '/gold') {
    const v = await marketView(db);
    await send(chat, v.text);
    return { ok: true };
  }
  if (cmd === '/pairs') {
    const v = await pairsView(db);
    await send(chat, v.text);
    return { ok: true };
  }
  if (cmd === '/outlook' || cmd === '/currencies') {
    const v = await outlookView(db);
    await send(chat, v.text);
    return { ok: true };
  }
  if (cmd === '/settings' || cmd === '/alerts') {
    const v = await settingsView(user || {});
    await send(chat, v.text, { reply_markup: v.kb });
    return { ok: true };
  }
  if (cmd === '/donate' || cmd === '/support') {
    const v = await donateView();
    await send(chat, v.text, v.kb ? { reply_markup: v.kb } : {});
    return { ok: true };
  }
  if (cmd === '/review' || cmd === '/weekly' || cmd === '/analysis') {
    const kind = cmd === '/review' ? 'daily' : cmd === '/weekly' ? 'weekly' : 'intel';
    await send(chat, await briefView(db, kind));
    return { ok: true };
  }
  if (cmd === '/status') {
    const n = nowSec();
    const upcoming = liveOnly(await getEvents(db, { ts: { $gte: n } }, 'ts', 200));
    const next = upcoming[0];
    const out = [
      `<b>Status</b>`,
      '',
      `Calendar: ${upcoming.length} upcoming releases tracked.`,
      next ? `Next up: ${esc(next.title)} — ${fmtStamp(next.ts)} WAT.` : `Nothing scheduled at the moment.`,
      `Alerts are running automatically, day and night.`,
    ].join('\n');
    await send(chat, out);
    return { ok: true };
  }

  // free text: try to find a matching release or currency
  const maybeCcy = arg ? arg.toUpperCase().slice(0, 3) : cmd.replace('/', '').toUpperCase().slice(0, 3);
  if (CURRENCIES.includes(maybeCcy)) {
    const n = nowSec();
    const mine = liveOnly(await getEvents(db, { ts: { $gte: n - 3600 }, currency: maybeCcy }, 'ts', 20));
    if (!mine.length) {
      await send(chat, `🌍 <b>${maybeCcy}</b>\n\nNothing tracked for ${maybeCcy} in the days ahead.`);
      return { ok: true };
    }
    const out = [`🌍 <b>${maybeCcy} ahead</b>`, ''];
    for (const e of mine.slice(0, 10)) out.push(`${fmtStamp(e.ts)} — <b>${esc(e.title)}</b>${e.forecast ? ` <i>(expected ${esc(e.forecast)})</i>` : ''}`);
    await send(chat, out.join('\n'), {
      reply_markup: { inline_keyboard: [[{ text: `💡 Explain the next one`, callback_data: `ex:${mine[0].id}` }]] },
    });
    return { ok: true };
  }

  const needle = (arg || cmd.replace('/', '')).trim();
  if (needle.length >= 3) {
    const n = nowSec();
    const all = liveOnly(await getEvents(db, { ts: { $gte: n - 86400 } }, 'ts', 150));
    const hits = all.filter((e) => String(e.title).toLowerCase().includes(needle.toLowerCase()));
    if (hits.length) {
      const out = [`🔎 <b>Matches for "${esc(needle)}"</b>`, ''];
      for (const e of hits.slice(0, 8)) out.push(`${fmtStamp(e.ts)} — ${esc(e.currency)} <b>${esc(e.title)}</b>`);
      await send(chat, out.join('\n'), {
        reply_markup: { inline_keyboard: hits.slice(0, 3).map((e) => [{ text: `💡 ${String(e.title).slice(0, 30)}`, callback_data: `ex:${e.id}` }]) },
      });
      return { ok: true };
    }
  }

  await send(chat, `I did not quite catch that. Pick something from the buttons below, or type a currency like <b>USD</b>, <b>EUR</b>, <b>GBP</b>, <b>JPY</b> or <b>AUD</b>.`, { reply_markup: MAIN_KEYS });
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: true, service: 'macropulse-bot' });
  const sec = SECRET();
  if (sec && req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== sec) {
    return json({ ok: false, error: 'bad_webhook_secret' }, 401);
  }
  let body: any = null;
  try { body = await req.json(); } catch { return json({ ok: true }); }
  const base44 = createClientFromRequest(req);
  const db = base44.asServiceRole.entities;
  try {
    if (body.pre_checkout_query) {
      await tg('answerPreCheckoutQuery', { pre_checkout_query_id: body.pre_checkout_query.id, ok: true });
      return json({ ok: true });
    }
    if (!body.update_id && !body.callback_query && !body.message) return json({ ok: true });
    const out = await handleUpdate(db, body);
    return json(out);
  } catch (e) {
    return json({ ok: false, error: String(e).slice(0, 300) }, 200);
  }
});
