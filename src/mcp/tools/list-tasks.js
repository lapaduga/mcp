export const name = "list_tasks";

export const description = "Возвращает список всех задач планировщика";

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

  if (tasks.length === 0) {
    return { content: [{ type: "text", text: "Нет задач" }] };
  }

  const lines = tasks.map((t) => {
    const status = t.status === "completed" ? "[x]" : "[ ]";
    const type = t.type === "reminder" ? "Напоминание" : "Периодическая";
    const next = t.executeAt
      ? new Date(t.executeAt).toLocaleTimeString()
      : "\u2014";
    return `${status} [${type}] ${t.message} | Следующий запуск: ${next}`;
  });

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}
