/**
 * Shared types for remote control system.
 */

/**
 * Normalized attachment from any platform.
 */
export interface RemoteAttachment {
	type: "image" | "file" | "audio" | "video";
	url: string;
	filename?: string;
	mimeType?: string;
	size?: number;
}

/**
 * Normalized message from any platform.
 */
export interface RemoteMessage {
	/** Unique message ID from the platform */
	id: string;

	/** Channel/conversation ID */
	channelId: string;

	/** User ID who sent the message */
	userId: string;

	/** Display name of the user */
	username: string;

	/** Message text content */
	text: string;

	/** Optional attachments */
	attachments?: RemoteAttachment[];

	/** Platform identifier */
	platform: string;

	/** Original platform message (for advanced use) */
	raw?: unknown;
}

/**
 * Handler for incoming messages.
 */
export type MessageHandler = (message: RemoteMessage) => void | Promise<void>;

/**
 * Response to send back to the platform.
 */
export interface RemoteResponse {
	/** Text content to send */
	text: string;

	/** Optional: reply to specific message */
	replyToId?: string;
}
