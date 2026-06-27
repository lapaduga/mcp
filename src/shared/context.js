export class AppContext {
  constructor() {
    this.logger = null;
    this.registry = null;
    this.storage = null;
    this.scheduler = null;
    this.clientManager = null;
    this.chatClients = new Map();
    this.chatProcessMessage = null;
  }

  pushToChat(sessionId, data) {
    const client = this.chatClients.get(sessionId);
    if (client) {
      try {
        client.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (err) {
        this.logger?.warn(`SSE send error: ${err.message}`);
      }
    }
  }
}
