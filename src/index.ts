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
export { SettingsManager } from "./core/settings-manager.js";

// New tree-based session manager
export {
	SessionTree,
	type TreeHeader,
	type TreeNode,
	type TreeEntry,
	type MessageNode,
	type ProviderNode,
	type SummaryNode,
	type MergeNode,
	type CheckpointNode,
	type CustomNode,
	type ActiveBranch,
	type ContextStrategy,
	type SessionInfo as TreeSessionInfo,
	type BranchInfo,
} from "./core/session-tree.js";

// Re-export provider types for convenience
export type { Api, Model, Provider, Message, Attachment, OptionsForApi } from "@ank1015/providers";

// RPC mode for headless operation
export {
	RpcClient,
	type RpcClientOptions,
	type RpcEventListener,
	type ModelInfo,
	type SessionInfo,
	type RpcCommand,
	type RpcCommandType,
	type RpcResponse,
	type RpcSessionState,
} from "./modes/rpc/index.js";

// Remote control for messaging platforms
export {
	RemoteAgent,
	RemoteServer,
	MockServer,
	DiscordServer,
	type RemoteAgentConfig,
	type RemoteServerConfig,
	type MockServerConfig,
	type DiscordServerConfig,
	type RemoteMessage,
	type RemoteAttachment,
	type RemoteResponse,
	type MessageHandler,
} from "./remote/index.js";

export * from './evals/index.js'