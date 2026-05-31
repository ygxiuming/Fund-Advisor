const { createApp, nextTick, ref } = Vue;

createApp({
  data() {
    return {
      tabs: [
        { id: "portfolio", name: "持仓管理" },
        { id: "insights", name: "洞察图表" },
        { id: "chat", name: "实时聊天" },
        { id: "agents", name: "Agent 管理" },
        { id: "skills", name: "Skill 管理" },
        { id: "model", name: "模型管理" },
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
      messages: [],
      chat: { mode: "single", model_id: "", agent_id: "", agent_ids: [], skill_ids: [], message: "", include_portfolio: true, include_quotes: true, include_skills: true, include_rule: true },
      holdingModal: { show: false, index: null },
      holdingDraft: { id: "", code: "", name: "", cost: 0, shares: 0, note: "" },
      draftQuote: null,
      searchQuery: "",
      sendingChat: false,
      showPassword: false,
      modelTestStatus: {},
    };
  },
  computed: {
    activeAgents() { return this.agents.filter((a) => a.active); },
    activeSkills() { return this.skills.filter((s) => s.active); },
    activeModels() { return this.models.filter((m) => m.active); },
    holdingsView() {
      const q = this.searchQuery.toLowerCase().trim();
      return this.holdings
        .map((h) => {
          const quote = this.quotes[h.code] || null;
          const nav = Number(quote?.nav || 0);
          const marketValue = nav * Number(h.shares || 0);
          const pnl = marketValue - Number(h.cost || 0);
          const rate = Number(h.cost || 0) ? (pnl / Number(h.cost)) * 100 : 0;
          return { ...h, quote, marketValue, pnl, rate };
        })
        .filter((h) => {
          if (!q) return true;
          const name = (h.name || h.quote?.name || "").toLowerCase();
          const code = (h.code || "").toLowerCase();
          return code.includes(q) || name.includes(q);
        });
    },
    summary() {
      const cost = this.holdings.reduce((s, h) => s + Number(h.cost || 0), 0);
      const value = this.holdingsView.reduce((s, h) => s + Number(h.marketValue || 0), 0);
      const pnl = value - cost;
      return { cost, value, pnl, rate: cost ? (pnl / cost) * 100 : 0 };
    },
    recommendations() { return this.insights?.recommendations || []; },
  },
  async mounted() {
    this.initTheme();
    await this.loadAll();
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
  },
  methods: {
    initTheme() {
      const saved = localStorage.getItem("fund-advisor-theme");
      if (saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
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
      try { return window.marked.parse(text, { breaks: true }); }
      catch { return text; }
    },
    async api(path, options = {}) {
      const res = await fetch(path, {
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        ...options,
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || "请求失败");
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
    async loadAll() {
      try {
        const data = await this.api("/api/bootstrap");
        this.holdings = data.portfolio.holdings || [];
        this.agents = data.agents.agents || [];
        this.skills = data.skills.skills || [];
        this.models = data.models || [];
        this.chat.model_id = this.activeModels[0]?.id || "";
        this.chat.agent_id = this.activeAgents[0]?.id || "";
        await this.refreshQuotes(null, false);
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
    async refreshQuotes(codes = null, notify = true) {
      const list = codes || this.holdings.map((h) => h.code).filter(Boolean);
      if (!list.length) return;
      try {
        const data = await this.api(`/api/funds/realtime?codes=${encodeURIComponent(list.join(","))}`);
        this.quotes = { ...this.quotes, ...data };
        this.recalcShares(list);
        if (notify) this.showToast("行情已刷新，份额已按当前净值自动重算");
      } catch (err) {
        this.showToast(err.message, false);
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
        if (this.draftQuote?.name && !this.holdingDraft.name) this.holdingDraft.name = this.draftQuote.name;
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
      try {
        this.recalcShares();
        const data = await this.api("/api/portfolio", { method: "PUT", body: JSON.stringify(this.holdings) });
        this.holdings = data.holdings || [];
        this.showToast("持仓已保存");
      } catch (err) { this.showToast(err.message, false); }
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
      try {
        this.insights = await this.api("/api/insights");
        await nextTick();
        this.renderCharts();
        if (notify) this.showToast("洞察已刷新");
      } catch (err) { this.showToast(err.message, false); }
    },
    async loadHotFunds(notify = true) {
      try {
        const data = await this.api("/api/fund-market/hot");
        this.hotFunds = data.hot || [];
        if (notify) this.showToast("天天基金热点已刷新");
      } catch (err) { this.showToast(err.message, false); }
    },
    renderCharts() {
      const data = this.insights;
      if (!data) return;
      const history = data.history || [];
      this.setChart("pnlChart", {
        type: "line",
        data: {
          labels: history.map((x) => x.time),
          datasets: [
            { label: "当前市值", data: history.map((x) => x.total_value), borderColor: "#3b82f6", backgroundColor: "rgba(59,130,246,.08)", tension: 0.35, fill: true, pointRadius: 0, borderWidth: 2 },
            { label: "浮动盈亏", data: history.map((x) => x.total_pnl), borderColor: "#f43f5e", backgroundColor: "rgba(244,63,94,.06)", tension: 0.35, pointRadius: 0, borderWidth: 2 },
          ],
        },
        options: { responsive: true, scales: { x: { ticks: { maxTicksLimit: 6 } }, y: { beginAtZero: false } } },
      });
      const items = data.snapshot?.items || [];
      this.setChart("allocationChart", {
        type: "doughnut",
        data: { labels: items.map((x) => x.name || x.code), datasets: [{ data: items.map((x) => x.market_value), backgroundColor: ["#3b82f6", "#f43f5e", "#f59e0b", "#8b5cf6", "#06b6d4", "#22c55e"], borderWidth: 0, hoverOffset: 8 }] },
        options: { responsive: true, cutout: "65%" },
      });
      const colors = ["#3b82f6", "#f43f5e", "#f59e0b", "#8b5cf6", "#06b6d4", "#22c55e"];
      const labels = (data.funds?.[0]?.history || []).map((x) => x.date);
      this.setChart("fundTrendChart", {
        type: "line",
        data: {
          labels,
          datasets: (data.funds || []).map((f, i) => ({ label: f.quote?.name || f.name || f.code, data: (f.history || []).map((x) => x.nav), borderColor: colors[i % colors.length], tension: 0.32, pointRadius: 0, borderWidth: 2 })),
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
      this.messages.push({ id: this.uid(), role: "user", text, time: this.now() });
      this.chat.message = "";
      this.scrollChatToBottom();
      this.sendingChat = true;
      const pendingId = this.uid();
      try {
        const data = await this.api("/api/chat", { method: "POST", body: JSON.stringify({ message: text, model_id: this.chat.model_id, mode: this.chat.mode, agent_id: this.chat.agent_id, agent_ids: this.chat.agent_ids, skill_ids: this.chat.skill_ids, include_portfolio: this.chat.include_portfolio, include_quotes: this.chat.include_quotes, include_skills: this.chat.include_skills, include_rule: this.chat.include_rule }) });
        this.messages.push({ id: pendingId, role: "assistant", text: data.reply, time: this.now() });
      } catch (err) {
        this.messages.push({ id: pendingId, role: "assistant", text: `错误：${err.message}`, time: this.now() });
      }
      this.sendingChat = false;
      this.scrollChatToBottom();
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
    addAgent() {
      this.agents.push({ id: this.uid(), name: "新 Agent", description: "", system_prompt: "你是基金投资顾问。必须给出明确买卖建议。", temperature: 0.3, max_tokens: 1500, active: true });
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
