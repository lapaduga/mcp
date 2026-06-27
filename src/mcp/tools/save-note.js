export const name = "save_note";

export const description = "Сохраняет текстовую заметку в файл на сервере в папку notes/";

export const inputSchema = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "Заголовок заметки (будет частью имени файла)",
    },
    content: {
      type: "string",
      description: "Содержимое заметки",
    },
  },
  required: ["title", "content"],
};

export async function handler(args) {
  const { title, content } = args ?? {};

  if (!title || !content) {
    throw new Error("Поля 'title' и 'content' обязательны для заполнения");
  }

  const fs = await import("fs/promises");
  const path = await import("path");
  const { fileURLToPath } = await import("url");

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const notesDir = path.resolve(__dirname, "..", "..", "..", "notes");
  await fs.mkdir(notesDir, { recursive: true });

  const safeName = title.replace(/[^a-zA-Zа-яА-Я0-9\s_-]/g, "").replace(/\s+/g, "_");
  const filename = path.join(notesDir, `${Date.now()}_${safeName}.md`);
  const header = `# ${title}\n\nСоздано: ${new Date().toLocaleString("ru-RU")}\n\n---\n\n`;
  await fs.writeFile(filename, header + content, "utf-8");

  return {
    content: [
      {
        type: "text",
        text: `Заметка сохранена: ${filename}\nЗаголовок: ${title}\nРазмер: ${content.length} символов`,
      },
    ],
  };
}
