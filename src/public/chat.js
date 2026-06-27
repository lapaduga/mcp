(function () {
  const BASE = "";

  class ChatManager {
    constructor() {
      this.container = document.getElementById("chatMessages");
      this.input = document.getElementById("chatInput");
      this.sendBtn = document.getElementById("chatSendBtn");
      this.chatSection = document.getElementById("chatSection");
      this.sessionId = "sess_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);

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
          if (data.type === "tool_chain_result") {
            this.removeTyping();
            for (const tc of data.toolCalls || []) {
              this.addToolCall(tc);
            }
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

        if (data.toolCalls && data.toolCalls.length > 0) {
          for (const tc of data.toolCalls) {
            this.addToolCall(tc);
          }
        }

        this.addMessage("assistant", this.renderMarkdown(data.reply));
      } catch (err) {
        this.removeTyping(typingId);
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

    addToolCall(tc) {
      const div = document.createElement("div");
      div.className = "chat-tool-call";
      const argsStr = tc.arguments ? JSON.stringify(tc.arguments) : "";
      div.innerHTML = `🔧 <strong>${this.escapeHtml(tc.tool)}</strong>(${this.escapeHtml(argsStr)})`;
      this.container.appendChild(div);
      this.scrollBottom();
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
