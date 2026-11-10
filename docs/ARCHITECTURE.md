# Architecture

## Components

| Layer | Component | Responsibility |
|---|---|---|
| Conversation | `macroBot` | Webhook target. Registration, on-screen keyboard, inline cards, plain-English explainer, Stars donations. |
| Engine | `macroPulse` | Calendar sync, alert dispatch, briefings, reviews, post-release reads, projection scoring, correlations. |
| Scheduler | Workflow `MacroPulse 5-Minute Dispatcher` | `*/5 * * * *` Africa/Lagos → `macroPulse {action:"tick"}` |
| Audit | `skills/macro-sheets-sync` | Mirrors entities into a Google Sheets workbook for analysis. |

The engine never sends from a user-facing context and the bot never mutates delivery state. They share only the database.

## Entities

| Entity | Purpose | Key fields |
|---|---|---|
| `EconomicEvent` | Canonical event store | `event_id`, `ts`, `impact`, `previous`, `forecast`, `actual`, `notified_60/30/15`, `post_release_done` |
| `MacroUser` | One row per Telegram account | `telegram_user_id`, `chat_id`, `alerts_enabled`, `impact_filter` |
| `MacroNotificationLog` | Delivery ledger and idempotency | `idempotency_key`, `stage`, `delivery_status`, `message_preview` |
| `HistoricalProjection` | Pre/post directional record | `event_id`, `instrument`, `projected_bias`, `outcome`, `reaction_m15` |
| `PairCorrelation` | Measured relationships | `pair`, `coefficient`, `sample_size`, `period_start/end` |
| `PriceSnapshot` | Daily close cache | `instrument`, `bar_time`, `close` |
| `MacroUserSettings` | Global scheduling config | `daily_briefing_time`, `daily_review_time`, `alerts_paused` |
| `ApiHealthLog` | Runtime telemetry | `check_type`, `status`, `latency_ms` |
| `DailyReview` / `WeeklyReview` | Report archive | `report_date`, `report_text` |
| `MarketAnalysis` | Reserved for on-demand AI narrative | `event_id`, `analysis_type` |

## Notification pipeline

```
tick
 ├─ sync        (only if last good sync > 15 min)
 ├─ resume      (re-pump any notification left 'queued')
 ├─ postRelease (actuals arrived → claim once → fan out)
 ├─ alerts      (60/30/15 windows → claim once → fan out)
 ├─ reports     (briefing 06:00, daily 22:00, weekly Fri 21:00, preview Sun 18:00)
 └─ evaluate    (score pending projections against price)
```

### Idempotency

Key format: `EVENT_ID|STAGE` (e.g. `usd-cpi-mom.20261110T1330|alert_30`).
A notification is created once with `delivery_status: queued`, then delivered. A repeat tick finds the row and returns `duplicate` without sending. Failures retry at most twice, then give up rather than spam.

### Fan-out

Subscribers are read once per run and cached. Delivery proceeds in batches of 8 concurrent sends, capped at 400 per pass. If a run is cut short, the cursor in `ScannerState` lets the next run continue where it stopped instead of restarting.

## Rate limits that shaped the design

| Limit | Consequence |
|---|---|
| 70 entity reads / 60s | Per-run memoisation of state, settings, subscribers |
| 80 entity writes / 60s | Sync budgeted to 55 writes per pass, resuming next tick |
| Twelve Data 8 credits/min | Health and correlation calls paced 8.5s apart |
| Telegram ~30 msg/s | Concurrency 8, batch cap 400 |

## Scheduling windows

Alerts fire when `time_to_event` falls inside `[lead, lead - 5min]`. A tick that arrives late does not send an expired reminder; the next stage handles it. This is deliberate: a 60-minute alert arriving at 12 minutes is worse than none.

## Analysis model

Interpretation is deterministic, driven by the indicator family rather than the number alone.

- Inflation, employment, growth, retail, PMI, rates, trade, sentiment, housing → a higher print reads stronger for the currency.
- Unemployment → a higher print reads weaker.
- Speeches → no numeric direction; tone relative to the prior stance decides.

Surprise magnitude is scored relative to forecast (`in line` under 0.05%, `large` above 15%). Only the surprise, never the raw level, drives the read.

## Failure behaviour

| Failure | Behaviour |
|---|---|
| Calendar provider down | Cycle skipped, logged to `ApiHealthLog`, previous data served, no fabricated prices |
| Telegram 400 on HTML | Retried as plain text |
| Notification send fails | Retried twice, then marked failed |
| Price provider quota exhausted | Section omitted with an explicit note |
| Scheduler missed a window | Expired reminder dropped |

## Extension points

- **New calendar provider** — implement `fetchCal()` returning raw events; `normEvent()` handles the rest.
- **New delivery channel** — add a branch in `tgSend()`; fan-out logic is channel-agnostic.
- **Real LLM narrative** — populate `MarketAnalysis` from an agent step; `macroBot` already has a slot for it.
