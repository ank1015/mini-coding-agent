/**
 * Remote control system for the coding agent.
 *
 * Allows controlling the agent from external messaging platforms
 * (Discord, Slack, Telegram, etc.)
 */

export { RemoteAgent, type RemoteAgentConfig } from "./remote-agent.js";
export { RemoteServer, type RemoteServerConfig } from "./remote-server.js";
export { MockServer, type MockServerConfig } from "./mock-server.js";
export type { MessageHandler, RemoteAttachment, RemoteMessage, RemoteResponse } from "./types.js";
