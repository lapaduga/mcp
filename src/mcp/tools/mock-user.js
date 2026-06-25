export const name = "get_user";

export const description = "Получает информацию о пользователе по ID из mock API (jsonplaceholder)";

export const inputSchema = {
  type: "object",
  properties: {
    userId: {
      type: "integer",
      description: "ID пользователя (1-10)",
      minimum: 1,
      maximum: 10,
    },
  },
  required: ["userId"],
};

export async function handler(args) {
  const { userId } = args ?? {};

  if (!userId) {
    throw new Error("Поле 'userId' обязательно для заполнения");
  }

  try {
    const response = await fetch(
      `https://jsonplaceholder.typicode.com/users/${userId}`
    );

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Пользователь с ID ${userId} не найден`);
      }
      throw new Error(`API вернул статус ${response.status}`);
    }

    const data = await response.json();

    const result = [
      `Пользователь #${data.id}`,
      `Имя: ${data.name}`,
      `Username: ${data.username}`,
      `Email: ${data.email}`,
      `Телефон: ${data.phone}`,
      `Сайт: ${data.website}`,
      `Город: ${data.address.city}`,
      `Компания: ${data.company.name}`,
    ].join("\n");

    return {
      content: [
        {
          type: "text",
          text: result,
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `Ошибка при получении пользователя: ${err.message}`,
        },
      ],
      isError: true,
    };
  }
}
