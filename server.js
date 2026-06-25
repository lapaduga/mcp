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

const __dirname = dirname(fileURLToPath(import.meta.url));
const logger = new Logger(config.logLevel);

export async function createApp() {
  const clientManager = new McpClientManager(logger);
  registry.setClientManager(clientManager);

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

  logger.info(`Всего инструментов: ${registry.getTools().length}`);

  return { app, mcpServer, clientManager };
}

async function main() {
  const { app, clientManager } = await createApp();

  const server = app.listen(config.port, () => {
    logger.info(`Сервер запущен на http://localhost:${config.port}`);
  });

  const shutdown = async (signal) => {
    logger.info(`Получен сигнал ${signal}, завершение работы...`);

    await clientManager.disconnectAll();

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
