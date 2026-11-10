---
name: macro-sheets-sync
description: Sync MacroPulse AI entities into the "MacroPulse AI — Master Log" Google Sheet for analysis and reporting.
---

# MacroPulse AI — Google Sheets sync

Mirrors the live Base44 data into one workbook so the numbers can be analysed in a spreadsheet without touching the bot.

## What it writes

| Tab | Source | Rows |
|---|---|---|
| Dashboard | computed | totals, next event, hit rate |
| Events | `EconomicEvent` | every tracked release with actual vs forecast |
| Analyses | computed from `EconomicEvent` | plain-English read per release |
| Alerts | `MacroNotificationLog` | every notification and its delivery state |
| Projections | `HistoricalProjection` | directional calls and outcomes |
| Correlations | `PairCorrelation` | measured coefficients |
| Users | `MacroUser` | registrations and alert settings |
| Health | `ApiHealthLog` | sync and dispatcher telemetry |

## Usage

```bash
python3 .agents/skills/macro-sheets-sync/run.py
```

Requires `GOOGLESHEETS_ACCESS_TOKEN` (via `get_connector_token`). Reads Base44 data with `BASE44_API_URL`, `BASE44_APP_ID`, `BASE44_SERVICE_TOKEN` from the environment.

The workbook id is stored in `state.json` and reused. It is never recreated, so shared links and manual notes survive.

## Notes

- Every tab is rewritten in full each run. This is self-healing: a deleted row comes back, and there is no cursor drift.
- No secrets are written to the sheet.
- Run it after the 06:00 briefing and after the 22:00 review.
