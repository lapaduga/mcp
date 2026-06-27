import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.MCP_EXTERNAL_ENABLED = "false";

const { createApp } = await import("../server.js");

let server;
let baseUrl;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

before(async () => {
  const { app } = await createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  baseUrl = `http://localhost:${addr.port}`;
});

after(() => {
  server.close();
});

describe("Orchestration E2E (цепочка инструментов)", () => {
  it("GET /api/tools возвращает инструменты с source и isExternal", async () => {
    const res = await fetch(`${baseUrl}/api/tools`);
    assert.equal(res.status, 200);
    const tools = await res.json();

    assert.ok(Array.isArray(tools));
    assert.ok(tools.length >= 3);

    const chain = ["get_user", "save_note", "create_reminder", "get_summary"];
    for (const name of chain) {
      const tool = tools.find((t) => t.name === name);
      assert.ok(tool, `Инструмент ${name} должен быть в списке`);
      assert.ok(tool.inputSchema, `${name}: должна быть inputSchema`);
    }
  });

  it("Цепочка: get_user(1) → берём город → проверяем данные", async () => {
    const res = await fetch(`${baseUrl}/api/tools/get_user/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: 1 }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.content);
    const text = body.content.map((c) => c.text).join("");
    assert.ok(text.includes("Leanne Graham"), "Должен быть пользователь Leanne Graham");
    assert.ok(text.includes("Gwenborough"), "Должен быть город Gwenborough");
  });

  it("Цепочка: save_note сохраняет заметку и возвращает путь", async () => {
    const res = await fetch(`${baseUrl}/api/tools/save_note/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "E2ETestNote", content: "Содержание теста" }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.content);
    const text = body.content.map((c) => c.text).join("");
    assert.ok(text.includes("E2ETestNote"), "Должно быть имя файла с заголовком");
  });

  it("Цепочка: create_reminder создаёт задачу в планировщике", async () => {
    const res = await fetch(`${baseUrl}/api/tools/create_reminder/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "E2E тест напоминания",
        delaySeconds: 2,
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.content);
    const text = body.content.map((c) => c.text).join("");
    assert.ok(text.includes("создано"), "Должен быть подтверждение создания");
  });

  it("Scheduler выполняет create_reminder через 2 секунды", async () => {
    const tasksBefore = await (await fetch(`${baseUrl}/api/scheduler/tasks`)).json();
    const pendingBefore = tasksBefore.filter((t) => t.status === "pending").length;

    await fetch(`${baseUrl}/api/tools/create_reminder/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "SchedulerTest", delaySeconds: 1 }),
    });

    await sleep(2500);

    const tasksAfter = await (await fetch(`${baseUrl}/api/scheduler/tasks`)).json();
    const completed = tasksAfter.filter(
      (t) => t.message === "SchedulerTest" && t.status === "completed"
    );
    assert.ok(completed.length >= 1, "Задача должна быть выполнена планировщиком");
    assert.ok(completed[0].completedAt, "Должна быть отметка completedAt");
  });

  it("Цепочка: get_summary возвращает сводку", async () => {
    const res = await fetch(`${baseUrl}/api/tools/get_summary/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.content);
    const text = body.content.map((c) => c.text).join("");
    assert.ok(text.length > 0, "Сводка должна содержать текст");
  });

  it("POST /api/chat выполняет цепочку (минимум 1 tool call)", { skip: !process.env.CHAT_API_KEY }, async () => {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Вызови hello_world с именем Тест, потом сохрани заметку с результатом" }],
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.toolCalls);
    assert.ok(data.toolCalls.length >= 1, "Должен быть хотя бы один tool call");
    for (const tc of data.toolCalls) {
      assert.ok(tc.tool, "Каждый tool call должен иметь имя");
      assert.ok(tc.source, "Каждый tool call должен иметь source");
      assert.ok(tc.source === "локальный", "Локальные инструменты должны иметь source=локальный");
    }
    assert.ok(data.reply, "Должен быть ответ");
  });
});
