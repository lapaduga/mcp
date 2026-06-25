const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const NAMES = { 0: "DEBUG", 1: "INFO", 2: "WARN", 3: "ERROR" };

class Logger {
  constructor(level = "info") {
    this.currentLevel = LEVELS[level] ?? 1;
  }

  #format(level, message) {
    const time = new Date().toLocaleTimeString("ru-RU", { hour12: false });
    return `[${time}] [${NAMES[level]}] ${message}`;
  }

  debug(message, ...args) {
    if (this.currentLevel <= 0) console.debug(this.#format(0, message), ...args);
  }

  info(message, ...args) {
    if (this.currentLevel <= 1) console.info(this.#format(1, message), ...args);
  }

  warn(message, ...args) {
    if (this.currentLevel <= 2) console.warn(this.#format(2, message), ...args);
  }

  error(message, ...args) {
    if (this.currentLevel <= 3) console.error(this.#format(3, message), ...args);
  }
}

export default Logger;
