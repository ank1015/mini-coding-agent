import { generateUUID, type Api, type Message, type OptionsForApi } from "@ank1015/providers";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "fs";
import { join, resolve } from "path";
import { getAgentDir as getDefaultAgentDir } from "../config.js";

export interface SessionHeader {
	type: "session";
	id: string;
	timestamp: string;
	cwd: string;
	// Initial model/provider info
	api?: string;
	modelId?: string;
	providerOptions?: OptionsForApi<Api>;
	// Branching info
	parent?: {
		sessionId: string;
		messageId: string | null;
	};
}

export interface SessionMessageEntry {
	type: "message";
	timestamp: string;
	message: Message;
}

export interface SessionProviderEntry {
	type: 'provider';
	timestamp: string;
	modelId?: string;
	api?: string;
	providerOptions?: OptionsForApi<Api>
}

export type SessionEntry =
	| SessionHeader
	| SessionProviderEntry
	| SessionMessageEntry

export interface LoadedSession {
	messages: Message[];
	model: { api: string; modelId: string, providerOptions: OptionsForApi<Api> } | null;
}

export interface SessionInfo {
	path: string;
	id: string;
	parentId?: string;
	parentMessageId?: string | null;
	created: Date;
	modified: Date;
	messageCount: number;
	firstMessage: string;
	allMessagesText: string;
}

export function parseSessionEntries(content: string): SessionEntry[] {
	const entries: SessionEntry[] = [];
	const lines = content.trim().split("\n");

	for (const line of lines) {
		if (!line.trim()) continue;
		try {
			const entry = JSON.parse(line) as SessionEntry;
			entries.push(entry);
		} catch {
			// Skip malformed lines
		}
	}

	return entries;
}

export function loadSessionFromEntries(entries: SessionEntry[]): LoadedSession {
	let model: { api: string; modelId: string, providerOptions: OptionsForApi<Api> } | null = null;

	// 1. Start with model from SessionHeader (if present)
	const header = entries.find(e => e.type === "session") as SessionHeader | undefined;
	if (header?.api && header?.modelId && header?.providerOptions) {
		model = {
			api: header.api,
			modelId: header.modelId,
			providerOptions: header.providerOptions
		};
	}

	// 2. Apply provider entries chronologically (later ones override)
	for (const entry of entries) {
		if (entry.type === 'provider') {
			// Only set model if all required fields are present
			if (entry.modelId && entry.api && entry.providerOptions) {
				model = {
					modelId: entry.modelId,
					api: entry.api,
					providerOptions: entry.providerOptions
				}
			}
		}
	}

	const messages: Message[] = [];
	for (const entry of entries) {
		if (entry.type === "message") {
			messages.push(entry.message);
		}
	}
	return { messages, model };
}

function getSessionDirectory(cwd: string, agentDir: string): string {
	const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	const sessionDir = join(agentDir, "sessions", safePath);
	if (!existsSync(sessionDir)) {
		mkdirSync(sessionDir, { recursive: true });
	}
	return sessionDir;
}

function loadEntriesFromFile(filePath: string): SessionEntry[] {
	if (!existsSync(filePath)) return [];

	const content = readFileSync(filePath, "utf8");
	const entries: SessionEntry[] = [];
	const lines = content.trim().split("\n");

	for (const line of lines) {
		if (!line.trim()) continue;
		try {
			const entry = JSON.parse(line) as SessionEntry;
			entries.push(entry);
		} catch {
			// Skip malformed lines
		}
	}

	return entries;
}

function findMostRecentSession(sessionDir: string): string | null {
	try {
		const files = readdirSync(sessionDir)
			.filter((f) => f.endsWith(".jsonl"))
			.map((f) => ({
				path: join(sessionDir, f),
				mtime: statSync(join(sessionDir, f)).mtime,
			}))
			.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

		return files[0]?.path || null;
	} catch {
		return null;
	}
}

export class SessionManager {
	private sessionId: string = "";
	private sessionFile: string = "";
	private sessionDir: string;
	private cwd: string;
	private persist: boolean;
	private flushed: boolean = false;
	private inMemoryEntries: SessionEntry[] = [];

	private constructor(
		cwd: string,
		agentDir: string,
		sessionFile: string | null,
		persist: boolean,
		initialProvider?: { api: string; modelId: string; providerOptions: OptionsForApi<Api> }
	) {
		this.cwd = cwd;
		this.sessionDir = getSessionDirectory(cwd, agentDir);
		this.persist = persist;

		if (sessionFile) {
			this.setSessionFile(sessionFile);
		} else {
			this.sessionId = generateUUID();
			const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
			const sessionFile = join(this.sessionDir, `${timestamp}_${this.sessionId}.jsonl`);
			this.setSessionFile(sessionFile, initialProvider);
		}
	}

	/** Switch to a different session file (used for resume and branching) */
	setSessionFile(
		sessionFile: string,
		initialProvider?: { api: string; modelId: string; providerOptions: OptionsForApi<Api> }
	): void {
		this.sessionFile = resolve(sessionFile);
		if (existsSync(this.sessionFile)) {
			this.inMemoryEntries = loadEntriesFromFile(this.sessionFile);
			const header = this.inMemoryEntries.find((e) => e.type === "session");
			this.sessionId = header ? (header as SessionHeader).id : generateUUID();
			this.flushed = true;
		} else {
			this.sessionId = generateUUID();
			this.inMemoryEntries = [];
			this.flushed = false;
			const entry: SessionHeader = {
				type: "session",
				id: this.sessionId,
				timestamp: new Date().toISOString(),
				cwd: this.cwd,
				api: initialProvider?.api,
				modelId: initialProvider?.modelId,
				providerOptions: initialProvider?.providerOptions,
			};
			this.inMemoryEntries.push(entry);
		}
	}

	isPersisted(): boolean {
		return this.persist;
	}

	getCwd(): string {
		return this.cwd;
	}

	getSessionId(): string {
		return this.sessionId;
	}

	getSessionFile(): string {
		return this.sessionFile;
	}

	reset(): void {
		this.sessionId = generateUUID();
		this.flushed = false;
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		this.sessionFile = join(this.sessionDir, `${timestamp}_${this.sessionId}.jsonl`);
		this.inMemoryEntries = [
			{
				type: "session",
				id: this.sessionId,
				timestamp: new Date().toISOString(),
				cwd: this.cwd,
			},
		];
	}

	_persist(entry: SessionEntry): void {
		if (!this.persist) return;

		const hasAssistant = this.inMemoryEntries.some((e) => e.type === "message" && e.message.role === "assistant");
		if (!hasAssistant) return;

		if (!this.flushed) {
			for (const e of this.inMemoryEntries) {
				appendFileSync(this.sessionFile, `${JSON.stringify(e)}\n`);
			}
			this.flushed = true;
		} else {
			appendFileSync(this.sessionFile, `${JSON.stringify(entry)}\n`);
		}
	}

	saveMessage(message: any): void {
		const entry: SessionMessageEntry = {
			type: "message",
			timestamp: new Date().toISOString(),
			message,
		};
		this.inMemoryEntries.push(entry);
		this._persist(entry);
	}

	saveProvider(api: string, modelId: string, providerOptions: OptionsForApi<Api>): void {
		const entry: SessionProviderEntry = {
			type: "provider",
			timestamp: new Date().toISOString(),
			api,
			modelId,
			providerOptions
		};
		this.inMemoryEntries.push(entry);
		this._persist(entry);
	}

	loadSession(): LoadedSession {
		const entries = this.loadEntries();
		return loadSessionFromEntries(entries);
	}

	loadMessages(): Message[] {
		return this.loadSession().messages;
	}

	loadModel(): { api: string; modelId: string; providerOptions: OptionsForApi<Api> } | null {
		return this.loadSession().model;
	}

	loadEntries(): SessionEntry[] {
		if (this.inMemoryEntries.length > 0) {
			return [...this.inMemoryEntries];
		} else {
			return loadEntriesFromFile(this.sessionFile);
		}
	}

	/**
	 * Create a branch of the current session starting from the state BEFORE the specified message ID.
	 * The specified message and all subsequent messages are excluded from the new branch.
	 */
	branch(messageId: string): string {
		const entries = this.loadEntries();

		// Find index of the target message
		const splitIndex = entries.findIndex(e => e.type === "message" && e.message.id === messageId);

		if (splitIndex === -1) {
			throw new Error(`Message with ID ${messageId} not found in current session.`);
		}

		// Slice entries: everything before the target message
		// We skip the original header (index 0) because we'll make a new one
		// We start slice at 1 to skip original header
		const historyEntries = entries.slice(1, splitIndex);

		// Find the anchor (last message in the sliced history)
		let parentMessageId: string | null = null;
		for (let i = historyEntries.length - 1; i >= 0; i--) {
			const entry = historyEntries[i];
			if (entry.type === "message") {
				parentMessageId = entry.message.id;
				break;
			}
		}

		// Generate new Session ID
		const newSessionId = generateUUID();
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const newSessionFile = join(this.sessionDir, `${timestamp}_${newSessionId}.jsonl`);

		// Create new Header
		// We need the original header to get cwd and initial provider info
		const originalHeader = entries.find(e => e.type === "session") as SessionHeader;

		const newHeader: SessionHeader = {
			type: "session",
			id: newSessionId,
			timestamp: new Date().toISOString(),
			cwd: this.cwd, // or originalHeader.cwd
			api: originalHeader?.api,
			modelId: originalHeader?.modelId,
			providerOptions: originalHeader?.providerOptions,
			parent: {
				sessionId: this.sessionId,
				messageId: parentMessageId
			}
		};

		// Write new file
		// 1. Header
		appendFileSync(newSessionFile, JSON.stringify(newHeader) + "\n");
		// 2. History
		for (const entry of historyEntries) {
			appendFileSync(newSessionFile, JSON.stringify(entry) + "\n");
		}

		return newSessionFile;
	}

	/** Create a new session for the given directory */
	static create(
		cwd: string,
		agentDir: string = getDefaultAgentDir(),
		initialProvider?: { api: string; modelId: string; providerOptions: OptionsForApi<Api> }
	): SessionManager {
		return new SessionManager(cwd, agentDir, null, true, initialProvider);
	}

	/** Open a specific session file */
	static open(path: string, agentDir: string = getDefaultAgentDir()): SessionManager {
		// Extract cwd from session header if possible, otherwise use process.cwd()
		const entries = loadEntriesFromFile(path);
		const header = entries.find((e) => e.type === "session") as SessionHeader | undefined;
		const cwd = header?.cwd ?? process.cwd();
		return new SessionManager(cwd, agentDir, path, true);
	}

	/** Continue the most recent session for the given directory, or create new if none */
	static continueRecent(
		cwd: string,
		agentDir: string = getDefaultAgentDir(),
		initialProvider?: { api: string; modelId: string; providerOptions: OptionsForApi<Api> }
	): SessionManager {
		const sessionDir = getSessionDirectory(cwd, agentDir);
		const mostRecent = findMostRecentSession(sessionDir);
		if (mostRecent) {
			return new SessionManager(cwd, agentDir, mostRecent, true);
		}
		return new SessionManager(cwd, agentDir, null, true, initialProvider);
	}

	/** Create an in-memory session (no file persistence) */
	static inMemory(
		initialProvider?: { api: string; modelId: string; providerOptions: OptionsForApi<Api> }
	): SessionManager {
		return new SessionManager(process.cwd(), getDefaultAgentDir(), null, false, initialProvider);
	}

	/** List all sessions for a directory */
	static list(cwd: string, agentDir: string = getDefaultAgentDir()): SessionInfo[] {
		const sessionDir = getSessionDirectory(cwd, agentDir);
		const sessions: SessionInfo[] = [];

		try {
			const files = readdirSync(sessionDir)
				.filter((f) => f.endsWith(".jsonl"))
				.map((f) => join(sessionDir, f));

			for (const file of files) {
				try {
					const stats = statSync(file);
					const content = readFileSync(file, "utf8");
					const lines = content.trim().split("\n");

					let sessionId = "";
					let parentId: string | undefined;
					let parentMessageId: string | null | undefined;
					let created = stats.birthtime;
					let messageCount = 0;
					let firstMessage = "";
					const allMessages: string[] = [];

					for (const line of lines) {
						try {
							const entry = JSON.parse(line);

							if (entry.type === "session" && !sessionId) {
								const sessionEntry = entry as SessionHeader;
								sessionId = sessionEntry.id;
								created = new Date(sessionEntry.timestamp);
								if (sessionEntry.parent) {
									parentId = sessionEntry.parent.sessionId;
									parentMessageId = sessionEntry.parent.messageId;
								}
							}

							if (entry.type === "message") {
								messageCount++;
								const message = entry.message as Message;

								if (message.role === "user" || message.role === "assistant") {
									const textContent = message.content
										.filter((c: any) => c.type === "text")
										.map((c: any) => c.content)
										.join(" ");

									if (textContent) {
										allMessages.push(textContent);

										if (!firstMessage && message.role === "user") {
											firstMessage = textContent;
										}
									}
								}
							}
						} catch {
							// Skip malformed lines
						}
					}

					sessions.push({
						path: file,
						id: sessionId || "unknown",
						parentId,
						parentMessageId,
						created,
						modified: stats.mtime,
						messageCount,
						firstMessage: firstMessage || "(no messages)",
						allMessagesText: allMessages.join(" "),
					});
				} catch {
					// Skip files that can't be read
				}
			}

			sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
		} catch {
			// Return empty list on error
		}

		return sessions;
	}
}
