import { Router } from "express";

export function createRouter(ctx) {
  const router = Router();
  const { registry, storage, logger } = ctx;

  router.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  router.get("/tools", (req, res) => {
    const tools = registry.getTools().map((t) => ({
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

    const tool = registry.getTool(name);
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

  router.get("/scheduler/tasks", async (req, res) => {
    if (!storage) {
      return res.status(503).json({ error: "Планировщик не инициализирован" });
    }
    const tasks = await storage.getAll();
    res.json(tasks);
  });

  // Админ: очистить папку заметок
  router.post("/admin/clear-notes", async (req, res) => {
    try {
      const { readdir, unlink } = await import("fs/promises");
      const { join, dirname } = await import("path");
      const { fileURLToPath } = await import("url");
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const notesDir = join(__dirname, "..", "..", "notes");

      let deleted = 0;
      try {
        const files = await readdir(notesDir);
        for (const f of files) {
          await unlink(join(notesDir, f));
          deleted++;
        }
      } catch {
        // папки нет — ок
      }

      logger.info(`Очищено заметок: ${deleted}`);
      res.json({ success: true, deleted });
    } catch (err) {
      logger.error(`Ошибка очистки заметок: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // Админ: очистить файл планировщика
  router.post("/admin/clear-scheduler", async (req, res) => {
    if (!storage) {
      return res.status(503).json({ error: "Планировщик не инициализирован" });
    }

    try {
      const tasks = await storage.getAll();
      const deleted = tasks.length;

      for (const task of tasks) {
        await storage.delete(task.id);
      }

      logger.info(`Очищено задач: ${deleted}`);
      res.json({ success: true, deleted });
    } catch (err) {
      logger.error(`Ошибка очистки планировщика: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
