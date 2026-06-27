export const name = "create_reminder";

export const description = "Создаёт напоминание, которое сработает через указанное количество секунд. Поддерживает callback-цепочку для отложенного вызова других инструментов.";

export const inputSchema = {
  type: "object",
  properties: {
    message: {
      type: "string",
      description: "Текст напоминания",
    },
    delaySeconds: {
      type: "integer",
      description: "Через сколько секунд сработать (1-3600)",
      minimum: 1,
      maximum: 3600,
    },
    callback: {
      type: "object",
      description: "НАСТОЯТЕЛЬНО РЕКОМЕНДУЕТСЯ: если пользователь просит сделать что-то с задержкой, создай callback с контекстом задачи, которая должна выполниться после срабатывания напоминания",
      properties: {
        type: {
          type: "string",
          description: "Всегда 'llm_chat'",
          enum: ["llm_chat"],
        },
        messages: {
          type: "array",
          description: "Массив сообщений с контекстом для LLM при срабатывании. Первое сообщение должно быть system: 'Сработало отложенное задание. Выполни следующие шаги по порядку: ...'",
        },
      },
    },
  },
  required: ["message", "delaySeconds"],
};

const DEFAULT_SYSTEM_PROMPT = "Ты — ассистент с доступом к инструментам. Выполни задачу пользователя, вызвав нужные инструменты через TOOL_CALL: {\"tool\":\"имя\",\"arguments\":{}}. После получения результата ответь пользователю по-русски.";

export async function handler(args) {
  const { message, delaySeconds, callback } = args ?? {};
  const storage = global.storageInstance;
  const scheduler = global.schedulerInstance;

  if (!storage || !scheduler) {
    throw new Error("Планировщик не инициализирован");
  }

  if (!delaySeconds || delaySeconds < 1 || delaySeconds > 3600) {
    throw new Error("delaySeconds должен быть от 1 до 3600");
  }

  // Авто-обертка callback: если нет system-сообщения — добавляем (immutable)
  let processedCallback = callback || null;
  if (processedCallback?.type === "llm_chat" && Array.isArray(processedCallback.messages)) {
    const hasSystem = processedCallback.messages.some((m) => m.role === "system");
    if (!hasSystem) {
      processedCallback = {
        ...processedCallback,
        messages: [
          { role: "system", content: DEFAULT_SYSTEM_PROMPT },
          ...processedCallback.messages,
        ],
      };
    }
  }

  const id = "reminder_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
  const executeAt = Date.now() + delaySeconds * 1000;

  await storage.add({
    id,
    type: "reminder",
    message,
    delaySeconds,
    executeAt,
    status: "pending",
    createdAt: Date.now(),
    callback: processedCallback,
  });

  const hasCallback = processedCallback?.type === "llm_chat" && Array.isArray(processedCallback.messages);
  const chainText = hasCallback
    ? `\nCallback-цепочка активирована (${processedCallback.messages.length} сообщений контекста)`
    : "";

  return {
    content: [
      {
        type: "text",
        text: `Напоминание создано (ID: ${id})\nСработает через ${delaySeconds} сек. (${new Date(executeAt).toLocaleTimeString()})\nТекст: ${message}${chainText}`,
      },
    ],
  };
}
