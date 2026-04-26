#!/usr/bin/env python3
"""
Intel Center — Collection Script v1.0.0
Three sectors: Politics / Finance / Tech (interconnected)

Data sources:
  1. Google News RSS  — 10 queries across 3 sectors
  2. Yahoo Finance    — 15 key asset prices with anomaly detection
  3. RSS Aggregation  — 15 sources (BBC/Reuters/Guardian/TechCrunch/etc.)
  4. Hacker News      — Top stories, keyword-classified by sector
  5. Search Engines   — Bing/Sogou/DuckDuckGo HTML scraping (optional)

Output: JSON to stdout, progress to stderr
Dependencies: Python 3.9+ (stdlib only, no pip packages required)
Optional: akshare (for A/H stock data), tencent-news-cli (for Chinese news)
"""

import json
import os
import re
import ssl
import subprocess
import sys
import time
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

# ── Google News RSS Queries (3 sectors) ──────────────────────────────────────
GNEWS_QUERIES = [
    ("politics", "armed conflict war sanctions diplomacy"),
    ("politics", "election government international relations summit"),
    ("finance",  "Federal Reserve interest rate inflation bond yield"),
    ("finance",  "trade tariff oil OPEC energy supply chain"),
    ("finance",  "cryptocurrency Bitcoin DeFi crypto regulation"),
    ("finance",  "China economy PBOC yuan property debt"),
    ("tech",     "artificial intelligence AI chip semiconductor"),
    ("tech",     "cybersecurity quantum computing space"),
    ("tech",     "generative AI LLM OpenAI Anthropic Google"),
    ("tech",     "electric vehicle battery clean energy nuclear fusion"),
]
GNEWS_MAX_PER_QUERY = 8
GNEWS_BASE = "https://news.google.com/rss/search?hl=en&gl=US&ceid=US:en&q="

# ── Market Signal Config ─────────────────────────────────────────────────────
MARKET_ASSETS = {
    # Politics/Geopolitics
    "gold":  {"symbol": "GC=F",     "name": "Gold",          "threshold": 1.5,  "sector": "politics"},
    "oil":   {"symbol": "CL=F",     "name": "Crude Oil",     "threshold": 2.0,  "sector": "politics"},
    "hsi":   {"symbol": "^HSI",     "name": "Hang Seng",     "threshold": 2.0,  "sector": "politics"},
    # Finance
    "dxy":   {"symbol": "DX-Y.NYB", "name": "USD Index",     "threshold": 0.8,  "sector": "finance"},
    "sp500": {"symbol": "^GSPC",    "name": "S&P 500",       "threshold": 1.5,  "sector": "finance"},
    "vix":   {"symbol": "^VIX",     "name": "VIX",           "threshold": 10.0, "sector": "finance"},
    "tnx":   {"symbol": "^TNX",     "name": "10Y Treasury",  "threshold": 3.0,  "sector": "finance"},
    "btc":   {"symbol": "BTC-USD",  "name": "Bitcoin",       "threshold": 5.0,  "sector": "finance"},
    "hsti":  {"symbol": "3032.HK",  "name": "HS Tech ETF",   "threshold": 2.5,  "sector": "finance"},
    "csi300":{"symbol": "000300.SS","name": "CSI 300",       "threshold": 2.0,  "sector": "finance"},
    "sse":   {"symbol": "000001.SS","name": "SSE Composite",  "threshold": 2.0,  "sector": "finance"},
    # Tech
    "ndx":   {"symbol": "^IXIC",    "name": "Nasdaq",        "threshold": 1.5,  "sector": "tech"},
    "sox":   {"symbol": "^SOX",     "name": "Philly Semi",   "threshold": 2.0,  "sector": "tech"},
    "tsm":   {"symbol": "TSM",      "name": "TSMC",          "threshold": 3.0,  "sector": "tech"},
    "arkk":  {"symbol": "ARKK",     "name": "ARK Innovation","threshold": 3.0,  "sector": "tech"},
}

# ── Cross-sector causal tags ─────────────────────────────────────────────────
CROSS_SECTOR_TAGS = {
    "sanctions":       "Sanctions -> Markets",
    "war_inflation":   "War -> Inflation",
    "election_market": "Election -> Markets",
    "export_ban":      "Export Ban",
    "tech_war":        "Tech Decoupling",
    "rate_tech":       "Rates -> Tech Valuations",
    "dollar_chips":    "USD -> Chip Supply Chain",
    "ai_regulation":   "AI Regulation",
    "chip_geopolitics":"Chip Geopolitics",
    "ai_energy":       "AI -> Energy Demand",
    "big_tech_market": "Big Tech -> Markets",
}

# ── Delta Engine Config ──────────────────────────────────────────────────────
DELTA_THRESHOLDS = {
    "vix":    {"abs": 2.0,  "type": "abs"},
    "sp500":  {"abs": 0.8,  "type": "pct"},
    "gold":   {"abs": 0.8,  "type": "pct"},
    "oil":    {"abs": 1.2,  "type": "pct"},
    "btc":    {"abs": 2.0,  "type": "pct"},
    "dxy":    {"abs": 0.4,  "type": "pct"},
    "ndx":    {"abs": 0.8,  "type": "pct"},
    "sox":    {"abs": 1.2,  "type": "pct"},
    "hsi":    {"abs": 1.2,  "type": "pct"},
    "csi300": {"abs": 1.0,  "type": "pct"},
    "tnx":    {"abs": 2.0,  "type": "abs"},
}
DELTA_RISK_WEIGHTS = {
    "vix":    lambda d: -1 if d > 0 else +1,
    "sp500":  lambda d: +1 if d > 0 else -1,
    "gold":   lambda d: -1 if d > 0 else +1,
    "oil":    lambda d: 0,
    "btc":    lambda d: +1 if d > 0 else -1,
    "dxy":    lambda d: -1 if d > 0 else +1,
    "ndx":    lambda d: +1 if d > 0 else -1,
    "sox":    lambda d: +1 if d > 0 else -1,
}

SNAPSHOT_PATH = Path(__file__).parent / "market-snapshot.json"

# ── RSS Sources ──────────────────────────────────────────────────────────────
RSS_FEEDS = [
    # Politics
    {"id": "rss-bbc-world",       "url": "http://feeds.bbci.co.uk/news/world/rss.xml", "sector": "politics", "source": "BBC World"},
    {"id": "rss-al-jazeera",      "url": "https://www.aljazeera.com/xml/rss/all.xml",  "sector": "politics", "source": "Al Jazeera"},
    {"id": "rss-guardian-world",  "url": "https://www.theguardian.com/world/rss",      "sector": "politics", "source": "The Guardian"},
    {"id": "rss-foreign-policy",  "url": "https://foreignpolicy.com/feed/",            "sector": "politics", "source": "Foreign Policy"},
    {"id": "rss-npr-world",       "url": "https://feeds.npr.org/1004/rss.xml",         "sector": "politics", "source": "NPR World"},
    {"id": "rss-global-times",    "url": "https://www.globaltimes.cn/rss/outbrain.xml", "sector": "politics", "source": "Global Times"},
    # Finance
    {"id": "rss-reuters-world",   "url": "https://feeds.reuters.com/Reuters/worldNews", "sector": "finance", "source": "Reuters World"},
    {"id": "rss-yahoo-finance",   "url": "https://finance.yahoo.com/rss/topfinstories", "sector": "finance", "source": "Yahoo Finance"},
    {"id": "rss-caixin",          "url": "https://www.caixin.com/rss/",                 "sector": "finance", "source": "Caixin"},
    # Tech
    {"id": "rss-techcrunch",      "url": "https://techcrunch.com/feed/",                   "sector": "tech", "source": "TechCrunch"},
    {"id": "rss-ars-technica",    "url": "http://feeds.arstechnica.com/arstechnica/index", "sector": "tech", "source": "Ars Technica"},
    {"id": "rss-the-verge",       "url": "https://www.theverge.com/rss/index.xml",         "sector": "tech", "source": "The Verge"},
    {"id": "rss-hacker-news",     "url": "https://news.ycombinator.com/rss",               "sector": "tech", "source": "Hacker News"},
    {"id": "rss-mit-tech-review", "url": "https://www.technologyreview.com/feed/",          "sector": "tech", "source": "MIT Tech Review"},
    {"id": "rss-wired",           "url": "https://www.wired.com/feed/rss",                  "sector": "tech", "source": "Wired"},
]
RSS_MAX_PER_FEED = 5

# ── Hacker News Config ───────────────────────────────────────────────────────
HN_MAX_ITEMS = 60
HN_FETCH_ITEMS = 30
HN_MIN_SCORE = 50
HN_ALGOLIA_URL = "https://hn.algolia.com/api/v1/search?tags=front_page"
HN_SECTOR_KEYWORDS = {
    "tech": [
        "AI", "LLM", "GPT", "Claude", "Gemini", "machine learning", "neural",
        "semiconductor", "chip", "quantum", "cybersecurity", "hack", "breach",
        "open source", "GitHub", "programming", "software", "startup", "launch",
        "model", "benchmark", "API", "cloud", "database", "compiler", "kernel",
    ],
    "finance": [
        "bitcoin", "crypto", "ethereum", "blockchain", "Fed", "interest rate",
        "inflation", "recession", "stock", "market", "IPO", "acquisition",
        "venture", "funding", "economy", "bank", "dollar", "tariff", "trade",
        "GDP", "layoff", "earnings",
    ],
    "politics": [
        "war", "military", "sanction", "election", "government", "policy",
        "congress", "senate", "president", "minister", "treaty", "nuclear",
        "geopolit", "Ukraine", "Russia", "China", "Taiwan", "Iran", "Israel",
        "NATO", "UN", "WHO", "climate",
    ],
}

# ── Search Engine Config (adapted from 1052-OS websearch module) ─────────────
SEARCH_ENGINES = [
    {
        "id": "bing-cn",
        "source_id": "search-bing-cn",
        "name": "Bing CN",
        "template": "https://cn.bing.com/search?q={query}&ensearch=0",
        "region": "cn",
    },
    {
        "id": "bing-int",
        "source_id": "search-bing-int",
        "name": "Bing INT",
        "template": "https://cn.bing.com/search?q={query}&ensearch=1",
        "region": "global",
    },
    {
        "id": "sogou-wechat",
        "source_id": "search-sogou-wechat",
        "name": "Sogou WeChat",
        "template": "https://wx.sogou.com/weixin?type=2&query={query}",
        "region": "cn",
    },
    {
        "id": "duckduckgo",
        "source_id": "search-duckduckgo",
        "name": "DuckDuckGo",
        "template": "https://duckduckgo.com/html/?q={query}",
        "region": "global",
    },
]

SEARCH_QUERIES = [
    ("politics", "geopolitical conflict sanctions 2024"),
    ("finance",  "central bank interest rate decision"),
    ("tech",     "AI regulation semiconductor export"),
]

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"


def _env_float(name: str, default: float) -> float:
    try:
        value = float(os.environ.get(name, ""))
        return value if value > 0 else default
    except (TypeError, ValueError):
        return default


REQUEST_TIMEOUT = _env_float("INTEL_CENTER_REQUEST_TIMEOUT_SECONDS", 8.0)
SEARCH_TIMEOUT = _env_float("INTEL_CENTER_SEARCH_TIMEOUT_SECONDS", 8.0)
HN_INDEX_TIMEOUT = _env_float("INTEL_CENTER_HN_INDEX_TIMEOUT_SECONDS", 10.0)
HN_ITEM_TIMEOUT = _env_float("INTEL_CENTER_HN_ITEM_TIMEOUT_SECONDS", 5.0)
TOTAL_BUDGET_SECONDS = _env_float("INTEL_CENTER_TOTAL_BUDGET_SECONDS", 150.0)
GNEWS_STAGE_BUDGET_SECONDS = _env_float("INTEL_CENTER_GNEWS_BUDGET_SECONDS", 40.0)
MARKET_STAGE_BUDGET_SECONDS = _env_float("INTEL_CENTER_MARKET_BUDGET_SECONDS", 35.0)
RSS_STAGE_BUDGET_SECONDS = _env_float("INTEL_CENTER_RSS_BUDGET_SECONDS", 35.0)
HN_STAGE_BUDGET_SECONDS = _env_float("INTEL_CENTER_HN_BUDGET_SECONDS", 25.0)
SEARCH_STAGE_BUDGET_SECONDS = _env_float("INTEL_CENTER_SEARCH_BUDGET_SECONDS", 25.0)
CHINA_MARKET_STAGE_BUDGET_SECONDS = _env_float("INTEL_CENTER_CHINA_MARKET_BUDGET_SECONDS", 10.0)
STARTED_AT = time.monotonic()
STAGE_DEADLINE: Optional[float] = None
WARNINGS: list[str] = []
SOURCE_REGISTRY_ENABLED = os.environ.get("INTEL_CENTER_SOURCE_REGISTRY") == "1"
ENABLED_SOURCE_IDS = {
    item.strip()
    for item in os.environ.get("INTEL_CENTER_ENABLED_SOURCES", "").split(",")
    if item.strip()
}
DEFAULT_DISABLED_SOURCE_IDS = {"tencent-news"}
SKIPPED_SOURCE_IDS: list[str] = []


def _source_enabled(source_id: str) -> bool:
    if SOURCE_REGISTRY_ENABLED:
        return source_id in ENABLED_SOURCE_IDS
    return source_id not in DEFAULT_DISABLED_SOURCE_IDS


def _skip_source(source_id: str, label: str) -> None:
    SKIPPED_SOURCE_IDS.append(source_id)
    print(f"  [INFO] {label} disabled by Source Registry", file=sys.stderr)


def _remaining_budget() -> Optional[float]:
    candidates = []
    if TOTAL_BUDGET_SECONDS > 0:
        candidates.append(TOTAL_BUDGET_SECONDS - (time.monotonic() - STARTED_AT))
    if STAGE_DEADLINE is not None:
        candidates.append(STAGE_DEADLINE - time.monotonic())
    if not candidates:
        return None
    return min(candidates)


def _begin_stage(seconds: float) -> None:
    global STAGE_DEADLINE
    STAGE_DEADLINE = time.monotonic() + seconds


def _budgeted_timeout(timeout: float) -> Optional[float]:
    remaining = _remaining_budget()
    if remaining is not None and remaining <= 1:
        return None
    if remaining is None:
        return timeout
    return max(1.0, min(float(timeout), remaining))


def _sleep(seconds: float) -> None:
    remaining = _remaining_budget()
    if remaining is not None and remaining <= 1:
        return
    if remaining is not None:
        seconds = min(seconds, max(0.0, remaining - 1))
    if seconds > 0:
        time.sleep(seconds)


def _warn(message: str) -> None:
    WARNINGS.append(message)
    print(f"  [WARN] {message}", file=sys.stderr)


def _make_certifi_context() -> Optional[ssl.SSLContext]:
    try:
        import certifi  # type: ignore
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return None


CERTIFI_CONTEXT = _make_certifi_context()


def _is_cert_error(error: Exception) -> bool:
    reason = getattr(error, "reason", None)
    return (
        isinstance(error, ssl.SSLCertVerificationError)
        or isinstance(reason, ssl.SSLCertVerificationError)
        or "CERTIFICATE_VERIFY_FAILED" in str(error)
    )


# ── Helper Functions ─────────────────────────────────────────────────────────

def _http_get(url: str, timeout: float = REQUEST_TIMEOUT, headers: dict = None) -> Optional[bytes]:
    """Safe HTTP GET with timeout and error handling."""
    effective_timeout = _budgeted_timeout(timeout)
    if effective_timeout is None:
        _warn(f"Budget exhausted before GET {url[:80]}")
        return None

    hdrs = {"User-Agent": USER_AGENT}
    if headers:
        hdrs.update(headers)
    try:
        req = urllib.request.Request(url, headers=hdrs)
        context = CERTIFI_CONTEXT if CERTIFI_CONTEXT is not None else None
        with urllib.request.urlopen(req, timeout=effective_timeout, context=context) as resp:
            return resp.read()
    except Exception as e:
        if CERTIFI_CONTEXT is not None and _is_cert_error(e):
            try:
                req = urllib.request.Request(url, headers=hdrs)
                with urllib.request.urlopen(req, timeout=effective_timeout) as resp:
                    return resp.read()
            except Exception as default_ca_error:
                e = default_ca_error
        _warn(f"GET {url[:80]}: {e}")
        return None


def _strip_html(text: str) -> str:
    """Remove HTML tags and normalize whitespace."""
    text = re.sub(r'<script[\s\S]*?</script>', ' ', text, flags=re.I)
    text = re.sub(r'<style[\s\S]*?</style>', ' ', text, flags=re.I)
    text = re.sub(r'<br\s*/?>', '\n', text, flags=re.I)
    text = re.sub(r'</p>', '\n', text, flags=re.I)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'&amp;', '&', text)
    text = re.sub(r'&lt;', '<', text)
    text = re.sub(r'&gt;', '>', text)
    text = re.sub(r'&quot;', '"', text)
    text = re.sub(r'&#39;', "'", text)
    text = re.sub(r'&nbsp;', ' ', text)
    text = re.sub(r'&#(\d+);', lambda m: chr(int(m.group(1))), text)
    return re.sub(r'\s+', ' ', text).strip()


# ── Delta Engine ─────────────────────────────────────────────────────────────

def load_snapshot() -> Optional[dict]:
    if not SNAPSHOT_PATH.exists():
        return None
    try:
        return json.loads(SNAPSHOT_PATH.read_text())
    except Exception:
        return None


def save_snapshot(signals: dict, timestamp: str) -> None:
    snap = {
        "timestamp": timestamp,
        "signals": {k: {"price": v["price"], "name": v["name"]} for k, v in signals.items()},
    }
    SNAPSHOT_PATH.write_text(json.dumps(snap, ensure_ascii=False, indent=2))


def compute_market_delta(current_signals: dict, snapshot: Optional[dict]) -> dict:
    if not snapshot:
        return {"since": None, "deltas": [], "risk_direction": "neutral", "risk_score": 0}

    prev_signals = snapshot.get("signals", {})
    since = snapshot.get("timestamp")
    deltas = []
    risk_score = 0

    for key, cfg in current_signals.items():
        if key not in prev_signals:
            continue
        prev_price = prev_signals[key]["price"]
        curr_price = cfg["price"]
        if not prev_price or prev_price == 0:
            continue
        thresh_cfg = DELTA_THRESHOLDS.get(key)
        if not thresh_cfg:
            continue

        if thresh_cfg["type"] == "abs":
            change = curr_price - prev_price
            significant = abs(change) >= thresh_cfg["abs"]
            display = f"{change:+.2f}"
        else:
            change = (curr_price - prev_price) / prev_price * 100
            significant = abs(change) >= thresh_cfg["abs"]
            display = f"{change:+.1f}%"

        if not significant:
            continue

        severity = "high" if abs(change) >= thresh_cfg["abs"] * 2 else "moderate"
        direction_fn = DELTA_RISK_WEIGHTS.get(key)
        risk_contrib = direction_fn(change) if direction_fn else 0
        risk_score += risk_contrib

        deltas.append({
            "key": key, "name": cfg["name"], "sector": cfg["sector"],
            "prev_price": round(prev_price, 4), "curr_price": round(curr_price, 4),
            "change": round(change, 4), "display": display,
            "severity": severity, "risk_contrib": risk_contrib,
        })

    risk_direction = "risk_on" if risk_score > 0 else ("risk_off" if risk_score < 0 else "neutral")
    return {"since": since, "deltas": deltas, "risk_direction": risk_direction, "risk_score": risk_score}


# ── Collectors ───────────────────────────────────────────────────────────────

def fetch_rss(url: str, source: str, sector: str, max_items: int) -> list[dict]:
    try:
        raw = _http_get(url)
        if not raw:
            return []
        root = ET.fromstring(raw)
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        items = root.findall(".//item") or root.findall(".//atom:entry", ns)
        results = []
        for item in items[:max_items]:
            title = (item.findtext("title") or
                     item.findtext("atom:title", namespaces=ns) or "").strip()
            link = (item.findtext("link") or
                    item.findtext("atom:link[@rel='alternate']", namespaces=ns) or
                    (item.find("atom:link", ns).get("href") if item.find("atom:link", ns) is not None else "") or "").strip()
            if title and link:
                results.append({"title": title, "url": link, "source": source, "sector": sector})
        return results
    except Exception as e:
        print(f"  [WARN] RSS [{source}]: {e}", file=sys.stderr)
        return []


def collect_gnews() -> list[dict]:
    """Google News RSS search across 3 sectors."""
    _begin_stage(GNEWS_STAGE_BUDGET_SECONDS)
    if not _source_enabled("google-news-rss"):
        _skip_source("google-news-rss", "Google News RSS")
        return []
    seen, results = set(), []
    for sector, query in GNEWS_QUERIES:
        url = GNEWS_BASE + urllib.parse.quote(query)
        print(f"  [{sector}] {query[:45]}...", file=sys.stderr)
        items = fetch_rss(url, f"GoogleNews:{query[:20]}", sector, GNEWS_MAX_PER_QUERY)
        for item in items:
            if item["url"] not in seen and item["title"] not in seen:
                seen.add(item["url"])
                seen.add(item["title"])
                results.append(item)
        _sleep(0.5)
    print(f"  Google News: {len(results)} items", file=sys.stderr)
    return results


def fetch_yahoo_price(symbol: str) -> Optional[dict]:
    """Yahoo Finance v8 API — fetch 5-day data, compute daily change."""
    params = urllib.parse.urlencode({"interval": "1d", "range": "5d"})
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol)}?{params}"
    try:
        raw = _http_get(url, headers={"Accept": "application/json"})
        if not raw:
            return None
        data = json.loads(raw)
        result = data["chart"]["result"][0]
        closes = result["indicators"]["quote"][0]["close"]
        valid = [c for c in closes if c is not None]
        if len(valid) < 2:
            return None
        prev, curr = valid[-2], valid[-1]
        if symbol in ("^VIX", "^TNX"):
            change = curr - prev
        else:
            change = (curr - prev) / prev * 100
        return {"price": round(curr, 2), "change_pct": round(change, 2)}
    except Exception as e:
        print(f"  [WARN] Yahoo [{symbol}]: {e}", file=sys.stderr)
        return None


def collect_market() -> dict:
    """Collect all asset prices, classify by sector, flag anomalies."""
    _begin_stage(MARKET_STAGE_BUDGET_SECONDS)
    signals = {}
    anomalies = []
    by_sector = {"politics": [], "finance": [], "tech": []}
    if not _source_enabled("yahoo-finance"):
        _skip_source("yahoo-finance", "Yahoo Finance market data")
        return {
            "signals": signals,
            "anomalies": anomalies,
            "by_sector": by_sector,
            "snapshot_enabled": False,
        }

    print("  Collecting market signals...", file=sys.stderr)
    for key, cfg in MARKET_ASSETS.items():
        data = fetch_yahoo_price(cfg["symbol"])
        if not data:
            continue
        is_anomaly = abs(data["change_pct"]) >= cfg["threshold"]
        direction = "+" if data["change_pct"] > 0 else ""
        label = f"{cfg['name']} {direction}{data['change_pct']:.1f}%"
        signals[key] = {
            "name": cfg["name"], "sector": cfg["sector"],
            "price": data["price"], "change_pct": data["change_pct"],
            "anomaly": is_anomaly, "label": label,
        }
        by_sector[cfg["sector"]].append(label)
        if is_anomaly:
            anomalies.append(f"[{cfg['sector']}] {label}")
        _sleep(0.5)

    if anomalies:
        print(f"  Anomalies: {', '.join(anomalies)}", file=sys.stderr)
    else:
        print("  Market signals normal", file=sys.stderr)

    return {
        "signals": signals,
        "anomalies": anomalies,
        "by_sector": by_sector,
        "snapshot_enabled": True,
    }


def collect_rss() -> list[dict]:
    """Collect from all RSS sources."""
    _begin_stage(RSS_STAGE_BUDGET_SECONDS)
    seen, results = set(), []
    print(f"  Collecting {len(RSS_FEEDS)} RSS feeds...", file=sys.stderr)
    for feed in RSS_FEEDS:
        if not _source_enabled(feed["id"]):
            _skip_source(feed["id"], feed["source"])
            continue
        items = fetch_rss(feed["url"], feed["source"], feed["sector"], RSS_MAX_PER_FEED)
        for item in items:
            if item["url"] not in seen:
                seen.add(item["url"])
                results.append(item)
    print(f"  RSS: {len(results)} items", file=sys.stderr)
    return results


def _hn_classify_sector(title: str) -> str:
    title_lower = title.lower()
    for sector, keywords in HN_SECTOR_KEYWORDS.items():
        if any(k.lower() in title_lower for k in keywords):
            return sector
    return "tech"


def collect_hackernews() -> list[dict]:
    """Collect top stories from Hacker News, classify by sector."""
    _begin_stage(HN_STAGE_BUDGET_SECONDS)
    if not _source_enabled("hacker-news"):
        _skip_source("hacker-news", "Hacker News API")
        return []
    seen, results = set(), []
    print("  Collecting Hacker News...", file=sys.stderr)
    raw_algolia = _http_get(HN_ALGOLIA_URL, timeout=HN_INDEX_TIMEOUT)
    if raw_algolia:
        try:
            data = json.loads(raw_algolia)
            for item in data.get("hits", [])[:HN_FETCH_ITEMS]:
                title = (item.get("title") or item.get("story_title") or "").strip()
                score = item.get("points") or 0
                item_id = item.get("objectID")
                url = item.get("url") or (f"https://news.ycombinator.com/item?id={item_id}" if item_id else "")
                if title and score >= HN_MIN_SCORE and url and url not in seen:
                    seen.add(url)
                    results.append({
                        "title": title, "url": url, "source": "HackerNews",
                        "sector": _hn_classify_sector(title), "score": score,
                    })
            if results:
                print(f"  HN: {len(results)} items", file=sys.stderr)
                return results
        except Exception as e:
            _warn(f"HN Algolia parse: {e}")

    try:
        raw = _http_get("https://hacker-news.firebaseio.com/v0/topstories.json")
        if not raw:
            return []
        top_ids = json.loads(raw)[:HN_MAX_ITEMS]
    except Exception as e:
        print(f"  [WARN] HN top stories: {e}", file=sys.stderr)
        return []

    fetched = 0
    for item_id in top_ids:
        if fetched >= HN_FETCH_ITEMS:
            break
        raw = _http_get(f"https://hacker-news.firebaseio.com/v0/item/{item_id}.json", timeout=HN_ITEM_TIMEOUT)
        if not raw:
            continue
        item = json.loads(raw)
        title = item.get("title", "").strip()
        score = item.get("score", 0)
        url = item.get("url") or f"https://news.ycombinator.com/item?id={item_id}"
        if title and score >= HN_MIN_SCORE and url not in seen:
            seen.add(url)
            results.append({
                "title": title, "url": url, "source": "HackerNews",
                "sector": _hn_classify_sector(title), "score": score,
            })
            fetched += 1
        _sleep(0.05)

    print(f"  HN: {len(results)} items", file=sys.stderr)
    return results


# ── Search Engine Scraping (from 1052-OS websearch module) ───────────────────

def _parse_bing_results(html: str) -> list[dict]:
    """Parse Bing search results HTML."""
    results = []
    # Match <li class="b_algo"> blocks
    blocks = re.findall(r'<li class="b_algo">(.*?)</li>', html, re.S)
    for block in blocks[:10]:
        title_m = re.search(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', block, re.S)
        snippet_m = re.search(r'<p[^>]*>(.*?)</p>', block, re.S)
        if title_m:
            url = title_m.group(1)
            title = _strip_html(title_m.group(2))
            snippet = _strip_html(snippet_m.group(1))[:220] if snippet_m else ""
            if title and url.startswith("http"):
                results.append({"title": title, "url": url, "snippet": snippet})
    return results


def _parse_duckduckgo_results(html: str) -> list[dict]:
    """Parse DuckDuckGo HTML results."""
    results = []
    blocks = re.findall(r'<div class="result[^"]*">(.*?)</div>\s*</div>', html, re.S)
    for block in blocks[:10]:
        title_m = re.search(r'<a[^>]+href="([^"]+)"[^>]*class="result__a"[^>]*>(.*?)</a>', block, re.S)
        if not title_m:
            title_m = re.search(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', block, re.S)
        snippet_m = re.search(r'class="result__snippet"[^>]*>(.*?)</[^>]+>', block, re.S)
        if title_m:
            url = title_m.group(1)
            if url.startswith("//duckduckgo.com/l/"):
                ud_m = re.search(r'uddg=([^&]+)', url)
                url = urllib.parse.unquote(ud_m.group(1)) if ud_m else url
            title = _strip_html(title_m.group(2))
            snippet = _strip_html(snippet_m.group(1))[:220] if snippet_m else ""
            if title and url.startswith("http"):
                results.append({"title": title, "url": url, "snippet": snippet})
    return results


def _parse_sogou_wechat_results(html: str) -> list[dict]:
    """Parse Sogou WeChat search results."""
    results = []
    blocks = re.findall(r'<li[^>]*id="sogou_vr_\d+"[^>]*>(.*?)</li>', html, re.S)
    if not blocks:
        blocks = re.findall(r'<div class="txt-box">(.*?)</div>', html, re.S)
    for block in blocks[:10]:
        title_m = re.search(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', block, re.S)
        snippet_m = re.search(r'<p[^>]*class="txt-info"[^>]*>(.*?)</p>', block, re.S)
        if title_m:
            url = title_m.group(1)
            if url.startswith("/"):
                url = "https://wx.sogou.com" + url
            title = _strip_html(title_m.group(2))
            snippet = _strip_html(snippet_m.group(1))[:220] if snippet_m else ""
            if title:
                results.append({"title": title, "url": url, "snippet": snippet})
    return results


def collect_search_engines() -> list[dict]:
    """Scrape search engine results for intel queries."""
    _begin_stage(SEARCH_STAGE_BUDGET_SECONDS)
    all_results = []
    seen_urls = set()

    print("  Collecting from search engines...", file=sys.stderr)
    for sector, query in SEARCH_QUERIES:
        for engine in SEARCH_ENGINES:
            if not _source_enabled(engine["source_id"]):
                _skip_source(engine["source_id"], engine["name"])
                continue
            url = engine["template"].replace("{query}", urllib.parse.quote(query))
            raw = _http_get(url, timeout=SEARCH_TIMEOUT)
            if not raw:
                continue

            html = raw.decode("utf-8", errors="replace")

            # Check if blocked
            if re.search(r'captcha|verify|robot|firewall', html, re.I):
                print(f"  [WARN] {engine['name']}: blocked/captcha", file=sys.stderr)
                continue

            # Parse based on engine type
            if "bing" in engine["id"]:
                items = _parse_bing_results(html)
            elif "duckduckgo" in engine["id"]:
                items = _parse_duckduckgo_results(html)
            elif "sogou" in engine["id"]:
                items = _parse_sogou_wechat_results(html)
            else:
                continue

            new_count = 0
            for item in items:
                if item["url"] not in seen_urls:
                    seen_urls.add(item["url"])
                    item["source"] = engine["name"]
                    item["sector"] = sector
                    item["engine_id"] = engine["id"]
                    all_results.append(item)
                    new_count += 1

            if new_count:
                print(f"    {engine['name']} [{sector}]: +{new_count}", file=sys.stderr)
            _sleep(1.0)  # Polite delay between engine requests

    print(f"  Search engines: {len(all_results)} items", file=sys.stderr)
    return all_results


# ── Optional: A/H Stock Data (requires akshare) ─────────────────────────────

CHINA_MARKET_CHILD = r'''
import datetime as _dt
import json

MARKER = "__INTEL_CHINA_MARKET_JSON__"

result = {
    "northbound": None, "southbound": None,
    "sectors_top": [], "sectors_bot": [],
    "ah_premium": None, "limit_up": 0, "limit_down": 0,
    "error": [],
}

try:
    import akshare as ak
    today = _dt.datetime.now().strftime("%Y%m%d")

    try:
        flow = ak.stock_hsgt_fund_flow_summary_em()
        north_rows = flow[flow["资金方向"] == "北向"]
        south_rows = flow[flow["资金方向"] == "南向"]
        def _sum_flow(rows):
            val = rows["资金净流入"].sum()
            return {"net_flow_m": round(float(val) / 1e8, 2)}
        result["northbound"] = _sum_flow(north_rows)
        result["southbound"] = _sum_flow(south_rows)
    except Exception as e:
        result["error"].append(f"northbound: {e}")

    try:
        sectors = ak.stock_board_industry_summary_ths()
        sectors = sectors.sort_values("涨跌幅", ascending=False)
        def _row(r):
            return {"name": r["板块"], "change": round(float(r["涨跌幅"]), 2)}
        result["sectors_top"] = [_row(r) for _, r in sectors.head(10).iterrows()]
        result["sectors_bot"] = [_row(r) for _, r in sectors.tail(5).iterrows()]
    except Exception as e:
        result["error"].append(f"sectors: {e}")

    try:
        result["limit_up"] = len(ak.stock_zt_pool_em(date=today))
    except Exception:
        pass
    try:
        result["limit_down"] = len(ak.stock_zt_pool_dtgc_em(date=today))
    except Exception:
        pass
except ImportError:
    result["error"].append("akshare not installed, skipping A/H stock data")

print(MARKER + json.dumps(result, ensure_ascii=False))
'''


def collect_china_market() -> dict:
    """Collect A/H stock data. Requires akshare (pip install akshare)."""
    _begin_stage(CHINA_MARKET_STAGE_BUDGET_SECONDS)
    result = {
        "northbound": None, "southbound": None,
        "sectors_top": [], "sectors_bot": [],
        "ah_premium": None, "limit_up": 0, "limit_down": 0,
        "error": [],
    }
    if not _source_enabled("china-market-akshare"):
        result["skipped"] = "source disabled"
        _skip_source("china-market-akshare", "A/H stock data")
        return result

    timeout = _budgeted_timeout(CHINA_MARKET_STAGE_BUDGET_SECONDS)
    if timeout is None:
        result["error"].append("budget exhausted before A/H stock data")
        _warn("Budget exhausted before A/H stock data")
        return result

    try:
        completed = subprocess.run(
            [sys.executable, "-c", CHINA_MARKET_CHILD],
            capture_output=True,
            env={**os.environ, "FORCE_COLOR": "0", "NO_COLOR": "1", "TERM": "dumb"},
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        result["error"].append(f"akshare timed out after {timeout:.1f}s")
        return result
    except Exception as e:
        result["error"].append(f"akshare subprocess: {e}")
        return result

    marker = "__INTEL_CHINA_MARKET_JSON__"
    payload = ""
    for line in completed.stdout.splitlines():
        if line.startswith(marker):
            payload = line[len(marker):]

    if completed.returncode != 0:
        stderr = completed.stderr.strip()[-500:]
        result["error"].append(f"akshare subprocess exited {completed.returncode}: {stderr or 'no stderr'}")
        return result
    if not payload:
        result["error"].append("akshare subprocess did not return JSON")
        return result

    try:
        child_result = json.loads(payload)
        if isinstance(child_result, dict):
            result.update(child_result)
    except Exception as e:
        result["error"].append(f"akshare JSON parse: {e}")

    if "akshare not installed, skipping A/H stock data" in result.get("error", []):
        print("  [INFO] akshare not installed, skipping A/H stock data", file=sys.stderr)

    return result


def collect_tencent_news() -> list[dict]:
    """Reserved Tencent News source slot; adapter is intentionally gated by the registry."""
    if not _source_enabled("tencent-news"):
        _skip_source("tencent-news", "Tencent News")
        return []
    _warn("Tencent News source is enabled, but the collector adapter is not implemented yet")
    return []


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    date_str = datetime.now().strftime("%Y-%m-%d")
    print(f"\nIntel Center v1.0 — {date_str}\n", file=sys.stderr)
    print("Sectors: Politics <-> Finance <-> Tech\n", file=sys.stderr)

    # Step 1: Google News
    print("[Step 1] Google News RSS (10 queries)", file=sys.stderr)
    articles = collect_gnews()
    print(f"  Total: {len(articles)} (deduplicated)\n", file=sys.stderr)

    # Step 2: Market signals
    print("[Step 2] Market signals", file=sys.stderr)
    market = collect_market()
    print(f"  Total: {len(market['signals'])} assets, {len(market['anomalies'])} anomalies\n", file=sys.stderr)

    # Step 2.1: Delta engine
    print("[Step 2.1] Delta engine (scan-to-scan)", file=sys.stderr)
    now_ts = datetime.now().isoformat(timespec="seconds")
    snapshot = load_snapshot()
    market_delta = compute_market_delta(market["signals"], snapshot)
    if market.get("snapshot_enabled") and market["signals"]:
        save_snapshot(market["signals"], now_ts)
    else:
        market_delta["snapshot_skipped"] = True
    if market_delta["deltas"]:
        print(f"  {len(market_delta['deltas'])} significant changes, direction: {market_delta['risk_direction']}", file=sys.stderr)
    else:
        print("  No significant scan-to-scan changes", file=sys.stderr)
    print("", file=sys.stderr)

    # Step 3: RSS
    print("[Step 3] RSS feeds", file=sys.stderr)
    rss_items = collect_rss()
    print(f"  Total: {len(rss_items)}\n", file=sys.stderr)

    # Step 4: Hacker News
    print("[Step 4] Hacker News", file=sys.stderr)
    hn_items = collect_hackernews()
    print(f"  Total: {len(hn_items)}\n", file=sys.stderr)

    # Step 5: Search engines
    print("[Step 5] Search engines (Bing/DuckDuckGo/Sogou)", file=sys.stderr)
    search_items = collect_search_engines()
    print(f"  Total: {len(search_items)}\n", file=sys.stderr)

    # Step 6: A/H stock data (optional)
    print("[Step 6] A/H stock data (optional)", file=sys.stderr)
    china_market = collect_china_market()
    errors = china_market.get("error", [])
    if errors:
        print(f"  Warnings: {'; '.join(errors)}", file=sys.stderr)
    print("", file=sys.stderr)

    # Step 7: Tencent News reserved source
    print("[Step 7] Tencent News (optional)", file=sys.stderr)
    tencent_items = collect_tencent_news()
    print(f"  Total: {len(tencent_items)}\n", file=sys.stderr)

    # Output JSON
    output = {
        "date": date_str,
        "version": "1.0.0",
        "sectors": ["politics", "finance", "tech"],
        "cross_sector_tags": CROSS_SECTOR_TAGS,
        "gnews":         {"total": len(articles),      "items": articles},
        "market":        market,
        "market_delta":  market_delta,
        "rss":           {"total": len(rss_items),     "items": rss_items},
        "hackernews":    {"total": len(hn_items),      "items": hn_items},
        "search_engines":{"total": len(search_items),  "items": search_items},
        "china_market":  china_market,
        "tencent_news":  {"total": len(tencent_items), "items": tencent_items},
        "diagnostics": {
            "elapsed_seconds": round(time.monotonic() - STARTED_AT, 2),
            "source_registry_enabled": SOURCE_REGISTRY_ENABLED,
            "enabled_source_ids": sorted(ENABLED_SOURCE_IDS) if SOURCE_REGISTRY_ENABLED else None,
            "skipped_source_ids": sorted(set(SKIPPED_SOURCE_IDS)),
            "request_timeout_seconds": REQUEST_TIMEOUT,
            "search_timeout_seconds": SEARCH_TIMEOUT,
            "hn_index_timeout_seconds": HN_INDEX_TIMEOUT,
            "hn_item_timeout_seconds": HN_ITEM_TIMEOUT,
            "total_budget_seconds": TOTAL_BUDGET_SECONDS,
            "stage_budget_seconds": {
                "gnews": GNEWS_STAGE_BUDGET_SECONDS,
                "market": MARKET_STAGE_BUDGET_SECONDS,
                "rss": RSS_STAGE_BUDGET_SECONDS,
                "hackernews": HN_STAGE_BUDGET_SECONDS,
                "search_engines": SEARCH_STAGE_BUDGET_SECONDS,
                "china_market": CHINA_MARKET_STAGE_BUDGET_SECONDS,
            },
            "certifi_fallback_available": CERTIFI_CONTEXT is not None,
            "warning_count": len(WARNINGS),
            "warnings": WARNINGS[-80:],
        },
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
