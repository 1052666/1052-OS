---
name: intel-center
description: Global intelligence hub. Three-sector architecture (Politics/Finance/Tech) with cross-sector causal chain analysis, market anomaly detection, and delta engine. Collects from Google News, Yahoo Finance, RSS, Hacker News, and search engines.
enabled: true
---

# Intel Center

A comprehensive global intelligence collection and analysis skill for 1052 OS.

**Three-sector architecture**: Politics <-> Finance <-> Tech (interconnected — events in one sector often cascade to others)

## What It Does

1. **Collects** news and market data from 6 parallel sources
2. **Detects** market anomalies and scan-to-scan price changes (delta engine)
3. **You analyze** the collected data: filter, score relevance, identify cross-sector causal chains
4. **You write** structured intelligence briefs with transmission chain analysis

## Quick Start

Run the collection script:

```bash
python3 scripts/intel.py 2>&1
```

The script outputs JSON to stdout with all collected data. Progress goes to stderr.

Then analyze the JSON output following the workflow below.

## Data Sources

| Source | What | Count |
|--------|------|-------|
| Google News RSS | 10 keyword queries across 3 sectors | ~50-80 articles |
| Yahoo Finance | 15 key assets (oil, gold, S&P500, VIX, BTC, etc.) | Price + daily change |
| RSS Feeds | 15 sources (BBC, Reuters, TechCrunch, Wired, etc.) | ~50-75 articles |
| Hacker News | Top stories filtered by score >= 50 | ~20-30 items |
| Search Engines | Bing CN/INT, DuckDuckGo, Sogou WeChat | ~10-30 results |
| A/H Stocks | Northbound flow, sector rotation, limit up/down | Optional (needs akshare) |

## Market Assets Tracked

### Politics/Geopolitics
- Gold (>1.5% = safe haven signal)
- Crude Oil (>2% = energy/geopolitical event)
- Hang Seng (>2% = China/HK geopolitical proxy)

### Finance
- USD Index, S&P 500, VIX, 10Y Treasury, Bitcoin
- HS Tech ETF, CSI 300, SSE Composite

### Tech
- Nasdaq, Philadelphia Semiconductor, TSMC, ARK Innovation ETF

## Cross-Sector Transmission Paths

```
Politics -> Finance: Sanctions -> market shock / War -> inflation
Politics -> Tech:    Export bans / Tech decoupling / State-funded R&D
Finance  -> Tech:    Interest rates -> tech valuations / USD -> chip costs
Tech     -> Politics: AI regulation / Chip geopolitics / Cyber warfare
Tech     -> Finance:  Big tech earnings -> market / AI -> energy demand
```

## Delta Engine

The script maintains a `market-snapshot.json` file to track scan-to-scan changes.

**How it works:**
- Each run saves current prices as a snapshot
- Next run compares against the previous snapshot
- Reports significant changes with severity (moderate/high)
- Computes risk direction: risk_on / risk_off / neutral

**Thresholds:**
- VIX: ±2.0 absolute | S&P 500: ±0.8% | Gold: ±0.8%
- Oil: ±1.2% | Bitcoin: ±2.0% | USD: ±0.4%
- Nasdaq: ±0.8% | Philly Semi: ±1.2%

## Analysis Workflow

After running the script, analyze the JSON output:

### Step 1: Market Signal Reading

Check `market.anomalies` for significant moves. Cross-reference with news:
- Oil spike + military news = geopolitical escalation
- VIX spike + no news = positioning ahead of known event
- Multiple assets moving same direction = high-conviction signal

### Step 2: LLM Annotation

For each article, annotate:

| Field | Description |
|-------|-------------|
| `title_cn` | Chinese title (if needed) |
| `summary` | Core content (50 chars) |
| `sector` | politics / finance / tech |
| `relevance_score` | 1-10 (6=notable, 8=important, 10=historic) |
| `event_type` | intent / action / market / accident |
| `key_actors` | Main actors involved |
| `causal_tags` | From the cross-sector tag library |
| `cross_sector` | Cross-sector transmission (if any) |

**Filter rules:**
- relevance < 5: discard
- Entertainment/sports: discard
- Duplicate events: keep highest-scored only
- Cross-sector events: boost relevance +1

### Step 3: Transmission Chain Analysis (Core Value)

This is the key output — not listing events, but connecting causal chains:

```
Chain N: [Sector A -> Sector B (-> Sector C)]
  Origin: Event title (Sector A)
  Mechanism: One sentence explaining the transmission
  Endpoint: Market signal or event (Sector B/C)
  Confidence: High/Medium/Low (basis: N signals cross-confirmed)
```

Rules:
- Quality over quantity: 1 solid chain > 5 weak ones
- Must have origin event + endpoint (market signal or another event)
- Military events -> check finance (oil, gold, defense stocks)
- Diplomatic events -> check tech (export bans, chips) and finance (FX, tariffs)

### Step 4: Write Intelligence Brief

Structure your output as a brief with:
1. **Sector summaries** (top events per sector with relevance scores)
2. **Market anomalies** (if any)
3. **Transmission chains** (the core analytical value)
4. **Delta alerts** (if significant scan-to-scan changes detected)

## Optional Dependencies

| Package | Purpose | Install |
|---------|---------|---------|
| akshare | A/H stock data (northbound flow, sectors, limit up/down) | `pip install akshare` |
| tencent-news-cli | Chinese news (Tencent hot topics, morning brief) | npm package |

The script works without these — they provide additional Chinese market data.

## Scheduling

For best coverage, run 2-3 times daily:

| Time | Purpose |
|------|---------|
| 09:30 | Morning brief (Asian markets open) |
| 15:00 | Afternoon update (US pre-market) |
| 22:00 | Evening brief (US market hours) |

Use 1052 OS's built-in calendar/scheduler to automate.

## Output JSON Structure

```json
{
  "date": "2026-04-22",
  "version": "1.0.0",
  "sectors": ["politics", "finance", "tech"],
  "cross_sector_tags": { ... },
  "gnews":          { "total": 65, "items": [...] },
  "market":         { "signals": {...}, "anomalies": [...], "by_sector": {...} },
  "market_delta":   { "since": "...", "deltas": [...], "risk_direction": "...", "risk_score": 0 },
  "rss":            { "total": 52, "items": [...] },
  "hackernews":     { "total": 25, "items": [...] },
  "search_engines": { "total": 18, "items": [...] },
  "china_market":   { "northbound": {...}, "sectors_top": [...], ... }
}
```
