import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.MCP_EXTERNAL_ENABLED = "false";

const { createApp } = await import("../server.js");

let server;
let baseUrl;

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

describe("REST API (локальные инструменты)", () => {
  it("GET /api/health возвращает 200", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.status, "ok");
    assert.ok(body.timestamp);
  });

  it("GET /api/tools возвращает массив с hello_world", async () => {
    const res = await fetch(`${baseUrl}/api/tools`);
    assert.equal(res.status, 200);

    const tools = await res.json();
    assert.ok(Array.isArray(tools));
    assert.ok(tools.length >= 1);

    const hello = tools.find((t) => t.name === "hello_world");
    assert.ok(hello);
    assert.equal(hello.name, "hello_world");
    assert.ok(hello.description);
    assert.ok(hello.inputSchema);
  });

  it("GET /api/tools возвращает isExternal и source поля", async () => {
    const res = await fetch(`${baseUrl}/api/tools`);
    const tools = await res.json();
    const hello = tools.find((t) => t.name === "hello_world");
    assert.equal(hello.isExternal, false);
    assert.equal(hello.source, null);
  });

  it("POST /api/tools/hello_world/call с name возвращает приветствие", async () => {
    const res = await fetch(`${baseUrl}/api/tools/hello_world/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test" }),
    });

    assert.equal(res.status, 200);

    const body = await res.json();
    assert.ok(body.content);
    assert.ok(Array.isArray(body.content));
    assert.equal(body.content[0].type, "text");

    const text = body.content[0].text;
    assert.ok(text.includes("Test"));
    assert.ok(text.includes("Привет"));
  });

  it("POST /api/tools/hello_world/call без name возвращает ошибку", async () => {
    const res = await fetch(`${baseUrl}/api/tools/hello_world/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    assert.equal(res.status, 400);

    const body = await res.json();
    assert.ok(body.error || body.isError);
  });

  it("POST /api/tools/unknown/call возвращает 404", async () => {
    const res = await fetch(`${baseUrl}/api/tools/unknown/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    assert.equal(res.status, 404);
  });
});
