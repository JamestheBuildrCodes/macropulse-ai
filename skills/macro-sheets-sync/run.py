#!/usr/bin/env python3
"""Mirror MacroPulse AI data into the "MacroPulse AI — Master Log" Google Sheet.

Env: GOOGLESHEETS_ACCESS_TOKEN, BASE44_API_URL, BASE44_APP_ID, BASE44_SERVICE_TOKEN
"""
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(HERE, "state.json")
TITLE = "MacroPulse AI — Master Log"
TABS = ["Dashboard", "Events", "Analyses", "Alerts", "Projections", "Correlations", "Users", "Health"]

TOKEN = os.environ.get("GOOGLESHEETS_ACCESS_TOKEN", "").strip()
API = os.environ.get("BASE44_API_URL", "").rstrip("/")
APP = os.environ.get("BASE44_APP_ID", "")
SVC = os.environ.get("BASE44_SERVICE_TOKEN", "")

SHEETS = "https://sheets.googleapis.com/v4/spreadsheets"
DRIVE = "https://www.googleapis.com/drive/v3/files"


def call(url, method="GET", body=None, timeout=45):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {TOKEN}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:300]
        raise RuntimeError(f"{method} {url.split('/v4/')[-1][:60]} -> {e.code} {detail}")


def rows(entity, limit=500):
    if not (API and APP and SVC):
        return []
    out, skip = [], 0
    while skip < 5000:
        url = f"{API}/api/apps/{APP}/entities/{entity}?limit={limit}&skip={skip}"
        req = urllib.request.Request(url)
        req.add_header("Authorization", f"Bearer {SVC}")
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                page = json.loads(r.read().decode())
        except Exception:
            break
        if not isinstance(page, list) or not page:
            break
        out.extend(page)
        if len(page) < limit:
            break
        skip += limit
    return out


def ensure_book():
    state = {}
    if os.path.exists(STATE):
        try:
            state = json.load(open(STATE))
        except Exception:
            state = {}
    sid = state.get("spreadsheet_id")
    if sid:
        try:
            call(f"{SHEETS}/{sid}?fields=spreadsheetId,sheets.properties.title")
            return sid, state
        except Exception:
            pass
    q = urllib.parse.quote(f"name='{TITLE}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false")
    found = call(f"{DRIVE}?q={q}&fields=files(id,name)")
    if found.get("files"):
        sid = found["files"][0]["id"]
        state["spreadsheet_id"] = sid
        json.dump(state, open(STATE, "w"), indent=2)
        return sid, state
    created = call(SHEETS, "POST", {
        "properties": {"title": TITLE, "locale": "en_GB", "timeZone": "Africa/Lagos"},
        "sheets": [{"properties": {"title": t}} for t in TABS],
    })
    sid = created["spreadsheetId"]
    state["spreadsheet_id"] = sid
    state["url"] = f"https://docs.google.com/spreadsheets/d/{sid}"
    json.dump(state, open(STATE, "w"), indent=2)
    return sid, state


def write_tab(sid, tab, values):
    rng = f"{urllib.parse.quote(tab)}!A1:Z8000"
    try:
        call(f"{SHEETS}/{sid}/values/{rng}:clear", "POST", {})
    except Exception:
        pass
    width = max((len(r) for r in values), default=1)
    values = [r + [""] * (width - len(r)) for r in values]
    body = {"values": values, "majorDimension": "ROWS"}
    call(f"{SHEETS}/{sid}/values/{urllib.parse.quote(tab)}!A1?valueInputOption=RAW", "PUT", body)


NUM = re.compile(r"-?\d+(?:\.\d+)?")


def num(v):
    if v is None:
        return None
    m = NUM.search(str(v).replace(",", ""))
    if not m:
        return None
    try:
        n = float(m.group())
    except ValueError:
        return None
    s = str(v)
    if re.search(r"[Kk]$", s):
        n *= 1e3
    elif re.search(r"[Mm]$", s):
        n *= 1e6
    elif re.search(r"[Bb]$", s):
        n *= 1e9
    return n


FAM = [
    ("inflation", r"cpi|inflation|price index|ppi|pce"),
    ("employment", r"employment|payroll|jobless|unemployment|wage|earnings|jobs"),
    ("growth", r"gdp|gross domestic"),
    ("retail", r"retail sales|consumer spending"),
    ("pmi", r"pmi|purchasing manager|\bism\b"),
    ("rates", r"interest rate|rate decision|policy rate|bank rate"),
    ("trade", r"trade balance|current account|exports|imports"),
    ("sentiment", r"confidence|sentiment|expectations"),
    ("housing", r"home|housing|mortgage|building permits"),
]
DOWN_IS_STRONG = "unemployment"


def family(title):
    t = str(title or "")
    if re.search(r"speech|speaks|press conference|testimony|remarks|statement|minutes", t, re.I):
        return "speech"
    for k, rx in FAM:
        if re.search(rx, t, re.I):
            return k
    return "other"


def analyse(e):
    fam = family(e.get("title"))
    a, f = num(e.get("actual")), num(e.get("forecast"))
    if a is None:
        return None
    if f is None or f == 0:
        return {"fam": fam, "delta": None, "pct": None, "word": "no forecast", "read": "No forecast published; context only."}
    delta = a - f
    pct = (delta / abs(f)) * 100
    scale = abs(pct)
    word = "in line" if scale < 1.5 else "modest" if scale < 6 else "significant" if scale < 15 else "large"
    if fam == "speech" or abs(delta) < 1e-12:
        read = "Neutral read: no measurable gap from expectation."
    else:
        strong = (delta < 0) if fam == DOWN_IS_STRONG else (delta > 0)
        read = f"{'Stronger' if strong else 'Weaker'} {e.get('currency')} than expected"
    return {"fam": fam, "delta": delta, "pct": pct, "word": word, "read": read}


def main():
    if not TOKEN:
        print("GOOGLESHEETS_ACCESS_TOKEN missing")
        return 1
    sid, state = ensure_book()

    events = rows("EconomicEvent")
    events.sort(key=lambda e: e.get("ts") or 0)
    alerts = rows("MacroNotificationLog")
    alerts.sort(key=lambda a: a.get("sent_at") or "", reverse=True)
    projs = rows("HistoricalProjection")
    corrs = rows("PairCorrelation")
    users = rows("MacroUser")
    health = rows("ApiHealthLog")
    health.sort(key=lambda h: h.get("checked_at") or "", reverse=True)

    now = datetime.now(timezone.utc).timestamp()
    upcoming = [e for e in events if (e.get("ts") or 0) > now]
    released = [e for e in events if e.get("actual")]

    resolved = [p for p in projs if p.get("outcome") in ("correct", "wrong", "inconclusive")]
    hit = [p for p in resolved if p.get("outcome") == "correct"]
    rate = f"{len(hit)}/{len(resolved)}" if resolved else "no scored calls yet"

    dash = [
        ["MacroPulse AI — Master Log"],
        ["Updated", datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")],
        [],
        ["Tracked releases", len(events)],
        ["Upcoming", len(upcoming)],
        ["Released with numbers", len(released)],
        ["Registered users", len(users)],
        ["Notifications logged", len(alerts)],
        ["Delivered", len([a for a in alerts if a.get("delivery_status") == "sent"])],
        ["Projections scored", rate],
        ["Correlations measured", len(corrs)],
        [],
        ["Next release", ""],
    ]
    if upcoming:
        n = upcoming[0]
        dash[-1] = ["Next release", f"{n.get('currency')} {n.get('title')} — {n.get('scheduled_wat', '')} WAT"]

    ev_rows = [["Event ID", "Currency", "Title", "Impact", "Family", "Scheduled (WAT)", "Previous", "Forecast", "Actual", "Surprise", "Surprise %", "Magnitude", "Status"]]
    for e in events:
        an = analyse(e) or {}
        ev_rows.append([
            e.get("event_id", ""), e.get("currency", ""), e.get("title", ""), e.get("impact", ""),
            e.get("indicator_family") or family(e.get("title")),
            e.get("scheduled_wat", ""), e.get("previous", ""), e.get("forecast", ""), e.get("actual", ""),
            "" if an.get("delta") is None else round(an["delta"], 4),
            "" if an.get("pct") is None else round(an["pct"], 2),
            an.get("word", ""), e.get("event_status", ""),
        ])

    an_rows = [["Currency", "Event", "Family", "Actual", "Forecast", "Gap", "Gap %", "Magnitude", "Read"]]
    for e in released:
        an = analyse(e)
        if not an:
            continue
        an_rows.append([
            e.get("currency", ""), e.get("title", ""), an["fam"], e.get("actual", ""), e.get("forecast", ""),
            "" if an["delta"] is None else round(an["delta"], 4),
            "" if an["pct"] is None else round(an["pct"], 2),
            an["word"], an["read"],
        ])

    al_rows = [["Sent", "Stage", "Event ID", "Status", "Channel", "Detail"]]
    for a in alerts:
        al_rows.append([
            (a.get("sent_at") or "")[:19].replace("T", " "), a.get("stage", ""), a.get("event_id", ""),
            a.get("delivery_status", ""), a.get("channel", ""), (a.get("error_message") or "")[:120],
        ])

    pr_rows = [["Event ID", "Instrument", "Projected", "Realised", "Outcome", "15m %", "60m %", "Family"]]
    for p in projs:
        pr_rows.append([
            p.get("event_id", ""), p.get("instrument", ""), p.get("projected_bias", ""),
            p.get("realized_direction", ""), p.get("outcome", ""),
            p.get("reaction_m15", ""), p.get("reaction_m60", ""), p.get("indicator_family", ""),
        ])

    co_rows = [["Pair", "Coefficient vs USD", "Samples", "Window days", "Period", "Method"]]
    for c in corrs:
        co_rows.append([
            c.get("pair", ""), c.get("coefficient", ""), c.get("sample_size", ""),
            c.get("window_days", ""), f"{c.get('period_start','')} to {c.get('period_end','')}", c.get("method", ""),
        ])

    us_rows = [["Telegram ID", "Username", "Joined", "Alerts", "Impact filter", "Commands"]]
    for u in users:
        us_rows.append([
            u.get("telegram_user_id", ""), u.get("username", ""), (u.get("joined_at") or "")[:10],
            "on" if u.get("alerts_enabled") is not False else "off",
            u.get("impact_filter", ""), u.get("commands_used", ""),
        ])

    he_rows = [["Checked", "Type", "Status", "Latency ms", "Detail"]]
    for h in health[:200]:
        he_rows.append([
            (h.get("checked_at") or "")[:19].replace("T", " "), h.get("check_type", ""),
            h.get("status", ""), h.get("latency_ms", ""), (h.get("detail") or "")[:160],
        ])

    write_tab(sid, "Dashboard", dash)
    write_tab(sid, "Events", ev_rows)
    write_tab(sid, "Analyses", an_rows)
    write_tab(sid, "Alerts", al_rows)
    write_tab(sid, "Projections", pr_rows)
    write_tab(sid, "Correlations", co_rows)
    write_tab(sid, "Users", us_rows)
    write_tab(sid, "Health", he_rows)

    print(json.dumps({
        "ok": True,
        "spreadsheet_url": f"https://docs.google.com/spreadsheets/d/{sid}",
        "tabs": {"Events": len(ev_rows) - 1, "Analyses": len(an_rows) - 1, "Alerts": len(al_rows) - 1,
                 "Projections": len(pr_rows) - 1, "Correlations": len(co_rows) - 1, "Users": len(us_rows) - 1},
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
