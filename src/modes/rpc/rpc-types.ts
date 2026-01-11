/**
 * RPC protocol types for headless operation.
 *
 * Commands are sent as JSON lines on stdin.
 * Responses and events are emitted as JSON lines on stdout.
 */

import type { Api, Attachment, Message, OptionsForApi } from "@ank1015/providers";
import type { SessionStats } from "../../core/agent-session.js";
import type { BranchInfo } from "../../core/session-tree.js";

// ============================================================================
// RPC Commands (stdin)
// ============================================================================

export type RpcCommand =
	// Prompting
	| { id?: string; type: "prompt"; message: string; attachments?: Attachment[] }
	| { id?: string; type: "queue_message"; message: string }
	| { id?: string; type: "abort" }
	| { id?: string; type: "reset" }

	// State
	| { id?: string; type: "get_state" }
	| { id?: string; type: "get_messages" }

	// Model
	| { id?: string; type: "set_model"; api: string; modelId: string }
	| { id?: string; type: "get_available_models" }

	// Thinking (for OpenAI/Google models)
	| { id?: string; type: "set_thinking_level"; level: "low" | "high" }

	// Queue mode
	| { id?: string; type: "set_queue_mode"; mode: "all" | "one-at-a-time" }

	// Compaction
	| { id?: string; type: "compact"; keepRecent?: number }

	// Session
	| { id?: string; type: "get_session_stats" }
	| { id?: string; type: "export_html"; outputPath?: string }
	| { id?: string; type: "switch_session"; sessionPath: string }
	| { id?: string; type: "list_sessions" }

	// Branches
	| { id?: string; type: "create_branch"; name: string; fromNodeId?: string }
	| { id?: string; type: "switch_branch"; name: string }
	| { id?: string; type: "branch_and_switch"; name: string; fromNodeId?: string }
	| { id?: string; type: "list_branches" }
	| { id?: string; type: "merge_branch"; fromBranch: string }

	// Checkpoints
	| { id?: string; type: "create_checkpoint"; name: string; metadata?: Record<string, unknown> };

// ============================================================================
// RPC State
// ============================================================================

export interface RpcSessionState {
	model: { api: string; modelId: string; providerOptions: OptionsForApi<Api> } | null;
	isStreaming: boolean;
	queueMode: "all" | "one-at-a-time";
	sessionFile: string | null;
	sessionId: string;
	activeBranch: string;
	branches: string[];
	messageCount: number;
	queuedMessageCount: number;
}

// ============================================================================
// RPC Responses (stdout)
// ============================================================================

export type RpcResponse =
	// Prompting (async - events follow)
	| { id?: string; type: "response"; command: "prompt"; success: true }
	| { id?: string; type: "response"; command: "queue_message"; success: true }
	| { id?: string; type: "response"; command: "abort"; success: true }
	| { id?: string; type: "response"; command: "reset"; success: true }

	// State
	| { id?: string; type: "response"; command: "get_state"; success: true; data: RpcSessionState }
	| { id?: string; type: "response"; command: "get_messages"; success: true; data: { messages: Message[] } }

	// Model
	| { id?: string; type: "response"; command: "set_model"; success: true; data: { api: string; modelId: string } }
	| { id?: string; type: "response"; command: "get_available_models"; success: true; data: { models: Array<{ api: string; id: string; contextWindow: number; reasoning: boolean }> } }

	// Thinking
	| { id?: string; type: "response"; command: "set_thinking_level"; success: true }

	// Queue mode
	| { id?: string; type: "response"; command: "set_queue_mode"; success: true }

	// Compaction
	| { id?: string; type: "response"; command: "compact"; success: true }

	// Session
	| { id?: string; type: "response"; command: "get_session_stats"; success: true; data: SessionStats }
	| { id?: string; type: "response"; command: "export_html"; success: true; data: { path: string } }
	| { id?: string; type: "response"; command: "switch_session"; success: true }
	| { id?: string; type: "response"; command: "list_sessions"; success: true; data: { sessions: Array<{ file: string; id: string; created: string; modified: string; messageCount: number; firstMessage: string }> } }

	// Branches
	| { id?: string; type: "response"; command: "create_branch"; success: true }
	| { id?: string; type: "response"; command: "switch_branch"; success: true }
	| { id?: string; type: "response"; command: "branch_and_switch"; success: true; data: BranchInfo }
	| { id?: string; type: "response"; command: "list_branches"; success: true; data: { branches: BranchInfo[] } }
	| { id?: string; type: "response"; command: "merge_branch"; success: true }

	// Checkpoints
	| { id?: string; type: "response"; command: "create_checkpoint"; success: true }

	// Error response (any command can fail)
	| { id?: string; type: "response"; command: string; success: false; error: string };

// ============================================================================
// Helper type for extracting command types
// ============================================================================

export type RpcCommandType = RpcCommand["type"];
