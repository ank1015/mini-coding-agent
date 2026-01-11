/**
 * SlackServer - Slack bot integration for RemoteAgent.
 *
 * Uses Socket Mode for outbound-only connections (no webhooks needed).
 * Listens for messages and routes them to the agent.
 */

import { App } from "@slack/bolt";
import { RemoteServer, type RemoteServerConfig } from "../remote-server.js";
import type { RemoteAttachment, RemoteResponse } from "../types.js";

/** Slack message character limit */
const SLACK_MAX_LENGTH = 4000;

export interface SlackServerConfig extends RemoteServerConfig {
	/** Slack bot token (xoxb-...) */
	botToken: string;

	/** Slack app token for Socket Mode (xapp-...) */
	appToken: string;

	/** Only respond to DMs (direct messages) */
	dmOnly?: boolean;

	/** Only respond when mentioned (@bot) */
	requireMention?: boolean;
}

export class SlackServer extends RemoteServer {
	private slackConfig: SlackServerConfig;
	private app: App;
	private botUserId: string | null = null;

	constructor(config: SlackServerConfig) {
		super(config);
		this.slackConfig = config;

		this.app = new App({
			token: config.botToken,
			appToken: config.appToken,
			socketMode: true,
		});
	}

	get platform(): string {
		return "slack";
	}

	async start(): Promise<void> {
		if (this._isConnected) {
			return;
		}

		// Get bot user ID
		const authResult = await this.app.client.auth.test();
		this.botUserId = authResult.user_id as string;
		console.log(`[Slack] Logged in as ${authResult.user}`);

		// Listen for messages
		this.app.message(async ({ message }) => {
			await this.onSlackMessage(message as Parameters<typeof this.onSlackMessage>[0]);
		});

		// Listen for app mentions
		this.app.event("app_mention", async ({ event }) => {
			await this.onSlackMention(event);
		});

		// Start the app
		await this.app.start();
		this._isConnected = true;
	}

	async stop(): Promise<void> {
		await this.app.stop();
		this._isConnected = false;
		console.log("[Slack] Disconnected");
	}

	async sendMessage(channelId: string, response: RemoteResponse): Promise<void> {
		// Split long messages
		const chunks = this.splitMessage(response.text);

		for (const chunk of chunks) {
			await this.app.client.chat.postMessage({
				channel: channelId,
				text: chunk,
				thread_ts: response.replyToId, // Reply in thread if available
			});
		}
	}

	async sendTypingIndicator(_channelId: string): Promise<void> {
		// Slack doesn't have a typing indicator API for bots
		// We could use reactions or a "thinking" message, but keeping it simple
	}

	/**
	 * Handle incoming Slack message.
	 */
	private async onSlackMessage(
		message: {
			bot_id?: string;
			subtype?: string;
			user?: string;
			text?: string;
			ts: string;
			channel: string;
			channel_type?: string;
			thread_ts?: string;
			files?: Array<{ url_private: string; name: string; mimetype: string; size: number }>;
		}
	): Promise<void> {
		// Ignore bot messages
		if (message.bot_id || message.subtype === "bot_message") {
			return;
		}

		// Check DM-only mode
		if (this.slackConfig.dmOnly && message.channel_type !== "im") {
			return;
		}

		// Check mention requirement (for non-DM channels)
		if (this.slackConfig.requireMention && message.channel_type !== "im") {
			if (!message.text?.includes(`<@${this.botUserId}>`)) {
				return;
			}
		}

		await this.processMessage(message);
	}

	/**
	 * Handle app mention events.
	 */
	private async onSlackMention(
		event: { user?: string; text?: string; ts: string; channel: string; thread_ts?: string }
	): Promise<void> {
		// Create a message-like object from the mention event
		const message = {
			user: event.user,
			text: event.text,
			ts: event.ts,
			channel: event.channel,
			thread_ts: event.thread_ts,
			channel_type: "channel" as const,
		};

		await this.processMessage(message);
	}

	/**
	 * Process a message and dispatch to handlers.
	 */
	private async processMessage(
		message: {
			user?: string;
			text?: string;
			ts: string;
			channel: string;
			thread_ts?: string;
			channel_type?: string;
			files?: Array<{ url_private: string; name: string; mimetype: string; size: number }>;
		}
	): Promise<void> {
		if (!message.user || !message.text) {
			return;
		}

		// Extract text (remove bot mention if present)
		let text = message.text;
		if (this.botUserId) {
			text = text.replace(new RegExp(`<@${this.botUserId}>`, "g"), "").trim();
		}

		// Get user info
		let username = message.user;
		try {
			const userInfo = await this.app.client.users.info({ user: message.user });
			username = userInfo.user?.real_name || userInfo.user?.name || message.user;
		} catch {
			// Use user ID if we can't get the name
		}

		// Convert attachments
		const attachments: RemoteAttachment[] = (message.files || []).map((file) => ({
			type: this.getAttachmentType(file.mimetype),
			url: file.url_private,
			filename: file.name,
			mimeType: file.mimetype,
			size: file.size,
		}));

		// Create normalized message
		const remoteMessage = {
			id: message.ts,
			channelId: message.channel,
			userId: message.user,
			username,
			text,
			attachments: attachments.length > 0 ? attachments : undefined,
			platform: "slack",
			raw: message,
		};

		// Dispatch to handlers
		await this.handleIncomingMessage(remoteMessage);
	}

	/**
	 * Determine attachment type from MIME type.
	 */
	private getAttachmentType(mimeType: string): RemoteAttachment["type"] {
		if (mimeType.startsWith("image/")) return "image";
		if (mimeType.startsWith("audio/")) return "audio";
		if (mimeType.startsWith("video/")) return "video";
		return "file";
	}

	/**
	 * Split a message into chunks that fit Slack's character limit.
	 */
	private splitMessage(text: string): string[] {
		if (text.length <= SLACK_MAX_LENGTH) {
			return [text];
		}

		const chunks: string[] = [];
		let remaining = text;

		while (remaining.length > 0) {
			if (remaining.length <= SLACK_MAX_LENGTH) {
				chunks.push(remaining);
				break;
			}

			let splitAt = SLACK_MAX_LENGTH;

			// Try to split at code block boundaries or newlines
			const lastCodeBlock = remaining.lastIndexOf("```", splitAt);
			const lastNewline = remaining.lastIndexOf("\n", splitAt);

			if (lastNewline > splitAt - 500) {
				splitAt = lastNewline;
			} else if (lastCodeBlock > splitAt - 500) {
				splitAt = lastCodeBlock;
			}

			chunks.push(remaining.substring(0, splitAt));
			remaining = remaining.substring(splitAt).trimStart();
		}

		return chunks;
	}
}
