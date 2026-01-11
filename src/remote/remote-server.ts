/**
 * Abstract base class for remote messaging platform servers.
 *
 * Extend this class to implement platform-specific connections
 * (Discord, Slack, Telegram, etc.)
 */

import type { MessageHandler, RemoteMessage, RemoteResponse } from "./types.js";

export interface RemoteServerConfig {
	/** Optional: only respond to messages from these user IDs */
	allowedUsers?: string[];

	/** Optional: only respond in these channels */
	allowedChannels?: string[];

	/** Optional: require messages to start with this prefix */
	commandPrefix?: string;
}

export abstract class RemoteServer {
	protected config: RemoteServerConfig;
	protected messageHandlers: MessageHandler[] = [];
	protected _isConnected = false;

	constructor(config: RemoteServerConfig = {}) {
		this.config = config;
	}

	/**
	 * Whether the server is currently connected.
	 */
	get isConnected(): boolean {
		return this._isConnected;
	}

	/**
	 * Start the server and connect to the platform.
	 */
	abstract start(): Promise<void>;

	/**
	 * Stop the server and disconnect.
	 */
	abstract stop(): Promise<void>;

	/**
	 * Send a message to a channel.
	 */
	abstract sendMessage(channelId: string, response: RemoteResponse): Promise<void>;

	/**
	 * Send a typing indicator to show the bot is "thinking".
	 */
	abstract sendTypingIndicator(channelId: string): Promise<void>;

	/**
	 * Platform name for logging/identification.
	 */
	abstract get platform(): string;

	/**
	 * Register a handler for incoming messages.
	 */
	onMessage(handler: MessageHandler): () => void {
		this.messageHandlers.push(handler);

		// Return unsubscribe function
		return () => {
			const index = this.messageHandlers.indexOf(handler);
			if (index !== -1) {
				this.messageHandlers.splice(index, 1);
			}
		};
	}

	/**
	 * Called by subclasses when a message is received.
	 * Handles filtering and dispatching to handlers.
	 */
	protected async handleIncomingMessage(message: RemoteMessage): Promise<void> {
		// Filter by allowed users
		if (this.config.allowedUsers && this.config.allowedUsers.length > 0) {
			if (!this.config.allowedUsers.includes(message.userId)) {
				return; // Ignore messages from non-allowed users
			}
		}

		// Filter by allowed channels
		if (this.config.allowedChannels && this.config.allowedChannels.length > 0) {
			if (!this.config.allowedChannels.includes(message.channelId)) {
				return; // Ignore messages from non-allowed channels
			}
		}

		// Filter by command prefix
		if (this.config.commandPrefix) {
			if (!message.text.startsWith(this.config.commandPrefix)) {
				return; // Ignore messages without prefix
			}
			// Strip prefix from message
			message = {
				...message,
				text: message.text.slice(this.config.commandPrefix.length).trim(),
			};
		}

		// Dispatch to all handlers
		for (const handler of this.messageHandlers) {
			try {
				await handler(message);
			} catch (error) {
				console.error(`[${this.platform}] Error in message handler:`, error);
			}
		}
	}
}
