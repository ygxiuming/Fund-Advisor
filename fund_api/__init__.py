from __future__ import annotations

import hashlib
import json
import random
import re
from datetime import datetime
from typing import Any

import httpx


EASTMONEY_JS_URL = "https://fundgz.1234567.com.cn/js/{code}.js"
EASTMONEY_DATA_URL = "https://fund.eastmoney.com/pingzhongdata/{code}.js"


def _fallback_quote(fund_code: str) -> dict[str, Any] | None:
    """Return stable demo data when the public quote endpoint is unavailable."""
    if not re.fullmatch(r"\d{6}", fund_code):
        return None

    digest = hashlib.sha256(fund_code.encode("utf-8")).hexdigest()
    seed = int(digest[:8], 16)
    rng = random.Random(seed)
    nav = round(0.75 + rng.random() * 2.8, 4)
    percent = round(rng.uniform(-2.8, 2.8), 2)
    return {
        "name": f"演示基金 {fund_code}",
        "nav": nav,
        "percent": percent,
        "update_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "source": "mock",
    }


async def _fetch_pingzhong_quote(fund_code: str) -> dict[str, Any] | None:
    """Backup source: Eastmoney static page data (name + latest NAV + daily return).

    The pingzhongdata/{code}.js file exposes fS_name and Data_netWorthTrend.
    Used when the realtime estimation endpoint (fundgz) is unavailable.
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                EASTMONEY_DATA_URL.format(code=fund_code),
                headers={"Referer": f"https://fund.eastmoney.com/{fund_code}.html"},
            )
            response.raise_for_status()
        text = response.text
        name_match = re.search(r'fS_name\s*=\s*"([^"]+)"', text)
        trend_match = re.search(r"Data_netWorthTrend\s*=\s*(\[.*?\]);", text, re.S)
        if not name_match or not trend_match:
            return None
        rows = json.loads(trend_match.group(1))
        if not rows:
            return None
        latest = rows[-1]
        nav = float(latest.get("y") or 0)
        if nav <= 0:
            return None
        ts = int(latest.get("x", 0)) / 1000
        return {
            "name": name_match.group(1) or f"基金 {fund_code}",
            "nav": nav,
            "percent": float(latest.get("equityReturn") or 0),
            "update_time": datetime.fromtimestamp(ts).strftime("%Y-%m-%d"),
            "source": "eastmoney-static",
        }
    except Exception:
        return None


async def get_fund_realtime_async(fund_code: str) -> dict[str, Any] | None:
    """Fetch realtime fund data from Eastmoney's public JS endpoint.

    The endpoint returns JavaScript like jsonpgz({...});. If that fails, the
    static pingzhongdata page is used as a backup (name + latest NAV). Only when
    both sources fail is a deterministic demo quote returned so the app stays
    usable offline.
    """
    code = str(fund_code).strip()
    if not re.fullmatch(r"\d{6}", code):
        return None

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(
                EASTMONEY_JS_URL.format(code=code),
                headers={"Referer": "https://fund.eastmoney.com/"},
            )
            response.raise_for_status()
        match = re.search(r"jsonpgz\((.*)\);?", response.text.strip())
        if match:
            raw = json.loads(match.group(1))
            nav = float(raw.get("gsz") or raw.get("dwjz") or 0)
            percent = float(raw.get("gszzl") or 0)
            name = (raw.get("name") or "").strip()
            if nav > 0 and name:
                return {
                    "name": name,
                    "nav": nav,
                    "percent": percent,
                    "update_time": raw.get("gztime") or datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "source": "eastmoney",
                }
    except Exception:
        pass

    quote = await _fetch_pingzhong_quote(code)
    if quote:
        return quote

    return _fallback_quote(code)


async def get_fund_history_async(fund_code: str, days: int = 90) -> list[dict[str, Any]]:
    """Fetch recent net-worth history for charting.

    Eastmoney exposes Data_netWorthTrend inside pingzhongdata/{code}.js. The
    shape is not formally versioned, so failures return an empty list.
    """
    code = str(fund_code).strip()
    if not re.fullmatch(r"\d{6}", code):
        return []
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                EASTMONEY_DATA_URL.format(code=code),
                headers={"Referer": f"https://fund.eastmoney.com/{code}.html"},
            )
            response.raise_for_status()
        match = re.search(r"Data_netWorthTrend\s*=\s*(\[.*?\]);", response.text, re.S)
        if not match:
            return []
        rows = json.loads(match.group(1))
        result = []
        for item in rows[-days:]:
            ts = int(item.get("x", 0)) / 1000
            result.append(
                {
                    "date": datetime.fromtimestamp(ts).strftime("%Y-%m-%d"),
                    "nav": float(item.get("y") or 0),
                    "equity_return": float(item.get("equityReturn") or 0),
                }
            )
        return result
    except Exception:
        return []


async def get_fund_extra_async(fund_code: str) -> dict[str, Any]:
    quote = await get_fund_realtime_async(fund_code)
    history = await get_fund_history_async(fund_code, 120)
    if not history:
        return {"quote": quote, "history": [], "metrics": {}}

    navs = [x["nav"] for x in history if x["nav"]]
    latest = navs[-1] if navs else 0
    first_30 = navs[-30] if len(navs) >= 30 else navs[0]
    first_90 = navs[-90] if len(navs) >= 90 else navs[0]
    peak = navs[0]
    max_drawdown = 0.0
    for nav in navs:
        peak = max(peak, nav)
        if peak:
            max_drawdown = min(max_drawdown, (nav - peak) / peak * 100)
    metrics = {
        "return_30d": (latest - first_30) / first_30 * 100 if first_30 else 0,
        "return_90d": (latest - first_90) / first_90 * 100 if first_90 else 0,
        "max_drawdown": max_drawdown,
        "history_points": len(history),
    }
    return {"quote": quote, "history": history, "metrics": metrics}


def get_fund_realtime(fund_code: str) -> dict[str, Any] | None:
    """Synchronous wrapper for scripts/tests that do not run an event loop."""
    import asyncio

    try:
        return asyncio.run(get_fund_realtime_async(fund_code))
    except RuntimeError:
        loop = asyncio.get_event_loop()
        return loop.run_until_complete(get_fund_realtime_async(fund_code))
