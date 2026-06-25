import { Router } from "express";
import Logger from "../shared/logger.js";

const logger = new Logger();

export function createRouter(toolRegistry) {
  const router = Router();

  router.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  router.get("/tools", (req, res) => {
    const tools = toolRegistry.getTools().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      isExternal: t.isExternal ?? false,
      source: t.source ?? null,
    }));
    res.json(tools);
  });

  router.post("/tools/:name/call", async (req, res) => {
    const { name } = req.params;
    const args = req.body ?? {};

    const tool = toolRegistry.getTool(name);
    if (!tool) {
      return res.status(404).json({ error: `Инструмент не найден: ${name}` });
    }

    try {
      logger.info(`Вызов инструмента: ${name}`, args);
      const result = await tool.handler(args);
      logger.info(`Результат инструмента ${name}: успешно`);
      res.json(result);
    } catch (err) {
      logger.error(`Ошибка вызова инструмента ${name}: ${err.message}`);
      res.status(400).json({
        error: err.message,
        content: [{ type: "text", text: `Ошибка: ${err.message}` }],
        isError: true,
      });
    }
  });

  return router;
}
