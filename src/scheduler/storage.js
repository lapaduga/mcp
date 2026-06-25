import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");
const STORAGE_FILE = join(DATA_DIR, "scheduler.json");

export class TaskStorage {
  constructor(logger) {
    this.logger = logger;
    this._tasks = [];
    this._saveTimer = null;
    this._ready = this._init();
  }

  async _init() {
    try {
      await mkdir(DATA_DIR, { recursive: true });
      const raw = await readFile(STORAGE_FILE, "utf-8");
      this._tasks = JSON.parse(raw);
      this.logger.info(`Загружено задач из хранилища: ${this._tasks.length}`);
    } catch {
      this._tasks = [];
      await this._save();
      this.logger.info("Создано новое хранилище задач");
    }
  }

  async _save() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(async () => {
      await writeFile(STORAGE_FILE, JSON.stringify(this._tasks, null, 2));
      this._saveTimer = null;
    }, 100);
  }

  async getAll() {
    await this._ready;
    return [...this._tasks];
  }

  async add(task) {
    await this._ready;
    this._tasks.push(task);
    await this._save();
  }

  async update(id, updates) {
    await this._ready;
    const idx = this._tasks.findIndex((t) => t.id === id);
    if (idx >= 0) {
      this._tasks[idx] = { ...this._tasks[idx], ...updates };
      await this._save();
    }
  }

  async delete(id) {
    await this._ready;
    this._tasks = this._tasks.filter((t) => t.id !== id);
    await this._save();
  }

  async getCompleted() {
    await this._ready;
    return this._tasks.filter((t) => t.status === "completed");
  }
}
