import { readdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import Logger from "../../shared/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const logger = new Logger();

/*
  Выбран подход с динамическим импортом (readdir + import()).
  Это позволяет добавлять новые инструменты простым созданием файла в папке tools/
  без необходимости регистрировать их вручную в коде ядра.
  Недостаток: асинхронная загрузка. Преимущество: масштабирование без изменения кода.
*/
class ToolRegistry {
  constructor() {
    this._localTools = new Map();
    this._externalTools = new Map();
    this._clientManager = null;
  }

  setClientManager(cm) {
    this._clientManager = cm;
  }

  async loadTools() {
    const files = await readdir(__dirname);
    const jsFiles = files.filter(
      (f) => f.endsWith(".js") && f !== "registry.js"
    );

    for (const file of jsFiles) {
      try {
        const modulePath = `./${file}`;
        const mod = await import(modulePath);
        if (mod.name && typeof mod.handler === "function") {
          this._localTools.set(mod.name, {
            name: mod.name,
            description: mod.description ?? "",
            inputSchema: mod.inputSchema ?? { type: "object", properties: {} },
            handler: mod.handler,
            isExternal: false,
          });
          logger.info(`Зарегистрирован локальный инструмент: ${mod.name}`);
        }
      } catch (err) {
        logger.error(`Ошибка загрузки инструмента ${file}: ${err.message}`);
      }
    }

    return this.getTools();
  }

  async loadExternalTools(serverConfigs) {
    if (!this._clientManager) {
      logger.warn("McpClientManager не установлен, внешние инструменты недоступны");
      return [];
    }

    const allExternalTools = [];

    for (const server of serverConfigs) {
      try {
        const tools = await this._clientManager.connectServer(
          server.id,
          server.command,
          server.args
        );

        for (const tool of tools) {
          // Локальный инструмент имеет приоритет при конфликте имён
          if (this._localTools.has(tool.name)) {
            logger.warn(
              `Конфликт имён: внешний инструмент "${tool.name}" (сервер: ${server.id}) ` +
              `переопределён локальным инструментом`
            );
            continue;
          }

          // Оборачиваем handler для проксирования вызова на внешний сервер
          const wrappedTool = {
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            source: server.id,
            isExternal: true,
            handler: async (args) => {
              return this._clientManager.callTool(server.id, tool.name, args);
            },
          };

          this._externalTools.set(tool.name, wrappedTool);
          allExternalTools.push(wrappedTool);
        }
      } catch (err) {
        logger.error(
          `Ошибка подключения к внешнему серверу ${server.id}: ${err.message}`
        );
      }
    }

    logger.info(
      `Загружено внешних инструментов: ${allExternalTools.length}`
    );
    return allExternalTools;
  }

  getTools() {
    return [
      ...Array.from(this._localTools.values()),
      ...Array.from(this._externalTools.values()),
    ];
  }

  getTool(name) {
    return this._localTools.get(name) ?? this._externalTools.get(name) ?? null;
  }
}

export const registry = new ToolRegistry();
