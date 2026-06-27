import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { config } from "./src/shared/config.js";
import Logger from "./src/shared/logger.js";
import { AppContext } from "./src/shared/context.js";
import { registry } from "./src/mcp/tools/registry.js";
import { createMcpServer } from "./src/mcp/server.js";
import { setupSseTransport } from "./src/mcp/transports/sse.js";
import { createRouter } from "./src/api/routes.js";
import { McpClientManager } from "./src/mcp/client-manager.js";
import { TaskStorage } from "./src/scheduler/storage.js";
import { Scheduler } from "./src/scheduler/scheduler.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const logger = new Logger(config.logLevel);

const ctx = new AppContext();
ctx.logger = logger;
ctx.registry = registry;

export async function createApp() {
  const clientManager = new McpClientManager(logger);
  registry.setClientManager(clientManager);
  ctx.clientManager = clientManager;

  const taskStorage = new TaskStorage(logger);
  const scheduler = new Scheduler(taskStorage, logger, ctx);
  scheduler.start();

  ctx.storage = taskStorage;
  ctx.scheduler = scheduler;
  // Обратная совместимость для инструментов, использующих global.*
  global.storageInstance = taskStorage;
  global.schedulerInstance = scheduler;

  await registry.loadTools();
  logger.info(`Загружено локальных инструментов: ${registry.getTools().length}`);

  if (config.externalMcpServers.length > 0) {
    await registry.loadExternalTools(config.externalMcpServers);
  }

  const mcpServer = createMcpServer(registry);
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(express.static(join(__dirname, "src", "public")));

  setupSseTransport(app, mcpServer, logger);
  app.use("/api", createRouter(ctx));

  // SSE endpoint для realtime-уведомлений чата
  app.get("/api/chat/stream", (req, res) => {
    const sessionId = req.query.sessionId || "default";
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    ctx.chatClients.set(sessionId, res);
    logger.info(`SSE клиент подключён: ${sessionId}`);

    req.on("close", () => {
      ctx.chatClients.delete(sessionId);
      logger.info(`SSE клиент отключён: ${sessionId}`);
    });
  });

  // Чат-эндпоинт с MCP-агент
  app.post("/api/chat", async (req, res) => {
    try {
      const { messages, sessionId } = req.body;
      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "Поле 'messages' обязательно" });
      }
      const result = await processChatMessage(ctx, messages, sessionId || null, 5);
      res.json(result);
    } catch (err) {
      logger.error(`Ошибка чата: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // Экспортируем processChatMessage для scheduler callback
  ctx.chatProcessMessage = (msgs, sessionId) =>
    processChatMessage(ctx, msgs, sessionId, 5);

  logger.info(`Всего инструментов: ${registry.getTools().length}`);

  return { app, mcpServer, clientManager, scheduler };
}

function buildChatSystemPrompt(tools) {
  const lines = [
    "Ты — ассистент с доступом к инструментам.",
    "",
    "ПРАВИЛО ЦЕПОЧКИ (ORCHESTRATION):",
    "Ты можешь выполнять несколько шагов последовательно, вызывая инструменты один за другим.",
    "После КАЖДОГО вызова инструмента ты получишь результат. Проанализируй его и реши:",
    "  — Нужен ли следующий шаг (вызвать ещё один инструмент через TOOL_CALL)?",
    "  — Или задача решена (ответь пользователю по-русски)?",
    "",
    "ВЕТВЛЕНИЕ (BRANCHING):",
    "На основе результата предыдущего шага ты можешь выбирать разные следующие шаги.",
    "Пример: получив температуру, ты можешь вызвать save_note с 'Тепло' если > 15°C, или 'Холодно' если <= 15°C.",
    "",
    "ОТЛОЖЕННЫЕ ЗАДАЧИ:",
    "Если пользователь просит сделать что-то через N секунд/минут — используй create_reminder с callback.",
    "",
    "ФОРМАТ callback.messages (строго):",
    "Это массив ДИАЛОГОВЫХ сообщений {role, content} для LLM, а не одна команда.",
    "ОБЯЗАТЕЛЬНО добавь system-сообщение первым с инструкцией вызвать инструменты через TOOL_CALL.",
    "",
    "Пример правильного callback:",
    '  {"type":"llm_chat","messages":[{"role":"system","content":"Ты — ассистент с доступом к инструментам. Вызови get_weather для Москвы через TOOL_CALL, затем ответь пользователю по-русски."},{"role":"user","content":"Проверь погоду"}],"sessionId":"..."}',
    "",
    "ФОРМАТ ВЫЗОВА ИНСТРУМЕНТА:",
    "TOOL_CALL: {\"tool\": \"имя_инструмента\", \"arguments\": {}}",
    "Несколько TOOL_CALL в одном ответе = параллельные вызовы (они выполняются одновременно).",
    "",
    "ВАЖНО: Parallel calls (несколько TOOL_CALL в одном ответе) — это НЕ конец цепочки. Продолжай вызывать инструменты на следующих шагах, пока все задачи пользователя не выполнены.",
    "",
    "Пример 5 (parallel calls + продолжение):",
    'Пользователь: "Проверь погоду в Москве и Питере, сохрани результат в заметку"',
    "→ TOOL_CALL: {\"tool\": \"get_weather\", \"arguments\": {\"city\": \"Москва\"}}",
    "TOOL_CALL: {\"tool\": \"get_weather\", \"arguments\": {\"city\": \"Питер\"}}",
    "[получаешь результаты обоих вызовов]",
    "→ TOOL_CALL: {\"tool\": \"save_note\", \"arguments\": {\"title\": \"Погода\", \"content\": \"Москва: ... Питер: ...\"}}",
    "→ Ответ пользователю: \"Готово! Погода сохранена в заметку.\"",
    "",
    "Пример 6 (полный микс):",
    'Пользователь: "Поприветствуй меня как Иван, проверь погоду в Москве и Питере, сохрани результат в заметку, и создай напоминание через 3 секунды"',
    "→ Шаг 1 (parallel):",
    "TOOL_CALL: {\"tool\": \"hello_world\", \"arguments\": {\"name\": \"Иван\"}}",
    "TOOL_CALL: {\"tool\": \"get_weather\", \"arguments\": {\"city\": \"Москва\"}}",
    "TOOL_CALL: {\"tool\": \"get_weather\", \"arguments\": {\"city\": \"Питер\"}}",
    "→ Шаг 2:",
    "TOOL_CALL: {\"tool\": \"save_note\", \"arguments\": {\"title\": \"Погода\", \"content\": \"...\"}}",
    "→ Шаг 3:",
    "TOOL_CALL: {\"tool\": \"create_reminder\", \"arguments\": {\"message\": \"Проверь сводку\", \"delaySeconds\": 3, \"callback\": {\"type\": \"llm_chat\", \"messages\": [{\"role\": \"system\", \"content\": \"Ты должен вызвать get_summary через TOOL_CALL и сообщить результат\"}, {\"role\": \"user\", \"content\": \"Выполни\"}]}}}",
    "→ Ответ пользователю: \"Готово! Напоминание создано.\"",
    "",
    "Доступные инструменты:",
  ];

  for (const tool of tools) {
    const source = tool.isExternal ? `внешний:${tool.source}` : "локальный";
    lines.push(`\n### ${tool.name} (source: ${source})`);
    lines.push(tool.description || "Нет описания");
    const schema = tool.inputSchema || {};
    const props = schema.properties || {};
    const required = new Set(schema.required || []);
    const entries = Object.entries(props);
    if (entries.length > 0) {
      lines.push("Параметры:");
      for (const [key, prop] of entries) {
        const req = required.has(key) ? " (обязательный)" : "";
        const desc = prop.description ? `: ${prop.description}` : "";
        lines.push(`- ${key} (${prop.type})${desc}${req}`);
      }
    } else {
      lines.push("Параметры: нет");
    }
  }

  lines.push(
    "",
    "После получения результата инструмента, если задача требует ещё шагов — используй TOOL_CALL для следующего.",
    "Если всё готово — просто ответь пользователю по-русски.",
    "Максимум 5 шагов в цепочке."
  );

  return { role: "system", content: lines.join("\n") };
}

async function callChatLlm(messages) {
  if (!config.chatApiKey) {
    throw new Error("CHAT_API_KEY не задан в .env");
  }

  const url = `${config.chatBaseUrl}/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.chatApiKey}`,
    },
    body: JSON.stringify({
      model: config.chatModel,
      messages,
      temperature: 0.3,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`LLM API (${response.status}): ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "";
}

function parseToolCalls(reply) {
  const results = [];
  const parts = reply.split("TOOL_CALL:");
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i].trim();
    let depth = 0;
    let start = -1;
    for (let j = 0; j < part.length; j++) {
      const ch = part[j];
      if (ch === "{") {
        if (depth === 0) start = j;
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0 && start !== -1) {
          try {
            const jsonStr = part.slice(start, j + 1);
            const data = JSON.parse(jsonStr);
            if (data.tool) results.push(data);
          } catch {
            // ignore invalid JSON
          }
          break;
        }
      }
    }
  }
  return results;
}

async function processChatMessage(ctx, messages, sessionId = null, maxSteps = 5) {
  const tools = ctx.registry.getTools();
  const systemMsg = buildChatSystemPrompt(tools);

  const allToolCalls = [];
  const historyMessages = [...messages];
  const logger = ctx.logger;

  for (let step = 0; step < maxSteps; step++) {
    const currentMessages = [systemMsg, ...historyMessages];
    const reply = await callChatLlm(currentMessages);

    // Парсим ВСЕ TOOL_CALL блоки — поддерживаем параллельные вызовы
    const callRequests = parseToolCalls(reply);
    if (callRequests.length === 0) {
      return { reply, toolCalls: allToolCalls };
    }

    // Выполняем все вызовы параллельно (независимые)
    const stepResults = await Promise.all(callRequests.map(async (callData, idx) => {
      const { tool: toolName, arguments: args } = callData;
      if (!toolName) return null;

      const tool = ctx.registry.getTool(toolName);
      if (!tool) return null;

      // Для create_reminder с callback — подставляем sessionId
      if (toolName === "create_reminder" && args?.callback && sessionId) {
        args.callback.sessionId = args.callback.sessionId || sessionId;
      }

      logger.info(`Чат -> [шаг ${step + 1}/${maxSteps}] вызов #${idx + 1}: ${toolName}`, args);
      let toolResult;
      try {
        toolResult = await tool.handler(args || {});
      } catch (err) {
        toolResult = {
          content: [{ type: "text", text: `Ошибка: ${err.message}` }],
          isError: true,
        };
      }

      const resultText = toolResult.content?.map((c) => c.text).join("\n") || JSON.stringify(toolResult);
      const source = tool.isExternal ? `внешний:${tool.source}` : "локальный";

      return {
        tool: toolName,
        arguments: args || {},
        source,
        result: resultText.slice(0, 800),
        resultText,
        isError: toolResult.isError || false,
      };
    }));

    // Фильтруем успешные и добавляем в общую историю
    const validResults = stepResults.filter(Boolean);

    for (let i = 0; i < validResults.length; i++) {
      const entry = validResults[i];
      allToolCalls.push({
        tool: entry.tool,
        arguments: entry.arguments,
        source: entry.source,
        result: entry.result,
      });

      // SSE push для каждого вызова
      if (sessionId) {
        try {
          ctx.pushToChat(sessionId, {
            type: "tool_step",
            step: step + 1,
            toolCall: { tool: entry.tool, arguments: entry.arguments, source: entry.source, result: entry.result },
          });
        } catch (sseErr) {
          logger.warn(`SSE push error: ${sseErr.message}`);
        }
      }
    }

    logger.info(`Чат -> [шаг ${step + 1}/${maxSteps}] выполнено вызовов: ${validResults.length}`);

    // Добавляем результаты в историю для следующей итерации
    const assistantPart = validResults.map((r) =>
      `- "${r.tool}" (${r.source}): ${r.result}`
    ).join("\n");

    const remainingHint = step < maxSteps - 1
      ? "\n\nВАЖНО: Если пользователь просил несколько действий (например, сохранить заметку или создать напоминание) — выполни их ВСЕ. Parallel calls — это только часть задачи."
      : "";

    historyMessages.push(
      { role: "assistant", content: reply },
      {
        role: "system",
        content: `Шаг ${step + 1}: выполнено ${validResults.length} вызовов:\n${assistantPart}\n\nЕсли задача пользователя решена — ответь ему по-русски. Если нужно выполнить ещё один шаг — используй TOOL_CALL.${remainingHint}`,
      }
    );
  }

  // Достигнут лимит шагов — просим LLM подвести итог
  const currentMessages = [
    systemMsg,
    ...historyMessages,
    { role: "system", content: "Достигнут лимит шагов (5). Подведи итог пользователю по-русски." },
  ];
  const finalReply = await callChatLlm(currentMessages);
  return { reply: finalReply, toolCalls: allToolCalls };
}

async function main() {
  const { app, clientManager, scheduler } = await createApp();

  const server = app.listen(config.port, () => {
    logger.info(`Сервер запущен на http://localhost:${config.port}`);
  });

  const shutdown = async (signal) => {
    logger.info(`Получен сигнал ${signal}, завершение работы...`);

    if (scheduler) scheduler.stop();
    if (clientManager) {
      try {
        await clientManager.disconnectAll();
      } catch (err) {
        logger.warn(`Ошибка отключения MCP-клиентов: ${err.message}`);
      }
    }

    server.close(() => {
      logger.info("HTTP-сервер остановлен");
      process.exit(0);
    });
    setTimeout(() => {
      logger.error("Принудительное завершение");
      process.exit(1);
    }, 5000);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("uncaughtException", (err) => {
    logger.error(`Необработанное исключение: ${err.message}`);
    process.exit(1);
  });
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
