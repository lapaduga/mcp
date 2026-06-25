export class Scheduler {
  constructor(storage, logger) {
    this.storage = storage;
    this.logger = logger;
    this._interval = null;
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

      if (task.type === "reminder" && task.executeAt <= now) {
        await this._executeReminder(task);
      } else if (task.type === "periodic" && task.executeAt <= now) {
        await this._executePeriodic(task);
      }
    }
  }

  async _executeReminder(task) {
    this.logger.info(`Выполнение напоминания: ${task.id}`);
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
