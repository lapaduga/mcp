export const name = "get_summary";

export const description = "Возвращает агрегированную сводку по всем задачам планировщика";

export const inputSchema = {
  type: "object",
  properties: {},
  required: [],
};

export async function handler() {
  const storage = global.storageInstance;

  if (!storage) {
    throw new Error("Планировщик не инициализирован");
  }

  const tasks = await storage.getAll();
  const completed = tasks.filter((t) => t.status === "completed");
  const pending = tasks.filter((t) => t.status === "pending");
  const reminders = tasks.filter((t) => t.type === "reminder");
  const periodic = tasks.filter((t) => t.type === "periodic");
  const periodicExecutions = periodic.reduce(
    (sum, t) => sum + (t.executions?.length || 0),
    0
  );

  const lines = [
    `СВОДКА ПЛАНИРОВЩИКА`,
    "",
    `Всего задач: ${tasks.length}`,
    `  Напоминаний: ${reminders.length} (выполнено: ${reminders.filter((t) => t.status === "completed").length})`,
    `  Периодических: ${periodic.length} (запусков: ${periodicExecutions})`,
    `Ожидают выполнения: ${pending.length}`,
    `Выполнено: ${completed.length}`,
    `Последние выполнения:`,
  ];

  const recent = tasks
    .filter((t) => t.status === "completed" || t.lastResult)
    .slice(-5)
    .reverse();

  for (const t of recent) {
    const time = t.completedAt
      ? new Date(t.completedAt).toLocaleTimeString()
      : new Date(
          t.executions?.[t.executions.length - 1]?.timestamp
        ).toLocaleTimeString();
    lines.push(
      `  [${time}] ${t.type}: ${t.message} \u2192 ${t.result || t.lastResult}`
    );
  }

  if (recent.length === 0) {
    lines.push("  (пока нет выполнений)");
  }

  return {
    content: [
      {
        type: "text",
        text: lines.join("\n"),
      },
    ],
  };
}
