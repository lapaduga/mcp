import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.MCP_EXTERNAL_ENABLED = "true";

const { createApp } = await import("../server.js");

let server;
let baseUrl;
let externalToolNames = [];

before(async function () {
  const { app } = await createApp();

  await new Promise((resolve) => {
    server = app.listen(0, () => resolve());
  });

  const addr = server.address();
  baseUrl = `http://localhost:${addr.port}`;

  const res = await fetch(`${baseUrl}/api/tools`);
  const tools = await res.json();
  externalToolNames = tools
    .filter((t) => t.isExternal)
    .map((t) => t.name);
});

after(() => {
  server.close();
});

describe("REST API (внешние инструменты)", () => {
  it("GET /api/tools содержит внешние инструменты", async () => {
    const res = await fetch(`${baseUrl}/api/tools`);
    assert.equal(res.status, 200);
    const tools = await res.json();

    const external = tools.filter((t) => t.isExternal);
    assert.ok(external.length > 0, "Должен быть хотя бы один внешний инструмент");
  });

  it("Внешний инструмент имеет isExternal и source поля", async () => {
    const res = await fetch(`${baseUrl}/api/tools`);
    const tools = await res.json();
    const external = tools.find((t) => t.isExternal);

    assert.ok(external);
    assert.equal(external.isExternal, true);
    assert.equal(external.source, "everything");
  });

  it("Локальный инструмент имеет приоритет при конфликте имён", async () => {
    const res = await fetch(`${baseUrl}/api/tools`);
    const tools = await res.json();
    const hello = tools.find((t) => t.name === "hello_world");

    assert.ok(hello);
    assert.equal(hello.isExternal, false);
  });

  it("Вызов echo внешнего инструмента возвращает результат", async () => {
    if (!externalToolNames.includes("echo")) {
      return;
    }

    const res = await fetch(`${baseUrl}/api/tools/echo/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Hello from test" }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.content);
    const text = body.content.map((c) => c.text).join("");
    assert.ok(text.includes("Hello from test"));
  });

  it("Вызов add внешнего инструмента возвращает сумму", async () => {
    if (!externalToolNames.includes("add")) {
      return;
    }

    const res = await fetch(`${baseUrl}/api/tools/add/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a: 3, b: 4 }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    const text = body.content.map((c) => c.text).join("");
    assert.ok(text.includes("7"));
  });
});
