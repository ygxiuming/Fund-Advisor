# 🏦 DeepSeek Fund Advisor

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/)
[![Version](https://img.shields.io/badge/version-v1.0.0-green.svg)](https://github.com/lzm/fund-advisor)
[![Docs](https://img.shields.io/badge/docs-中文-red.svg)](./README.md)

> 📌 **AI-Powered Fund Portfolio Management & Investment Advisory for Chinese Markets**
>
> 中文文档：[README.md](./README.md)

---

## 📖 Overview

DeepSeek Fund Advisor is a locally runnable multi-agent AI investment advisory web application. It supports fund portfolio management, real-time market data, portfolio performance analysis, hot fund rankings, and context-aware investment suggestions powered by the DeepSeek LLM.

Designed for personal local use. Private data such as API keys, holdings, and portfolio history is excluded from Git by default.

---

## ✨ Features

- **📊 Portfolio Management**: Add, edit, delete fund holdings with local JSON persistence
- **🔍 Auto-Lookup**: Automatic fund name and NAV retrieval upon entering a fund code
- **📈 Real-Time Data**: Live NAV, daily change, and historical data from Eastmoney/Tiantian Fund
- **🔥 Hot Rankings**: Trending fund leaderboard for market insights
- **💰 P&L Analysis**: Total cost, current value, floating P&L, and return rate at a glance
- **📉 Charts**: P&L curves, asset allocation, and 90-day NAV trends
- **🤖 AI Chat Advisor**: DeepSeek-powered chat with automatic portfolio and market context injection
- **👥 Multi-Agent Collaboration**: 2–3 agents analyze in parallel, then synthesize a final recommendation
- **⚙️ Visual Management**: Visual CRUD interface for Agent and Skill templates
- **🔒 Privacy First**: Local JSON storage, no database required, API keys never persisted to files

---

## 👥 Multi-Agent Design

### Inspiration

The multi-agent collaboration concept is inspired by **[TradingAgents-CN](https://github.com/hsliuping/TradingAgents-CN)** — a Chinese-enhanced multi-agent and LLM stock analysis learning platform.

> 🎯 TradingAgents-CN is a leading open-source project in multi-agent financial analysis. We acknowledge their product philosophy and architectural design.

### Implementation

The multi-agent collaboration logic in this project is independently implemented. No code imports or depends on the TradingAgents-CN repository.

Workflow:

| Step | Description |
|------|-------------|
| 1️⃣ Select | User picks 2–3 agents from the available pool |
| 2️⃣ Analyze | Backend sends identical portfolio and market context to each agent in parallel |
| 3️⃣ Advise | Each agent produces independent suggestions based on its role and skills |
| 4️⃣ Synthesize | A summary agent merges all suggestions into one clear, actionable final plan |

---

## 🛠️ Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Backend | FastAPI + Pydantic | High-performance async API |
| HTTP | httpx | Async third-party market data requests |
| Frontend | Vue 3 CDN | Reactive single-page application |
| Styling | TailwindCSS CDN | Utility-first CSS |
| Charts | Chart.js CDN | P&L and NAV trend visualization |
| Storage | Local JSON | Zero dependencies, no database needed |
| AI Model | DeepSeek | OpenAI Chat Completions compatible |

---

## 🚀 Quick Start

### Requirements

- Python 3.10+
- pip

### Installation

```bash
# Create virtual environment
python -m venv .venv

# Activate (Windows)
.venv\Scripts\activate

# Activate (macOS / Linux)
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Launch the server
python main.py
```

Open in browser:

```text
http://localhost:8000
```

---

## 🔑 DeepSeek Configuration

### Option 1: Environment File (Recommended)

Copy the template and edit:

```bash
# Windows
copy .env.example .env

# macOS / Linux
cp .env.example .env
```

Edit `.env`:

```env
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_API_KEY=replace-with-your-real-api-key
```

### Option 2: Web UI

Enter the API key temporarily under **Model Settings** in the web interface. Keys entered via the UI stay in backend process memory only and are lost on restart.

> ⚠️ `.env` is gitignored and will never be committed.

---

## 🔒 Privacy & Security

### Git Ignore Rules

These paths are excluded from version control:

```text
.env                    # Environment variables (contains API Key)
config/*.json           # Local configuration files
TradingAgents-CN/       # Reference project
__pycache__/            # Python cache
```

### Commit Checklist

| Artifact | Safe to Commit |
|----------|---------------|
| `config.example/` | ✅ Safe (public templates) |
| `.env.example` | ✅ Safe (no real keys) |
| `config/portfolio.json` | ❌ Never (real holdings) |
| `config/*.json` | ❌ Never (local config) |
| `.env` | ❌ Never (contains API Key) |

> 🚨 If an API key was ever committed or pushed, **immediately** revoke it in the DeepSeek console and generate a new one.

---

## 📁 Project Structure

```text
fund-advisor/
├── main.py                  # FastAPI application entry point
├── fund_api/__init__.py     # Eastmoney/Tiantian Fund market data module
├── static/
│   ├── index.html           # Vue single-page application
│   ├── app.js               # Frontend business logic
│   └── style.css            # Custom styles
├── config.example/          # Public configuration templates
├── config/.gitkeep          # Preserves the local config directory
├── .env.example             # Environment variable template
├── requirements.txt         # Python dependencies
├── README.md                # Chinese documentation
└── README_EN.md             # English documentation (this file)
```

---

## 📡 API Endpoints

All responses follow a unified envelope:

```json
{
  "success": true,
  "message": "ok",
  "data": {}
}
```

### Endpoint Overview

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/bootstrap` | App initialization data |
| GET | `/api/funds/realtime` | Real-time fund quotes |
| GET | `/api/insights` | Investment insights |
| GET | `/api/fund-market/hot` | Trending fund rankings |
| PUT | `/api/portfolio` | Update portfolio |
| GET | `/api/agents` | List agent templates |
| PUT | `/api/agents` | Update agent config |
| GET | `/api/skills` | List skill templates |
| PUT | `/api/skills` | Update skill config |
| GET | `/api/model-config` | Get model configuration |
| PUT | `/api/model-config` | Update model configuration |
| POST | `/api/model-config/test` | Test model connection |
| POST | `/api/chat` | AI chat |

---

## ⚠️ Disclaimer

This project is an investment assistance tool and **does not constitute financial advice**. While prompts constrain the model to produce actionable suggestions:

- All investment decisions and risks remain solely with the user
- Past performance does not guarantee future results
- This platform is intended for **educational and research purposes** only — it does not provide live trading instructions

---

## 🤝 Acknowledgments

- **[TradingAgents-CN](https://github.com/hsliuping/TradingAgents-CN)** — Multi-agent financial analysis product philosophy and architecture reference
- **[Tauric Research](https://github.com/TauricResearch/TradingAgents)** — Original TradingAgents project
- **[DeepSeek](https://deepseek.com)** — Affordable and capable LLM API
- **[Eastmoney](https://www.eastmoney.com)** / **[Tiantian Fund](https://fund.eastmoney.com)** — Public market data

---

## 📄 License

This project is licensed under the [Apache 2.0](LICENSE) license.
