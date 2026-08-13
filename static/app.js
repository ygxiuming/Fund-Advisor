const { createApp, nextTick, ref } = Vue;

const CHAT_STORAGE_KEY = "fund-advisor-chats";
const MAX_CONVERSATIONS = 50;

// Chart.js plugin: draw a center text inside doughnut charts
const centerTextPlugin = {
  id: "centerText",
  afterDraw(chart) {
    if (chart.config.type !== "doughnut") return;
    const meta = chart.getDatasetMeta(0);
    if (!meta.data || !meta.data.length) return;
    const { x, y } = meta.data[0];
    const ctx = chart.ctx;
    const opts = chart.options.plugins.centerText || {};
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = opts.color || "#0f172a";
    ctx.font = "700 20px sans-serif";
    ctx.fillText(opts.text || "", x, y - 9);
    ctx.fillStyle = opts.subColor || "#94a3b8";
    ctx.font = "500 11px sans-serif";
    ctx.fillText(opts.sub || "", x, y + 13);
    ctx.restore();
  },
};

createApp({
  data() {
    return {
      tabs: [
        { id: "portfolio", name: "持仓管理", group: "工作台", desc: "持仓 · 行情 · 收益" },
        { id: "insights", name: "洞察图表", group: "工作台", desc: "诊断 · 图表 · 推荐" },
        { id: "chat", name: "实时聊天", group: "工作台", desc: "AI 顾问 · 多 Agent" },
        { id: "agents", name: "Agent 管理", group: "配置管理", desc: "顾问角色与策略" },
        { id: "skills", name: "Skill 管理", group: "配置管理", desc: "技能模板" },
        { id: "model", name: "模型管理", group: "配置管理", desc: "LLM 配置" },
      ],
      activeTab: "portfolio",
      sidebarOpen: false,
      theme: "light",
      toast: { text: "", ok: true },
      holdings: [],
      quotes: {},
      agents: [],
      skills: [],
      models: [],
      insights: null,
      hotFunds: [],
      charts: {},
      conversations: [],
      currentConversationId: null,
      showChatConfig: false,
      chat: { mode: "single", model_id: "", agent_id: "", agent_ids: [], skill_ids: [], message: "", include_portfolio: true, include_quotes: true, include_skills: true, include_rule: true, thinking_enabled: false, reasoning_effort: "high" },
      holdingModal: { show: false, index: null },
      holdingDraft: { id: "", code: "", name: "", cost: 0, shares: 0, note: "" },
      draftQuote: null,
      searchQuery: "",
      sendingChat: false,
      showPassword: false,
      modelTestStatus: {},
      quickPhrases: [],
      showQuickPhraseModal: false,
      quickPhraseDraft: { text: "" },
      editingQuickPhraseId: null,
      settings: {},
      quotesLoading: false,
      savingPortfolio: false,
      insightsLoading: false,
      hotLoading: false,
      autoRefresh: true,
      autoRefreshSeconds: 300,
      lastUpdateText: "",
      insightsUpdateText: "",
      hotSource: "",
      chatHistoryOpen: false,
      refreshTimer: null,
      abortController: null,
      sortKey: "",
      sortDir: "asc",
      importModal: { show: false, items: [], mode: "append" },
    };
  },
  computed: {
    activeAgents() { return this.agents.filter((a) => a.active); },
    activeSkills() { return this.skills.filter((s) => s.active); },
    activeModels() { return this.models.filter((m) => m.active); },
    holdingsView() {
      const q = this.searchQuery.toLowerCase().trim();
      const rows = this.holdings
        .map((h) => {
          const quote = this.quotes[h.code] || null;
          const nav = Number(quote?.nav || 0);
          const marketValue = nav * Number(h.shares || 0);
          const pnl = marketValue - Number(h.cost || 0);
          const rate = Number(h.cost || 0) ? (pnl / Number(h.cost)) * 100 : 0;
          return { ...h, quote, nav: quote?.nav, percent: quote?.percent, marketValue, pnl, rate };
        });
      const totalValue = rows.reduce((s, h) => s + Number(h.marketValue || 0), 0);
      return rows
        .map((h) => ({ ...h, weight: totalValue ? (Number(h.marketValue || 0) / totalValue) * 100 : 0 }))
        .filter((h) => {
          if (!q) return true;
          const name = (h.name || h.quote?.name || "").toLowerCase();
          const code = (h.code || "").toLowerCase();
          return code.includes(q) || name.includes(q);
        });
    },
    summary() {
      const rows = this.holdings.map((h) => {
        const quote = this.quotes[h.code] || null;
        const nav = Number(quote?.nav || 0);
        const marketValue = nav * Number(h.shares || 0);
        const pnl = marketValue - Number(h.cost || 0);
        const rate = Number(h.cost || 0) ? (pnl / Number(h.cost)) * 100 : 0;
        return { ...h, quote, marketValue, pnl, rate };
      });
      const cost = rows.reduce((s, h) => s + Number(h.cost || 0), 0);
      const shares = rows.reduce((s, h) => s + Number(h.shares || 0), 0);
      const value = rows.reduce((s, h) => s + Number(h.marketValue || 0), 0);
      const pnl = value - cost;
      return { cost, shares, value, pnl, rate: cost ? (pnl / cost) * 100 : 0, count: rows.length };
    },
    sortedHoldingsView() {
      const list = this.holdingsView;
      if (!this.sortKey) return list;
      const dir = this.sortDir === "asc" ? 1 : -1;
      const key = this.sortKey;
      return [...list].sort((a, b) => {
        const va = a[key];
        const vb = b[key];
        if (typeof va === "string" || typeof vb === "string") {
          return String(va || "").localeCompare(String(vb || ""), "zh-Hans-CN") * dir;
        }
        return ((Number(va) || 0) - (Number(vb) || 0)) * dir;
      });
    },
    recommendationsEnriched() {
      const funds = this.insights?.funds || [];
      return (this.insights?.recommendations || []).map((r) => {
        const f = funds.find((x) => x.code === r.code);
        return { ...r, ...(f || {}), nav: f?.quote?.nav, percent: f?.quote?.percent };
      });
    },
    recSummaryGroups() {
      const groups = { 加仓: { cls: "add", count: 0 }, 买入: { cls: "buy", count: 0 }, 持有: { cls: "hold", count: 0 }, 减仓: { cls: "sell", count: 0 }, 卖出: { cls: "sell", count: 0 } };
      for (const r of this.recommendationsEnriched) {
        const key = r.action || "持有";
        if (groups[key]) groups[key].count += 1;
      }
      return Object.entries(groups).filter(([, g]) => g.count > 0).map(([label, g]) => ({ label, ...g }));
    },
    portfolioDiagnosis() {
      const insights = this.insights;
      if (!insights) return null;
      const funds = insights.funds || [];
      const snapshot = insights.snapshot || {};
      const items = snapshot.items || [];
      const totalValue = Number(snapshot.total_value) || 0;
      const totalCost = Number(snapshot.total_cost) || 0;
      if (!funds.length) return null;
      const rate = totalCost ? ((totalValue - totalCost) / totalCost) * 100 : 0;
      const maxDrawdown = Math.min(...funds.map((f) => Number(f.metrics?.max_drawdown) || 0), 0);
      const maxWeight = totalValue ? (Math.max(...items.map((i) => Number(i.market_value) || 0)) / totalValue) * 100 : 0;
      const avgMove = funds.reduce((s, f) => s + Math.abs(Number(f.quote?.percent) || 0), 0) / (funds.length || 1);
      const losingCount = funds.filter((f) => Number(f.pnl_rate) < 0).length;
      const losingPct = (losingCount / funds.length) * 100;
      let score = Math.min(Math.abs(maxDrawdown), 30) * 2 + maxWeight * 0.8 + losingPct * 0.5 - Math.max(rate, 0) * 0.8;
      score = Math.max(0, Math.min(100, score));
      const level = score >= 70 ? "高" : score >= 42 ? "中" : "低";
      return { rate, maxDrawdown, maxWeight, avgMove, losingCount, losingPct, score: Math.round(score), level, snapshotCount: (insights.history || []).length };
    },
    riskTip() {
      const d = this.portfolioDiagnosis;
      if (!d) return "";
      if (d.level === "高") return "组合回撤或集中度偏高，建议优先控制单一持仓占比、避免高位追涨。";
      if (d.level === "中") return "组合风险处于中等水平，建议定期再平衡并重点关注亏损持仓。";
      return "组合风险可控，可维持当前配置并跟踪趋势变化。";
    },
    contributionData() {
      const items = this.insights?.snapshot?.items || [];
      return items
        .map((i) => ({ label: i.name || i.code, value: Number(i.pnl) || 0 }))
        .sort((a, b) => b.value - a.value);
    },
    recommendations() { return this.insights?.recommendations || []; },
    tabGroups() {
      return [...new Set(this.tabs.map((t) => t.group))];
    },
    currentConversation() {
      return this.conversations.find((c) => c.id === this.currentConversationId) || null;
    },
    messages() {
      return this.currentConversation?.messages || [];
    },
    currentConversationTitle() {
      return this.currentConversation?.title || "新对话";
    },
    sortedConversations() {
      return [...this.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
    },
  },
  async mounted() {
    this.initTheme();
    this.loadConversations();
    // 支持深链：https://host/#insights 直接打开对应页面
    const hash = window.location.hash.replace("#", "");
    if (hash && this.tabs.some((t) => t.id === hash)) {
      this.activeTab = hash;
    }
    await this.loadAll();
    this.startAutoRefresh();
  },
  beforeUnmount() {
    this.stopAutoRefresh();
  },
  watch: {
    activeTab(value) {
      if (value === "insights") {
        nextTick(() => {
          if (!this.insights) this.loadInsights(false);
          if (!this.hotFunds.length) this.loadHotFunds(false);
        });
      }
      this.sidebarOpen = false;
    },
    conversations: {
      handler() { this.saveConversations(); },
      deep: true,
    },
    autoRefresh(value) {
      if (value) this.startAutoRefresh(); else this.stopAutoRefresh();
    },
    theme() {
      if (this.insights) nextTick(() => this.renderCharts());
    },
  },
  methods: {
    initTheme() {
      const saved = localStorage.getItem("fund-advisor-theme");
      const urlTheme = new URLSearchParams(window.location.search).get("theme");
      if (urlTheme === "dark" || urlTheme === "light") {
        this.theme = urlTheme;
      } else if (saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
        this.theme = "dark";
      }
      this.applyTheme();
    },
    toggleTheme() {
      this.theme = this.theme === "light" ? "dark" : "light";
      localStorage.setItem("fund-advisor-theme", this.theme);
      this.applyTheme();
    },
    applyTheme() {
      document.documentElement.setAttribute("data-theme", this.theme);
    },
    switchTab(id) {
      this.activeTab = id;
      this.sidebarOpen = false;
      this.animateContent();
    },
    animateContent() {
      nextTick(() => {
        const el = this.$refs.mainContent;
        if (!el) return;
        el.classList.remove("tab-fade");
        void el.offsetWidth;
        el.classList.add("tab-fade");
      });
    },
    toggleSort(key) {
      if (this.sortKey === key) {
        this.sortDir = this.sortDir === "asc" ? "desc" : "asc";
      } else {
        this.sortKey = key;
        this.sortDir = "asc";
      }
    },
    sortIndicator(key) {
      return this.sortKey === key ? (this.sortDir === "asc" ? "▲" : "▼") : "";
    },
    recScorePct(score) {
      const n = Number(score) || 0;
      return Math.max(4, Math.min(100, n));
    },
    recScoreLevel(score) {
      const n = Number(score) || 0;
      return n >= 60 ? "high" : n >= 45 ? "mid" : "low";
    },
    async copyText(text, okMsg = "已复制到剪贴板") {
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        this.showToast(okMsg);
      } catch {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        this.showToast(okMsg);
      }
    },
    copyActionList() {
      const lines = this.recommendationsEnriched.map((r) => `- 【${r.action}】${r.name || r.code}：${r.reason}`);
      if (!lines.length) { this.showToast("暂无推荐数据", false); return; }
      const text = `【当前调仓建议 ${this.nowText()}】\n${lines.join("\n")}`;
      this.copyText(text, "操作清单已复制");
    },
    sendActionListToAI() {
      const lines = this.recommendationsEnriched.map((r) => `- 【${r.action}】${r.name || r.code}：${r.reason}`);
      if (!lines.length) { this.showToast("暂无推荐数据", false); return; }
      this.chat.message = `请根据以下规则推荐结果，给出具体可执行方案（建议金额/份额、分批节奏、触发条件）：\n${lines.join("\n")}`;
      this.switchTab("chat");
      this.showToast("已填入聊天框，确认后发送");
    },
    quickAddHolding(fund) {
      this.openHolding();
      this.holdingDraft.code = fund.code;
      this.fetchDraftQuote();
      this.switchTab("portfolio");
      this.showToast("已预填基金代码，确认成本后保存");
    },
    exportPortfolioCSV() {
      if (!this.holdings.length) { this.showToast("暂无持仓可导出", false); return; }
      const headers = ["代码", "名称", "成本", "份额", "净值", "涨跌幅%", "市值", "占比%", "盈亏", "收益率%", "备注"];
      const rows = this.sortedHoldingsView.map((h) => [
        h.code, h.name || h.quote?.name || "", h.cost, h.shares,
        h.quote?.nav ?? "", h.quote?.percent ?? "", h.marketValue, h.weight, h.pnl, h.rate, h.note || "",
      ]);
      const csv = [headers, ...rows]
        .map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
        .join("\r\n");
      const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `持仓明细-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      this.showToast("持仓明细已导出（CSV）");
    },
    exportTemplate() {
      const tpl = [
        "# 基金持仓导入模板（CSV，UTF-8 编码）",
        "# 表头不可修改；以 # 开头的说明行会被忽略；示例行可删除",
        "# 代码必填（6 位数字）；名称可留空（导入后自动获取）；成本必填（元）；份额可留空（按当前净值自动计算）；备注可选",
        "代码,名称,成本,份额,备注",
        "000001,示例基金,10000,,",
      ].join("\r\n");
      const blob = new Blob(["\ufeff" + tpl], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "持仓导入模板.csv";
      a.click();
      URL.revokeObjectURL(a.href);
      this.showToast("导入模板已下载");
    },
    clearAllHoldings() {
      if (!this.holdings.length) { this.showToast("当前没有持仓", false); return; }
      if (!confirm(`确认清空全部 ${this.holdings.length} 条持仓？此操作不可撤销。`)) return;
      this.holdings = [];
      this.savePortfolio();
    },
    importCSV() {
      this.$refs.csvFileInput?.click();
    },
    async onImportFile(e) {
      const file = e.target.files && e.target.files[0];
      e.target.value = ""; // 允许重复选择同一文件
      if (!file) return;
      try {
        const text = await this.readFileSmart(file);
        const rows = this.parseCSV(text);
        const items = this.parseHoldingRows(rows);
        if (!items.length) {
          this.showToast("未解析到有效持仓（请确认表头为：代码,名称,成本,份额,备注）", false);
          return;
        }
        this.importModal = { show: true, items, mode: "append" };
      } catch (err) {
        this.showToast(err.message || "CSV 解析失败", false);
      }
    },
    async readFileSmart(file) {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      // UTF-8 BOM
      if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        return new TextDecoder("utf-8").decode(buf.subarray(3));
      }
      let text = new TextDecoder("utf-8").decode(buf);
      if (text.includes("\ufffd")) {
        // UTF-8 解码异常，尝试 GBK（Excel 常见编码）
        try { text = new TextDecoder("gbk").decode(buf); } catch {}
      }
      return text;
    },
    parseCSV(text) {
      const rows = [];
      let row = [], field = "", inQuotes = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
          if (c === '"') {
            if (text[i + 1] === '"') { field += '"'; i++; }
            else inQuotes = false;
          } else field += c;
        } else if (c === '"') {
          inQuotes = true;
        } else if (c === ",") {
          row.push(field); field = "";
        } else if (c === "\n" || c === "\r") {
          if (c === "\r" && text[i + 1] === "\n") i++;
          row.push(field); field = "";
          if (row.some((f) => f.trim() !== "")) rows.push(row);
          row = [];
        } else {
          field += c;
        }
      }
      if (field !== "" || row.length) {
        row.push(field);
        if (row.some((f) => f.trim() !== "")) rows.push(row);
      }
      return rows;
    },
    parseHoldingRows(rows) {
      const cleaned = rows.filter((r) => !String(r[0] || "").trim().startsWith("#"));
      const headerIdx = cleaned.findIndex((r) => r.some((c) => String(c).trim() === "代码"));
      if (headerIdx === -1) throw new Error("未找到表头行（应包含：代码,名称,成本,份额,备注）");
      const header = cleaned[headerIdx].map((h) => String(h).trim());
      const col = {
        code: header.indexOf("代码"),
        name: header.indexOf("名称"),
        cost: header.indexOf("成本"),
        shares: header.indexOf("份额"),
        note: header.indexOf("备注"),
      };
      if (col.code === -1 || col.cost === -1) throw new Error("表头缺少必填列：代码、成本");
      const items = [];
      for (const r of cleaned.slice(headerIdx + 1)) {
        const code = String(r[col.code] ?? "").trim();
        if (!/^\d{6}$/.test(code)) continue; // 跳过无效代码行
        const costRaw = String(r[col.cost] ?? "").trim().replace(/[,\s元￥¥]/g, "");
        const cost = Number(costRaw);
        if (!Number.isFinite(cost) || cost <= 0) continue;
        const sharesRaw = String(r[col.shares] ?? "").trim().replace(/[,\s]/g, "");
        const shares = sharesRaw ? Number(sharesRaw) : 0;
        items.push({
          id: this.uid(),
          code,
          name: String(r[col.name] ?? "").trim(),
          cost,
          shares: Number.isFinite(shares) && shares > 0 ? shares : 0,
          note: String(r[col.note] ?? "").trim(),
        });
      }
      return items;
    },
    async confirmImport() {
      const items = this.importModal.items || [];
      if (!items.length) return;
      if (this.importModal.mode === "replace") this.holdings = [];
      this.holdings.push(...items);
      this.importModal.show = false;
      this.showToast(`正在保存 ${items.length} 条持仓并获取行情...`);
      await this.savePortfolio();
      await this.refreshQuotes(null, false);
      this.showToast(`已导入 ${items.length} 条持仓，份额已按最新净值重算`);
    },
    exportChart(id, name) {
      const chart = this.charts[id];
      if (!chart) { this.showToast("暂无图表数据，请先刷新洞察", false); return; }
      const a = document.createElement("a");
      a.href = chart.toBase64Image("image/png", 2);
      a.download = `${name}-${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
      this.showToast("图表已导出（PNG）");
    },
    recActionClass(action) {
      if (!action) return "hold";
      const a = action.charAt(0);
      if (a === "买" || a === "加") return "buy";
      if (a === "卖" || a === "减") return "sell";
      return "hold";
    },
    renderMarkdown(text) {
      if (!text) return "";
      let html = "";
      try {
        html = window.marked.parse(text, { gfm: true, breaks: false });
      } catch { return text; }
      if (window.DOMPurify) html = window.DOMPurify.sanitize(html);
      return html;
    },
    async api(path, options = {}) {
      const res = await fetch(path, {
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        ...options,
      });
      const text = await res.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; }
      catch { throw new Error(`服务器响应异常（HTTP ${res.status}）`); }
      if (!res.ok || data.success === false) {
        throw new Error(data.message || `请求失败（HTTP ${res.status}）`);
      }
      return data.data;
    },
    showToast(text, ok = true) {
      this.toast = { text, ok };
      window.clearTimeout(this.toastTimer);
      this.toastTimer = window.setTimeout(() => (this.toast.text = ""), 3000);
    },
    uid() { return crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()); },
    number(value, digits = 2) {
      const n = Number(value);
      return Number.isFinite(n) ? n.toFixed(digits) : "-";
    },
    money(value) {
      const n = Number(value || 0);
      return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },
    moneyShort(value) {
      const n = Number(value || 0);
      const abs = Math.abs(n);
      if (abs >= 1e8) return `${this.number(n / 1e8, 2)}亿`;
      if (abs >= 1e4) return `${this.number(n / 1e4, 2)}万`;
      return this.money(n);
    },
    pct(value) {
      if (value === undefined || value === null || value === "" || Number.isNaN(Number(value))) return "-";
      return `${this.number(value, 2)}%`;
    },
    valueOrDash(value, suffix = "") {
      if (value === undefined || value === null || value === "" || value === "-") return "-";
      return `${this.number(value, 2)}${suffix}`;
    },
    gainClass(value) { return Number(value || 0) >= 0 ? "text-rise" : "text-fall"; },
    now() {
      const d = new Date();
      return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
    },
    nowText() {
      const d = new Date();
      const p = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    },
    extractTitle(text) {
      const first = (text || "").trim();
      return first.length > 24 ? first.substring(0, 24) + "..." : first || "新对话";
    },

    // ---- Conversation Management ----
    loadConversations() {
      try {
        const raw = localStorage.getItem(CHAT_STORAGE_KEY);
        this.conversations = raw ? JSON.parse(raw) : [];
        if (this.conversations.length > 0) {
          const lastId = localStorage.getItem("fund-advisor-current-chat");
          this.currentConversationId = (lastId && this.conversations.find(c => c.id === lastId))
            ? lastId
            : this.conversations[0].id;
        } else {
          this.newConversation();
        }
      } catch {
        this.conversations = [];
        this.newConversation();
      }
    },
    saveConversations() {
      try {
        localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(this.conversations.slice(0, MAX_CONVERSATIONS)));
        if (this.currentConversationId) {
          localStorage.setItem("fund-advisor-current-chat", this.currentConversationId);
        }
      } catch {}
    },
    newConversation() {
      const conv = {
        id: this.uid(),
        title: "新对话",
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.conversations.unshift(conv);
      this.currentConversationId = conv.id;
      this.chatHistoryOpen = false;
      if (this.conversations.length > MAX_CONVERSATIONS) {
        this.conversations = this.conversations.slice(0, MAX_CONVERSATIONS);
      }
    },
    switchConversation(id) {
      if (id === this.currentConversationId) return;
      this.currentConversationId = id;
      this.chatHistoryOpen = false;
      this.saveConversations();
      this.scrollChatToBottom();
    },
    deleteConversation(id) {
      if (this.conversations.length <= 1) {
        this.conversations[0].messages = [];
        this.conversations[0].title = "新对话";
        this.conversations[0].updatedAt = Date.now();
        return;
      }
      const idx = this.conversations.findIndex((c) => c.id === id);
      if (idx === -1) return;
      this.conversations.splice(idx, 1);
      if (this.currentConversationId === id) {
        this.currentConversationId = this.conversations[0]?.id || null;
        if (!this.currentConversationId) this.newConversation();
      }
    },

    async loadAll() {
      try {
        const data = await this.api("/api/bootstrap");
        this.holdings = data.portfolio.holdings || [];
        this.agents = data.agents.agents || [];
        this.skills = data.skills.skills || [];
        this.models = data.models || [];
        this.settings = data.settings || {};
        this.quickPhrases = data.quick_phrases || [];
        this.chat.model_id = this.activeModels[0]?.id || "";
        this.chat.agent_id = this.activeAgents[0]?.id || "";
        await this.refreshQuotes(null, false);
        this.startAutoRefresh();
      } catch (err) {
        this.showToast(err.message, false);
      }
    },
    async refreshAll() {
      this.showToast("正在刷新所有数据...");
      try {
        await this.refreshQuotes(null, false);
        if (this.insights) await this.loadInsights(false);
        if (this.hotFunds.length) await this.loadHotFunds(false);
        this.showToast("所有数据已刷新");
      } catch (err) {
        this.showToast(err.message, false);
      }
    },
    recalcShares(codes = null) {
      const set = codes ? new Set(codes) : null;
      this.holdings = this.holdings.map((h) => {
        if (set && !set.has(h.code)) return h;
        const nav = Number(this.quotes[h.code]?.nav || 0);
        const cost = Number(h.cost || 0);
        const name = h.name || this.quotes[h.code]?.name || "";
        return nav > 0 && cost > 0 ? { ...h, name, shares: Number((cost / nav).toFixed(2)) } : { ...h, name };
      });
    },
    startAutoRefresh() {
      this.stopAutoRefresh();
      const seconds = Number(this.settings?.refresh_interval_seconds) || 300;
      this.autoRefreshSeconds = seconds;
      this.refreshTimer = window.setInterval(() => {
        if (document.hidden || !this.autoRefresh) return;
        if (this.quotesLoading || this.savingPortfolio) return;
        if (this.activeTab === "portfolio" || this.activeTab === "chat") {
          this.refreshQuotes(null, false);
        }
        if (this.activeTab === "insights" && this.insights) {
          this.loadInsights(false);
        }
      }, seconds * 1000);
    },
    stopAutoRefresh() {
      if (this.refreshTimer) {
        window.clearInterval(this.refreshTimer);
        this.refreshTimer = null;
      }
    },
    async refreshQuotes(codes = null, notify = true) {
      const list = codes || this.holdings.map((h) => h.code).filter(Boolean);
      if (!list.length) return;
      this.quotesLoading = true;
      try {
        const data = await this.api(`/api/funds/realtime?codes=${encodeURIComponent(list.join(","))}`);
        this.quotes = { ...this.quotes, ...data };
        this.recalcShares(list);
        this.lastUpdateText = this.nowText();
        if (notify) this.showToast("行情已刷新，份额已按当前净值自动重算");
      } catch (err) {
        this.showToast(err.message, false);
      } finally {
        this.quotesLoading = false;
      }
    },
    openHolding(index = null) {
      this.holdingModal = { show: true, index };
      const item = index === null ? { id: this.uid(), code: "", name: "", cost: 0, shares: 0, note: "" } : { ...this.holdings[index] };
      this.holdingDraft = item;
      this.draftQuote = item.code ? this.quotes[item.code] || null : null;
      if (item.code && !this.draftQuote) this.fetchDraftQuote();
    },
    closeHolding() { this.holdingModal.show = false; this.draftQuote = null; },
    async fetchDraftQuote() {
      const code = String(this.holdingDraft.code || "").trim();
      if (!code) return;
      try {
        const data = await this.api(`/api/funds/realtime?codes=${encodeURIComponent(code)}`);
        this.quotes = { ...this.quotes, ...data };
        this.draftQuote = data[code];
        if (this.draftQuote) {
          const realName = this.draftQuote.source !== "mock" ? this.draftQuote.name : "";
          const cur = String(this.holdingDraft.name || "");
          if (realName && (!cur || cur.startsWith("演示基金"))) {
            this.holdingDraft.name = realName;
          }
          if (this.draftQuote.source === "mock") {
            this.showToast("行情接口不可用，当前为演示数据，请手动填写基金名称", false);
          }
        }
        this.calcDraftShares();
      } catch (err) { this.showToast(err.message, false); }
    },
    calcDraftShares() {
      const nav = Number(this.draftQuote?.nav || this.quotes[this.holdingDraft.code]?.nav || 0);
      const cost = Number(this.holdingDraft.cost || 0);
      this.holdingDraft.shares = nav > 0 && cost > 0 ? Number((cost / nav).toFixed(2)) : 0;
    },
    async saveHoldingModal() {
      await this.fetchDraftQuote();
      const row = { ...this.holdingDraft, code: String(this.holdingDraft.code).trim() };
      if (this.holdingModal.index === null) this.holdings.push(row);
      else this.holdings.splice(this.holdingModal.index, 1, row);
      this.closeHolding();
      await this.savePortfolio();
    },
    async savePortfolio() {
      this.savingPortfolio = true;
      try {
        this.recalcShares();
        const data = await this.api("/api/portfolio", { method: "PUT", body: JSON.stringify(this.holdings) });
        this.holdings = data.holdings || [];
        this.showToast("持仓已保存");
      } catch (err) { this.showToast(err.message, false); }
      finally { this.savingPortfolio = false; }
    },
    async deleteHolding(index) {
      if (!confirm("确认删除该持仓？")) return;
      this.holdings.splice(index, 1);
      await this.savePortfolio();
    },
    setChart(id, config) {
      if (!window.Chart || !document.getElementById(id)) return;
      if (this.charts[id]) this.charts[id].destroy();
      const isDark = this.theme === "dark";
      const gridColor = isDark ? "rgba(148,163,184,.15)" : "rgba(148,163,184,.2)";
      const textColor = isDark ? "#94a3b8" : "#64748b";
      config.options = config.options || {};
      config.options.plugins = config.options.plugins || {};
      if (!config.options.plugins.legend) config.options.plugins.legend = { position: "bottom", labels: { color: textColor, padding: 16, usePointStyle: true, pointStyle: "circle" } };
      if (!config.options.plugins.tooltip) config.options.plugins.tooltip = { mode: "index", intersect: false };
      if (config.options.scales) {
        for (const axis of Object.values(config.options.scales)) {
          axis.grid = axis.grid || {};
          axis.grid.color = gridColor;
          axis.ticks = axis.ticks || {};
          axis.ticks.color = textColor;
        }
      }
      this.charts[id] = new Chart(document.getElementById(id), config);
    },
    async loadInsights(notify = true) {
      this.insightsLoading = true;
      try {
        this.insights = await this.api("/api/insights");
        this.insightsUpdateText = this.nowText();
        await nextTick();
        this.renderCharts();
        if (notify) this.showToast("洞察已刷新");
      } catch (err) { this.showToast(err.message, false); }
      finally { this.insightsLoading = false; }
    },
    async loadHotFunds(notify = true) {
      this.hotLoading = true;
      try {
        const data = await this.api("/api/fund-market/hot");
        this.hotFunds = data.hot || [];
        this.hotSource = data.source || "";
        if (notify) this.showToast("天天基金热点已刷新");
      } catch (err) { this.showToast(err.message, false); }
      finally { this.hotLoading = false; }
    },
    renderCharts() {
      const data = this.insights;
      if (!data) return;
      const isDark = this.theme === "dark";
      const history = data.history || [];
      this.setChart("pnlChart", {
        type: "line",
        data: {
          labels: history.map((x) => x.time),
          datasets: [
            {
              label: "当前市值",
              data: history.map((x) => x.total_value),
              borderColor: "#3b82f6",
              backgroundColor: (ctx) => {
                const { chart } = ctx;
                const { ctx: c, chartArea } = chart;
                if (!chartArea) return "rgba(59,130,246,.08)";
                const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                g.addColorStop(0, "rgba(59,130,246,.30)");
                g.addColorStop(1, "rgba(59,130,246,.02)");
                return g;
              },
              tension: 0.35,
              fill: true,
              pointRadius: 0,
              borderWidth: 2,
            },
            {
              label: "浮动盈亏",
              data: history.map((x) => x.total_pnl),
              borderColor: "#f43f5e",
              backgroundColor: "rgba(244,63,94,.06)",
              tension: 0.35,
              pointRadius: 0,
              borderWidth: 2,
              borderDash: [5, 4],
            },
          ],
        },
        options: {
          responsive: true,
          scales: {
            x: { ticks: { maxTicksLimit: 6 } },
            y: { beginAtZero: false, ticks: { callback: (v) => this.moneyShort(v) } },
          },
        },
      });
      const items = data.snapshot?.items || [];
      const totalValue = Number(data.snapshot?.total_value || 0);
      const palette = ["#3b82f6", "#f43f5e", "#f59e0b", "#8b5cf6", "#06b6d4", "#22c55e", "#ec4899", "#84cc16"];
      this.setChart("allocationChart", {
        type: "doughnut",
        data: {
          labels: items.map((x) => x.name || x.code),
          datasets: [{
            data: items.map((x) => x.market_value),
            backgroundColor: items.map((_, i) => palette[i % palette.length]),
            borderWidth: 2,
            borderColor: isDark ? "#1e293b" : "#ffffff",
            hoverOffset: 8,
          }],
        },
        options: {
          responsive: true,
          cutout: "66%",
          plugins: {
            centerText: { text: this.moneyShort(totalValue), sub: "总市值", color: isDark ? "#f1f5f9" : "#0f172a", subColor: isDark ? "#94a3b8" : "#64748b" },
          },
        },
        plugins: [centerTextPlugin],
      });
      this.setChart("contributionChart", {
        type: "bar",
        data: {
          labels: this.contributionData.map((x) => x.label),
          datasets: [{
            label: "盈亏贡献（元）",
            data: this.contributionData.map((x) => x.value),
            backgroundColor: this.contributionData.map((x) => (x.value >= 0 ? "rgba(220,38,38,.72)" : "rgba(5,150,105,.72)")),
            borderRadius: 6,
            barPercentage: 0.6,
          }],
        },
        options: {
          responsive: true,
          indexAxis: "y",
          scales: {
            x: { ticks: { callback: (v) => this.moneyShort(v) } },
            y: { grid: { display: false }, ticks: { autoSkip: false, font: { size: 11 } } },
          },
        },
      });
      const labels = (data.funds?.[0]?.history || []).map((x) => x.date);
      this.setChart("fundTrendChart", {
        type: "line",
        data: {
          labels,
          datasets: (data.funds || []).map((f, i) => ({ label: f.quote?.name || f.name || f.code, data: (f.history || []).map((x) => x.nav), borderColor: palette[i % palette.length], tension: 0.32, pointRadius: 0, borderWidth: 2 })),
        },
        options: { responsive: true, scales: { x: { ticks: { maxTicksLimit: 10 } } } },
      });
    },
    scrollChatToBottom() {
      nextTick(() => {
        const el = this.$refs.chatLog;
        if (el) el.scrollTop = el.scrollHeight;
      });
    },
    async sendChat() {
      const text = this.chat.message.trim();
      if (!text || this.sendingChat) return;
      if (this.chat.mode === "collab" && this.chat.agent_ids.length < 2) {
        this.showToast("协作模式请至少选择 2 个 Agent", false);
        return;
      }

      if (!this.currentConversation) this.newConversation();

      this.currentConversation.messages.push({ id: this.uid(), role: "user", text, time: this.now() });
      if (this.currentConversation.messages.filter(m => m.role === "user").length === 1) {
        this.currentConversation.title = this.extractTitle(text);
      }
      this.currentConversation.updatedAt = Date.now();
      this.chat.message = "";
      this.scrollChatToBottom();
      this.sendingChat = true;

      const replyId = this.uid();
      this.currentConversation.messages.push({ id: replyId, role: "assistant", text: "", thinkingText: "", drafts: [], _thinkingOpen: true, _draftsOpen: true, time: this.now() });

      const controller = new AbortController();
      this.abortController = controller;

      const buildBody = () => JSON.stringify({
        message: text,
        model_id: this.chat.model_id,
        mode: this.chat.mode,
        agent_id: this.chat.agent_id,
        agent_ids: this.chat.agent_ids,
        skill_ids: this.chat.skill_ids,
        include_portfolio: this.chat.include_portfolio,
        include_quotes: this.chat.include_quotes,
        include_skills: this.chat.include_skills,
        include_rule: this.chat.include_rule,
        thinking_enabled: this.chat.thinking_enabled,
        reasoning_effort: this.chat.reasoning_effort,
      });

      try {
        const resp = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: buildBody(),
          signal: controller.signal,
        });

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullText = "";
        let fullThinking = "";
        let streamError = "";

        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            const payload = trimmed.slice(6);
            if (payload === "[DONE]") continue;
            try {
              const chunk = JSON.parse(payload);
              if (chunk.error) {
                streamError = chunk.error;
                const msg = this.currentConversation.messages;
                const last = msg[msg.length - 1];
                if (last && last.id === replyId) {
                  last.role = "error";
                  last.text = chunk.error;
                }
                break outer;
              }
              const msg = this.currentConversation.messages;
              const last = msg[msg.length - 1];
              if (chunk.drafts && Array.isArray(chunk.drafts) && last && last.id === replyId) {
                last.drafts = chunk.drafts;
                this.scrollChatToBottom();
              }
              if (chunk.thinking && last && last.id === replyId) {
                fullThinking += chunk.thinking;
                last.thinkingText = fullThinking;
                this.scrollChatToBottom();
              }
              if (chunk.token && last && last.id === replyId) {
                fullText += chunk.token;
                last.text = fullText;
                this.scrollChatToBottom();
              }
            } catch {}
          }
        }

        if (streamError) {
          this.showToast(streamError, false);
          this.scrollChatToBottom();
        } else if (!fullText) {
          const msg = this.currentConversation.messages;
          const last = msg[msg.length - 1];
          if (last && last.id === replyId && !last.text) {
            if (last.thinkingText) {
              last.text = "（模型思考后未输出正文：可能是输出额度不足。后端已对 V4 系列自动提升额度，请直接重试；仍失败可到「Agent 管理」调大该 Agent 的 Max Tokens）";
            } else if (last.drafts && last.drafts.length) {
              last.text = "（汇总生成失败，可展开上方查看各 Agent 草稿）";
            } else {
              last.text = "未收到回复。";
            }
          }
        }
      } catch (err) {
        if (err.name === "AbortError") {
          this.showToast("已停止生成，保留当前已生成内容");
        } else {
          const errMsg = err.message || "未知错误";
          const msg = this.currentConversation.messages;
          const last = msg[msg.length - 1];
          if (last && last.id === replyId) {
            last.role = "error";
            last.text = errMsg;
          }
          this.showToast(errMsg, false);

          if (errMsg.includes("Failed to fetch") || errMsg.includes("NetworkError") || errMsg.includes("网络")) {
            try {
              const data = await this.api("/api/chat", {
                method: "POST",
                body: buildBody(),
              });
              const msg = this.currentConversation.messages;
              const last = msg[msg.length - 1];
              if (last && last.id === replyId) {
                last.role = "assistant";
                last.text = data.reply;
                last.drafts = data.drafts || [];
              }
            } catch (fallbackErr) {
              const msg2 = this.currentConversation.messages;
              const last2 = msg2[msg2.length - 1];
              if (last2 && last2.id === replyId) {
                last2.role = "error";
                last2.text = fallbackErr.message;
              }
            }
          }
        }
      }
      this.currentConversation.updatedAt = Date.now();
      this.sendingChat = false;
      this.abortController = null;
      this.scrollChatToBottom();
    },
    stopChat() {
      if (this.abortController) this.abortController.abort();
    },
    exportChat() {
      if (!this.messages.length) { this.showToast("暂无聊天记录", false); return; }
      const lines = this.messages.map((m) => `[${m.time}] ${m.role === "user" ? "我" : "AI"}: ${m.text}`);
      const blob = new Blob([lines.join("\n\n")], { type: "text/plain;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `chat-${new Date().toISOString().slice(0, 10)}.txt`;
      a.click();
      URL.revokeObjectURL(a.href);
      this.showToast("聊天记录已导出");
    },
    useQuickPhrase(phrase) {
      this.chat.message = phrase.text;
      this.sendChat();
    },
    openAddQuickPhrase() {
      this.editingQuickPhraseId = null;
      this.quickPhraseDraft = { text: "" };
      this.showQuickPhraseModal = true;
    },
    openEditQuickPhrase(phrase) {
      this.editingQuickPhraseId = phrase.id;
      this.quickPhraseDraft = { text: phrase.text };
      this.showQuickPhraseModal = true;
    },
    async saveQuickPhrase() {
      const text = this.quickPhraseDraft.text.trim();
      if (!text) { this.showToast("请输入短语内容", false); return; }
      try {
        if (this.editingQuickPhraseId) {
          const idx = this.quickPhrases.findIndex(p => p.id === this.editingQuickPhraseId);
          if (idx !== -1) this.quickPhrases[idx].text = text;
          await this.api("/api/quick-phrases", { method: "PUT", body: JSON.stringify({ phrases: this.quickPhrases }) });
        } else {
          const data = await this.api("/api/quick-phrases", { method: "POST", body: JSON.stringify({ text, active: true }) });
          if (data.phrase) this.quickPhrases.push(data.phrase);
        }
        this.showQuickPhraseModal = false;
        this.showToast(this.editingQuickPhraseId ? "快捷短语已更新" : "快捷短语已添加");
      } catch (err) { this.showToast(err.message, false); }
    },
    async deleteQuickPhrase(phrase) {
      try {
        const data = await this.api(`/api/quick-phrases/${phrase.id}`, { method: "DELETE" });
        this.quickPhrases = data.phrases || [];
        this.showToast("快捷短语已删除");
      } catch (err) { this.showToast(err.message, false); }
    },
    addAgent() {
      this.agents.push({ id: this.uid(), name: "新 Agent", description: "", system_prompt: "你是基金投资顾问。必须给出明确买卖建议。", temperature: 0.3, max_tokens: 4000, active: true });
    },
    async saveAgents() {
      try {
        const data = await this.api("/api/agents", { method: "PUT", body: JSON.stringify(this.agents) });
        this.agents = data.agents || [];
        if (!this.chat.agent_id) this.chat.agent_id = this.activeAgents[0]?.id || "";
        this.showToast("Agent 已保存");
      } catch (err) { this.showToast(err.message, false); }
    },
    deleteAgent(index) { if (confirm("确认删除该 Agent？")) this.agents.splice(index, 1); },
    addSkill() {
      this.skills.push({ id: this.uid(), name: "新 Skill", description: "", keywords: [], instruction: "", active: true });
    },
    async saveSkills() {
      try {
        const data = await this.api("/api/skills", { method: "PUT", body: JSON.stringify(this.skills) });
        this.skills = data.skills || [];
        this.showToast("Skill 已保存");
      } catch (err) { this.showToast(err.message, false); }
    },
    deleteSkill(index) { if (confirm("确认删除该 Skill？")) this.skills.splice(index, 1); },
    addModel() {
      this.models.push({ id: this.uid(), name: "新模型", base_url: "", api_key: "", model: "", active: true });
    },
    async saveModels() {
      try {
        const data = await this.api("/api/models", { method: "PUT", body: JSON.stringify(this.models) });
        this.models = data.models || [];
        if (!this.chat.model_id || !this.activeModels.find((m) => m.id === this.chat.model_id)) {
          this.chat.model_id = this.activeModels[0]?.id || "";
        }
        this.modelTestStatus = {};
        this.showToast("模型配置已保存");
      } catch (err) { this.showToast(err.message, false); }
    },
    deleteModel(index) { if (confirm("确认删除该模型？")) this.models.splice(index, 1); },
    async testModelById(modelId) {
      try {
        const data = await this.api("/api/models/test", { method: "POST", body: JSON.stringify({ model_id: modelId }) });
        this.modelTestStatus = { ...this.modelTestStatus, [modelId]: "ok" };
        this.showToast(`连接成功：${data.reply || ""}`);
      } catch (err) {
        this.modelTestStatus = { ...this.modelTestStatus, [modelId]: "fail" };
        this.showToast(err.message, false);
      }
    },
  },
}).mount("#app");