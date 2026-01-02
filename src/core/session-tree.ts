/**
 * SessionTree - Tree-based session manager with branching support.
 *
 * Each message is a node with a parent pointer, allowing:
 * - Branches: different nodes sharing common ancestors
 * - Flexible context building strategies
 * - Summarization and merge nodes
 * - No data duplication when branching
 *
 * Storage: JSONL with append-only writes for nodes, occasional pointer updates.
 */

import { generateUUID, type Api, type Message, type OptionsForApi } from "@ank1015/providers";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "fs";
import { join, resolve } from "path";
import { getAgentDir as getDefaultAgentDir } from "../config.js";

// ============================================================================
// Types
// ============================================================================

/** Header entry - first line of session file */
export interface TreeHeader {
	type: 'tree';
	id: string;
	cwd: string;
	created: string;
	defaultBranch: string;
	// Initial provider info (optional)
	api?: string;
	modelId?: string;
	providerOptions?: OptionsForApi<Api>;
}

/** Base fields shared by all nodes */
export interface BaseNode {
	id: string;
	parentId: string | null;
	branch: string;
	timestamp: string;
}

/** Regular message node */
export interface MessageNode extends BaseNode {
	type: 'message';
	message: Message;
}

/** Provider/model change node */
export interface ProviderNode extends BaseNode {
	type: 'provider';
	api: string;
	modelId: string;
	providerOptions: OptionsForApi<Api>;
}

/** Summary node - compresses multiple nodes into one */
export interface SummaryNode extends BaseNode {
	type: 'summary';
	content: string;
	summarizes: string[]; // Node IDs this summary covers
}

/** Merge node - summary of content merged from another branch */
export interface MergeNode extends BaseNode {
	type: 'merge';
	content: string;
	fromBranch: string;
	fromNodeId: string; // Head of merged branch at merge time
}

/** Checkpoint node - named marker for navigation */
export interface CheckpointNode extends BaseNode {
	type: 'checkpoint';
	name: string;
	metadata?: Record<string, unknown>;
}

/** Custom node - extensibility escape hatch */
export interface CustomNode extends BaseNode {
	type: 'custom';
	subtype: string;
	data: unknown;
	contextBehavior?: 'include' | 'skip' | 'terminal';
}

/** Branch pointer - tracks active branch */
export interface ActiveBranch {
	type: 'active';
	branch: string;
	timestamp: string;
}

/** Union of all node types (excludes header and active pointer) */
export type TreeNode =
	| MessageNode
	| ProviderNode
	| SummaryNode
	| MergeNode
	| CheckpointNode
	| CustomNode;

/** Union of all entry types in a session file */
export type TreeEntry = TreeHeader | TreeNode | ActiveBranch;

// ============================================================================
// Context Strategy Types
// ============================================================================

export type ContextStrategy =
	| { type: 'full' }
	| { type: 'recent'; count: number }
	| { type: 'since-checkpoint'; name: string }
	| { type: 'use-summaries' }
	| { type: 'custom'; fn: (lineage: TreeNode[]) => Message[] };

// ============================================================================
// Info Types for Listing
// ============================================================================

export interface SessionInfo {
	file: string;
	id: string;
	cwd: string;
	created: Date;
	modified: Date;
	branches: string[];
	activeBranch: string;
	messageCount: number;
	firstMessage: string;
}

export interface BranchInfo {
	name: string;
	headNodeId: string | null;
	messageCount: number;
	created: Date;
	lastModified: Date;
}

// ============================================================================
// Loaded Session Type (for compatibility)
// ============================================================================

export interface LoadedSession {
	messages: Message[];
	model: { api: string; modelId: string; providerOptions: OptionsForApi<Api> } | null;
}

// ============================================================================
// Helper Functions
// ============================================================================

function getSessionDirectory(cwd: string, agentDir: string): string {
	const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	const sessionDir = join(agentDir, "sessions", safePath);
	if (!existsSync(sessionDir)) {
		mkdirSync(sessionDir, { recursive: true });
	}
	return sessionDir;
}

function parseEntries(content: string): TreeEntry[] {
	const entries: TreeEntry[] = [];
	const lines = content.trim().split("\n");

	for (const line of lines) {
		if (!line.trim()) continue;
		try {
			const entry = JSON.parse(line) as TreeEntry;
			entries.push(entry);
		} catch {
			// Skip malformed lines
		}
	}

	return entries;
}

function isNode(entry: TreeEntry): entry is TreeNode {
	return entry.type !== 'tree' && entry.type !== 'active';
}

// ============================================================================
// SessionTree Class
// ============================================================================

export class SessionTree {
	private _file: string;
	private _header: TreeHeader;
	private _entries: TreeEntry[] = [];
	private _nodeMap: Map<string, TreeNode> = new Map();
	private _activeBranch: string;
	private _persist: boolean;
	private _flushed: boolean = false;

	// Track pending branch creation (branch name -> parent node ID)
	private _pendingBranches: Map<string, string> = new Map();

	private constructor(
		file: string,
		header: TreeHeader,
		entries: TreeEntry[],
		persist: boolean
	) {
		this._file = file ? resolve(file) : '';
		this._header = header;
		this._entries = entries;
		this._persist = persist;

		// Build node map and find active branch
		this._activeBranch = header.defaultBranch;
		for (const entry of entries) {
			if (isNode(entry)) {
				this._nodeMap.set(entry.id, entry);
			} else if (entry.type === 'active') {
				this._activeBranch = entry.branch;
			}
		}
	}

	// =========================================================================
	// Properties
	// =========================================================================

	get id(): string {
		return this._header.id;
	}

	get cwd(): string {
		return this._header.cwd;
	}

	get file(): string {
		return this._file;
	}

	get activeBranch(): string {
		return this._activeBranch;
	}

	get defaultBranch(): string {
		return this._header.defaultBranch;
	}

	isPersisted(): boolean {
		return this._persist;
	}

	// =========================================================================
	// Node Operations
	// =========================================================================

	appendMessage(message: Message, branch?: string): MessageNode {
		const targetBranch = branch ?? this._activeBranch;
		const parentId = this._getParentIdForBranch(targetBranch);

		const node: MessageNode = {
			type: 'message',
			id: message.id ?? generateUUID(),
			parentId,
			branch: targetBranch,
			timestamp: new Date().toISOString(),
			message,
		};

		this._appendNode(node);
		return node;
	}

	appendProvider(
		api: string,
		modelId: string,
		providerOptions: OptionsForApi<Api>,
		branch?: string
	): ProviderNode {
		const targetBranch = branch ?? this._activeBranch;
		const parentId = this._getParentIdForBranch(targetBranch);

		const node: ProviderNode = {
			type: 'provider',
			id: generateUUID(),
			parentId,
			branch: targetBranch,
			timestamp: new Date().toISOString(),
			api,
			modelId,
			providerOptions,
		};

		this._appendNode(node);
		return node;
	}

	appendSummary(content: string, summarizes: string[], branch?: string): SummaryNode {
		const targetBranch = branch ?? this._activeBranch;
		const parentId = this._getParentIdForBranch(targetBranch);

		const node: SummaryNode = {
			type: 'summary',
			id: generateUUID(),
			parentId,
			branch: targetBranch,
			timestamp: new Date().toISOString(),
			content,
			summarizes,
		};

		this._appendNode(node);
		return node;
	}

	appendCheckpoint(name: string, metadata?: Record<string, unknown>, branch?: string): CheckpointNode {
		const targetBranch = branch ?? this._activeBranch;
		const parentId = this._getParentIdForBranch(targetBranch);

		const node: CheckpointNode = {
			type: 'checkpoint',
			id: generateUUID(),
			parentId,
			branch: targetBranch,
			timestamp: new Date().toISOString(),
			name,
			metadata,
		};

		this._appendNode(node);
		return node;
	}

	appendCustom(
		subtype: string,
		data: unknown,
		contextBehavior?: 'include' | 'skip' | 'terminal',
		branch?: string
	): CustomNode {
		const targetBranch = branch ?? this._activeBranch;
		const parentId = this._getParentIdForBranch(targetBranch);

		const node: CustomNode = {
			type: 'custom',
			id: generateUUID(),
			parentId,
			branch: targetBranch,
			timestamp: new Date().toISOString(),
			subtype,
			data,
			contextBehavior,
		};

		this._appendNode(node);
		return node;
	}

	/**
	 * Merge a branch into the current (or specified) branch.
	 * Creates a MergeNode with summary content.
	 */
	merge(fromBranch: string, summaryContent: string, intoBranch?: string): MergeNode {
		const targetBranch = intoBranch ?? this._activeBranch;
		const parentId = this._getParentIdForBranch(targetBranch);
		const fromHead = this.getHeadNode(fromBranch);

		if (!fromHead) {
			throw new Error(`Branch '${fromBranch}' has no nodes to merge.`);
		}

		const node: MergeNode = {
			type: 'merge',
			id: generateUUID(),
			parentId,
			branch: targetBranch,
			timestamp: new Date().toISOString(),
			content: summaryContent,
			fromBranch,
			fromNodeId: fromHead.id,
		};

		this._appendNode(node);
		return node;
	}

	/**
	 * Get parent ID for a new node on a branch.
	 * Handles pending branches (created with specific fromNodeId).
	 */
	private _getParentIdForBranch(branch: string): string | null {
		// Check if there's a pending branch start point
		const pendingParent = this._pendingBranches.get(branch);
		if (pendingParent) {
			this._pendingBranches.delete(branch);
			return pendingParent;
		}

		// Otherwise, use the current head of the branch
		const head = this.getHeadNode(branch);
		return head?.id ?? null;
	}

	private _appendNode(node: TreeNode): void {
		this._entries.push(node);
		this._nodeMap.set(node.id, node);
		this._persistEntry(node);
	}

	private _persistEntry(entry: TreeEntry): void {
		if (!this._persist) return;

		// Only persist after we have at least one assistant message
		const hasAssistant = Array.from(this._nodeMap.values()).some(
			n => n.type === 'message' && n.message.role === 'assistant'
		);
		if (!hasAssistant) return;

		if (!this._flushed) {
			// Flush all entries (header + all nodes so far)
			for (const e of this._entries) {
				appendFileSync(this._file, JSON.stringify(e) + '\n');
			}
			this._flushed = true;
		} else {
			appendFileSync(this._file, JSON.stringify(entry) + '\n');
		}
	}

	// =========================================================================
	// Branch Operations
	// =========================================================================

	getBranches(): string[] {
		const branches = new Set<string>();
		for (const entry of this._entries) {
			if (isNode(entry)) {
				branches.add(entry.branch);
			}
		}
		// Always include default branch
		branches.add(this._header.defaultBranch);
		return Array.from(branches);
	}

	getBranchInfo(branchName: string): BranchInfo | null {
		const branchNodes = Array.from(this._nodeMap.values())
			.filter(n => n.branch === branchName)
			.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

		if (branchNodes.length === 0) {
			// Branch exists but has no nodes (default branch case)
			if (branchName === this._header.defaultBranch) {
				return {
					name: branchName,
					headNodeId: null,
					messageCount: 0,
					created: new Date(this._header.created),
					lastModified: new Date(this._header.created),
				};
			}
			return null;
		}

		const messageCount = branchNodes.filter(n => n.type === 'message').length;
		const head = branchNodes[branchNodes.length - 1];
		const first = branchNodes[0];

		return {
			name: branchName,
			headNodeId: head.id,
			messageCount,
			created: new Date(first.timestamp),
			lastModified: new Date(head.timestamp),
		};
	}

	switchBranch(name: string): void {
		// Verify branch exists (has at least one node, is default, or is pending)
		const branches = this.getBranches();
		const isPending = this._pendingBranches.has(name);

		if (!branches.includes(name) && !isPending) {
			throw new Error(`Branch '${name}' does not exist.`);
		}

		this._activeBranch = name;

		const activeEntry: ActiveBranch = {
			type: 'active',
			branch: name,
			timestamp: new Date().toISOString(),
		};
		this._entries.push(activeEntry);
		this._persistEntry(activeEntry);
	}

	/**
	 * Create a new branch from a specific node (or current head).
	 * Does NOT switch to the new branch automatically.
	 */
	createBranch(name: string, fromNodeId?: string): void {
		// Check if branch already exists
		const branches = this.getBranches();
		if (branches.includes(name)) {
			throw new Error(`Branch '${name}' already exists.`);
		}

		// Determine the parent node ID
		let parentId: string | null = null;

		if (fromNodeId) {
			// Verify node exists
			if (!this._nodeMap.has(fromNodeId)) {
				throw new Error(`Node '${fromNodeId}' does not exist.`);
			}
			parentId = fromNodeId;
		} else {
			// Use current head
			const head = this.getHeadNode();
			parentId = head?.id ?? null;
		}

		// Store pending parent for when first node is added to this branch
		if (parentId) {
			this._pendingBranches.set(name, parentId);
		}
	}

	// =========================================================================
	// Navigation
	// =========================================================================

	getHeadNode(branch?: string): TreeNode | null {
		const targetBranch = branch ?? this._activeBranch;

		// Find last node on this branch
		let head: TreeNode | null = null;
		for (const entry of this._entries) {
			if (isNode(entry) && entry.branch === targetBranch) {
				head = entry;
			}
		}
		return head;
	}

	getNode(id: string): TreeNode | null {
		return this._nodeMap.get(id) ?? null;
	}

	/**
	 * Get lineage from root to the specified node.
	 * Returns nodes in order: [root, ..., node]
	 */
	getLineage(nodeId: string): TreeNode[] {
		const lineage: TreeNode[] = [];
		let current = this._nodeMap.get(nodeId);

		while (current) {
			lineage.unshift(current); // prepend
			if (current.parentId) {
				current = this._nodeMap.get(current.parentId);
			} else {
				break;
			}
		}

		return lineage;
	}

	/**
	 * Get direct children of a node.
	 */
	getChildren(nodeId: string): TreeNode[] {
		return Array.from(this._nodeMap.values())
			.filter(n => n.parentId === nodeId);
	}

	// =========================================================================
	// Context Building
	// =========================================================================

	buildContext(branch?: string, strategy: ContextStrategy = { type: 'full' }): Message[] {
		const targetBranch = branch ?? this._activeBranch;
		const head = this.getHeadNode(targetBranch);

		if (!head) {
			return [];
		}

		const lineage = this.getLineage(head.id);
		return this._applyStrategy(lineage, strategy);
	}

	private _applyStrategy(lineage: TreeNode[], strategy: ContextStrategy): Message[] {
		switch (strategy.type) {
			case 'full':
				return this._extractMessages(lineage);

			case 'recent': {
				// Get last N message nodes
				const messageNodes = lineage.filter(n => n.type === 'message');
				const recent = messageNodes.slice(-strategy.count);
				return recent.map(n => (n as MessageNode).message);
			}

			case 'since-checkpoint': {
				// Find checkpoint and return messages after it
				const checkpointIdx = lineage.findIndex(
					n => n.type === 'checkpoint' && (n as CheckpointNode).name === strategy.name
				);
				if (checkpointIdx === -1) {
					return this._extractMessages(lineage); // Checkpoint not found, return all
				}
				return this._extractMessages(lineage.slice(checkpointIdx + 1));
			}

			case 'use-summaries':
				return this._extractWithSummaries(lineage);

			case 'custom':
				return strategy.fn(lineage);
		}
	}

	private _extractMessages(nodes: TreeNode[]): Message[] {
		const messages: Message[] = [];

		for (const node of nodes) {
			if (node.type === 'message') {
				messages.push(node.message);
			} else if (node.type === 'merge') {
				// Include merge summary as an assistant message
				messages.push({
					id: node.id,
					role: 'assistant',
					content: [{ type: 'text', content: `[Merged from ${node.fromBranch}]: ${node.content}` }],
					timestamp: new Date(node.timestamp).getTime(),
				} as Message);
			} else if (node.type === 'summary') {
				// Include summary as an assistant message
				messages.push({
					id: node.id,
					role: 'assistant',
					content: [{ type: 'text', content: `[Summary]: ${node.content}` }],
					timestamp: new Date(node.timestamp).getTime(),
				} as Message);
			}
			// Skip provider, checkpoint, custom (unless custom says include)
			else if (node.type === 'custom' && node.contextBehavior === 'include') {
				// Custom nodes with include behavior would need user-defined conversion
				// For now, skip (user should use custom strategy for these)
			}
		}

		return messages;
	}

	private _extractWithSummaries(lineage: TreeNode[]): Message[] {
		const messages: Message[] = [];
		const summarizedIds = new Set<string>();

		// First pass: collect all summarized node IDs
		for (const node of lineage) {
			if (node.type === 'summary') {
				for (const id of node.summarizes) {
					summarizedIds.add(id);
				}
			}
		}

		// Second pass: build messages, skipping summarized nodes
		for (const node of lineage) {
			if (summarizedIds.has(node.id)) {
				continue; // Skip, this is covered by a summary
			}

			if (node.type === 'message') {
				messages.push(node.message);
			} else if (node.type === 'summary') {
				// Include summary as a message
				messages.push({
					id: node.id,
					role: 'assistant',
					content: [{ type: 'text', content: `[Summary]: ${node.content}` }],
					timestamp: new Date(node.timestamp).getTime(),
				} as Message);
			} else if (node.type === 'merge') {
				messages.push({
					id: node.id,
					role: 'assistant',
					content: [{ type: 'text', content: `[Merged from ${node.fromBranch}]: ${node.content}` }],
					timestamp: new Date(node.timestamp).getTime(),
				} as Message);
			}
		}

		return messages;
	}

	/**
	 * Get the last provider info from the lineage.
	 */
	getLastProvider(branch?: string): { api: string; modelId: string; providerOptions: OptionsForApi<Api> } | null {
		const head = this.getHeadNode(branch);

		// If no nodes, check header for initial provider
		if (!head) {
			if (this._header.api && this._header.modelId) {
				return {
					api: this._header.api,
					modelId: this._header.modelId,
					providerOptions: this._header.providerOptions ?? {},
				};
			}
			return null;
		}

		const lineage = this.getLineage(head.id);

		// Walk backwards to find last provider node
		for (let i = lineage.length - 1; i >= 0; i--) {
			const node = lineage[i];
			if (node.type === 'provider') {
				return {
					api: node.api,
					modelId: node.modelId,
					providerOptions: node.providerOptions,
				};
			}
		}

		// Fall back to header
		if (this._header.api && this._header.modelId) {
			return {
				api: this._header.api,
				modelId: this._header.modelId,
				providerOptions: this._header.providerOptions ?? {},
			};
		}

		return null;
	}

	/**
	 * Load session data in old format (for compatibility).
	 */
	loadSession(branch?: string): LoadedSession {
		const messages = this.buildContext(branch);
		const model = this.getLastProvider(branch);
		return { messages, model };
	}

	// =========================================================================
	// Lifecycle / Static Methods
	// =========================================================================

	/**
	 * Create a new session tree.
	 */
	static create(
		cwd: string,
		agentDir: string = getDefaultAgentDir(),
		initialProvider?: { api: string; modelId: string; providerOptions: OptionsForApi<Api> }
	): SessionTree {
		const sessionDir = getSessionDirectory(cwd, agentDir);
		const id = generateUUID();
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const file = join(sessionDir, `${timestamp}_${id}.jsonl`);

		const header: TreeHeader = {
			type: 'tree',
			id,
			cwd,
			created: new Date().toISOString(),
			defaultBranch: 'main',
			api: initialProvider?.api,
			modelId: initialProvider?.modelId,
			providerOptions: initialProvider?.providerOptions,
		};

		return new SessionTree(file, header, [header], true);
	}

	/**
	 * Open an existing session tree from file.
	 */
	static open(file: string): SessionTree {
		if (!existsSync(file)) {
			throw new Error(`Session file not found: ${file}`);
		}

		const content = readFileSync(file, 'utf-8');
		const entries = parseEntries(content);

		const header = entries.find(e => e.type === 'tree') as TreeHeader | undefined;
		if (!header) {
			throw new Error(`Invalid session file: missing tree header`);
		}

		const tree = new SessionTree(file, header, entries, true);
		tree._flushed = true; // File already exists
		return tree;
	}

	/**
	 * Find the most recent session in a directory.
	 */
	static findRecent(cwd: string, agentDir: string = getDefaultAgentDir()): SessionTree | null {
		const sessionDir = getSessionDirectory(cwd, agentDir);

		try {
			const files = readdirSync(sessionDir)
				.filter(f => f.endsWith('.jsonl'))
				.map(f => ({
					path: join(sessionDir, f),
					mtime: statSync(join(sessionDir, f)).mtime,
				}))
				.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

			if (files.length === 0) return null;

			return SessionTree.open(files[0].path);
		} catch {
			return null;
		}
	}

	/**
	 * Continue the most recent session or create new if none exists.
	 */
	static continueRecent(
		cwd: string,
		agentDir: string = getDefaultAgentDir(),
		initialProvider?: { api: string; modelId: string; providerOptions: OptionsForApi<Api> }
	): SessionTree {
		const recent = SessionTree.findRecent(cwd, agentDir);
		if (recent) {
			return recent;
		}
		return SessionTree.create(cwd, agentDir, initialProvider);
	}

	/**
	 * Create an in-memory session tree (no file persistence).
	 */
	static inMemory(
		cwd: string = process.cwd(),
		initialProvider?: { api: string; modelId: string; providerOptions: OptionsForApi<Api> }
	): SessionTree {
		const id = generateUUID();
		const header: TreeHeader = {
			type: 'tree',
			id,
			cwd,
			created: new Date().toISOString(),
			defaultBranch: 'main',
			api: initialProvider?.api,
			modelId: initialProvider?.modelId,
			providerOptions: initialProvider?.providerOptions,
		};

		return new SessionTree('', header, [header], false);
	}

	/**
	 * Reset: create a new session tree (new file).
	 * Returns the new tree; original tree is unchanged.
	 */
	reset(agentDir: string = getDefaultAgentDir()): SessionTree {
		return SessionTree.create(this._header.cwd, agentDir);
	}

	/**
	 * List all sessions in a directory.
	 */
	static listSessions(cwd: string, agentDir: string = getDefaultAgentDir()): SessionInfo[] {
		const sessionDir = getSessionDirectory(cwd, agentDir);
		const sessions: SessionInfo[] = [];

		try {
			const files = readdirSync(sessionDir)
				.filter(f => f.endsWith('.jsonl'))
				.map(f => join(sessionDir, f));

			for (const file of files) {
				try {
					const stats = statSync(file);
					const content = readFileSync(file, 'utf-8');
					const entries = parseEntries(content);

					const header = entries.find(e => e.type === 'tree') as TreeHeader | undefined;
					if (!header) continue;

					// Find branches and active branch
					const branches = new Set<string>([header.defaultBranch]);
					let activeBranch = header.defaultBranch;
					let messageCount = 0;
					let firstMessage = '';

					for (const entry of entries) {
						if (isNode(entry)) {
							branches.add(entry.branch);
							if (entry.type === 'message') {
								messageCount++;
								if (!firstMessage && entry.message.role === 'user') {
									const textContent = entry.message.content
										.filter((c: any) => c.type === 'text')
										.map((c: any) => c.content)
										.join(' ');
									if (textContent) {
										firstMessage = textContent;
									}
								}
							}
						} else if (entry.type === 'active') {
							activeBranch = entry.branch;
						}
					}

					sessions.push({
						file,
						id: header.id,
						cwd: header.cwd,
						created: new Date(header.created),
						modified: stats.mtime,
						branches: Array.from(branches),
						activeBranch,
						messageCount,
						firstMessage: firstMessage || '(no messages)',
					});
				} catch {
					// Skip files that can't be parsed
				}
			}

			sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
		} catch {
			// Return empty on error
		}

		return sessions;
	}

	/**
	 * List all branches in this session.
	 */
	listBranches(): BranchInfo[] {
		const branches = this.getBranches();
		const infos: BranchInfo[] = [];

		for (const name of branches) {
			const info = this.getBranchInfo(name);
			if (info) {
				infos.push(info);
			}
		}

		return infos.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
	}

	// =========================================================================
	// Compatibility Methods (mimic old SessionManager API)
	// =========================================================================

	/** Alias for id */
	getSessionId(): string {
		return this.id;
	}

	/** Alias for file */
	getSessionFile(): string {
		return this._file;
	}

	/** Get cwd */
	getCwd(): string {
		return this.cwd;
	}

	/** Save a message (appends to current branch) */
	saveMessage(message: Message): void {
		this.appendMessage(message);
	}

	/** Save provider change */
	saveProvider(api: string, modelId: string, providerOptions: OptionsForApi<Api>): void {
		this.appendProvider(api, modelId, providerOptions);
	}

	/** Load messages from current branch */
	loadMessages(branch?: string): Message[] {
		return this.buildContext(branch);
	}

	/** Load model info */
	loadModel(branch?: string): { api: string; modelId: string; providerOptions: OptionsForApi<Api> } | null {
		return this.getLastProvider(branch);
	}

	/** Get all entries (for debugging/export) */
	getEntries(): TreeEntry[] {
		return [...this._entries];
	}
}
