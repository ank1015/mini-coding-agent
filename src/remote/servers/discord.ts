/**
 * DiscordServer - Discord bot integration for RemoteAgent.
 *
 * Connects to Discord via WebSocket (outbound only, no ports exposed).
 * Listens for messages and routes them to the agent.
 */

import { Client, Events, GatewayIntentBits, type Message, type TextChannel } from "discord.js";
import { RemoteServer, type RemoteServerConfig } from "../remote-server.js";
import type { RemoteAttachment, RemoteResponse } from "../types.js";

/** Discord message character limit */
const DISCORD_MAX_LENGTH = 2000;

export interface DiscordServerConfig extends RemoteServerConfig {
	/** Discord bot token (required) */
	token: string;

	/** Only respond to DMs (direct messages) */
	dmOnly?: boolean;

	/** Only respond when mentioned (@bot) */
	requireMention?: boolean;
}

export class DiscordServer extends RemoteServer {
	private discordConfig: DiscordServerConfig;
	private client: Client;
	private botUserId: string | null = null;

	constructor(config: DiscordServerConfig) {
		super(config);
		this.discordConfig = config;

		this.client = new Client({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.DirectMessages,
				GatewayIntentBits.MessageContent,
			],
		});
	}

	get platform(): string {
		return "discord";
	}

	async start(): Promise<void> {
		if (this._isConnected) {
			return;
		}

		// Set up event handlers before login
		this.client.once(Events.ClientReady, (readyClient) => {
			this.botUserId = readyClient.user.id;
			console.log(`[Discord] Logged in as ${readyClient.user.tag}`);
		});

		this.client.on(Events.MessageCreate, async (message) => {
			await this.onDiscordMessage(message);
		});

		// Login to Discord
		await this.client.login(this.discordConfig.token);
		this._isConnected = true;
	}

	async stop(): Promise<void> {
		if (this.client) {
			this.client.destroy();
		}
		this._isConnected = false;
		console.log("[Discord] Disconnected");
	}

	async sendMessage(channelId: string, response: RemoteResponse): Promise<void> {
		const channel = await this.client.channels.fetch(channelId);

		if (!channel || !("send" in channel)) {
			console.error(`[Discord] Cannot send to channel ${channelId}`);
			return;
		}

		const textChannel = channel as TextChannel;

		// Split long messages
		const chunks = this.splitMessage(response.text);

		for (const chunk of chunks) {
			if (response.replyToId && chunks.indexOf(chunk) === 0) {
				// Reply to the original message for the first chunk
				try {
					const originalMessage = await textChannel.messages.fetch(response.replyToId);
					await originalMessage.reply(chunk);
				} catch {
					// If we can't fetch the original, just send normally
					await textChannel.send(chunk);
				}
			} else {
				await textChannel.send(chunk);
			}
		}
	}

	async sendTypingIndicator(channelId: string): Promise<void> {
		try {
			const channel = await this.client.channels.fetch(channelId);
			if (channel && "sendTyping" in channel) {
				await (channel as TextChannel).sendTyping();
			}
		} catch {
			// Ignore typing indicator errors
		}
	}

	/**
	 * Handle incoming Discord message.
	 */
	private async onDiscordMessage(message: Message): Promise<void> {
		// Ignore bot messages
		if (message.author.bot) {
			return;
		}

		// Check DM-only mode
		if (this.discordConfig.dmOnly && message.guild) {
			return; // Ignore non-DM messages
		}

		// Check mention requirement
		if (this.discordConfig.requireMention && this.botUserId) {
			if (!message.mentions.has(this.botUserId)) {
				return; // Ignore messages that don't mention the bot
			}
		}

		// Extract text (remove bot mention if present)
		let text = message.content;
		if (this.botUserId) {
			text = text.replace(new RegExp(`<@!?${this.botUserId}>`, "g"), "").trim();
		}

		// Convert attachments
		const attachments: RemoteAttachment[] = message.attachments.map((att) => ({
			type: this.getAttachmentType(att.contentType),
			url: att.url,
			filename: att.name || undefined,
			mimeType: att.contentType || undefined,
			size: att.size,
		}));

		// Create normalized message
		const remoteMessage = {
			id: message.id,
			channelId: message.channelId,
			userId: message.author.id,
			username: message.author.username,
			text,
			attachments: attachments.length > 0 ? attachments : undefined,
			platform: "discord",
			raw: message,
		};

		// Dispatch to handlers
		await this.handleIncomingMessage(remoteMessage);
	}

	/**
	 * Determine attachment type from MIME type.
	 */
	private getAttachmentType(mimeType: string | null): RemoteAttachment["type"] {
		if (!mimeType) return "file";
		if (mimeType.startsWith("image/")) return "image";
		if (mimeType.startsWith("audio/")) return "audio";
		if (mimeType.startsWith("video/")) return "video";
		return "file";
	}

	/**
	 * Split a message into chunks that fit Discord's character limit.
	 * Tries to split at natural boundaries (newlines, spaces).
	 * Preserves code blocks.
	 */
	private splitMessage(text: string): string[] {
		if (text.length <= DISCORD_MAX_LENGTH) {
			return [text];
		}

		const chunks: string[] = [];
		let remaining = text;

		while (remaining.length > 0) {
			if (remaining.length <= DISCORD_MAX_LENGTH) {
				chunks.push(remaining);
				break;
			}

			// Find a good split point
			let splitAt = DISCORD_MAX_LENGTH;

			// Check if we're in a code block
			const codeBlockStart = remaining.lastIndexOf("```", splitAt);
			const codeBlockEnd = remaining.lastIndexOf("```", codeBlockStart - 1);

			// If we have an unclosed code block, try to close it properly
			if (codeBlockStart > codeBlockEnd) {
				// We're inside a code block, find where it started
				const blockContent = remaining.substring(0, splitAt);
				const lastNewline = blockContent.lastIndexOf("\n");

				if (lastNewline > codeBlockStart) {
					// Split at the last newline inside the code block
					splitAt = lastNewline;
				}
			} else {
				// Not in a code block, try to split at newline or space
				const lastNewline = remaining.lastIndexOf("\n", splitAt);
				const lastSpace = remaining.lastIndexOf(" ", splitAt);

				if (lastNewline > splitAt - 500) {
					splitAt = lastNewline;
				} else if (lastSpace > splitAt - 200) {
					splitAt = lastSpace;
				}
			}

			chunks.push(remaining.substring(0, splitAt));
			remaining = remaining.substring(splitAt).trimStart();
		}

		return chunks;
	}
}
