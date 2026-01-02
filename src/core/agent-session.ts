/**
 * AgentSession - Core abstraction for agent lifecycle and session management.
 *
 * This class is shared between all run modes (interactive, print, rpc).
 * It encapsulates:
 * - Agent state access
 * - Event subscription with automatic session persistence
 * - Model and Provider options management
 * - Session and branch management
 *
 * Modes use this class and add their own I/O layer on top.
 */

import { Conversation, BaseAssistantMessage, Model, TextContent, AgentEvent, AgentState, Message, Attachment, getApiKeyFromEnv, Api, OptionsForApi, generateUUID, getModel, GoogleThinkingLevel, OpenAIProviderOptions, GoogleProviderOptions } from "@ank1015/providers";
import { getModelsPath } from "../config.js";
import { exportSessionToHtml } from "./export-html.js";
import { SessionTree, type BranchInfo, type ContextStrategy } from "./session-tree.js";
import type { SettingsManager } from "./settings-manager.js";
import { getDefaultProviderOption } from "../utils/default-provider-options.js";

/** Session-specific events that extend the core AgentEvent */
export type AgentSessionEvent = AgentEvent

/** Listener function for agent session events */
export type AgentSessionEventListener = (event: AgentSessionEvent) => void;

// ============================================================================
// Types
// ============================================================================

export interface AgentSessionConfig {
	agent: Conversation;
	sessionTree: SessionTree;
	settingsManager: SettingsManager;
}

/** Options for AgentSession.prompt() */
export interface PromptOptions {
	/** Image/file attachments */
	attachments?: Attachment[];
}

/** Session statistics for /session command */
export interface SessionStats {
	sessionFile: string | null;
	sessionId: string;
	activeBranch: string;
	branchCount: number;
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	toolResults: number;
	totalMessages: number;
	tokens: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
	cost: number;
}


// ============================================================================
// AgentSession Class
// ============================================================================

export class AgentSession {
	readonly agent: Conversation;
	private _sessionTree: SessionTree;
	readonly settingsManager: SettingsManager;

	// Event subscription state
	private _unsubscribeAgent?: () => void;
	private _eventListeners: AgentSessionEventListener[] = [];

	// Message queue state
	private _queuedMessages: string[] = [];

	constructor(config: AgentSessionConfig) {
		this.agent = config.agent;
		this._sessionTree = config.sessionTree;
		this.settingsManager = config.settingsManager;
	}

	// =========================================================================
	// Event Subscription
	// =========================================================================

	/** Emit an event to all listeners */
	private _emit(event: AgentSessionEvent): void {
		for (const l of this._eventListeners) {
			l(event);
		}
	}

	/** Internal handler for agent events - shared by subscribe and reconnect */
	private _handleAgentEvent = async (event: AgentEvent): Promise<void> => {
		// When a user message starts, check if it's from the queue and remove it BEFORE emitting
		// This ensures the UI sees the updated queue state
		if (event.type === "message_start" && event.message.role === "user" && this._queuedMessages.length > 0) {
			// Extract text content from the message
			const messageText = this._getUserMessageText(event.message);
			if (messageText && this._queuedMessages.includes(messageText)) {
				// Remove the first occurrence of this message from the queue
				const index = this._queuedMessages.indexOf(messageText);
				if (index !== -1) {
					this._queuedMessages.splice(index, 1);
				}
			}
		}

		// Notify all listeners
		this._emit(event);

		// Handle session persistence
		if (event.type === "message_end") {
			this._sessionTree.saveMessage(event.message);
		}
	};

	/** Extract text content from a message */
	private _getUserMessageText(message: Message): string {
		if (message.role !== "user") return "";
		const content = message.content;
		if (typeof content === "string") return content;
		const textBlocks = content.filter((c) => c.type === "text");
		return textBlocks.map((c) => (c as TextContent).content).join("");
	}

	/** Find the last assistant message in agent state (including aborted ones) */
	private _findLastAssistantMessage(): BaseAssistantMessage<Api> | null {
		const messages = this.agent.state.messages;
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg.role === "assistant") {
				return msg as BaseAssistantMessage<Api>;
			}
		}
		return null;
	}

	/**
	 * Subscribe to agent events.
	 * Session persistence is handled internally (saves messages on message_end).
	 * Multiple listeners can be added. Returns unsubscribe function for this listener.
	 */
	subscribe(listener: AgentSessionEventListener): () => void {
		this._eventListeners.push(listener);

		// Set up agent subscription if not already done
		if (!this._unsubscribeAgent) {
			this._unsubscribeAgent = this.agent.subscribe(this._handleAgentEvent);
		}

		// Return unsubscribe function for this specific listener
		return () => {
			const index = this._eventListeners.indexOf(listener);
			if (index !== -1) {
				this._eventListeners.splice(index, 1);
			}
		};
	}

	/**
	 * Temporarily disconnect from agent events.
	 * User listeners are preserved and will receive events again after resubscribe().
	 * Used internally during operations that need to pause event processing.
	 */
	private _disconnectFromAgent(): void {
		if (this._unsubscribeAgent) {
			this._unsubscribeAgent();
			this._unsubscribeAgent = undefined;
		}
	}

	/**
	 * Reconnect to agent events after _disconnectFromAgent().
	 * Preserves all existing listeners.
	 */
	private _reconnectToAgent(): void {
		if (this._unsubscribeAgent) return; // Already connected
		this._unsubscribeAgent = this.agent.subscribe(this._handleAgentEvent);
	}

	/**
	 * Remove all listeners and disconnect from agent.
	 * Call this when completely done with the session.
	 */
	dispose(): void {
		this._disconnectFromAgent();
		this._eventListeners = [];
	}

	// =========================================================================
	// Read-only State Access
	// =========================================================================

	/** Full agent state */
	get state(): AgentState {
		return this.agent.state;
	}

	/** Current model (may be null if not yet selected) */
	get model(): Model<any> | null {
		return this.agent.state.provider.model;
	}

	/** Current Provider options */
	get providerOptions(): OptionsForApi<Api> {
		return this.agent.state.provider.providerOptions;
	}

	/** Whether agent is currently streaming a response */
	get isStreaming(): boolean {
		return this.agent.state.isStreaming;
	}

	/** All messages */
	get messages(): Message[] {
		return this.agent.state.messages;
	}

	/** Current queue mode */
	get queueMode(): "all" | "one-at-a-time" {
		return this.agent.getQueueMode();
	}

	/** Current session file path, or null if sessions are disabled */
	get sessionFile(): string | null {
		return this._sessionTree.isPersisted() ? this._sessionTree.file : null;
	}

	/** Current session ID */
	get sessionId(): string {
		return this._sessionTree.id;
	}

	/** Current session tree (for advanced access) */
	get sessionTree(): SessionTree {
		return this._sessionTree;
	}

	/** Current active branch name */
	get activeBranch(): string {
		return this._sessionTree.activeBranch;
	}

	/** List of all branch names in current session */
	get branches(): string[] {
		return this._sessionTree.getBranches();
	}

	// =========================================================================
	// Prompting
	// =========================================================================

	/**
	 * Send a prompt to the agent.
	 * - Validates model and API key before sending
	 * - Expands file-based slash commands by default
	 * @throws Error if no model selected or no API key available
	 */
	async prompt(text: string, options?: PromptOptions): Promise<void> {

		// Validate model
		if (!this.model) {
			throw new Error(
				"No model selected.\n\n" +
					"Set an API key (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)\n" +
					`or create ${getModelsPath()}\n\n` +
					"Then use /model to select a model.",
			);
		}

		// Validate API key
		const apiKey = getApiKeyFromEnv(this.model.api);
		if (!apiKey) {
			throw new Error(
				`No API key found for ${this.model.api}.\n\n` +
					`Set the appropriate environment variable or update ${getModelsPath()}`,
			);
		}

		await this.agent.prompt(text, options?.attachments);
	}

	/**
	 * Queue a message to be sent after the current response completes.
	 * Use when agent is currently streaming.
	 */
	async queueMessage(text: string): Promise<void> {
		this._queuedMessages.push(text);
		await this.agent.queueMessage({
			role: "user",
			content: [{ type: "text", content: text }],
			timestamp: Date.now(),
			id: generateUUID()
		});
	}

	/**
	 * Clear queued messages and return them.
	 * Useful for restoring to editor when user aborts.
	 */
	clearQueue(): string[] {
		const queued = [...this._queuedMessages];
		this._queuedMessages = [];
		this.agent.clearMessageQueue();
		return queued;
	}

	/** Number of messages currently queued */
	get queuedMessageCount(): number {
		return this._queuedMessages.length;
	}

	/** Get queued messages (read-only) */
	getQueuedMessages(): readonly string[] {
		return this._queuedMessages;
	}

	/**
	 * Abort current operation and wait for agent to become idle.
	 */
	async abort(): Promise<void> {
		this.agent.abort();
		await this.agent.waitForIdle();
	}

	/**
	 * Reset agent and session to start fresh.
	 * Clears all messages and starts a new session file.
	 * Listeners are preserved and will continue receiving events.
	 * @returns true if reset completed
	 */
	async reset(): Promise<boolean> {
		this._disconnectFromAgent();
		await this.abort();
		
		// Capture current model before resetting agent (just in case, though agent.reset shouldn't clear it)
		const currentModel = this.model;
		const currentOptions = this.providerOptions;

		this.agent.reset();
		this._sessionTree = this._sessionTree.reset();

		// Ensure the new session starts with the correct provider info
		if (currentModel) {
			this._sessionTree.saveProvider(currentModel.api, currentModel.id, currentOptions);
		}

		this._queuedMessages = [];
		this._reconnectToAgent();
		return true;
	}

	// =========================================================================
	// Model Management
	// =========================================================================

	/**
	 * Set model & Provider options directly.
	 * Validates API key, saves to session.
	 * @throws Error if no API key available for the model
	 */
	async setModel(model: Model<Api>, providerOptions: OptionsForApi<Api>): Promise<void> {
		const apiKey = getApiKeyFromEnv(model.api);
		if (!apiKey) {
			throw new Error(`No API key for ${model.api}/${model.id}`);
		}

		this.agent.setProvider({model, providerOptions});
		this._sessionTree.saveProvider(model.api, model.id, providerOptions);
	}

	/**
	 * Change the model.
	 * Switches in-place and records the provider change.
	 * User can manually branch before switching if they want to preserve history.
	 */
	async changeModel(model: Model<Api>, providerOptions?: OptionsForApi<Api>): Promise<void> {
		const options = providerOptions ?? getDefaultProviderOption(model.api);
		await this.setModel(model, options);
	}

	/**
	 * Update thinking level for supported models (OpenAI/Google).
	 */
	async updateThinkingLevel(level: 'low' | 'high'): Promise<void> {
		const model = this.model;
		if (!model) throw new Error("No model selected");

		let newOptions: OptionsForApi<Api> = { ...this.providerOptions };

		if (model.api === 'openai') {
			const opts = newOptions as OpenAIProviderOptions;
			if (!opts.reasoning) opts.reasoning = {};
			opts.reasoning.effort = level;
		} else if (model.api === 'google') {
			const opts = newOptions as GoogleProviderOptions;
			if (!opts.thinkingConfig) opts.thinkingConfig = { includeThoughts: true };
			opts.thinkingConfig.thinkingLevel = level === 'high' 
				? GoogleThinkingLevel.HIGH 
				: GoogleThinkingLevel.LOW;
		} else {
			throw new Error(`Thinking level not supported for ${model.api}`);
		}

		await this.setModel(model, newOptions);
	}

	// =========================================================================
	// Queue Mode Management
	// =========================================================================

	/**
	 * Set message queue mode.
	 * Saves to settings.
	 */
	setQueueMode(mode: "all" | "one-at-a-time"): void {
		this.agent.setQueueMode(mode);
		this.settingsManager.setQueueMode(mode);
	}


	// =========================================================================
	// Session Management
	// =========================================================================

	/**
	 * Switch to a different session file.
	 * Aborts current operation, loads messages, restores model.
	 * Listeners are preserved and will continue receiving events.
	 * @returns true if switch completed
	 */
	async switchSession(sessionPath: string): Promise<boolean> {
		this._disconnectFromAgent();
		await this.abort();
		this._queuedMessages = [];

		// Open the new session tree
		this._sessionTree = SessionTree.open(sessionPath);

		// Reload context from the new tree
		await this._reloadContext();

		this._reconnectToAgent();
		return true;
	}

	/**
	 * Reload context from session tree into agent.
	 * Used after session/branch switches.
	 */
	private async _reloadContext(strategy?: ContextStrategy): Promise<void> {
		const messages = this._sessionTree.buildContext(undefined, strategy ?? { type: 'full' });
		this.agent.replaceMessages(messages);

		// Restore model if saved
		const savedModel = this._sessionTree.loadModel();
		if (savedModel) {
			const model = getModel(savedModel.api as Api, savedModel.modelId as any);
			if (!model) {
				throw new Error(`Model not found: ${savedModel.api}/${savedModel.modelId}`);
			}
			this.agent.setProvider({ model, providerOptions: savedModel.providerOptions });
		}
	}

	// =========================================================================
	// Branch Management
	// =========================================================================

	/**
	 * Create a new branch from a specific node (or current head).
	 * Does NOT switch to the new branch.
	 * @param name - Name for the new branch
	 * @param fromNodeId - Optional node ID to branch from (defaults to current head)
	 */
	createBranch(name: string, fromNodeId?: string): void {
		this._sessionTree.createBranch(name, fromNodeId);
	}

	/**
	 * Switch to a different branch.
	 * Reloads context from the branch.
	 * @param name - Branch name to switch to
	 * @param strategy - Optional context strategy (defaults to full)
	 */
	async switchBranch(name: string, strategy?: ContextStrategy): Promise<void> {
		this._disconnectFromAgent();
		await this.abort();
		this._queuedMessages = [];

		this._sessionTree.switchBranch(name);
		await this._reloadContext(strategy);

		this._reconnectToAgent();
	}

	/**
	 * Create a branch and switch to it.
	 * Convenience method combining createBranch + switchBranch.
	 * @param name - Name for the new branch
	 * @param fromNodeId - Optional node ID to branch from
	 * @returns BranchInfo for the new branch
	 */
	async branchAndSwitch(name: string, fromNodeId?: string): Promise<BranchInfo> {
		this._sessionTree.createBranch(name, fromNodeId);
		await this.switchBranch(name);
		return this._sessionTree.getBranchInfo(name)!;
	}

	/**
	 * Merge another branch into the current branch.
	 * Creates a merge node with the provided summary.
	 * @param fromBranch - Branch to merge from
	 * @param summary - Summary of the merged content
	 */
	mergeBranch(fromBranch: string, summary: string): void {
		this._sessionTree.merge(fromBranch, summary);
	}

	/**
	 * List all branches with their info.
	 */
	listBranches(): BranchInfo[] {
		return this._sessionTree.listBranches();
	}

	/**
	 * Get info for a specific branch.
	 */
	getBranchInfo(name: string): BranchInfo | null {
		return this._sessionTree.getBranchInfo(name);
	}

	// =========================================================================
	// Summarization & Checkpoints
	// =========================================================================

	/**
	 * Create a summary node that compresses multiple nodes.
	 * @param content - The summary text
	 * @param nodeIds - Node IDs that this summary covers
	 */
	createSummary(content: string, nodeIds: string[]): void {
		this._sessionTree.appendSummary(content, nodeIds);
	}

	/**
	 * Create a checkpoint at the current position.
	 * Useful for marking points to return to later.
	 * @param name - Name for the checkpoint
	 * @param metadata - Optional metadata
	 */
	createCheckpoint(name: string, metadata?: Record<string, unknown>): void {
		this._sessionTree.appendCheckpoint(name, metadata);
	}

	// =========================================================================
	// Statistics & Export
	// =========================================================================

	/**
	 * Get session statistics.
	 */
	getSessionStats(): SessionStats {
		const state = this.state;
		const userMessages = state.messages.filter((m) => m.role === "user").length;
		const assistantMessages = state.messages.filter((m) => m.role === "assistant").length;
		const toolResults = state.messages.filter((m) => m.role === "toolResult").length;

		let toolCalls = 0;
		let totalInput = 0;
		let totalOutput = 0;
		let totalCacheRead = 0;
		let totalCacheWrite = 0;
		let totalCost = 0;

		for (const message of state.messages) {
			if (message.role === "assistant") {
				const assistantMsg = message as BaseAssistantMessage<Api>;
				toolCalls += assistantMsg.content.filter((c) => c.type === "toolCall").length;
				totalInput += assistantMsg.usage.input;
				totalOutput += assistantMsg.usage.output;
				totalCacheRead += assistantMsg.usage.cacheRead;
				totalCacheWrite += assistantMsg.usage.cacheWrite;
				totalCost += assistantMsg.usage.cost.total;
			}
		}

		return {
			sessionFile: this.sessionFile,
			sessionId: this.sessionId,
			activeBranch: this.activeBranch,
			branchCount: this.branches.length,
			userMessages,
			assistantMessages,
			toolCalls,
			toolResults,
			totalMessages: state.messages.length,
			tokens: {
				input: totalInput,
				output: totalOutput,
				cacheRead: totalCacheRead,
				cacheWrite: totalCacheWrite,
				total: totalInput + totalOutput + totalCacheRead + totalCacheWrite,
			},
			cost: totalCost,
		};
	}

	/**
	 * Export session to HTML.
	 * @param outputPath Optional output path (defaults to session directory)
	 * @returns Path to exported file
	 */
	exportToHtml(outputPath?: string): string {
		return exportSessionToHtml(this._sessionTree, this.state, outputPath);
	}
}
