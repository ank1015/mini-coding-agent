/**
 * RPC Client for programmatic access to the coding agent.
 *
 * Spawns the agent in RPC mode and provides a typed API for all operations.
 */

import { type ChildProcess, spawn } from "node:child_process";
import * as readline from "node:readline";
import type { AgentEvent, Attachment, Message } from "@ank1015/providers";
import type { SessionStats } from "../../core/agent-session.js";
import type { BranchInfo } from "../../core/session-tree.js";
import type { RpcCommand, RpcResponse, RpcSessionState } from "./rpc-types.js";

// ============================================================================
// Types
// ============================================================================

/** Distributive Omit that works with union types */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/** RpcCommand without the id field (for internal send) */
type RpcCommandBody = DistributiveOmit<RpcCommand, "id">;

export interface RpcClientOptions {
	/** Path to the CLI entry point (default: dist/cli.js) */
	cliPath?: string;
	/** Working directory for the agent */
	cwd?: string;
	/** Environment variables */
	env?: Record<string, string>;
	/** API provider to use */
	api?: string;
	/** Model ID to use */
	model?: string;
	/** Additional CLI arguments */
	args?: string[];
}

export interface ModelInfo {
	api: string;
	id: string;
	contextWindow: number;
	reasoning: boolean;
}

export interface SessionInfo {
	file: string;
	id: string;
	created: string;
	modified: string;
	messageCount: number;
	firstMessage: string;
}

export type RpcEventListener = (event: AgentEvent) => void;

// ============================================================================
// RPC Client
// ============================================================================

export class RpcClient {
	private process: ChildProcess | null = null;
	private rl: readline.Interface | null = null;
	private eventListeners: RpcEventListener[] = [];
	private pendingRequests: Map<string, { resolve: (response: RpcResponse) => void; reject: (error: Error) => void }> =
		new Map();
	private requestId = 0;
	private stderr = "";

	constructor(private options: RpcClientOptions = {}) {}

	/**
	 * Start the RPC agent process.
	 */
	async start(): Promise<void> {
		if (this.process) {
			throw new Error("Client already started");
		}

		const cliPath = this.options.cliPath ?? "dist/cli.js";
		const args = ["--mode", "rpc"];

		if (this.options.api) {
			args.push("--api", this.options.api);
		}
		if (this.options.model) {
			args.push("--model", this.options.model);
		}
		if (this.options.args) {
			args.push(...this.options.args);
		}

		this.process = spawn("node", [cliPath, ...args], {
			cwd: this.options.cwd,
			env: { ...process.env, ...this.options.env },
			stdio: ["pipe", "pipe", "pipe"],
		});

		// Collect stderr for debugging
		this.process.stderr?.on("data", (data) => {
			this.stderr += data.toString();
		});

		// Set up line reader for stdout
		this.rl = readline.createInterface({
			input: this.process.stdout!,
			terminal: false,
		});

		this.rl.on("line", (line) => {
			this.handleLine(line);
		});

		// Wait a moment for process to initialize
		await new Promise((resolve) => setTimeout(resolve, 100));

		if (this.process.exitCode !== null) {
			throw new Error(`Agent process exited immediately with code ${this.process.exitCode}. Stderr: ${this.stderr}`);
		}
	}

	/**
	 * Stop the RPC agent process.
	 */
	async stop(): Promise<void> {
		if (!this.process) return;

		this.rl?.close();
		this.process.kill("SIGTERM");

		// Wait for process to exit
		await new Promise<void>((resolve) => {
			const timeout = setTimeout(() => {
				this.process?.kill("SIGKILL");
				resolve();
			}, 1000);

			this.process?.on("exit", () => {
				clearTimeout(timeout);
				resolve();
			});
		});

		this.process = null;
		this.rl = null;
		this.pendingRequests.clear();
	}

	/**
	 * Subscribe to agent events.
	 */
	onEvent(listener: RpcEventListener): () => void {
		this.eventListeners.push(listener);
		return () => {
			const index = this.eventListeners.indexOf(listener);
			if (index !== -1) {
				this.eventListeners.splice(index, 1);
			}
		};
	}

	/**
	 * Get collected stderr output (useful for debugging).
	 */
	getStderr(): string {
		return this.stderr;
	}

	// =========================================================================
	// Command Methods
	// =========================================================================

	/**
	 * Send a prompt to the agent.
	 * Returns immediately after sending; use onEvent() to receive streaming events.
	 * Use waitForIdle() to wait for completion.
	 */
	async prompt(message: string, attachments?: Attachment[]): Promise<void> {
		await this.send({ type: "prompt", message, attachments });
	}

	/**
	 * Queue a message to be processed after the agent finishes current work.
	 */
	async queueMessage(message: string): Promise<void> {
		await this.send({ type: "queue_message", message });
	}

	/**
	 * Abort current operation.
	 */
	async abort(): Promise<void> {
		await this.send({ type: "abort" });
	}

	/**
	 * Reset session (clear context, start fresh).
	 */
	async reset(): Promise<void> {
		await this.send({ type: "reset" });
	}

	/**
	 * Get current session state.
	 */
	async getState(): Promise<RpcSessionState> {
		const response = await this.send({ type: "get_state" });
		return this.getData(response);
	}

	/**
	 * Get all messages in the session.
	 */
	async getMessages(): Promise<Message[]> {
		const response = await this.send({ type: "get_messages" });
		return this.getData<{ messages: Message[] }>(response).messages;
	}

	/**
	 * Set model by API and model ID.
	 */
	async setModel(api: string, modelId: string): Promise<{ api: string; modelId: string }> {
		const response = await this.send({ type: "set_model", api, modelId });
		return this.getData(response);
	}

	/**
	 * Get list of available models.
	 */
	async getAvailableModels(): Promise<ModelInfo[]> {
		const response = await this.send({ type: "get_available_models" });
		return this.getData<{ models: ModelInfo[] }>(response).models;
	}

	/**
	 * Set thinking level (for OpenAI/Google models).
	 */
	async setThinkingLevel(level: "low" | "high"): Promise<void> {
		await this.send({ type: "set_thinking_level", level });
	}

	/**
	 * Set queue mode.
	 */
	async setQueueMode(mode: "all" | "one-at-a-time"): Promise<void> {
		await this.send({ type: "set_queue_mode", mode });
	}

	/**
	 * Compact session context.
	 */
	async compact(keepRecent?: number): Promise<void> {
		await this.send({ type: "compact", keepRecent });
	}

	/**
	 * Get session statistics.
	 */
	async getSessionStats(): Promise<SessionStats> {
		const response = await this.send({ type: "get_session_stats" });
		return this.getData(response);
	}

	/**
	 * Export session to HTML.
	 */
	async exportHtml(outputPath?: string): Promise<{ path: string }> {
		const response = await this.send({ type: "export_html", outputPath });
		return this.getData(response);
	}

	/**
	 * Switch to a different session file.
	 */
	async switchSession(sessionPath: string): Promise<void> {
		await this.send({ type: "switch_session", sessionPath });
	}

	/**
	 * List all sessions for the current working directory.
	 */
	async listSessions(): Promise<SessionInfo[]> {
		const response = await this.send({ type: "list_sessions" });
		return this.getData<{ sessions: SessionInfo[] }>(response).sessions;
	}

	/**
	 * Create a new branch.
	 */
	async createBranch(name: string, fromNodeId?: string): Promise<void> {
		await this.send({ type: "create_branch", name, fromNodeId });
	}

	/**
	 * Switch to a different branch.
	 */
	async switchBranch(name: string): Promise<void> {
		await this.send({ type: "switch_branch", name });
	}

	/**
	 * Create a branch and switch to it.
	 */
	async branchAndSwitch(name: string, fromNodeId?: string): Promise<BranchInfo> {
		const response = await this.send({ type: "branch_and_switch", name, fromNodeId });
		return this.getData(response);
	}

	/**
	 * List all branches.
	 */
	async listBranches(): Promise<BranchInfo[]> {
		const response = await this.send({ type: "list_branches" });
		return this.getData<{ branches: BranchInfo[] }>(response).branches;
	}

	/**
	 * Merge a branch into the current branch with smart summarization.
	 */
	async mergeBranch(fromBranch: string): Promise<void> {
		await this.send({ type: "merge_branch", fromBranch });
	}

	/**
	 * Create a checkpoint at the current position.
	 */
	async createCheckpoint(name: string, metadata?: Record<string, unknown>): Promise<void> {
		await this.send({ type: "create_checkpoint", name, metadata });
	}

	// =========================================================================
	// Helpers
	// =========================================================================

	/**
	 * Wait for agent to become idle (no streaming).
	 * Resolves when agent_end event is received.
	 */
	waitForIdle(timeout = 60000): Promise<void> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				unsubscribe();
				reject(new Error(`Timeout waiting for agent to become idle. Stderr: ${this.stderr}`));
			}, timeout);

			const unsubscribe = this.onEvent((event) => {
				if (event.type === "agent_end") {
					clearTimeout(timer);
					unsubscribe();
					resolve();
				}
			});
		});
	}

	/**
	 * Collect events until agent becomes idle.
	 */
	collectEvents(timeout = 60000): Promise<AgentEvent[]> {
		return new Promise((resolve, reject) => {
			const events: AgentEvent[] = [];
			const timer = setTimeout(() => {
				unsubscribe();
				reject(new Error(`Timeout collecting events. Stderr: ${this.stderr}`));
			}, timeout);

			const unsubscribe = this.onEvent((event) => {
				events.push(event);
				if (event.type === "agent_end") {
					clearTimeout(timer);
					unsubscribe();
					resolve(events);
				}
			});
		});
	}

	/**
	 * Send prompt and wait for completion, returning all events.
	 */
	async promptAndWait(message: string, attachments?: Attachment[], timeout = 60000): Promise<AgentEvent[]> {
		const eventsPromise = this.collectEvents(timeout);
		await this.prompt(message, attachments);
		return eventsPromise;
	}

	// =========================================================================
	// Internal
	// =========================================================================

	private handleLine(line: string): void {
		try {
			const data = JSON.parse(line);

			// Check if it's a response to a pending request
			if (data.type === "response" && data.id && this.pendingRequests.has(data.id)) {
				const pending = this.pendingRequests.get(data.id)!;
				this.pendingRequests.delete(data.id);
				pending.resolve(data as RpcResponse);
				return;
			}

			// Otherwise it's an event
			for (const listener of this.eventListeners) {
				listener(data as AgentEvent);
			}
		} catch {
			// Ignore non-JSON lines
		}
	}

	private async send(command: RpcCommandBody): Promise<RpcResponse> {
		if (!this.process?.stdin) {
			throw new Error("Client not started");
		}

		const id = `req_${++this.requestId}`;
		const fullCommand = { ...command, id } as RpcCommand;

		return new Promise((resolve, reject) => {
			this.pendingRequests.set(id, { resolve, reject });

			const timeout = setTimeout(() => {
				this.pendingRequests.delete(id);
				reject(new Error(`Timeout waiting for response to ${command.type}. Stderr: ${this.stderr}`));
			}, 30000);

			this.pendingRequests.set(id, {
				resolve: (response) => {
					clearTimeout(timeout);
					resolve(response);
				},
				reject: (error) => {
					clearTimeout(timeout);
					reject(error);
				},
			});

			this.process!.stdin!.write(`${JSON.stringify(fullCommand)}\n`);
		});
	}

	private getData<T>(response: RpcResponse): T {
		if (!response.success) {
			const errorResponse = response as Extract<RpcResponse, { success: false }>;
			throw new Error(errorResponse.error);
		}
		// Type assertion: we trust response.data matches T based on the command sent.
		const successResponse = response as Extract<RpcResponse, { success: true; data: unknown }>;
		return successResponse.data as T;
	}
}
