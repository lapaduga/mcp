const BASE = "";
const POLL_INTERVAL = 30000;

let tools = [];
let selectedTool = null;
window.__selectedTool = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function formatTime() {
  return new Date().toLocaleTimeString("ru-RU", { hour12: false });
}

function addLog(message, level = "info") {
  const container = $("#logContainer");
  const entry = document.createElement("div");
  entry.className = `log-entry log-${level}`;
  entry.innerHTML = `<span class="log-time">[${formatTime()}]</span>${message}`;
  container.appendChild(entry);
  container.scrollTop = container.scrollHeight;
}

function setStatus(online) {
  const indicator = $("#statusIndicator");
  const text = $("#statusText");
  if (online === null) {
    indicator.className = "status-indicator loading";
    text.textContent = "Подключение...";
  } else if (online) {
    indicator.className = "status-indicator online";
    text.textContent = "Подключено";
  } else {
    indicator.className = "status-indicator offline";
    text.textContent = "Нет подключения";
  }
}

async function fetchTools() {
  try {
    setStatus(null);
    const res = await fetch(`${BASE}/api/tools`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    tools = await res.json();
    setStatus(true);
    addLog("Список инструментов обновлён", "success");
    renderToolList();
    if (selectedTool) {
      const updated = tools.find((t) => t.name === selectedTool.name);
      if (updated) selectTool(updated);
    }
  } catch (err) {
    setStatus(false);
    addLog(`Ошибка загрузки инструментов: ${err.message}`, "error");
  }
}

function renderToolList() {
  const list = $("#toolList");
  list.innerHTML = tools
    .map(
      (t) => `
      <div class="tool-card${selectedTool?.name === t.name ? " active" : ""}" data-name="${t.name}">
        <div class="tool-name">${t.name}</div>
        <div class="tool-desc">${t.description || "Нет описания"}</div>
      </div>`
    )
    .join("");

  list.querySelectorAll(".tool-card").forEach((card) => {
    card.addEventListener("click", () => {
      const name = card.dataset.name;
      const tool = tools.find((t) => t.name === name);
      if (tool) selectTool(tool);
    });
  });
}

function selectTool(tool) {
  selectedTool = tool;
  window.__selectedTool = tool;
  renderToolList();

  const detail = $("#toolDetail");
  const placeholder = $("#placeholder");
  const resultArea = $("#resultArea");
  const errorArea = $("#errorArea");
  const spinner = $("#spinner");

  detail.classList.remove("hidden");
  placeholder.classList.add("hidden");
  resultArea.classList.add("hidden");
  errorArea.classList.add("hidden");
  spinner.classList.add("hidden");

  $("#detailName").textContent = tool.name;
  $("#detailDescription").textContent = tool.description || "Нет описания";
  $("#detailSchema").textContent = JSON.stringify(tool.inputSchema, null, 2);

  generateForm(tool.inputSchema);

  addLog(`Выбран инструмент: ${tool.name}`, "info");
}

function generateForm(schema) {
  const container = $("#formFields");
  container.innerHTML = "";

  if (!schema || !schema.properties || schema.type !== "object") {
    container.innerHTML = "<p style='color:var(--text-muted)'>Нет параметров</p>";
    return;
  }

  const required = new Set(schema.required || []);

  for (const [key, prop] of Object.entries(schema.properties)) {
    const group = document.createElement("div");
    group.className = "form-group";

    const label = document.createElement("label");
    label.setAttribute("for", `field-${key}`);
    label.textContent = key;
    if (required.has(key)) {
      const star = document.createElement("span");
      star.className = "required";
      star.textContent = "*";
      label.appendChild(star);
    }
    group.appendChild(label);

    const type = prop.type || "string";
    let input;

    if (type === "boolean") {
      input = document.createElement("select");
      input.innerHTML = `<option value="">--</option><option value="true">true</option><option value="false">false</option>`;
    } else if (type === "number" || type === "integer") {
      input = document.createElement("input");
      input.type = "number";
      if (prop.minimum !== undefined) input.min = prop.minimum;
      if (prop.maximum !== undefined) input.max = prop.maximum;
    } else if (type === "string" && prop.enum) {
      input = document.createElement("select");
      input.innerHTML = `<option value="">--</option>${prop.enum
        .map((v) => `<option value="${v}">${v}</option>`)
        .join("")}`;
    } else {
      input = document.createElement("input");
      input.type = "text";
      if (prop.pattern) input.pattern = prop.pattern;
    }

    if (prop.description) {
      input.placeholder = prop.description;
    }

    input.id = `field-${key}`;
    input.name = key;
    input.required = required.has(key);
    input.dataset.type = type;

    if (required.has(key)) {
      input.setAttribute("aria-required", "true");
    }

    group.appendChild(input);
    container.appendChild(group);
  }
}

function collectFormValues() {
  const fields = $$("#formFields .form-group");
  const values = {};
  let isValid = true;

  fields.forEach((group) => {
    const input = group.querySelector("input, select, textarea");
    if (!input) return;

    const key = input.name;
    const type = input.dataset.type;
    let value = input.value.trim();

    if (input.required && !value) {
      input.classList.add("error");
      isValid = false;
      return;
    }
    input.classList.remove("error");

    if (!value) return;

    if (type === "number") {
      values[key] = parseFloat(value);
    } else if (type === "integer") {
      values[key] = parseInt(value, 10);
    } else if (type === "boolean") {
      values[key] = value === "true";
    } else {
      values[key] = value;
    }
  });

  return isValid ? values : null;
}

async function callTool(name, args) {
  const resultArea = $("#resultArea");
  const errorArea = $("#errorArea");
  const spinner = $("#spinner");
  const callBtn = $("#callButton");

  resultArea.classList.add("hidden");
  errorArea.classList.add("hidden");
  spinner.classList.remove("hidden");
  callBtn.disabled = true;

  addLog(`Вызов инструмента: ${name}`, "info");

  try {
    const res = await fetch(`${BASE}/api/tools/${name}/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });

    const data = await res.json();

    if (!res.ok || data.isError) {
      const msg = data.error || "Неизвестная ошибка";
      errorArea.querySelector("#errorOutput").textContent = msg;
      errorArea.classList.remove("hidden");
      addLog(`Ошибка: ${msg}`, "error");
    } else {
      const output = resultArea.querySelector("#resultOutput");
      output.innerHTML = "";
      let summary = "";

      for (const c of data.content ?? []) {
        if (c.type === "image" && c.data) {
          const img = document.createElement("img");
          img.src = `data:${c.mimeType || "image/png"};base64,${c.data}`;
          img.alt = c.text || "image";
          img.style.maxWidth = "100%";
          img.style.borderRadius = "4px";
          output.appendChild(img);
          summary += "[image] ";
        } else if (c.type === "text") {
          const p = document.createElement("p");
          p.style.margin = c.text ? "0 0 8px 0" : "0";
          p.textContent = c.text;
          output.appendChild(p);
          summary += c.text;
        } else {
          const pre = document.createElement("pre");
          pre.textContent = JSON.stringify(c, null, 2);
          output.appendChild(pre);
          summary += "[data] ";
        }
      }

      resultArea.classList.remove("hidden");
      addLog(`Результат: ${summary.slice(0, 80)}${summary.length > 80 ? "..." : ""}`, "success");
    }
  } catch (err) {
    errorArea.querySelector("#errorOutput").textContent = err.message;
    errorArea.classList.remove("hidden");
    addLog(`Ошибка: ${err.message}`, "error");
  } finally {
    spinner.classList.add("hidden");
    callBtn.disabled = false;
    fetchSchedulerTasks();
  }
}

async function fetchSchedulerTasks() {
  try {
    const res = await fetch(`${BASE}/api/scheduler/tasks`);
    if (!res.ok) {
      if (res.status === 503) return;
      throw new Error(`HTTP ${res.status}`);
    }
    const tasks = await res.json();
    renderSchedulerTasks(tasks);
  } catch (err) {
    console.debug("Планировщик недоступен:", err.message);
  }
}

function renderSchedulerTasks(tasks) {
  const list = $("#taskList");
  if (!list) return;

  if (tasks.length === 0) {
    list.innerHTML = "<div class='task-empty'>Нет задач</div>";
    return;
  }

  list.innerHTML = tasks
    .map((t) => {
      const status = t.status === "completed" ? "\u2705" : "\u23F3";
      const typeLabel =
        t.type === "reminder" ? "Напоминание" : "Периодическая";
      const next = t.executeAt
        ? new Date(t.executeAt).toLocaleTimeString()
        : "\u2014";
      return `<div class="task-item">
        <div class="task-header">${status} <strong>${typeLabel}</strong></div>
        <div class="task-message">${t.message}</div>
        <div class="task-meta">Следующий: ${next}</div>
      </div>`;
    })
    .join("");
}

function init() {
  setStatus(null);

  fetchTools();
  fetchSchedulerTasks();

  setInterval(fetchTools, POLL_INTERVAL);
  setInterval(fetchSchedulerTasks, 5000);

  $("#toolForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!selectedTool) return;

    const values = collectFormValues();
    if (values === null) {
      addLog("Форма содержит ошибки валидации", "warn");
      return;
    }

    await callTool(selectedTool.name, values);
  });

  // Админ-кнопки
  const adminStatus = $("#adminStatus");

  async function adminAction(url, label) {
    const btn = event.target;
    btn.disabled = true;
    adminStatus.textContent = `⏳ ${label}...`;
    try {
      const res = await fetch(url, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        adminStatus.textContent = `✅ Удалено: ${data.deleted}`;
        addLog(`${label}: очищено ${data.deleted}`, "success");
      } else {
        adminStatus.textContent = `❌ ${data.error || "ошибка"}`;
      }
    } catch (err) {
      adminStatus.textContent = `❌ ${err.message}`;
      addLog(`${label}: ${err.message}`, "error");
    }
    btn.disabled = false;
    setTimeout(() => { adminStatus.textContent = ""; }, 3000);
  }

  $("#btnClearNotes").addEventListener("click", () => adminAction("/api/admin/clear-notes", "Заметки"));
  $("#btnClearScheduler").addEventListener("click", () => adminAction("/api/admin/clear-scheduler", "Планировщик"));

  addLog("Приложение загружено", "info");
}

document.addEventListener("DOMContentLoaded", init);
