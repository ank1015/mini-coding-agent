/**
 * RemoteAgent - Orchestrates RemoteServer and RpcClient.
 *
 * Receives messages from a messaging platform via RemoteServer,
 * routes them to the agent via RpcClient, and sends responses back.
 */

import type { AgentSessionEvent } from "../core/agent-session.js";
import { RpcClient, type RpcClientOptions } from "../modes/rpc/rpc-client.js";
import type { RemoteServer } from "./remote-server.js";
import type { RemoteMessage } from "./types.js";

export interface RemoteAgentConfig {
	/** RPC client configuration */
	rpc: RpcClientOptions;

	/** Show typing indicator while agent is processing */
	showTypingIndicator?: boolean;

	/** Interval for typing indicator refresh (ms) */
	typingIndicatorInterval?: number;

	/** Called when agent starts processing */
	onAgentStart?: (message: RemoteMessage) => void;

	/** Called when agent finishes processing */
	onAgentEnd?: (message: RemoteMessage, response: string) => void;

	/** Called on error */
	onError?: (error: Error, message: RemoteMessage) => void;
}

export class RemoteAgent {
	private server: RemoteServer;
	private client: RpcClient;
	private config: RemoteAgentConfig;
	private isProcessing = false;
	private typingInterval: ReturnType<typeof setInterval> | null = null;
	private unsubscribeMessage: (() => void) | null = null;

	constructor(server: RemoteServer, config: RemoteAgentConfig) {
		this.server = server;
		this.config = {
			showTypingIndicator: true,
			typingIndicatorInterval: 5000, // Discord typing lasts ~10s
			...config,
		};
		this.client = new RpcClient(config.rpc);
	}

	/**
	 * Start the remote agent.
	 * Starts both the RPC client and the remote server.
	 */
	async start(): Promise<void> {
		// Start RPC client first
		await this.client.start();
		console.log(`[RemoteAgent] RPC client started`);

		// Register message handler
		this.unsubscribeMessage = this.server.onMessage(this.handleMessage.bind(this));

		// Start the server
		await this.server.start();
		console.log(`[RemoteAgent] ${this.server.platform} server started`);
	}

	/**
	 * Stop the remote agent.
	 */
	async stop(): Promise<void> {
		// Stop typing indicator
		this.stopTypingIndicator();

		// Unsubscribe from messages
		if (this.unsubscribeMessage) {
			this.unsubscribeMessage();
			this.unsubscribeMessage = null;
		}

		// Stop server first (stop accepting new messages)
		await this.server.stop();
		console.log(`[RemoteAgent] ${this.server.platform} server stopped`);

		// Then stop RPC client
		await this.client.stop();
		console.log(`[RemoteAgent] RPC client stopped`);
	}

	/**
	 * Get the underlying RPC client for direct access.
	 */
	getRpcClient(): RpcClient {
		return this.client;
	}

	/**
	 * Get the underlying remote server.
	 */
	getServer(): RemoteServer {
		return this.server;
	}

	/**
	 * Check if agent is currently processing a message.
	 */
	get busy(): boolean {
		return this.isProcessing;
	}

	/**
	 * Handle incoming message from the platform.
	 */
	private async handleMessage(message: RemoteMessage): Promise<void> {
		// Skip empty messages
		if (!message.text.trim()) {
			return;
		}

		this.isProcessing = true;
		this.config.onAgentStart?.(message);

		// Start typing indicator
		if (this.config.showTypingIndicator) {
			this.startTypingIndicator(message.channelId);
		}

		try {
			// Collect response
			const response = await this.promptAndCollect(message.text);

			// Stop typing
			this.stopTypingIndicator();

			// Send response back to platform
			if (response) {
				await this.server.sendMessage(message.channelId, {
					text: response,
					replyToId: message.id,
				});
			}

			this.config.onAgentEnd?.(message, response);
		} catch (error) {
			this.stopTypingIndicator();

			const err = error instanceof Error ? error : new Error(String(error));
			console.error(`[RemoteAgent] Error processing message:`, err);
			this.config.onError?.(err, message);

			// Send error message to user
			await this.server.sendMessage(message.channelId, {
				text: `Error: ${err.message}`,
				replyToId: message.id,
			});
		} finally {
			this.isProcessing = false;
		}
	}

	/**
	 * Send prompt to agent and collect the full response.
	 */
	private async promptAndCollect(text: string): Promise<string> {
		let responseText = "";

		// Subscribe to events to collect response
		const unsubscribe = this.client.onEvent((event: AgentSessionEvent) => {
			if (event.type === "message_end" && event.message.role === "assistant") {
				responseText = this.extractTextFromMessage(event.message);
			}
		});

		try {
			await this.client.prompt(text);
			await this.client.waitForIdle();
			return responseText;
		} finally {
			unsubscribe();
		}
	}

	/**
	 * Extract text content from an assistant message.
	 */
	private extractTextFromMessage(message: { content: unknown[] }): string {
		const parts: string[] = [];

		for (const block of message.content) {
			if (typeof block === "object" && block !== null) {
				const b = block as { type: string; content?: unknown };

				// Handle response block (contains nested content)
				if (b.type === "response" && Array.isArray(b.content)) {
					for (const item of b.content) {
						if (typeof item === "object" && item !== null) {
							const i = item as { type: string; content?: string };
							if (i.type === "text" && typeof i.content === "string") {
								parts.push(i.content);
							}
						}
					}
				}

				// Handle direct text block
				if (b.type === "text" && typeof b.content === "string") {
					parts.push(b.content);
				}
			}
		}

		return parts.join("\n");
	}

	/**
	 * Start sending typing indicators.
	 */
	private startTypingIndicator(channelId: string): void {
		// Send immediately
		this.server.sendTypingIndicator(channelId).catch(() => {});

		// Then periodically refresh
		this.typingInterval = setInterval(() => {
			if (this.isProcessing) {
				this.server.sendTypingIndicator(channelId).catch(() => {});
			}
		}, this.config.typingIndicatorInterval);
	}

	/**
	 * Stop typing indicator.
	 */
	private stopTypingIndicator(): void {
		if (this.typingInterval) {
			clearInterval(this.typingInterval);
			this.typingInterval = null;
		}
	}
}
