import { generateUUID, type Api, type Message, type OptionsForApi } from "@ank1015/providers";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "fs";
import { join, resolve } from "path";
import { getAgentDir as getDefaultAgentDir } from "../config.js";

export interface SessionHeader {
	type: "session";
	id: string;
	timestamp: string;
	cwd: string;
	branchedFrom?: string;
}

export interface SessionMessageEntry {
	type: "message";
	timestamp: string;
	message: Message;
}

export interface SessionProviderEntry {
	type: 'provider';
	modelId: string;
	api: string;
	timestamp: string;
	providerOptions: OptionsForApi<Api>
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

	for (const entry of entries) {
		if (entry.type === 'provider') {
			model = {
				modelId: entry.modelId,
				api: entry.api,
				providerOptions: entry.providerOptions
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

	private constructor(cwd: string, agentDir: string, sessionFile: string | null, persist: boolean) {
		this.cwd = cwd;
		this.sessionDir = getSessionDirectory(cwd, agentDir);
		this.persist = persist;

		if (sessionFile) {
			this.setSessionFile(sessionFile);
		} else {
			this.sessionId = generateUUID();
			const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
			const sessionFile = join(this.sessionDir, `${timestamp}_${this.sessionId}.jsonl`);
			this.setSessionFile(sessionFile);
		}
	}

	/** Switch to a different session file (used for resume and branching) */
	setSessionFile(sessionFile: string): void {
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

	createBranchedSessionFromEntries(entries: SessionEntry[], branchBeforeIndex: number): string | null {
		const newSessionId = generateUUID();
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const newSessionFile = join(this.sessionDir, `${timestamp}_${newSessionId}.jsonl`);

		const newEntries: SessionEntry[] = [];
		for (let i = 0; i < branchBeforeIndex; i++) {
			const entry = entries[i];

			if (entry.type === "session") {
				newEntries.push({
					...entry,
					id: newSessionId,
					timestamp: new Date().toISOString(),
					branchedFrom: this.persist ? this.sessionFile : undefined,
				});
			} else {
				newEntries.push(entry);
			}
		}

		if (this.persist) {
			for (const entry of newEntries) {
				appendFileSync(newSessionFile, `${JSON.stringify(entry)}\n`);
			}
			return newSessionFile;
		}
		this.inMemoryEntries = newEntries;
		this.sessionId = newSessionId;
		return null;
	}

	/** Create a new session for the given directory */
	static create(cwd: string, agentDir: string = getDefaultAgentDir()): SessionManager {
		return new SessionManager(cwd, agentDir, null, true);
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
	static continueRecent(cwd: string, agentDir: string = getDefaultAgentDir()): SessionManager {
		const sessionDir = getSessionDirectory(cwd, agentDir);
		const mostRecent = findMostRecentSession(sessionDir);
		if (mostRecent) {
			return new SessionManager(cwd, agentDir, mostRecent, true);
		}
		return new SessionManager(cwd, agentDir, null, true);
	}

	/** Create an in-memory session (no file persistence) */
	static inMemory(): SessionManager {
		return new SessionManager(process.cwd(), getDefaultAgentDir(), null, false);
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
					let created = stats.birthtime;
					let messageCount = 0;
					let firstMessage = "";
					const allMessages: string[] = [];

					for (const line of lines) {
						try {
							const entry = JSON.parse(line);

							if (entry.type === "session" && !sessionId) {
								sessionId = entry.id;
								created = new Date(entry.timestamp);
							}

							if (entry.type === "message") {
								messageCount++;
								const message = entry.message as Message;

								if (message.role === "user" || message.role === "assistant") {
									const textContent = message.content
										.filter((c: any) => c.type === "text")
										.map((c: any) => c.text)
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
