# MacroPulse AI

Plain-English forex event intelligence for Telegram. It tracks every high and medium impact release for USD, EUR, GBP, JPY and AUD, warns you before it lands, then tells you what the number actually meant.

Built to run on Base44 with no paid subscriptions: free economic calendar, free Telegram Bot API, rule-based analysis on the scheduled path.

---

## What it does

| When | What you get |
|---|---|
| 06:00 WAT daily | Morning briefing with the day's releases |
| 60 min before | First reminder: event, expected, last time |
| 30 min before | Second reminder |
| 15 min before | Final reminder |
| Minutes after release | Plain read: came in at X vs Y expected, what it means, what to watch |
| 22:00 WAT daily | Day in review: what printed, where each currency stands, what we learned |
| Friday 21:00 | Week in review |
| Sunday 18:00 | Week ahead preview |

Every message is written for someone who does not work in a dealing room. No jargon, no signals, no advice.

## Architecture

Two backend functions, one scheduled workflow, ten entities.

```
Telegram ──webhook──> macroBot      (conversation, menus, explainer)
                          │
                          └─ reads ─> Base44 entities <─ writes ─ macroPulse
                                                                    ▲
                                                    5-minute workflow tick
```

- **macroPulse** — calendar sync, alert dispatch, briefings, reviews, post-release reads, projection scoring, correlations. Deterministic, no LLM on the scheduled path.
- **macroBot** — user-facing: on-screen keyboard, inline buttons, plain-English explainer, donations.
- **Workflow** — `*/5 * * * *` Africa/Lagos, calls `macroPulse {action:"tick"}`. Releases land on :00/:15/:30/:45, so a 5-minute grid hits the 60/30/15 marks exactly.

## Data sources

| Source | Auth | Use |
|---|---|---|
| ShowMyTrades calendar API | none | events, forecasts, actuals, reschedules |
| Telegram Bot API | bot token | delivery, menus, Stars donations |
| Twelve Data | API key | prices, correlation windows, reaction scoring |
| Google Sheets | OAuth | audit workbook (see `skills/macro-sheets-sync`) |

## Commands

On-screen buttons cover everything: Today, This week, High impact, Medium impact, Currencies, Market, My alerts, Support, Help.

Text commands: `/start` `/menu` `/today` `/week` `/high` `/medium` `/outlook` `/market` `/pairs` `/settings` `/donate` `/status` `/help`.

Anything else typed is treated as a search, so `USD CPI` finds the release.

## Design decisions worth knowing

**Confidence over volume.** A release that matches expectations produces no alert-worthy claim. The engine says "in line" rather than inventing a direction.

**No duplicate sends, ever.** Every notification is claimed once by idempotency key before delivery. A second tick finds the claim and stops.

**Stale reminders are dropped, not sent.** If the scheduler was down, a missed 60-minute alert does not arrive at 20 minutes. The next valid stage fires instead.

**Reads are paginated and memoised.** Base44 allows 70 entity reads and 80 writes per 60 seconds. Without memoisation the dispatcher exhausts that in a single pass.

**No LLM in the scheduled path.** Rule-based interpretation is free and unlimited. A language model would consume the monthly message credit within days.

## Local notes

- Timezone: Africa/Lagos (WAT), DST-aware via IANA rules.
- Prices: DXY is not on the current data plan, so EURUSD is inverted and labelled as a dollar proxy.
- Correlations are measured from daily closes, not asserted. Crosses are derived from currency identities.

## Status

Live, private, single-owner deployment. Informational only. Never financial advice.
