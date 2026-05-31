from __future__ import annotations

import asyncio
import json
import os
import re
import uuid
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from fund_api import get_fund_extra_async, get_fund_realtime_async


BASE_DIR = Path(__file__).resolve().parent
CONFIG_DIR = BASE_DIR / "config"


def load_local_env() -> None:
    env_path = BASE_DIR / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_local_env()


DEFAULT_PORTFOLIO = {
    "holdings": []
}

DECISIVE_RULE = (
    "你必须给出明确结论。禁止使用“可能、或许、看情况、建议谨慎、仅供参考、无法判断”等模糊表达。"
    "每只相关基金必须输出一个动作：买入、加仓、持有、减仓、卖出。必须说明理由和执行条件。"
)

DEFAULT_AGENTS = {
    "agents": [
        {
            "id": "steady-advisor",
            "name": "稳健型投资顾问",
            "description": "强调风险控制、回撤管理和长期配置。",
            "system_prompt": f"你是稳健型基金投资顾问。优先控制回撤、避免过度集中、重视长期胜率。{DECISIVE_RULE}",
            "temperature": 0.25,
            "max_tokens": 1500,
            "active": True,
        },
        {
            "id": "aggressive-advisor",
            "name": "激进型投资顾问",
            "description": "强调趋势择时和较高仓位进攻。",
            "system_prompt": f"你是激进型基金投资顾问。重视趋势强度、资金效率和进攻仓位。{DECISIVE_RULE}",
            "temperature": 0.45,
            "max_tokens": 1500,
            "active": True,
        },
        {
            "id": "risk-analyst",
            "name": "风险评估专家",
            "description": "识别集中度、波动和仓位风险。",
            "system_prompt": f"你是基金组合风险评估专家。重点识别仓位、行业集中度、亏损扩大和流动性风险。{DECISIVE_RULE}",
            "temperature": 0.2,
            "max_tokens": 1300,
            "active": True,
        },
    ]
}

DEFAULT_SKILLS = {
    "skills": [
        {
            "id": "rebalance",
            "name": "再平衡",
            "description": "要求输出组合再平衡方案。",
            "keywords": ["再平衡", "仓位", "配置"],
            "instruction": "额外输出目标仓位百分比和调仓顺序。",
            "active": True,
        },
        {
            "id": "risk-control",
            "name": "止盈止损",
            "description": "要求加入明确止盈止损线。",
            "keywords": ["止盈", "止损", "风控"],
            "instruction": "额外给出每只基金的止盈线、止损线和触发后的动作。",
            "active": True,
        },
    ]
}

DEFAULT_MODELS = {
    "models": [
        {
            "id": "deepseek-default",
            "name": "DeepSeek Chat",
            "base_url": "https://api.deepseek.com/v1",
            "api_key": "",
            "model": "deepseek-chat",
            "active": True,
        }
    ]
}

DEFAULT_SETTINGS = {"refresh_interval_seconds": 300}
DEFAULT_HISTORY = {"snapshots": []}


def success(data: Any = None, message: str = "ok") -> dict[str, Any]:
    return {"success": True, "message": message, "data": data}


def failure(message: str, data: Any = None) -> dict[str, Any]:
    return {"success": False, "message": message, "data": data}


class Store:
    defaults = {
        "portfolio.json": DEFAULT_PORTFOLIO,
        "agents.json": DEFAULT_AGENTS,
        "skills.json": DEFAULT_SKILLS,
        "models.json": DEFAULT_MODELS,
        "app_settings.json": DEFAULT_SETTINGS,
        "portfolio_history.json": DEFAULT_HISTORY,
    }

    def __init__(self) -> None:
        self.lock = asyncio.Lock()
        CONFIG_DIR.mkdir(exist_ok=True)
        for name, default in self.defaults.items():
            path = CONFIG_DIR / name
            if not path.exists():
                path.write_text(json.dumps(default, ensure_ascii=False, indent=2), encoding="utf-8")

    def read(self, name: str) -> Any:
        path = CONFIG_DIR / name
        if not path.exists():
            return deepcopy(self.defaults[name])
        return json.loads(path.read_text(encoding="utf-8"))

    async def write(self, name: str, data: Any) -> Any:
        async with self.lock:
            path = CONFIG_DIR / name
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return data


store = Store()
runtime_api_keys: dict[str, str] = {}
app = FastAPI(title="基金投资助手", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


class Holding(BaseModel):
    id: str | None = None
    code: str
    name: str = ""
    cost: float = Field(ge=0)
    shares: float = Field(ge=0)
    note: str = ""


class Agent(BaseModel):
    id: str | None = None
    name: str
    description: str = ""
    system_prompt: str
    temperature: float = 0.3
    max_tokens: int = 1500
    active: bool = True


class Skill(BaseModel):
    id: str | None = None
    name: str
    description: str = ""
    keywords: list[str] = []
    instruction: str = ""
    active: bool = True


class ModelProfile(BaseModel):
    id: str | None = None
    name: str = ""
    base_url: str
    api_key: str = ""
    model: str
    active: bool = True


class ChatRequest(BaseModel):
    message: str
    model_id: str | None = None
    agent_id: str | None = None
    agent_ids: list[str] = []
    skill_ids: list[str] = []
    mode: str = "single"
    include_portfolio: bool = True
    include_quotes: bool = True
    include_skills: bool = True
    include_rule: bool = True


def migrate_model_config() -> None:
    models_path = CONFIG_DIR / "models.json"
    old_path = CONFIG_DIR / "model_config.json"
    if models_path.exists():
        return
    if old_path.exists():
        old = json.loads(old_path.read_text(encoding="utf-8"))
        entry = {
            "id": str(uuid.uuid4()),
            "name": "DeepSeek (迁移)",
            "base_url": os.getenv("DEEPSEEK_BASE_URL") or old.get("base_url", "https://api.deepseek.com/v1"),
            "api_key": "",
            "model": os.getenv("DEEPSEEK_MODEL") or old.get("model", "deepseek-chat"),
            "active": True,
        }
        models_path.write_text(json.dumps({"models": [entry]}, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        models_path.write_text(json.dumps(DEFAULT_MODELS, ensure_ascii=False, indent=2), encoding="utf-8")


migrate_model_config()


def public_models() -> list[dict[str, Any]]:
    items = store.read("models.json").get("models", [])
    result = []
    for m in items:
        has_key = bool(
            os.getenv("DEEPSEEK_API_KEY")
            or runtime_api_keys.get(m.get("id", ""))
            or m.get("api_key")
        )
        result.append({
            "id": m.get("id", ""),
            "name": m.get("name", ""),
            "base_url": m.get("base_url", ""),
            "model": m.get("model", ""),
            "api_key": "********" if has_key else "",
            "has_api_key": has_key,
            "active": m.get("active", True),
        })
    return result


def effective_model_by_id(model_id: str) -> dict[str, str]:
    items = store.read("models.json").get("models", [])
    target = next((m for m in items if m.get("id") == model_id), None)
    if not target:
        raise RuntimeError(f"未找到模型配置: {model_id}")
    env_key = os.getenv("DEEPSEEK_API_KEY")
    return {
        "base_url": target.get("base_url", ""),
        "api_key": env_key or runtime_api_keys.get(model_id, "") or target.get("api_key", ""),
        "model": target.get("model", "deepseek-chat"),
    }


async def build_market_snapshot() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    holdings = store.read("portfolio.json").get("holdings", [])
    quotes = await asyncio.gather(*(get_fund_realtime_async(item["code"]) for item in holdings))
    enriched = []
    quote_rows = []
    for item, quote in zip(holdings, quotes):
        q = quote or {}
        nav = float(q.get("nav") or 0)
        market_value = nav * float(item.get("shares") or 0)
        pnl = market_value - float(item.get("cost") or 0)
        pnl_rate = (pnl / float(item.get("cost")) * 100) if float(item.get("cost") or 0) else 0
        row = {**item, "quote": quote, "market_value": market_value, "pnl": pnl, "pnl_rate": pnl_rate}
        enriched.append(row)
        quote_rows.append({"code": item["code"], "name": q.get("name") or item.get("name"), **q})
    return enriched, quote_rows


async def record_portfolio_snapshot() -> dict[str, Any]:
    holdings, _ = await build_market_snapshot()
    total_cost = sum(float(x.get("cost") or 0) for x in holdings)
    total_value = sum(float(x.get("market_value") or 0) for x in holdings)
    total_pnl = total_value - total_cost
    snapshot = {
        "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "total_cost": round(total_cost, 2),
        "total_value": round(total_value, 2),
        "total_pnl": round(total_pnl, 2),
        "total_rate": round(total_pnl / total_cost * 100, 2) if total_cost else 0,
        "items": [
            {
                "code": x.get("code"),
                "name": (x.get("quote") or {}).get("name") or x.get("name"),
                "market_value": round(float(x.get("market_value") or 0), 2),
                "pnl": round(float(x.get("pnl") or 0), 2),
                "pnl_rate": round(float(x.get("pnl_rate") or 0), 2),
            }
            for x in holdings
        ],
    }
    history = store.read("portfolio_history.json")
    snapshots = history.get("snapshots", [])
    if not snapshots or snapshots[-1].get("total_value") != snapshot["total_value"] or snapshots[-1].get("total_cost") != snapshot["total_cost"]:
        snapshots.append(snapshot)
    history["snapshots"] = snapshots[-500:]
    await store.write("portfolio_history.json", history)
    return snapshot


def rule_recommendation(item: dict[str, Any], metrics: dict[str, Any]) -> dict[str, Any]:
    q = item.get("quote") or {}
    pnl_rate = float(item.get("pnl_rate") or 0)
    day_percent = float(q.get("percent") or 0)
    r30 = float(metrics.get("return_30d") or 0)
    drawdown = float(metrics.get("max_drawdown") or 0)
    if pnl_rate <= -12 and r30 > 2:
        action = "加仓"
        reason = "持仓亏损较深，但近 30 日趋势转强，适合分批摊低成本。"
    elif pnl_rate >= 18 and day_percent < -1:
        action = "减仓"
        reason = "已有较高收益且当日走弱，先锁定部分利润。"
    elif r30 < -5 or drawdown < -12:
        action = "减仓"
        reason = "近 30 日趋势偏弱或回撤较大，降低组合波动。"
    elif r30 > 5 and day_percent >= 0:
        action = "持有"
        reason = "中短期趋势向上，继续持有等待趋势延续。"
    else:
        action = "持有"
        reason = "当前收益和趋势没有触发明确调仓阈值。"
    return {
        "code": item.get("code"),
        "name": q.get("name") or item.get("name"),
        "action": action,
        "reason": reason,
        "score": round(50 + r30 * 2 + pnl_rate * 0.4 + day_percent * 3 + max(drawdown, -30) * 0.5, 1),
    }


def compose_context(holdings: list[dict[str, Any]], quotes: list[dict[str, Any]], skills: list[dict[str, Any]], include_portfolio: bool = True, include_quotes: bool = True, include_skills: bool = True, include_rule: bool = True) -> str:
    lines = []
    if include_portfolio:
        total_cost = sum(float(x.get("cost") or 0) for x in holdings)
        total_value = sum(float(x.get("market_value") or 0) for x in holdings)
        total_pnl = total_value - total_cost
        lines.extend([
            "当前账户持仓摘要：",
            f"总成本：{total_cost:.2f} 元；当前市值：{total_value:.2f} 元；浮动盈亏：{total_pnl:.2f} 元；收益率：{(total_pnl / total_cost * 100 if total_cost else 0):.2f}%。",
        ])
        for item in holdings:
            q = item.get("quote") or {}
            lines.append(
                f"- {item.get('code')} {q.get('name') or item.get('name')}: 成本 {float(item.get('cost') or 0):.2f}, "
                f"份额 {float(item.get('shares') or 0):.2f}, 净值 {float(q.get('nav') or 0):.4f}, "
                f"涨跌幅 {float(q.get('percent') or 0):.2f}%, 盈亏 {float(item.get('pnl') or 0):.2f}, 收益率 {float(item.get('pnl_rate') or 0):.2f}%."
            )
    if include_quotes:
        lines.append("实时行情 JSON：")
        lines.append(json.dumps(quotes, ensure_ascii=False))
    if include_skills and skills:
        lines.append("已启用技能附加指令：")
        lines.extend(f"- {s['name']}: {s.get('instruction', '')}" for s in skills)
    if include_rule:
        lines.append(DECISIVE_RULE)
    return "\n".join(lines)


async def call_deepseek(system_prompt: str, user_prompt: str, temperature: float, max_tokens: int, model_id: str | None = None) -> str:
    if not model_id:
        items = store.read("models.json").get("models", [])
        active = [m for m in items if m.get("active")]
        if not active:
            raise RuntimeError("没有可用的已激活模型，请先在模型设置中添加并激活模型。")
        model_id = active[0]["id"]
    cfg = effective_model_by_id(model_id)
    base_url = (cfg.get("base_url") or "").rstrip("/")
    api_key = cfg.get("api_key") or ""
    model = cfg.get("model") or "deepseek-chat"
    if not base_url or not api_key:
        raise RuntimeError("DeepSeek Base URL 或 API Key 未配置，请先在模型设置中保存。")

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    last_error = ""
    last_status = None
    async with httpx.AsyncClient(timeout=30.0) as client:
        for attempt in range(2):
            try:
                resp = await client.post(
                    f"{base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                    json=payload,
                )
                last_status = resp.status_code
                if resp.status_code >= 400:
                    body = resp.text[:500]
                    last_error = f"HTTP {resp.status_code}: {body}"
                    continue
                data = resp.json()
                if "choices" not in data:
                    last_error = f"响应缺少 choices: {str(data)[:300]}"
                    continue
                return data["choices"][0]["message"]["content"].strip()
            except httpx.TimeoutException:
                last_error = f"请求超时 (30s)，第 {attempt + 1} 次重试"
            except httpx.ConnectError:
                last_error = f"无法连接到 {base_url}，请检查 Base URL"
            except Exception as exc:
                last_error = str(exc) or type(exc).__name__
    detail = last_error or "未知错误"
    raise RuntimeError(f"模型调用失败 (status={last_status}): {detail}")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(BASE_DIR / "static" / "index.html")


@app.get("/api/bootstrap")
async def bootstrap() -> dict[str, Any]:
    return success(
        {
            "portfolio": store.read("portfolio.json"),
            "agents": store.read("agents.json"),
            "skills": store.read("skills.json"),
            "models": public_models(),
            "settings": store.read("app_settings.json"),
            "history": store.read("portfolio_history.json"),
        }
    )


@app.get("/api/portfolio")
async def get_portfolio() -> dict[str, Any]:
    return success(store.read("portfolio.json"))


@app.put("/api/portfolio")
async def save_portfolio(items: list[Holding]) -> dict[str, Any]:
    holdings = []
    for item in items:
        row = item.model_dump()
        row["id"] = row.get("id") or str(uuid.uuid4())
        quote = await get_fund_realtime_async(row["code"])
        if quote and not row.get("name"):
            row["name"] = quote["name"]
        holdings.append(row)
    saved = await store.write("portfolio.json", {"holdings": holdings})
    await record_portfolio_snapshot()
    return success(saved, "持仓已保存")


@app.get("/api/funds/realtime")
async def realtime(codes: str = "") -> dict[str, Any]:
    code_list = [x.strip() for x in codes.split(",") if x.strip()]
    if not code_list:
        code_list = [x["code"] for x in store.read("portfolio.json").get("holdings", [])]
    quotes = await asyncio.gather(*(get_fund_realtime_async(code) for code in code_list))
    await record_portfolio_snapshot()
    return success({code: quote for code, quote in zip(code_list, quotes)}, "行情已刷新")


@app.get("/api/insights")
async def insights() -> dict[str, Any]:
    holdings, _ = await build_market_snapshot()
    extras = await asyncio.gather(*(get_fund_extra_async(item["code"]) for item in holdings))
    funds = []
    recommendations = []
    for item, extra in zip(holdings, extras):
        metrics = extra.get("metrics", {})
        funds.append({**item, "history": extra.get("history", []), "metrics": metrics})
        recommendations.append(rule_recommendation(item, metrics))
    snapshot = await record_portfolio_snapshot()
    history = store.read("portfolio_history.json")
    return success(
        {
            "snapshot": snapshot,
            "history": history.get("snapshots", []),
            "funds": funds,
            "recommendations": recommendations,
        },
        "洞察数据已更新",
    )


@app.get("/api/fund-market/hot")
async def fund_market_hot() -> dict[str, Any]:
    url = (
        "https://fund.eastmoney.com/data/rankhandler.aspx"
        "?op=ph&dt=kf&ft=all&rs=&gs=0&sc=6yzf&st=desc"
        "&sd=2025-05-29&ed=2026-05-29&qdii=&tabSubtype=,,,,,&pi=1&pn=12&dx=1&v=0.129"
    )
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                url,
                headers={
                    "Referer": "https://fund.eastmoney.com/data/fundranking.html",
                    "User-Agent": "Mozilla/5.0",
                },
            )
            resp.raise_for_status()
        match = re.search(r"datas:\[(.*?)\],allRecords", resp.text, re.S)
        if not match:
            raise RuntimeError("未解析到基金排行数据")
        rows = re.findall(r'"([^"]+)"', match.group(1))
        hot = []
        for row in rows[:12]:
            parts = row.split(",")
            hot.append(
                {
                    "code": parts[0],
                    "name": parts[1],
                    "date": parts[3],
                    "nav": parts[4],
                    "day_return": parts[6],
                    "week_return": parts[7],
                    "month_return": parts[8],
                    "quarter_return": parts[9],
                    "half_year_return": parts[10],
                    "year_return": parts[11],
                    "fee": parts[19] if len(parts) > 19 else "",
                    "reason": "近 6 个月收益率排名靠前，适合加入观察列表。",
                }
            )
        return success({"hot": hot, "source": "Eastmoney fund ranking"}, "热门基金已更新")
    except Exception as exc:
        holdings, _ = await build_market_snapshot()
        fallback = [
            {
                "code": item.get("code"),
                "name": (item.get("quote") or {}).get("name") or item.get("name"),
                "nav": (item.get("quote") or {}).get("nav"),
                "day_return": (item.get("quote") or {}).get("percent"),
                "month_return": "-",
                "half_year_return": "-",
                "year_return": "-",
                "reason": "热门接口暂不可用，已用当前持仓生成观察项。",
            }
            for item in holdings
        ]
        return success({"hot": fallback, "source": f"fallback: {exc}"}, "热门接口降级返回")


@app.get("/api/agents")
async def get_agents() -> dict[str, Any]:
    return success(store.read("agents.json"))


@app.put("/api/agents")
async def save_agents(items: list[Agent]) -> dict[str, Any]:
    agents = []
    for item in items:
        row = item.model_dump()
        row["id"] = row.get("id") or str(uuid.uuid4())
        row["system_prompt"] = f"{row['system_prompt']}\n{DECISIVE_RULE}" if DECISIVE_RULE not in row["system_prompt"] else row["system_prompt"]
        agents.append(row)
    return success(await store.write("agents.json", {"agents": agents}), "Agent 配置已保存")


@app.get("/api/skills")
async def get_skills() -> dict[str, Any]:
    return success(store.read("skills.json"))


@app.put("/api/skills")
async def save_skills(items: list[Skill]) -> dict[str, Any]:
    skills = []
    for item in items:
        row = item.model_dump()
        row["id"] = row.get("id") or str(uuid.uuid4())
        skills.append(row)
    return success(await store.write("skills.json", {"skills": skills}), "Skill 配置已保存")


@app.get("/api/models")
async def get_models() -> dict[str, Any]:
    return success({"models": public_models()})


@app.put("/api/models")
async def save_models(items: list[ModelProfile]) -> dict[str, Any]:
    models = []
    for item in items:
        row = item.model_dump()
        row["id"] = row.get("id") or str(uuid.uuid4())
        if row.get("api_key") and row["api_key"] != "********":
            runtime_api_keys[row["id"]] = row["api_key"]
        row["api_key"] = ""
        models.append(row)
    await store.write("models.json", {"models": models})
    return success({"models": public_models()}, "模型配置已保存")


@app.post("/api/models/test")
async def test_model_by_id(payload: dict[str, str]) -> dict[str, Any]:
    model_id = payload.get("model_id", "")
    if not model_id:
        return failure("缺少 model_id")
    try:
        text = await call_deepseek("只回答：连接成功", "请回复：连接成功", 0, 20, model_id)
        return success({"reply": text, "model_id": model_id}, "连接测试成功")
    except Exception as exc:
        return failure(str(exc))


@app.post("/api/chat")
async def chat(req: ChatRequest) -> dict[str, Any]:
    try:
        all_agents = [a for a in store.read("agents.json").get("agents", []) if a.get("active")]
        all_skills = [s for s in store.read("skills.json").get("skills", []) if s.get("active")]
        selected_skills = [s for s in all_skills if s["id"] in req.skill_ids]
        model_id = req.model_id or None

        holdings, quotes = await build_market_snapshot()
        has_context = req.include_portfolio or req.include_quotes or req.include_skills or req.include_rule
        if has_context:
            context = compose_context(holdings, quotes, selected_skills, req.include_portfolio, req.include_quotes, req.include_skills, req.include_rule)
            user_prompt = f"{context}\n\n用户问题：{req.message}"
        else:
            user_prompt = req.message

        if req.mode == "collab":
            ids = req.agent_ids[:3]
            agents = [a for a in all_agents if a["id"] in ids]
            if len(agents) < 2:
                return failure("协作模式至少选择 2 个已激活 Agent。")
            drafts = []
            for agent in agents:
                answer = await call_deepseek(agent["system_prompt"], user_prompt, agent["temperature"], agent["max_tokens"], model_id)
                drafts.append(f"【{agent['name']}】\n{answer}")
            if has_context:
                merge_prompt = (
                    f"{context}\n\n用户问题：{req.message}\n\n以下是多个 Agent 的初步建议，请合并成最终建议。"
                    "必须给出统一操作清单，不保留分歧，不输出模糊表达。\n\n" + "\n\n".join(drafts)
                )
            else:
                merge_prompt = f"用户问题：{req.message}\n\n以下是多个 Agent 的初步建议，请合并成最终建议。\n\n" + "\n\n".join(drafts)
            final = await call_deepseek(
                f"你是投资建议汇总 Agent。你负责把多名专家意见压缩成明确、可执行的最终方案。{DECISIVE_RULE if req.include_rule else ''}",
                merge_prompt,
                0.2,
                1800,
                model_id,
            )
            return success({"reply": final, "drafts": drafts}, "协作建议已生成")

        agent = next((a for a in all_agents if a["id"] == req.agent_id), all_agents[0] if all_agents else None)
        if not agent:
            return failure("没有可用的已激活 Agent。")
        reply = await call_deepseek(agent["system_prompt"], user_prompt, agent["temperature"], agent["max_tokens"], model_id)
        return success({"reply": reply}, "回答已生成")
    except Exception as exc:
        return failure(str(exc))


if __name__ == "__main__":
    uvicorn.run("main:app", host="localhost", port=8000, reload=False)
