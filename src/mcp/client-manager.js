import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export class McpClientManager {
  constructor(logger) {
    this._clients = new Map();
    this.logger = logger;
  }

  async connectServer(id, command, args) {
    this.logger.info(`Подключение к внешнему MCP-серверу: ${id} (${command} ${args.join(" ")})`);

    const transport = new StdioClientTransport({
      command,
      args,
    });

    const client = new Client(
      {
        name: "mcp-tools-hub-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );

    await client.connect(transport);

    const result = await client.listTools();
    const tools = (result.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema ?? { type: "object", properties: {} },
      source: id,
      isExternal: true,
    }));

    this._clients.set(id, { client, transport, tools });
    this.logger.info(
      `Подключено к внешнему MCP-серверу ${id}, получено инструментов: ${tools.length}`
    );

    return tools;
  }

  async healthCheck(id) {
    const entry = this._clients.get(id);
    if (!entry) return false;
    try {
      await entry.client.listTools();
      return true;
    } catch {
      return false;
    }
  }

  async disconnectAll() {
    for (const [id, { client }] of this._clients) {
      try {
        await client.close();
        this.logger.info(`MCP-клиент отключён: ${id}`);
      } catch (err) {
        this.logger.error(`Ошибка закрытия клиента ${id}: ${err.message}`);
      }
    }
    this._clients.clear();
  }

  async callTool(id, toolName, args) {
    const entry = this._clients.get(id);
    if (!entry) {
      throw new Error(`Внешний MCP-сервер не найден: ${id}`);
    }
    return entry.client.callTool({
      name: toolName,
      arguments: args,
    });
  }

  isConnected(id) {
    return this._clients.has(id);
  }

  getConnectedServers() {
    return Array.from(this._clients.keys());
  }
}
