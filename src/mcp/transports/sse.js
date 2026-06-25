import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

export function setupSseTransport(app, mcpServer, logger) {
  const transports = new Map();

  app.get("/mcp/sse", async (req, res) => {
    try {
      const transport = new SSEServerTransport("/mcp/message", res);
      transports.set(transport.sessionId, transport);

      res.on("close", () => {
        transports.delete(transport.sessionId);
        logger.info(`SSE соединение закрыто: ${transport.sessionId}`);
      });

      await mcpServer.connect(transport);
      logger.info(`SSE соединение установлено: ${transport.sessionId}`);
    } catch (err) {
      logger.error(`Ошибка SSE подключения: ${err.message}`);
      if (!res.headersSent) {
        res.status(500).end();
      }
    }
  });

  app.post("/mcp/message", async (req, res) => {
    const sessionId = req.query.sessionId;
    const transport = transports.get(sessionId);

    if (!transport) {
      res.writeHead(404).end("Транспорт не найден");
      return;
    }

    try {
      await transport.handlePostMessage(req, res, req.body);
    } catch (err) {
      logger.error(`Ошибка обработки MCP сообщения: ${err.message}`);
      if (!res.headersSent) {
        res.status(500).end();
      }
    }
  });

  return transports;
}
