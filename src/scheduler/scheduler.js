export class Scheduler {
  constructor(storage, logger, ctx = null) {
    this.storage = storage;
    this.logger = logger;
    this.ctx = ctx;
    this._interval = null;
    this._runningTasks = new Set();
  }

  start() {
    if (this._interval) return;
    this._interval = setInterval(() => this._checkTasks(), 1000);
    this.logger.info("Планировщик запущен");

    this._checkTasks();
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
      this.logger.info("Планировщик остановлен");
    }
  }

  async _checkTasks() {
    const tasks = await this.storage.getAll();
    const now = Date.now();

    for (const task of tasks) {
      if (task.status !== "pending") continue;
      if (this._runningTasks.has(task.id)) continue;

      if (task.type === "reminder" && task.executeAt <= now) {
        this._runningTasks.add(task.id);
        this._executeReminder(task).finally(() => {
          this._runningTasks.delete(task.id);
        });
      } else if (task.type === "periodic" && task.executeAt <= now) {
        this._runningTasks.add(task.id);
        this._executePeriodic(task).finally(() => {
          this._runningTasks.delete(task.id);
        });
      }
    }
  }

  async _executeReminder(task) {
    this.logger.info(`Выполнение напоминания: ${task.id}`);

    // Сразу блокируем повторный запуск — scheduler тикает каждую секунду
    await this.storage.update(task.id, { status: "running" });

    try {
      // Если есть callback — вызываем LLM-цепочку
      if (task.callback && task.callback.type === "llm_chat" && Array.isArray(task.callback.messages)) {
        const processChat = this.ctx?.chatProcessMessage;
        if (processChat) {
          this.logger.info(`Запуск LLM callback для ${task.id} с ${task.callback.messages.length} сообщениями`);
          let result;
          try {
            result = await processChat(task.callback.messages, task.callback.sessionId || null);
          } catch (err) {
            this.logger.error(`Ошибка LLM callback: ${err.message}`);
            await this.storage.update(task.id, { status: "failed", error: err.message });
            return;
          }

          const toolCalls = result.toolCalls || [];
          this.logger.info(`LLM callback результат: ${toolCalls.length} tool calls, reply: ${(result.reply || "").slice(0, 100)}`);
          if (toolCalls.length === 0) {
            this.logger.warn(`LLM callback вернул 0 tool calls — LLM не вызвала инструменты`);
          }

          const summary = result.reply ? result.reply.slice(0, 200) : "OK";
          const callSummary = result.toolCalls
            ? result.toolCalls.map((tc) => `${tc.tool}(${JSON.stringify(tc.arguments)})`).join(" → ")
            : "—";

          await this.storage.update(task.id, {
            status: "completed",
            completedAt: Date.now(),
            result: `LLM цепочка: ${callSummary}`,
          });

          // Пушим результат в чат через SSE
          if (task.callback.sessionId && this.ctx?.pushToChat) {
            this.ctx.pushToChat(task.callback.sessionId, {
              type: "tool_chain_result",
              toolCalls: result.toolCalls || [],
              reply: result.reply || "",
              taskId: task.id,
            });
          }

          this.logger.info(`LLM callback для ${task.id} выполнен: ${callSummary}`);
          return;
        }
        this.logger.warn("ctx.chatProcessMessage не найден, callback пропущен");
      }
    } catch (err) {
      this.logger.error(`Ошибка LLM callback: ${err.message}`);
    }

    // Стандартное выполнение (без callback или после ошибки)
    await this.storage.update(task.id, {
      status: "completed",
      completedAt: Date.now(),
      result: `Напоминание: ${task.message}`,
    });
  }

  async _executePeriodic(task) {
    this.logger.info(`Выполнение периодической задачи: ${task.id}`);

    const runCount = (task.runCount || 0) + 1;
    const result = `Запуск #${runCount}: ${task.message}`;
    const execution = { timestamp: Date.now(), result };
    const executions = [...(task.executions || []), execution];

    if (task.maxRuns && runCount >= task.maxRuns) {
      await this.storage.update(task.id, {
        status: "completed",
        runCount,
        executions,
        lastResult: result,
        completedAt: Date.now(),
      });
      this.logger.info(`Периодическая задача ${task.id} завершена (достигнут лимит)`);
    } else {
      const nextExecuteAt = Date.now() + (task.intervalMs || 10000);
      await this.storage.update(task.id, {
        executeAt: nextExecuteAt,
        runCount,
        executions,
        lastResult: result,
      });
    }
  }
}
