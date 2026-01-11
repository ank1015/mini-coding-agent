/**
 * RPC mode: Headless operation with JSON stdin/stdout protocol.
 *
 * Used for embedding the agent in other applications (IDE plugins, GUIs, bots).
 * Receives commands as JSON on stdin, outputs events and responses as JSON on stdout.
 *
 * Protocol:
 * - Commands: JSON objects with `type` field, optional `id` for correlation
 * - Responses: JSON objects with `type: "response"`, `command`, `success`, and optional `data`/`error`
 * - Events: AgentSessionEvent objects streamed as they occur
 */

import * as readline from "readline";
import type { AgentSession } from "../../core/agent-session.js";
import { SessionTree } from "../../core/session-tree.js";
import { discoverAvailableModels, findModel } from "../../core/sdk.js";
import type { RpcCommand, RpcResponse, RpcSessionState } from "./rpc-types.js";

// Re-export types for consumers
export type { RpcCommand, RpcResponse, RpcSessionState } from "./rpc-types.js";

/**
 * Run in RPC mode.
 * Listens for JSON commands on stdin, outputs events and responses on stdout.
 */
export async function runRpcMode(session: AgentSession): Promise<never> {
	const output = (obj: RpcResponse | object) => {
		console.log(JSON.stringify(obj));
	};

	const success = <T extends RpcCommand["type"]>(
		id: string | undefined,
		command: T,
		data?: object | null
	): RpcResponse => {
		if (data === undefined) {
			return { id, type: "response", command, success: true } as RpcResponse;
		}
		return { id, type: "response", command, success: true, data } as RpcResponse;
	};

	const error = (id: string | undefined, command: string, message: string): RpcResponse => {
		return { id, type: "response", command, success: false, error: message };
	};

	// Output all agent events as JSON
	session.subscribe((event) => {
		output(event);
	});

	// Handle a single command
	const handleCommand = async (command: RpcCommand): Promise<RpcResponse> => {
		const id = command.id;

		try {
			switch (command.type) {
				// =============================================================
				// Prompting
				// =============================================================

				case "prompt": {
					// Don't await - events will stream
					session
						.prompt(command.message, { attachments: command.attachments })
						.catch((e) => output(error(id, "prompt", e instanceof Error ? e.message : String(e))));
					return success(id, "prompt");
				}

				case "queue_message": {
					await session.queueMessage(command.message);
					return success(id, "queue_message");
				}

				case "abort": {
					await session.abort();
					return success(id, "abort");
				}

				case "reset": {
					await session.reset();
					return success(id, "reset");
				}

				// =============================================================
				// State
				// =============================================================

				case "get_state": {
					const model = session.model;
					const state: RpcSessionState = {
						model: model ? { api: model.api, modelId: model.id, providerOptions: session.providerOptions } : null,
						isStreaming: session.isStreaming,
						queueMode: session.queueMode,
						sessionFile: session.sessionFile,
						sessionId: session.sessionId,
						activeBranch: session.activeBranch,
						branches: session.branches,
						messageCount: session.messages.length,
						queuedMessageCount: session.queuedMessageCount,
					};
					return success(id, "get_state", state);
				}

				case "get_messages": {
					return success(id, "get_messages", { messages: session.messages });
				}

				// =============================================================
				// Model
				// =============================================================

				case "set_model": {
					const model = findModel(command.api, command.modelId);
					if (!model) {
						return error(id, "set_model", `Model not found: ${command.api}/${command.modelId}`);
					}
					await session.changeModel(model);
					return success(id, "set_model", { api: model.api, modelId: model.id });
				}

				case "get_available_models": {
					const models = discoverAvailableModels();
					const modelData = models.map((m) => ({
						api: m.api,
						id: m.id,
						contextWindow: m.contextWindow,
						reasoning: m.reasoning,
					}));
					return success(id, "get_available_models", { models: modelData });
				}

				// =============================================================
				// Thinking
				// =============================================================

				case "set_thinking_level": {
					await session.updateThinkingLevel(command.level);
					return success(id, "set_thinking_level");
				}

				// =============================================================
				// Queue Mode
				// =============================================================

				case "set_queue_mode": {
					session.setQueueMode(command.mode);
					return success(id, "set_queue_mode");
				}

				// =============================================================
				// Compaction
				// =============================================================

				case "compact": {
					await session.compactHistory({ keepRecent: command.keepRecent ?? 10 });
					return success(id, "compact");
				}

				// =============================================================
				// Session
				// =============================================================

				case "get_session_stats": {
					const stats = session.getSessionStats();
					return success(id, "get_session_stats", stats);
				}

				case "export_html": {
					const path = session.exportToHtml(command.outputPath);
					return success(id, "export_html", { path });
				}

				case "switch_session": {
					await session.switchSession(command.sessionPath);
					return success(id, "switch_session");
				}

				case "list_sessions": {
					const sessions = SessionTree.listSessions(session.sessionTree.cwd);
					const sessionData = sessions.map((s) => ({
						file: s.file,
						id: s.id,
						created: s.created.toISOString(),
						modified: s.modified.toISOString(),
						messageCount: s.messageCount,
						firstMessage: s.firstMessage,
					}));
					return success(id, "list_sessions", { sessions: sessionData });
				}

				// =============================================================
				// Branches
				// =============================================================

				case "create_branch": {
					session.createBranch(command.name, command.fromNodeId);
					return success(id, "create_branch");
				}

				case "switch_branch": {
					await session.switchBranch(command.name);
					return success(id, "switch_branch");
				}

				case "branch_and_switch": {
					const branchInfo = await session.branchAndSwitch(command.name, command.fromNodeId);
					return success(id, "branch_and_switch", branchInfo);
				}

				case "list_branches": {
					const branches = session.listBranches();
					return success(id, "list_branches", { branches });
				}

				case "merge_branch": {
					await session.smartMergeBranch(command.fromBranch);
					return success(id, "merge_branch");
				}

				// =============================================================
				// Checkpoints
				// =============================================================

				case "create_checkpoint": {
					session.createCheckpoint(command.name, command.metadata);
					return success(id, "create_checkpoint");
				}

				default: {
					const unknownCommand = command as { type: string };
					return error(undefined, unknownCommand.type, `Unknown command: ${unknownCommand.type}`);
				}
			}
		} catch (e) {
			return error(id, command.type, e instanceof Error ? e.message : String(e));
		}
	};

	// Listen for JSON input
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: false,
	});

	rl.on("line", async (line: string) => {
		try {
			const parsed = JSON.parse(line);
			const command = parsed as RpcCommand;
			const response = await handleCommand(command);
			output(response);
		} catch (e) {
			output(error(undefined, "parse", `Failed to parse command: ${e instanceof Error ? e.message : String(e)}`));
		}
	});

	// Handle stdin close (client disconnected)
	rl.on("close", () => {
		process.exit(0);
	});

	// Keep process alive forever
	return new Promise(() => {});
}
