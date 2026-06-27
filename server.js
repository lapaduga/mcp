import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { config } from "./src/shared/config.js";
import Logger from "./src/shared/logger.js";
import { registry } from "./src/mcp/tools/registry.js";
import { createMcpServer } from "./src/mcp/server.js";
import { setupSseTransport } from "./src/mcp/transports/sse.js";
import { createRouter } from "./src/api/routes.js";
import { McpClientManager } from "./src/mcp/client-manager.js";
import { TaskStorage } from "./src/scheduler/storage.js";
import { Scheduler } from "./src/scheduler/scheduler.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const logger = new Logger(config.logLevel);

// SSE-клиенты для realtime-пуша в чат
global.chatClients = new Map();
global.pushToChat = (sessionId, data) => {
  const client = global.chatClients.get(sessionId);
  if (client) {
    try {
      client.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (err) {
      logger.warn(`SSE send error: ${err.message}`);
    }
  }
};

export async function createApp() {
  const clientManager = new McpClientManager(logger);
  registry.setClientManager(clientManager);

  const taskStorage = new TaskStorage(logger);
  const scheduler = new Scheduler(taskStorage, logger);
  scheduler.start();

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
  app.use("/api", createRouter(registry));

  // SSE endpoint для realtime-уведомлений чата
  app.get("/api/chat/stream", (req, res) => {
    const sessionId = req.query.sessionId || "default";
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    global.chatClients.set(sessionId, res);
    logger.info(`SSE клиент подключён: ${sessionId}`);

    req.on("close", () => {
      global.chatClients.delete(sessionId);
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
      const result = await processChatMessage(messages, registry, logger, sessionId || null);
      res.json(result);
    } catch (err) {
      logger.error(`Ошибка чата: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // Экспортируем processChatMessage для scheduler callback
  global.chatProcessMessage = (msgs, sessionId) =>
    processChatMessage(msgs, registry, logger, sessionId, true);

  logger.info(`Всего инструментов: ${registry.getTools().length}`);

  return { app, mcpServer, clientManager, scheduler };
}

function buildChatSystemPrompt(tools) {
  const lines = [
    "Ты — ассистент с доступом к инструментам.",
    "",
    "ПРАВИЛО ЦЕПОЧКИ (CHAIN / PIPELINE):",
    "Если пользователь просит сделать что-то с задержкой (\"через N секунд\", \"через N минут\") — используй create_reminder с callback.",
    "",
    "В callback укажи messages — контекст для LLM, который выполнит задачу после срабатывания.",
    "Пример для запроса \"погода через 10 секунд и сохрани\":",
    'TOOL_CALL: {"tool": "create_reminder", "arguments": {"message": "Запросить погоду и сохранить", "delaySeconds": 10, "callback": {"type": "llm_chat", "messages": [{"role": "system", "content": "Сработало отложенное задание. Шаги: 1) get_weather(city=\\"Челябинск\\"). 2) save_note(title=\\"Погода Челябинск\\", content=результат погоды). 3) Ответь пользователю."}]}}}',
    "",
    "ФОРМАТ ВЫЗОВА ИНСТРУМЕНТА:",
    "TOOL_CALL: {\"tool\": \"имя_инструмента\", \"arguments\": {}}",
    "Без какого-либо дополнительного текста до или после.",
    "",
    "Доступные инструменты:",
  ];

  for (const tool of tools) {
    lines.push(`\n### ${tool.name}`);
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
    "После получения результата инструмента, если цепочка не завершена — используй TOOL_CALL для следующего шага.",
    "Если всё готово — просто ответь пользователю по-русски."
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

async function processChatMessage(messages, toolRegistry, logger, sessionId = null, chainMode = false) {
  const tools = toolRegistry.getTools();
  const systemMsg = buildChatSystemPrompt(tools);

  // Первый вызов LLM
  const reply = await callChatLlm([systemMsg, ...messages]);

  // Поиск TOOL_CALL — ищем первый { и последний } (поддержка вложенного JSON)
  const startIdx = reply.indexOf("{");
  const endIdx = reply.lastIndexOf("}");
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return { reply, toolCalls: [] };
  }

  let callData;
  try {
    callData = JSON.parse(reply.slice(startIdx, endIdx + 1));
  } catch {
    return { reply, toolCalls: [] };
  }

  const { tool: toolName, arguments: args } = callData;
  if (!toolName) {
    return { reply, toolCalls: [] };
  }

  const tool = toolRegistry.getTool(toolName);
  if (!tool) {
    return { reply, toolCalls: [] };
  }

  // Для create_reminder с callback — подставляем sessionId
  if (toolName === "create_reminder" && args?.callback && sessionId) {
    args.callback.sessionId = args.callback.sessionId || sessionId;
  }

  // Вызов инструмента
  logger.info(`Чат -> вызов инструмента: ${toolName}`, args);
  let toolResult;
  try {
    toolResult = await tool.handler(args || {});
  } catch (err) {
    toolResult = {
      content: [{ type: "text", text: `Ошибка: ${err.message}` }],
      isError: true,
    };
  }
  logger.info(`Чат -> результат ${toolName}: успешно`);

  // Второй вызов LLM с результатом инструмента
  const resultText =
    toolResult.content?.map((c) => c.text).join("\n") ||
    JSON.stringify(toolResult);

  // В chainMode разрешаем LLM продолжать TOOL_CALL для следующих шагов
  const followUpInstruction = chainMode
    ? `Был вызван инструмент "${toolName}" с аргументами ${JSON.stringify(args)}.\nРезультат:\n${resultText}\n\nЕсли цепочка не завершена — используй TOOL_CALL для следующего шага. Если всё готово — ответь пользователю по-русски.`
    : `Был вызван инструмент "${toolName}" с аргументами ${JSON.stringify(args)}.\nРезультат:\n${resultText}\n\nОтветь пользователю по-русски. Не используй TOOL_CALL.`;

  const followUpMessages = [
    systemMsg,
    ...messages,
    {
      role: "system",
      content: followUpInstruction,
    },
  ];

  const finalReply = await callChatLlm(followUpMessages);

  // В chainMode проверяем, не хочет ли LLM продолжить цепочку (TOOL_CALL в начале)
  if (chainMode && finalReply.trim().startsWith("TOOL_CALL:")) {
    const nextStart = finalReply.indexOf("{");
    const nextEnd = finalReply.lastIndexOf("}");
    if (nextStart !== -1 && nextEnd > nextStart) {
      try {
        JSON.parse(finalReply.slice(nextStart, nextEnd + 1));
        // Если JSON валидный — рекурсивно продолжаем цепочку
        const nextResult = await processChatMessage(
          [
            ...messages,
            {
              role: "system",
              content: `Шаг "${toolName}" выполнен.\nРезультат:\n${resultText}\n\nПродолжи цепочку.`,
            },
          ],
          toolRegistry,
          logger,
          sessionId,
          true
        );
        return {
          reply: nextResult.reply,
          toolCalls: [
            { tool: toolName, arguments: args || {} },
            ...nextResult.toolCalls,
          ],
        };
      } catch {
        // Невалидный JSON внутри текста — просто возвращаем ответ
      }
    }
  }

  return {
    reply: finalReply,
    toolCalls: [
      {
        tool: toolName,
        arguments: args || {},
      },
    ],
  };
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
