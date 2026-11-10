import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
const TZ = 'Africa/Lagos';
function stamp(d: any) {
  const x = new Date(d);
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(x);
}
async function tg(chat: string, text: string) {
  const token = Deno.env.get('MACROPULSE_BOT_TOKEN');
  if (!token) return false;
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  return r.ok;
}
function stats(users: any[]) {
  const now = Date.now(), day = 86400000;
  const since = (ms: number, f: string) => users.filter((u) => u[f] && Date.parse(u[f]) >= now - ms).length;
  return {
    total: users.length,
    newToday: since(day, 'joined_at'),
    newWeek: since(7 * day, 'joined_at'),
    activeToday: since(day, 'last_seen_at'),
    activeWeek: since(7 * day, 'last_seen_at'),
    alertsOn: users.filter((u) => u.alerts_enabled !== false).length,
    uses: users.reduce((a, u) => a + (Number(u.commands_used) || 0), 0),
  };
}
function reportText(s: any, users: any[]) {
  const pct = (a: number) => (s.total ? Math.round((a / s.total) * 100) : 0);
  const out = [
    '<b>👥 Users</b>', '',
    `<b>Total</b>  ${s.total}`,
    `New today ${s.newToday} · 7 days ${s.newWeek}`, '',
    '<b>Active</b>',
    `Today ${s.activeToday} (${pct(s.activeToday)}%)`,
    `7 days ${s.activeWeek} (${pct(s.activeWeek)}%)`, '',
    '<b>Engagement</b>',
    `Alerts on ${s.alertsOn} of ${s.total}`,
    `Average interactions ${s.total ? (s.uses / s.total).toFixed(1) : '0'}`,
  ];
  const newest = users.slice(0, 5);
  if (newest.length) {
    out.push('', '<b>Newest</b>');
    for (const u of newest) {
      const who = u.username ? '@' + u.username : (u.first_name || 'no username');
      out.push(`• ${who} — ${u.joined_at ? stamp(u.joined_at) : '—'}`);
    }
  }
  out.push('', '<i>Active means they messaged the bot in that window.</i>');
  return out.join('\n');
}
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const db: any = base44.asServiceRole.entities;
    const body = await req.json().catch(() => ({}));
    const action = body.action || 'report';
    const users = (await db.MacroUser.list('-joined_at', 500)) || [];
    const settings = ((await db.MacroUserSettings.list()) || [])[0] || {};
    const owner = String(settings.chat_id || settings.owner_telegram_user_id || '');
    const s = stats(users);
    if (action === 'report') return Response.json({ ok: true, stats: s, sent: await tg(owner, reportText(s, users)) });
    if (action === 'seen') return Response.json({ ok: true, stats: s, report: reportText(s, users) });
    if (action !== 'watch') return Response.json({ ok: false, error: 'unknown action' });
    const key = 'macro_users_seen';
    const rows = (await db.ScannerState.filter({ key })) || [];
    const known: string[] = rows.length ? JSON.parse(rows[0].value || '[]') : [];
    const ids = users.map((u) => String(u.telegram_user_id));
    const fresh = users.filter((u) => !known.includes(String(u.telegram_user_id)));
    let sent = 0;
    if (rows.length) {
      for (const u of fresh) {
        const who = u.username ? '@' + u.username : (u.first_name || 'Someone');
        const msg = ['<b>👤 New user</b>', '', `${who}`, `Joined ${u.joined_at ? stamp(u.joined_at) : 'just now'} WAT`, `You now have <b>${users.length}</b> users.`].join('\n');
        if (await tg(owner, msg)) sent++;
      }
      const today = new Date().toISOString().slice(0, 10);
      const rkey = 'macro_users_daily_report';
      const rrows = (await db.ScannerState.filter({ key: rkey })) || [];
      const last = rrows.length ? rrows[0].value : '';
      const hourWat = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date()));
      if (last !== today && hourWat >= 8 && await tg(owner, reportText(s, users))) {
        sent++;
        if (rrows.length) await db.ScannerState.update(rrows[0].id, { value: today, updated_at: new Date().toISOString() });
        else await db.ScannerState.create({ key: rkey, value: today, description: 'Last daily user report date', updated_at: new Date().toISOString() });
      }
    }
    const payload = JSON.stringify(ids.slice(0, 800));
    if (rows.length) await db.ScannerState.update(rows[0].id, { value: payload, updated_at: new Date().toISOString() });
    else await db.ScannerState.create({ key, value: payload, description: 'Known MacroPulse user ids', updated_at: new Date().toISOString() });
    return Response.json({ ok: true, stats: s, new_users: rows.length ? fresh.length : 0, sent });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as any)?.message || e) }, { status: 500 });
  }
});
