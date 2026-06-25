export const name = "create_periodic_task";

export const description = "Создаёт периодическую задачу, которая выполняется с заданным интервалом";

export const inputSchema = {
  type: "object",
  properties: {
    message: {
      type: "string",
      description: "Название/описание задачи",
    },
    intervalSeconds: {
      type: "integer",
      description: "Интервал в секундах (5-300)",
      minimum: 5,
      maximum: 300,
    },
    maxRuns: {
      type: "integer",
      description: "Максимальное количество запусков (1-100, опционально)",
      minimum: 1,
      maximum: 100,
    },
  },
  required: ["message", "intervalSeconds"],
};

export async function handler(args) {
  const { message, intervalSeconds, maxRuns } = args ?? {};
  const storage = global.storageInstance;

  if (!storage) {
    throw new Error("Планировщик не инициализирован");
  }

  const id = "periodic_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
  const intervalMs = intervalSeconds * 1000;
  const executeAt = Date.now() + intervalMs;

  await storage.add({
    id,
    type: "periodic",
    message,
    intervalSeconds,
    intervalMs,
    maxRuns: maxRuns || null,
    executeAt,
    status: "pending",
    runCount: 0,
    executions: [],
    createdAt: Date.now(),
  });

  return {
    content: [
      {
        type: "text",
        text: `Периодическая задача создана (ID: ${id})\nИнтервал: ${intervalSeconds} сек.\nПервый запуск: ${new Date(executeAt).toLocaleTimeString()}\nОписание: ${message}`,
      },
    ],
  };
}
