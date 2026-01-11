/**
 * Remote control system for the coding agent.
 *
 * Allows controlling the agent from external messaging platforms
 * (Discord, Slack, Telegram, etc.)
 */

export { RemoteAgent, type RemoteAgentConfig } from "./remote-agent.js";
export { RemoteServer, type RemoteServerConfig } from "./remote-server.js";
export type { MessageHandler, RemoteAttachment, RemoteMessage, RemoteResponse } from "./types.js";

// Platform-specific servers
export {
	MockServer,
	type MockServerConfig,
	DiscordServer,
	type DiscordServerConfig,
	SlackServer,
	type SlackServerConfig,
} from "./servers/index.js";
