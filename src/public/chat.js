(function () {
  const BASE = "";

  class ChatManager {
    constructor() {
      this.container = document.getElementById("chatMessages");
      this.input = document.getElementById("chatInput");
      this.sendBtn = document.getElementById("chatSendBtn");
      this.chatSection = document.getElementById("chatSection");
      this.sessionId = "sess_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);

      this.chainSteps = [];
      this._seenToolCalls = new Map();
      this.analyzingEl = null;
      this.chainToggleEl = null;
      this.chainDetailEl = null;

      if (!this.container || !this.input || !this.sendBtn) return;

      this.sendBtn.addEventListener("click", () => this.send());
      this.input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          this.send();
        }
      });

      this.setupSse();
    }

    setupSse() {
      const evtSource = new EventSource(`${BASE}/api/chat/stream?sessionId=${this.sessionId}`);

      evtSource.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);

          if (data.type === "tool_step") {
            const key = data.toolCall.tool + JSON.stringify(data.toolCall.arguments);
            if (!this._seenToolCalls.has(key)) {
              this._seenToolCalls.set(key, true);
              this.chainSteps.push(data.toolCall);
              this.removeAnalyzing();
              this.addToolCall(data.toolCall);
              this.showAnalyzing();
            }
          }

          if (data.type === "tool_chain_result") {
            this.removeAnalyzing();
            for (const tc of data.toolCalls || []) {
              const key = tc.tool + JSON.stringify(tc.arguments);
              if (!this._seenToolCalls.has(key)) {
                this._seenToolCalls.set(key, true);
                this.chainSteps.push(tc);
                this.addToolCall(tc);
              }
            }
            this.renderChainToggle();
            if (data.reply) {
              this.addMessage("assistant", this.renderMarkdown(data.reply));
            }
          }
        } catch {
          // ignore parse errors
        }
      };

      evtSource.onerror = () => {
        setTimeout(() => this.setupSse(), 3000);
      };
    }

    async send() {
      const text = this.input.value.trim();
      if (!text) return;

      this.chainSteps = [];
      this._seenToolCalls = new Map();
      this.removeAnalyzing();
      if (this.chainToggleEl) { this.chainToggleEl.remove(); this.chainToggleEl = null; }
      if (this.chainDetailEl) { this.chainDetailEl.remove(); this.chainDetailEl = null; }

      this.addMessage("user", this.escapeHtml(text));
      this.input.value = "";

      const typingId = this.showTyping();

      try {
        const res = await fetch(`${BASE}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: text }],
            sessionId: this.sessionId,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${res.status}`);
        }

        const data = await res.json();
        this.removeTyping(typingId);
        this.removeAnalyzing();

        if (data.toolCalls && data.toolCalls.length > 0) {
          for (const tc of data.toolCalls) {
            const key = tc.tool + JSON.stringify(tc.arguments);
            if (!this._seenToolCalls.has(key)) {
              this._seenToolCalls.set(key, true);
              this.chainSteps.push(tc);
              this.addToolCall(tc);
            }
          }
          this.renderChainToggle();
        }

        this.addMessage("assistant", this.renderMarkdown(data.reply));
      } catch (err) {
        this.removeTyping(typingId);
        this.removeAnalyzing();
        this.addMessage("assistant", `❌ Ошибка: ${this.escapeHtml(err.message)}`);
      }
    }

    addMessage(role, html) {
      const div = document.createElement("div");
      div.className = `chat-message chat-${role}`;
      div.innerHTML = html;
      this.container.appendChild(div);
      this.scrollBottom();
    }

    sourceBadgeClass(source) {
      if (!source || source === "локальный") return "source-local";
      if (source.startsWith("внешний:everything")) return "source-everything";
      return "source-other";
    }

    addToolCall(tc) {
      const div = document.createElement("div");
      div.className = "chat-tool-call";
      const badgeClass = this.sourceBadgeClass(tc.source);
      const sourceBadge = tc.source
        ? `<span class="tool-source-badge ${badgeClass}">${this.escapeHtml(tc.source)}</span>`
        : "";
      const argsStr = tc.arguments ? JSON.stringify(tc.arguments) : "";
      div.innerHTML = `🔧 ${sourceBadge} <strong>${this.escapeHtml(tc.tool)}</strong>(${this.escapeHtml(argsStr)})`;
      this.container.appendChild(div);
      this.scrollBottom();
    }

    showAnalyzing() {
      this.removeAnalyzing();
      const div = document.createElement("div");
      div.className = "chat-tool-call chat-analyzing";
      div.textContent = "🤖 Анализирую...";
      this.container.appendChild(div);
      this.scrollBottom();
      this.analyzingEl = div;
    }

    removeAnalyzing() {
      if (this.analyzingEl) {
        this.analyzingEl.remove();
        this.analyzingEl = null;
      }
    }

    renderChainToggle() {
      this.removeAnalyzing();
      if (this.chainToggleEl) this.chainToggleEl.remove();
      if (this.chainDetailEl) this.chainDetailEl.remove();

      const count = this.chainSteps.length;
      const maxSteps = 5;

      const toggle = document.createElement("div");
      toggle.className = "chat-chain-toggle";
      toggle.innerHTML = `
        🔗 <strong>Цепочка: ${count} шаг${count > 1 ? "а" : ""}</strong>
        <span class="chain-progress"><span class="chain-progress-fill" style="width:${Math.min(100, (count / 5) * 100)}%"></span></span>
        <span class="chain-toggle-arrow">▶</span>
      `;
      toggle.addEventListener("click", () => {
        this.toggleChainDetail(toggle);
      });
      this.container.appendChild(toggle);
      this.chainToggleEl = toggle;

      const detail = document.createElement("div");
      detail.className = "chat-chain-detail hidden";
      detail.innerHTML = this.chainSteps.map((tc, i) => {
        const isError = tc.result && (tc.result.startsWith("Ошибка:") || tc.result.startsWith("Error:"));
        const badgeClass = this.sourceBadgeClass(tc.source);
        return `
        <div class="chain-step${isError ? " chain-step-error" : ""}">
          <div class="chain-step-header">
            <span class="chain-step-num">${i + 1}</span>
            <span class="tool-source-badge ${badgeClass}">${this.escapeHtml(tc.source || "локальный")}</span>
            <strong>${this.escapeHtml(tc.tool)}</strong>
          </div>
          <div class="chain-step-args">Аргументы: ${this.escapeHtml(JSON.stringify(tc.arguments))}</div>
          ${tc.result ? `<div class="chain-step-result">${this.escapeHtml(tc.result)}</div>` : ""}
        </div>
      `}).join("");
      this.container.appendChild(detail);
      this.chainDetailEl = detail;

      this.scrollBottom();
    }

    toggleChainDetail(toggleEl) {
      const arrow = toggleEl.querySelector(".chain-toggle-arrow");
      if (this.chainDetailEl.classList.contains("hidden")) {
        this.chainDetailEl.classList.remove("hidden");
        arrow.textContent = "▼";
      } else {
        this.chainDetailEl.classList.add("hidden");
        arrow.textContent = "▶";
      }
    }

    showTyping() {
      const id = "typing-" + Date.now();
      const div = document.createElement("div");
      div.className = "chat-message chat-assistant chat-typing";
      div.id = id;
      div.textContent = "⚡ Думаю...";
      this.container.appendChild(div);
      this.scrollBottom();
      return id;
    }

    removeTyping(id) {
      if (id) {
        const el = document.getElementById(id);
        if (el) el.remove();
      } else {
        const els = this.container.querySelectorAll(".chat-typing");
        for (const el of els) el.remove();
      }
    }

    scrollBottom() {
      this.container.scrollTop = this.container.scrollHeight;
    }

    escapeHtml(str) {
      if (!str) return "";
      const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
      return String(str).replace(/[&<>"']/g, (c) => map[c]);
    }

    renderMarkdown(text) {
      if (!text) return "";
      let html = this.escapeHtml(text);
      html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
      html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
      html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
      html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
      html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
      html = html.replace(/\n/g, "<br>");
      return html;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const chatManager = new ChatManager();

    const tabs = document.querySelectorAll(".sidebar-tab");
    const placeholder = document.getElementById("placeholder");
    const toolDetail = document.getElementById("toolDetail");
    const chatSection = document.getElementById("chatSection");

    if (!tabs.length) return;

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const target = tab.dataset.tab;
        tabs.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");

        if (target === "chat") {
          placeholder.classList.add("hidden");
          toolDetail.classList.add("hidden");
          chatSection.classList.remove("hidden");
        } else {
          chatSection.classList.add("hidden");
          if (window.__selectedTool) {
            placeholder.classList.add("hidden");
            toolDetail.classList.remove("hidden");
          } else {
            placeholder.classList.remove("hidden");
            toolDetail.classList.add("hidden");
          }
        }
      });
    });
  });
})();
