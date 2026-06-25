export const name = "hello_world";

export const description = "Приветствует пользователя по имени";

export const inputSchema = {
  type: "object",
  properties: {
    name: {
      type: "string",
      description: "Имя пользователя",
    },
  },
  required: ["name"],
};

export async function handler(args) {
  const { name: userName } = args ?? {};
  if (!userName) {
    throw new Error("Поле 'name' обязательно для заполнения");
  }
  return {
    content: [
      {
        type: "text",
        text: `Привет, ${userName}! Добро пожаловать в MCP Tools Hub.`,
      },
    ],
  };
}
