import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

export function createMcpServer(toolRegistry) {
  const server = new Server(
    {
      name: "mcp-tools-hub",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = toolRegistry.getTools();
    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = toolRegistry.getTool(name);

    if (!tool) {
      throw new Error(`Инструмент не найден: ${name}`);
    }

    try {
      const result = await tool.handler(args);
      return { content: result.content };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Ошибка: ${err.message}` }],
        isError: true,
      };
    }
  });

  return server;
}
