import { getAgentDir } from "../config";
import { join, resolve } from "path";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "fs";

// ============================================================================
// Session entry types
// ============================================================================

import { AgentState, Api, BaseAssistantEvent, BaseAssistantMessage, generateUUID, Message, UserMessage } from "@ank1015/providers";

export interface SessionHeader {
	type: "session";
	id: string;
	timestamp: string;
	cwd: string;
	provider: string;
	modelId: string;
	branchedFrom?: string;
}

export interface SessionMessageEntry {
	type: "message";
	timestamp: string;
	message: Message;
}

/** Union of all session entry types */
export type SessionEntry =
	| SessionHeader
	| SessionMessageEntry


// ============================================================================
// Session loading with compaction support
// ============================================================================

export interface LoadedSession {
	messages: Message[];
	model: { provider: string; modelId: string } | null;
}

/**
 * Parse session file content into entries.
 */
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

	let model: { provider: string; modelId: string } | null = null;
    const sessionEntry = entries.find(entry => entry.type === 'session');
    if(sessionEntry){
        model = { provider: sessionEntry.provider, modelId: sessionEntry.modelId };
    }

    const messages: Message[] = [];
    for (const entry of entries) {
        if (entry.type === "message") {
            messages.push(entry.message);
        }
    }

    return { messages, model };
}


export class SessionManager {
	private sessionId!: string;
	private sessionFile!: string;
	private sessionDir: string;
	private enabled: boolean = true;
	private sessionInitialized: boolean = false;
	private pendingEntries: SessionEntry[] = [];
	// In-memory entries for --no-session mode (when enabled=false)
	private inMemoryEntries: SessionEntry[] = [];

    constructor(continueSession: boolean = false, customSessionPath?: string) {
		this.sessionDir = this.getSessionDirectory();

		if (customSessionPath) {
			// Use custom session file path
			this.sessionFile = resolve(customSessionPath);
			this.loadSessionId();

			// If file doesn't exist, loadSessionId() won't set sessionId, so generate one
			if (!this.sessionId) {
				this.sessionId = generateUUID();
			}
			// Mark as initialized since we're loading an existing session
			this.sessionInitialized = existsSync(this.sessionFile);
			// Load entries into memory
			if (this.sessionInitialized) {
				this.inMemoryEntries = this.loadEntriesFromFile();
			}
        }else if (continueSession) {
			const mostRecent = this.findMostRecentlyModifiedSession();
			if (mostRecent) {
				this.sessionFile = mostRecent;
				this.loadSessionId();
				// Mark as initialized since we're loading an existing session
				this.sessionInitialized = true;
				// Load entries into memory
				this.inMemoryEntries = this.loadEntriesFromFile();
			} else {
				this.initNewSession();
			}
		} else {
			this.initNewSession();
		}

    }

	private initNewSession(): void {
		this.sessionId = generateUUID();
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		this.sessionFile = join(this.sessionDir, `${timestamp}_${this.sessionId}.jsonl`);
	}

	/** Reset to a fresh session. Clears pending entries and starts a new session file. */
	reset(): void {
		this.pendingEntries = [];
		this.inMemoryEntries = [];
		this.sessionInitialized = false;
		this.initNewSession();
	}

	/** Disable session saving (for --no-session mode) */
	disable() {
		this.enabled = false;
	}

	/** Check if session persistence is enabled */
	isEnabled(): boolean {
		return this.enabled;
	}

	private getSessionDirectory(): string {
		const cwd = process.cwd();
		// Replace all path separators and colons (for Windows drive letters) with dashes
		const safePath = "--" + cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-") + "--";

		const configDir = getAgentDir();
		const sessionDir = join(configDir, "sessions", safePath);
		if (!existsSync(sessionDir)) {
			mkdirSync(sessionDir, { recursive: true });
		}
		return sessionDir;
	}

	private loadSessionId(): void {
		if (!existsSync(this.sessionFile)) return;

		const lines = readFileSync(this.sessionFile, "utf8").trim().split("\n");
		for (const line of lines) {
			try {
				const entry = JSON.parse(line);
				if (entry.type === "session") {
					this.sessionId = entry.id;
					return;
				}
			} catch {
				// Skip malformed lines
			}
		}
		this.sessionId = generateUUID();
	}


	private findMostRecentlyModifiedSession(): string | null {
		try {
			const files = readdirSync(this.sessionDir)
				.filter((f) => f.endsWith(".jsonl"))
				.map((f) => ({
					name: f,
					path: join(this.sessionDir, f),
					mtime: statSync(join(this.sessionDir, f)).mtime,
				}))
				.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

			return files[0]?.path || null;
		} catch {
			return null;
		}
	}

	startSession(state: AgentState): void {
		if (this.sessionInitialized) return;
		this.sessionInitialized = true;

		const entry: SessionHeader = {
			type: "session",
			id: this.sessionId,
			timestamp: new Date().toISOString(),
			cwd: process.cwd(),
			provider: state.provider.model.api,
			modelId: state.provider.model.id,
		};

		// Always track in memory
		this.inMemoryEntries.push(entry);
		for (const pending of this.pendingEntries) {
			this.inMemoryEntries.push(pending);
		}
		this.pendingEntries = [];

		// Write to file only if enabled
		if (this.enabled) {
			appendFileSync(this.sessionFile, JSON.stringify(entry) + "\n");
			for (const memEntry of this.inMemoryEntries.slice(1)) {
				appendFileSync(this.sessionFile, JSON.stringify(memEntry) + "\n");
			}
		}
	}

	saveMessage(message: any): void {
		const entry: SessionMessageEntry = {
			type: "message",
			timestamp: new Date().toISOString(),
			message,
		};

		if (!this.sessionInitialized) {
			this.pendingEntries.push(entry);
		} else {
			// Always track in memory
			this.inMemoryEntries.push(entry);
			// Write to file only if enabled
			if (this.enabled) {
				appendFileSync(this.sessionFile, JSON.stringify(entry) + "\n");
			}
		}
	}

	/**
	 * Load session data (messages, model, thinking level) with compaction support.
	 */
	loadSession(): LoadedSession {
		const entries = this.loadEntries();
		return loadSessionFromEntries(entries);
	}

	getSessionId(): string {
		return this.sessionId;
	}

	getSessionFile(): string {
		return this.sessionFile;
	}

	/**
	 * Load entries directly from the session file (internal helper).
	 */
	private loadEntriesFromFile(): SessionEntry[] {
		if (!existsSync(this.sessionFile)) return [];

		const content = readFileSync(this.sessionFile, "utf8");
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

	/**
	 * Load all entries from the session file or in-memory store.
	 * When file persistence is enabled, reads from file (source of truth for resumed sessions).
	 * When disabled (--no-session), returns in-memory entries.
	 */
	loadEntries(): SessionEntry[] {
		// If file persistence is enabled and file exists, read from file
		if (this.enabled && existsSync(this.sessionFile)) {
			return this.loadEntriesFromFile();
		}

		// Otherwise return in-memory entries (for --no-session mode)
		return [...this.inMemoryEntries];
	}

	/**
	 * Load all sessions for the current directory with metadata
	 */
	loadAllSessions(): Array<{
		path: string;
		id: string;
		created: Date;
		modified: Date;
		messageCount: number;
		firstMessage: string;
		allMessagesText: string;
	}> {
		const sessions: Array<{
			path: string;
			id: string;
			created: Date;
			modified: Date;
			messageCount: number;
			firstMessage: string;
			allMessagesText: string;
		}> = [];

		try {
			const files = readdirSync(this.sessionDir)
				.filter((f) => f.endsWith(".jsonl"))
				.map((f) => join(this.sessionDir, f));

			for (const file of files) {
				try {
					const stats = statSync(file);
					const content = readFileSync(file, "utf8");
					const lines = content.trim().split("\n");

					let sessionId = "";
					let created = stats.birthtime;
					let messageCount = 0;
					let firstMessage = "";
					const allMessages: string[] = [];

					for (const line of lines) {
						try {
							const entry = JSON.parse(line);

							// Extract session ID from first session entry
							if (entry.type === "session" && !sessionId) {
								sessionId = entry.id;
								created = new Date(entry.timestamp);
							}

							// Count messages and collect all text
							if (entry.type === "message") {
								messageCount++;

								// Extract text from user and assistant messages
								if ((entry.message as Message).role === "user" || (entry.message as Message).role === "assistant") {
                                    const message = entry.message;

									const textContent = message.content
										.filter((c: any) => c.type === "text")
										.map((c: any) => c.text)
										.join(" ");

									if (textContent) {
										allMessages.push(textContent);
										// Get first user message for display
										if (!firstMessage && entry.message.role === "user") {
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
						created,
						modified: stats.mtime,
						messageCount,
						firstMessage: firstMessage || "(no messages)",
						allMessagesText: allMessages.join(" "),
					});
				} catch (error) {
					// Skip files that can't be read
					console.error(`Failed to read session file ${file}:`, error);
				}
			}

			// Sort by modified date (most recent first)
			sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
		} catch (error) {
			console.error("Failed to load sessions:", error);
		}
		return sessions;
	}

	/**
	 * Set the session file to an existing session
	 */
	setSessionFile(path: string): void {
		this.sessionFile = path;
		this.loadSessionId();
		// Mark as initialized since we're loading an existing session
		this.sessionInitialized = existsSync(path);
		// Load entries into memory for consistency
		if (this.sessionInitialized) {
			this.inMemoryEntries = this.loadEntriesFromFile();
		} else {
			this.inMemoryEntries = [];
		}
		this.pendingEntries = [];
	}

	/**
	 * Check if we should initialize the session based on message history.
	 * Session is initialized when we have at least 1 user message and 1 assistant message.
	 */
	shouldInitializeSession(messages: any[]): boolean {
		if (this.sessionInitialized) return false;

		const userMessages = messages.filter((m) => m.role === "user");
		const assistantMessages = messages.filter((m) => m.role === "assistant");

		return userMessages.length >= 1 && assistantMessages.length >= 1;
	}

	/**
	 * Create a branched session from a specific message index.
	 * If branchFromIndex is -1, creates an empty session.
	 * Returns the new session file path.
	 */
	createBranchedSession(state: AgentState, branchFromIndex: number): string {
		// Create a new session ID for the branch
		const newSessionId = generateUUID();
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const newSessionFile = join(this.sessionDir, `${timestamp}_${newSessionId}.jsonl`);

		// Write session header
		const entry: SessionHeader = {
			type: "session",
			id: newSessionId,
			timestamp: new Date().toISOString(),
			cwd: process.cwd(),
			provider: state.provider.model.api,
			modelId: state.provider.model.id,
			branchedFrom: this.sessionFile,
		};
		appendFileSync(newSessionFile, JSON.stringify(entry) + "\n");

		// Write messages up to and including the branch point (if >= 0)
		if (branchFromIndex >= 0) {
			const messagesToWrite = state.messages.slice(0, branchFromIndex + 1);
			for (const message of messagesToWrite) {
				const messageEntry: SessionMessageEntry = {
					type: "message",
					timestamp: new Date().toISOString(),
					message,
				};
				appendFileSync(newSessionFile, JSON.stringify(messageEntry) + "\n");
			}
		}
		return newSessionFile;
	}


	/**
	 * Create a branched session from session entries up to (but not including) a specific entry index.
	 * Returns the new session file path, or null if in --no-session mode (in-memory only).
	 */
	createBranchedSessionFromEntries(entries: SessionEntry[], branchBeforeIndex: number): string | null {
		const newSessionId = generateUUID();
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const newSessionFile = join(this.sessionDir, `${timestamp}_${newSessionId}.jsonl`);

		// Build new entries list (up to but not including branch point)
		const newEntries: SessionEntry[] = [];
		for (let i = 0; i < branchBeforeIndex; i++) {
			const entry = entries[i];

			if (entry.type === "session") {
				// Rewrite session header with new ID and branchedFrom
				newEntries.push({
					...entry,
					id: newSessionId,
					timestamp: new Date().toISOString(),
					branchedFrom: this.enabled ? this.sessionFile : undefined,
				});
			} else {
				// Copy other entries as-is
				newEntries.push(entry);
			}
		}

		if (this.enabled) {
			// Write to file
			for (const entry of newEntries) {
				appendFileSync(newSessionFile, JSON.stringify(entry) + "\n");
			}
			return newSessionFile;
		} else {
			// In-memory mode: replace inMemoryEntries, no file created
			this.inMemoryEntries = newEntries;
			this.sessionId = newSessionId;
			return null;
		}
	}

}