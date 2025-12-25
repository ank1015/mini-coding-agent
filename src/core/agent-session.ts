/**
 * AgentSession - Core abstraction for agent lifecycle and session management.
 *
 * This class is shared between all run modes (interactive, print, rpc).
 * It encapsulates:
 * - Agent state access
 * - Event subscription with automatic session persistence
 * - Model and Provider options management
 * - Session switching
 *
 * Modes use this class and add their own I/O layer on top.
 */

import { Conversation, BaseAssistantMessage, Model, TextContent, AgentEvent, AgentState, Message, Attachment, getApiKeyFromEnv, Api, OptionsForApi, generateUUID, getModel } from "@ank1015/providers";
import { getModelsPath } from "../config.js";
import { exportSessionToHtml } from "./export-html.js";
import { loadSessionFromEntries, type SessionManager } from "./session-manager.js";
import type { SettingsManager } from "./settings-manager.js";

/** Session-specific events that extend the core AgentEvent */
export type AgentSessionEvent = AgentEvent

/** Listener function for agent session events */
export type AgentSessionEventListener = (event: AgentSessionEvent) => void;

// ============================================================================
// Types
// ============================================================================

export interface AgentSessionConfig {
	agent: Conversation;
	sessionManager: SessionManager;
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
	readonly sessionManager: SessionManager;
	readonly settingsManager: SettingsManager;

	// Event subscription state
	private _unsubscribeAgent?: () => void;
	private _eventListeners: AgentSessionEventListener[] = [];

	// Message queue state
	private _queuedMessages: string[] = [];

	constructor(config: AgentSessionConfig) {
		this.agent = config.agent;
		this.sessionManager = config.sessionManager;
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
			this.sessionManager.saveMessage(event.message);
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
		return this.sessionManager.isPersisted() ? this.sessionManager.getSessionFile() : null;
	}

	/** Current session ID */
	get sessionId(): string {
		return this.sessionManager.getSessionId();
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
	 * Clears all messages and starts a new session.
	 * Listeners are preserved and will continue receiving events.
	 * @returns true if reset completed, false if cancelled by hook
	 */
	async reset(): Promise<boolean> {
		this._disconnectFromAgent();
		await this.abort();
		this.agent.reset();
		this.sessionManager.reset();
		this._queuedMessages = [];
		this._reconnectToAgent();
		return true;
	}

	// =========================================================================
	// Model Management
	// =========================================================================

	/**
	 * Set model & Provider options directly.
	 * Validates API key, saves to session and settings.
	 * @throws Error if no API key available for the model
	 */
	async setModel(model: Model<Api>, providerOptions: OptionsForApi<Api>): Promise<void> {
		const apiKey = getApiKeyFromEnv(model.api);
		if (!apiKey) {
			throw new Error(`No API key for ${model.api}/${model.id}`);
		}

		this.agent.setProvider({model, providerOptions});
		this.sessionManager.saveProvider(model.api, model.id, providerOptions);
		this.settingsManager.setDefaultModelAndSettings(model, providerOptions);
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
	 * Branch session from a specific message ID.
	 * Creates a new session file up to that message, then switches to it.
	 * @returns true if branch completed
	 */
	async branchSession(messageId: string): Promise<boolean> {
		const newSessionPath = this.sessionManager.branch(messageId);
		return this.switchSession(newSessionPath);
	}

	/**
	 * Switch to a different session file.
	 * Aborts current operation, loads messages, restores model/thinking.
	 * Listeners are preserved and will continue receiving events.
	 * @returns true if switch completed, false if cancelled
	 */
	async switchSession(sessionPath: string): Promise<boolean> {
		this._disconnectFromAgent();
		await this.abort();
		this._queuedMessages = [];

		// Set new session
		this.sessionManager.setSessionFile(sessionPath);

		// Reload messages
		const entries = this.sessionManager.loadEntries();
		const loaded = loadSessionFromEntries(entries);

		this.agent.replaceMessages(loaded.messages);

		// Restore model if saved
		const savedModel = this.sessionManager.loadModel();
		if (savedModel) {
			const model = getModel(savedModel.api as Api, savedModel.modelId as any);
			if (!model) {
				throw new Error(`Model not found: ${savedModel.api}/${savedModel.modelId}`);
			}
			this.agent.setProvider({ model, providerOptions: savedModel.providerOptions });
		}

		this._reconnectToAgent();
		return true;
	}

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
		return exportSessionToHtml(this.sessionManager, this.state, outputPath);
	}
}
