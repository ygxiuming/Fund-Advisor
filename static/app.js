const { createApp, nextTick } = Vue;

createApp({
  data() {
    return {
      tabs: [
        { id: "portfolio", name: "持仓管理" },
        { id: "insights", name: "洞察图表" },
        { id: "chat", name: "实时聊天顾问" },
        { id: "agents", name: "Agent 管理" },
        { id: "skills", name: "Skill 管理" },
        { id: "model", name: "模型设置" },
      ],
      activeTab: "portfolio",
      toast: { text: "", ok: true },
      holdings: [],
      quotes: {},
      agents: [],
      skills: [],
      model: {},
      insights: null,
      hotFunds: [],
      charts: {},
      messages: [],
      chat: { mode: "single", agent_id: "", agent_ids: [], skill_ids: [], message: "" },
      holdingModal: { show: false, index: null },
      holdingDraft: { id: "", code: "", name: "", cost: 0, shares: 0, note: "" },
      draftQuote: null,
    };
  },
  computed: {
    activeAgents() {
      return this.agents.filter((a) => a.active);
    },
    activeSkills() {
      return this.skills.filter((s) => s.active);
    },
    holdingsView() {
      return this.holdings.map((h) => {
        const quote = this.quotes[h.code] || null;
        const nav = Number(quote?.nav || 0);
        const marketValue = nav * Number(h.shares || 0);
        const pnl = marketValue - Number(h.cost || 0);
        const rate = Number(h.cost || 0) ? (pnl / Number(h.cost)) * 100 : 0;
        return { ...h, quote, marketValue, pnl, rate };
      });
    },
    summary() {
      const cost = this.holdings.reduce((sum, h) => sum + Number(h.cost || 0), 0);
      const value = this.holdingsView.reduce((sum, h) => sum + Number(h.marketValue || 0), 0);
      const pnl = value - cost;
      return { cost, value, pnl, rate: cost ? (pnl / cost) * 100 : 0 };
    },
    recommendations() {
      return this.insights?.recommendations || [];
    },
  },
  async mounted() {
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
    },
  },
  methods: {
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
      this.toastTimer = window.setTimeout(() => (this.toast.text = ""), 2800);
    },
    uid() {
      return crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
    },
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
    gainClass(value) {
      return Number(value || 0) >= 0 ? "text-red-600" : "text-emerald-600";
    },
    async loadAll() {
      try {
        const data = await this.api("/api/bootstrap");
        this.holdings = data.portfolio.holdings || [];
        this.agents = data.agents.agents || [];
        this.skills = data.skills.skills || [];
        this.model = data.model_config || {};
        this.chat.agent_id = this.activeAgents[0]?.id || "";
        await this.refreshQuotes(null, false);
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
    closeHolding() {
      this.holdingModal.show = false;
      this.draftQuote = null;
    },
    async fetchDraftQuote() {
      const code = String(this.holdingDraft.code || "").trim();
      if (!code) return;
      try {
        const data = await this.api(`/api/funds/realtime?codes=${encodeURIComponent(code)}`);
        this.quotes = { ...this.quotes, ...data };
        this.draftQuote = data[code];
        if (this.draftQuote?.name && !this.holdingDraft.name) this.holdingDraft.name = this.draftQuote.name;
        this.calcDraftShares();
      } catch (err) {
        this.showToast(err.message, false);
      }
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
      } catch (err) {
        this.showToast(err.message, false);
      }
    },
    async deleteHolding(index) {
      if (!confirm("确认删除该持仓？")) return;
      this.holdings.splice(index, 1);
      await this.savePortfolio();
    },
    setChart(id, config) {
      if (!window.Chart || !document.getElementById(id)) return;
      if (this.charts[id]) this.charts[id].destroy();
      this.charts[id] = new Chart(document.getElementById(id), config);
    },
    async loadInsights(notify = true) {
      try {
        this.insights = await this.api("/api/insights");
        await nextTick();
        this.renderCharts();
        if (notify) this.showToast("洞察已刷新");
      } catch (err) {
        this.showToast(err.message, false);
      }
    },
    async loadHotFunds(notify = true) {
      try {
        const data = await this.api("/api/fund-market/hot");
        this.hotFunds = data.hot || [];
        if (notify) this.showToast("天天基金热点已刷新");
      } catch (err) {
        this.showToast(err.message, false);
      }
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
            { label: "当前市值", data: history.map((x) => x.total_value), borderColor: "#0f766e", backgroundColor: "rgba(15,118,110,.12)", tension: 0.35, fill: true },
            { label: "浮动盈亏", data: history.map((x) => x.total_pnl), borderColor: "#e11d48", backgroundColor: "rgba(225,29,72,.08)", tension: 0.35 },
          ],
        },
        options: { responsive: true, plugins: { legend: { position: "bottom" } }, scales: { x: { ticks: { maxTicksLimit: 6 } } } },
      });
      const items = data.snapshot?.items || [];
      this.setChart("allocationChart", {
        type: "doughnut",
        data: { labels: items.map((x) => x.name || x.code), datasets: [{ data: items.map((x) => x.market_value), backgroundColor: ["#0f766e", "#e11d48", "#2563eb", "#ca8a04", "#7c3aed", "#16a34a"] }] },
        options: { responsive: true, plugins: { legend: { position: "bottom" } } },
      });
      const colors = ["#0f766e", "#e11d48", "#2563eb", "#ca8a04", "#7c3aed", "#16a34a"];
      const labels = (data.funds?.[0]?.history || []).map((x) => x.date);
      this.setChart("fundTrendChart", {
        type: "line",
        data: {
          labels,
          datasets: (data.funds || []).map((f, i) => ({ label: f.quote?.name || f.name || f.code, data: (f.history || []).map((x) => x.nav), borderColor: colors[i % colors.length], tension: 0.32, pointRadius: 0 })),
        },
        options: { responsive: true, plugins: { legend: { position: "bottom" } }, scales: { x: { ticks: { maxTicksLimit: 10 } } } },
      });
    },
    async sendChat() {
      const text = this.chat.message.trim();
      if (!text) return;
      this.messages.push({ role: "user", text });
      this.chat.message = "";
      const pending = { role: "assistant", text: "正在生成明确建议..." };
      this.messages.push(pending);
      try {
        const data = await this.api("/api/chat", { method: "POST", body: JSON.stringify({ message: text, mode: this.chat.mode, agent_id: this.chat.agent_id, agent_ids: this.chat.agent_ids, skill_ids: this.chat.skill_ids }) });
        pending.text = data.reply;
      } catch (err) {
        pending.text = `错误：${err.message}`;
      }
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
      } catch (err) {
        this.showToast(err.message, false);
      }
    },
    deleteAgent(index) {
      if (confirm("确认删除该 Agent？")) this.agents.splice(index, 1);
    },
    addSkill() {
      this.skills.push({ id: this.uid(), name: "新 Skill", description: "", keywords: [], instruction: "", active: true });
    },
    async saveSkills() {
      try {
        const data = await this.api("/api/skills", { method: "PUT", body: JSON.stringify(this.skills) });
        this.skills = data.skills || [];
        this.showToast("Skill 已保存");
      } catch (err) {
        this.showToast(err.message, false);
      }
    },
    deleteSkill(index) {
      if (confirm("确认删除该 Skill？")) this.skills.splice(index, 1);
    },
    async saveModel() {
      try {
        this.model = await this.api("/api/model-config", { method: "PUT", body: JSON.stringify(this.model) });
        this.showToast("模型配置已保存");
      } catch (err) {
        this.showToast(err.message, false);
      }
    },
    async testModel() {
      try {
        const data = await this.api("/api/model-config/test", { method: "POST", body: JSON.stringify(this.model) });
        this.model = await this.api("/api/model-config");
        this.showToast(`连接成功：${data.reply || ""}`);
      } catch (err) {
        this.showToast(err.message, false);
      }
    },
  },
}).mount("#app");
