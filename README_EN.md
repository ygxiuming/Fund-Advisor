# 🏦 DeepSeek Fund Advisor

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/)
[![Version](https://img.shields.io/badge/version-v1.3.0-green.svg)](https://github.com/lzm/fund-advisor)

> 📌 **AI-Powered Fund Portfolio Management & Investment Advisory for Chinese Markets**
>
> 中文文档：[README.md](./README.md)

---

## 📖 Overview

DeepSeek Fund Advisor is a locally runnable multi-agent AI investment advisory web application. It supports fund portfolio management, real-time market data, portfolio performance analysis, hot fund rankings, and context-aware investment suggestions powered by the DeepSeek LLM with streaming output.

---

## ✨ Features

- **📊 Portfolio Management**: Add, edit, delete fund holdings with local JSON persistence; auto-recalculate shares based on NAV
- **🔍 Auto-Lookup**: Automatic fund name and NAV retrieval upon entering a fund code
- **📈 Real-Time Data**: Live NAV, daily change, and historical data from Eastmoney/Tiantian Fund; auto-fallback when offline
- **🔥 Hot Rankings**: Trending fund leaderboard for market insights; auto-fallback to portfolio list when API unavailable
- **💰 P&L Analysis**: Total cost, current value, floating P&L, and return rate at a glance
- **📉 Charts**: P&L curves, asset allocation, and 90-day NAV trends (Chart.js)
- **🤖 AI Chat Advisor**: DeepSeek-powered streaming chat with automatic portfolio and market context injection; single-agent and multi-agent collaboration modes
- **🧠 Deep Thinking**: DeepSeek thinking mode with streamed chain-of-thought, collapsible view, and configurable reasoning effort (high / max)
- **💬 Chat History**: Multi-conversation management with create/switch/delete, persisted locally
- **⚡ Quick Phrases**: Preset question templates — click to send, with full CRUD support
- **👥 Multi-Agent Collaboration**: 2–3 agents analyze in parallel, then a summary agent synthesizes a clear, actionable final recommendation
- **🎯 Rule-Based Recommendations**: Auto-generated buy/sell/hold suggestions based on 30-day return, drawdown, and daily change
- **⚙️ Visual Management**: Visual CRUD interface for Agents, Skills, and Model configs
- **🔄 Portfolio Snapshots**: Auto-record portfolio snapshots on every quote refresh
- **🌗 Dark Mode**: One-click light/dark theme toggle

---

## 👥 Multi-Agent Design

### Inspiration

The multi-agent collaboration concept is inspired by **[TradingAgents-CN](https://github.com/hsliuping/TradingAgents-CN)** — a Chinese-enhanced multi-agent and LLM stock analysis learning platform.

### Workflow

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
| Streaming | SSE (Server-Sent Events) | Token-by-token streaming response |
| Market Data | Eastmoney / Tiantian Fund public JS endpoints | No encryption required; offline auto-fallback |
| Frontend | Vue 3 CDN | Reactive single-page application |
| Styling | TailwindCSS CDN + custom CSS | Utility-first CSS + glassmorphism design |
| Charts | Chart.js CDN | P&L curves, asset allocation, NAV trends |
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

Open in browser: http://localhost:8000

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

---

## 📁 Project Structure

```text
fund-advisor/
├── main.py                  # FastAPI application entry point
├── fund_api/
│   ├── __init__.py          # Market data core module
│   └── eastmoney_fund_info.py  # Eastmoney API wrapper
├── static/
│   ├── index.html           # Vue single-page application
│   ├── app.js               # Frontend business logic
│   └── style.css            # Custom styles
├── config.example/          # Configuration templates
├── .env.example             # Environment variable template
├── requirements.txt         # Python dependencies
├── README.md                # Chinese documentation
└── README_EN.md             # English documentation (this file)
```

---

## 📡 API Endpoints

All responses follow a unified envelope:

```json
{ "success": true, "message": "ok", "data": {} }
```

### Endpoint Overview

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Homepage |
| GET | `/api/bootstrap` | App initialization data |
| GET/PUT | `/api/portfolio` | Portfolio management |
| GET | `/api/funds/realtime` | Real-time fund quotes |
| GET | `/api/insights` | Investment insights |
| GET | `/api/fund-market/hot` | Trending fund rankings |
| GET/PUT | `/api/agents` | Agent config |
| GET/PUT | `/api/skills` | Skill config |
| GET/PUT | `/api/models` | Model config |
| POST | `/api/models/test` | Test model connection |
| POST | `/api/chat` | AI chat (non-streaming) |
| POST | `/api/chat/stream` | AI chat (SSE streaming) |
| GET/PUT | `/api/quick-phrases` | Quick phrases management |

---

## ⚠️ Disclaimer

This project is an investment assistance tool and **does not constitute financial advice**. While prompts constrain the model to produce actionable suggestions:

- All investment decisions and risks remain solely with the user
- Past performance does not guarantee future results
- This platform is intended for **educational and research purposes** only

---

## 🤝 Acknowledgments

- **[TradingAgents-CN](https://github.com/hsliuping/TradingAgents-CN)** — Multi-agent financial analysis product philosophy and architecture reference
- **[Tauric Research](https://github.com/TauricResearch/TradingAgents)** — Original TradingAgents project
- **[DeepSeek](https://deepseek.com)** — Affordable and capable LLM API
- **[Eastmoney](https://www.eastmoney.com)** / **[Tiantian Fund](https://fund.eastmoney.com)** — Public market data

---

## 📋 Changelog

### v1.3.0 (2026-06-03)

- ✨ Added DeepSeek thinking mode: model outputs chain-of-thought before answering, streamed in real-time
- ✨ Collapsible thinking block: expanded by default during streaming, click to toggle
- ✨ Configurable reasoning effort: high (standard) or max (deep thinking)
- ✨ Quick phrases full CRUD: edit (✎) and delete (×) buttons always visible
- ✨ Startup banner shows local/LAN/public IP and access URLs
- 🎨 Quick phrase edit/delete buttons always visible, hover highlight
- 🐛 Fixed blank page (missing script tag)
- 🔧 Cleaned README, removed privacy/security sections, project-focused only

### v1.2.0 (2026-06-02)

- ✨ Added SSE streaming chat with token-by-token output (ChatGPT-like typing effect)
- ✨ Added chat history management: multi-conversation, create/switch/delete, local persistence
- ✨ Added quick phrases: preset question templates with click-to-send and full CRUD
- ✨ Added multi-model management with switchable models per chat
- ✨ Added dark mode toggle
- 🎨 Redesigned chat UI: left history panel + right chat area + collapsible config
- 🐛 Fixed Markdown rendering producing extra line breaks
- 🐛 Fixed model call errors not displaying correctly in frontend
- 🐛 Fixed auto-fallback from streaming to non-streaming on fetch failure

### v1.1.0 (2026-05-31)

- ✨ Added automatic portfolio snapshot recording
- ✨ Added rule-based holding recommendations
- ✨ Added offline fallback for quote and ranking APIs
- ✨ Portfolio management auto-recalculates shares based on NAV
- 🎨 Redesigned frontend with glassmorphism-style UI

### v1.0.0 (2026-05-29)

- 🎉 Initial release: FastAPI backend + Vue 3 frontend
- 📊 Fund portfolio management, real-time quotes, portfolio analysis
- 📈 Chart visualization
- 🤖 DeepSeek AI chat with multi-agent collaboration mode
- ⚙️ Agent / Skill template visual management

---

## 📄 License

This project is licensed under the [Apache 2.0](LICENSE) license.