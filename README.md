# 🏦 DeepSeek 基金投资助手

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/)
[![Version](https://img.shields.io/badge/version-v1.0.0-green.svg)](https://github.com/lzm/fund-advisor)
[![Docs](https://img.shields.io/badge/文档-中文-red.svg)](./README.md)

> 📌 **面向中文用户的 AI 基金持仓管理与智能投资分析平台**
>
> 英文文档：[README_EN.md](./README_EN.md)

---

## 📖 项目简介

DeepSeek 基金投资助手是一个本地运行的多 Agent AI 投资顾问 Web 应用。它支持基金持仓管理、实时行情刷新、组合收益分析、热门基金排行，并通过 DeepSeek 大模型提供基于持仓上下文的投资建议。

本项目适合个人本地使用。API Key、真实持仓、历史收益等隐私数据默认不会被 Git 追踪。

---

## ✨ 功能特性

- **📊 持仓管理**：新增、编辑、删除基金持仓，本地 JSON 持久化
- **🔍 自动查询**：输入基金代码后自动获取基金名称和最新净值
- **📈 实时行情**：从天天基金/东方财富公开接口获取实时净值、涨跌幅、历史数据
- **🔥 热门排行**：展示热门基金榜单，洞察市场热点
- **💰 收益分析**：组合总成本、当前市值、浮动盈亏、收益率一目了然
- **📉 图表可视化**：盈亏曲线、资产分布、近 90 日净值走势
- **🤖 AI 顾问**：DeepSeek 实时对话，自动携带持仓与行情上下文
- **👥 多 Agent 协作**：2~3 个 Agent 并行分析，汇总生成最终建议
- **⚙️ 可视化管理**：Agent 与 Skill 模板的可视化 CRUD
- **🔒 隐私安全**：本地 JSON 存储，无需数据库，API Key 不入文件

---

## 👥 多 Agent 设计

### 灵感来源

本项目的多 Agent 协作理念参考了 **[TradingAgents-CN](https://github.com/hsliuping/TradingAgents-CN)** —— 一个面向中文用户的多智能体与大模型股票分析学习平台。

> 🎯 TradingAgents-CN 是多 Agent 金融分析领域的优秀开源项目，我们向其产品理念和架构设计致敬。

### 当前实现

本项目的多 Agent 协作逻辑为独立实现，代码不依赖 TradingAgents-CN 仓库中的任何内容。

工作流程：

| 步骤 | 说明 |
|------|------|
| 1️⃣ 选择 Agent | 用户从可用 Agent 中选择 2 到 3 个 |
| 2️⃣ 并行分析 | 后端将相同的持仓与行情上下文分别发送给每个 Agent |
| 3️⃣ 独立建议 | 每个 Agent 基于自身角色和技能生成初步建议 |
| 4️⃣ 汇总合并 | 汇总 Agent 将多个建议合并为一份明确、可执行的最终方案 |

---

## 🛠️ 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 后端框架 | FastAPI + Pydantic | 高性能异步 API |
| HTTP 客户端 | httpx | 异步请求第三方行情接口 |
| 前端框架 | Vue 3 CDN | 响应式单页应用 |
| UI 样式 | TailwindCSS CDN | 原子化 CSS |
| 图表 | Chart.js CDN | 盈亏与净值走势 |
| 数据存储 | 本地 JSON | 零依赖，无需数据库 |
| AI 模型 | DeepSeek | 兼容 OpenAI Chat Completions |

---

## 🚀 快速开始

### 环境要求

- Python 3.10+
- pip

### 安装运行

```bash
# 创建虚拟环境
python -m venv .venv

# 激活虚拟环境（Windows）
.venv\Scripts\activate

# 激活虚拟环境（macOS / Linux）
source .venv/bin/activate

# 安装依赖
pip install -r requirements.txt

# 启动服务
python main.py
```

浏览器访问：

```text
http://localhost:8000
```

---

## 🔑 配置 DeepSeek

### 方式一：环境变量（推荐）

复制模板并编辑：

```bash
# Windows
copy .env.example .env

# macOS / Linux
cp .env.example .env
```

编辑 `.env` 文件：

```env
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_API_KEY=replace-with-your-real-api-key
```

### 方式二：网页配置

在网页「模型设置」中临时输入 API Key。网页输入的 Key 仅保存在后端进程内存中，重启服务后失效。

> ⚠️ `.env` 已被 `.gitignore` 忽略，不会被提交到 GitHub。

---

## 🔒 隐私与安全

### Git 忽略规则

以下内容默认不被 Git 追踪：

```text
.env                    # 环境变量（含 API Key）
config/*.json           # 本地配置文件
TradingAgents-CN/       # 参考项目
__pycache__/            # Python 缓存
```

### 提交检查清单

| 文件 | 是否可提交 |
|------|-----------|
| `config.example/` | ✅ 可提交（公开模板） |
| `.env.example` | ✅ 可提交（不含真实 Key） |
| `config/portfolio.json` | ❌ 禁止（真实持仓） |
| `config/*.json` | ❌ 禁止（本地配置） |
| `.env` | ❌ 禁止（含 API Key） |

> 🚨 如果 API Key 曾误提交或推送到远程仓库，请**立刻**在 DeepSeek 控制台吊销旧 Key 并重新生成。

---

## 📁 项目结构

```text
fund-advisor/
├── main.py                  # FastAPI 应用入口
├── fund_api/__init__.py     # 天天基金/东方财富行情模块
├── static/
│   ├── index.html           # Vue 单页应用
│   ├── app.js               # 前端业务逻辑
│   └── style.css            # 自定义样式
├── config.example/          # 可公开的配置模板
├── config/.gitkeep          # 保留本地配置目录
├── .env.example             # 环境变量模板
├── requirements.txt         # Python 依赖
├── README.md                # 中文文档（本文件）
└── README_EN.md             # 英文文档
```

---

## 📡 API 接口

所有接口统一响应格式：

```json
{
  "success": true,
  "message": "ok",
  "data": {}
}
```

### 接口列表

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/bootstrap` | 初始化数据 |
| GET | `/api/funds/realtime` | 基金实时行情 |
| GET | `/api/insights` | 投资洞察 |
| GET | `/api/fund-market/hot` | 热门基金排行 |
| PUT | `/api/portfolio` | 更新持仓 |
| GET | `/api/agents` | 获取 Agent 列表 |
| PUT | `/api/agents` | 更新 Agent 配置 |
| GET | `/api/skills` | 获取 Skill 列表 |
| PUT | `/api/skills` | 更新 Skill 配置 |
| GET | `/api/model-config` | 获取模型配置 |
| PUT | `/api/model-config` | 更新模型配置 |
| POST | `/api/model-config/test` | 测试模型连接 |
| POST | `/api/chat` | AI 对话 |

---

## ⚠️ 免责声明

本项目是投资辅助工具，**不构成金融投资建议**。模型输出会被提示词约束为明确的操作建议，但：

- 所有投资决策的最终责任由用户自行承担
- 过往业绩不代表未来表现
- 本平台定位为**学习与研究用途**，不提供实盘交易指令

---

## 🤝 致谢

- **[TradingAgents-CN](https://github.com/hsliuping/TradingAgents-CN)** — 多 Agent 金融分析的产品理念与架构参考
- **[Tauric Research](https://github.com/TauricResearch/TradingAgents)** — TradingAgents 源项目
- **[DeepSeek](https://deepseek.com)** — 提供高性价比的大模型 API
- **[天天基金](https://fund.eastmoney.com)** / **[东方财富](https://www.eastmoney.com)** — 公开行情数据

---

## 📄 许可证

本项目采用 [Apache 2.0](LICENSE) 许可证。
