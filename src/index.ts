/**
 * Public API exports for @ank1015/mini-coding-agent
 *
 * This file defines the public API surface for programmatic usage of the agent.
 */

// Core SDK
export {
	createAgentSession,
	type CreateAgentSessionOptions,
	type CreateAgentSessionResult,
	// Tools
	readTool,
	bashTool,
	editTool,
	writeTool,
	grepTool,
	findTool,
	lsTool,
	codingTools,
	readOnlyTools,
	allBuiltInTools,
	// Tool factories
	createCodingTools,
	createReadOnlyTools,
	createReadTool,
	createBashTool,
	createEditTool,
	createWriteTool,
	createGrepTool,
	createFindTool,
	createLsTool,
	// Helpers
	discoverAvailableModels,
	findModel,
	defaultGetApiKey,
	buildSystemPrompt,
	type BuildSystemPromptOptions,
	loadSettings,
	// Types
	type Settings,
	type Tool,
} from "./core/sdk.js";

// Core classes for advanced usage
export { AgentSession, type AgentSessionConfig, type PromptOptions, type SessionStats } from "./core/agent-session.js";
export { SessionManager, type SessionInfo, type LoadedSession } from "./core/session-manager.js";
export { SettingsManager } from "./core/settings-manager.js";

// Re-export provider types for convenience
export type { Api, Model, Provider, Message, Attachment, OptionsForApi } from "@ank1015/providers";
