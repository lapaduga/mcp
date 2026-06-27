import dotenv from "dotenv";

dotenv.config();

function parseExternalServers() {
  const enabled = process.env.MCP_EXTERNAL_ENABLED !== "false";
  if (!enabled) return [];

  const servers = [];

  // Формат одной строки: "id,command,arg1,arg2" — несколько серверов через ";"
  // Пример: MCP_EXTERNAL_SERVERS="everything,npx,-y,@modelcontextprotocol/server-everything;weather,npx,-y,@modelcontextprotocol/server-weather"
  const multiConfig = (process.env.MCP_EXTERNAL_SERVERS || "").trim();
  if (multiConfig) {
    for (const entry of multiConfig.split(";")) {
      const parts = entry.split(",");
      if (parts.length >= 2) {
        const [id, command, ...args] = parts;
        if (!servers.find((s) => s.id === id)) {
          servers.push({ id, command, args: args.filter(Boolean) });
        }
      }
    }
  }

  // Legacy single-server формат (для обратной совместимости)
  if (process.env.MCP_EXTERNAL_COMMAND) {
    const id = process.env.MCP_EXTERNAL_ID || "external";
    if (!servers.find((s) => s.id === id)) {
      servers.push({
        id,
        command: process.env.MCP_EXTERNAL_COMMAND,
        args: (process.env.MCP_EXTERNAL_ARGS || "")
          .split(",")
          .filter(Boolean),
      });
    }
  }

  // По умолчанию — @modelcontextprotocol/server-everything
  if (servers.length === 0) {
    servers.push({
      id: "everything",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-everything"],
    });
  }

  return servers;
}

export const config = Object.freeze({
  port: parseInt(process.env.PORT || "3000", 10),
  logLevel: process.env.LOG_LEVEL || "info",
  mcpTransport: process.env.MCP_TRANSPORT || "sse",
  externalMcpServers: parseExternalServers(),
  chatApiKey: process.env.CHAT_API_KEY || "",
  chatModel: process.env.CHAT_MODEL || "deepseek-chat",
  chatBaseUrl: (process.env.CHAT_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, ""),
});
