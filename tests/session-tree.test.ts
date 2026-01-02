import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionTree, type TreeNode, type ContextStrategy } from '../src/core/session-tree';
import { existsSync, mkdirSync, readFileSync, rmSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Message } from '@ank1015/providers';

describe('SessionTree', () => {
	let testDir: string;
	let agentDir: string;
	let cwd: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `session-tree-test-${Date.now()}`);
		agentDir = join(testDir, '.agent');
		cwd = join(testDir, 'project');

		mkdirSync(testDir, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(cwd, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
	});

	// =========================================================================
	// Static Creation Methods
	// =========================================================================

	describe('create()', () => {
		it('should create new session tree', () => {
			const tree = SessionTree.create(cwd, agentDir);

			expect(tree.id).toBeTruthy();
			expect(tree.cwd).toBe(cwd);
			expect(tree.file).toBeTruthy();
			expect(tree.isPersisted()).toBe(true);
			expect(tree.activeBranch).toBe('main');
			expect(tree.defaultBranch).toBe('main');
		});

		it('should create session file on first assistant message', () => {
			const tree = SessionTree.create(cwd, agentDir);
			const file = tree.file;

			expect(existsSync(file)).toBe(false);

			// Add user message - should not create file yet
			tree.appendMessage({
				role: 'user',
				id: 'msg-1',
				content: [{ type: 'text', content: 'Hello' }]
			} as Message);

			expect(existsSync(file)).toBe(false);

			// Add assistant message - should create file
			tree.appendMessage({
				role: 'assistant',
				id: 'msg-2',
				content: [{ type: 'text', content: 'Hi there' }]
			} as Message);

			expect(existsSync(file)).toBe(true);
		});

		it('should support initial provider', () => {
			const tree = SessionTree.create(cwd, agentDir, {
				api: 'openai',
				modelId: 'gpt-4',
				providerOptions: { temperature: 0.7 }
			});

			const provider = tree.getLastProvider();
			expect(provider).toEqual({
				api: 'openai',
				modelId: 'gpt-4',
				providerOptions: { temperature: 0.7 }
			});
		});

		it('should create unique session IDs', () => {
			const tree1 = SessionTree.create(cwd, agentDir);
			const tree2 = SessionTree.create(cwd, agentDir);

			expect(tree1.id).not.toBe(tree2.id);
			expect(tree1.file).not.toBe(tree2.file);
		});
	});

	describe('inMemory()', () => {
		it('should create in-memory session tree', () => {
			const tree = SessionTree.inMemory();

			expect(tree.id).toBeTruthy();
			expect(tree.isPersisted()).toBe(false);
			expect(tree.file).toBe('');
		});

		it('should not persist to file', () => {
			const tree = SessionTree.inMemory();

			tree.appendMessage({
				role: 'user',
				id: 'msg-1',
				content: [{ type: 'text', content: 'Test' }]
			} as Message);

			tree.appendMessage({
				role: 'assistant',
				id: 'msg-2',
				content: []
			} as Message);

			// No file should be created
			expect(tree.file).toBe('');
		});

		it('should support initial provider', () => {
			const tree = SessionTree.inMemory(process.cwd(), {
				api: 'google',
				modelId: 'gemini-3-flash',
				providerOptions: { temperature: 0.5 }
			});

			const provider = tree.getLastProvider();
			expect(provider?.api).toBe('google');
		});
	});

	describe('open()', () => {
		it('should open existing session file', () => {
			const tree1 = SessionTree.create(cwd, agentDir);
			tree1.appendMessage({
				role: 'user',
				id: 'msg-1',
				content: [{ type: 'text', content: 'Test' }]
			} as Message);
			tree1.appendMessage({
				role: 'assistant',
				id: 'msg-2',
				content: []
			} as Message);

			const tree2 = SessionTree.open(tree1.file);

			expect(tree2.id).toBe(tree1.id);
			expect(tree2.cwd).toBe(tree1.cwd);
			expect(tree2.loadMessages()).toHaveLength(2);
		});

		it('should throw error for non-existent file', () => {
			const fakeFile = join(agentDir, 'non-existent.jsonl');

			expect(() => {
				SessionTree.open(fakeFile);
			}).toThrow(/not found/);
		});

		it('should throw error for invalid session file', () => {
			const invalidFile = join(agentDir, 'invalid.jsonl');
			mkdirSync(agentDir, { recursive: true });
			writeFileSync(invalidFile, '{"type":"message","data":"invalid"}\n');

			expect(() => {
				SessionTree.open(invalidFile);
			}).toThrow(/missing tree header/);
		});

		it('should restore active branch', () => {
			const tree1 = SessionTree.create(cwd, agentDir);
			tree1.appendMessage({
				role: 'assistant',
				id: 'msg-1',
				content: []
			} as Message);
			tree1.createBranch('feature');
			tree1.switchBranch('feature');

			const tree2 = SessionTree.open(tree1.file);

			expect(tree2.activeBranch).toBe('feature');
		});
	});

	describe('findRecent()', () => {
		it('should find most recently modified session', async () => {
			const tree1 = SessionTree.create(cwd, agentDir);
			tree1.appendMessage({ role: 'assistant', id: 'msg-1', content: [] } as Message);

			// Wait to ensure different mtime
			await new Promise(resolve => setTimeout(resolve, 10));

			const tree2 = SessionTree.create(cwd, agentDir);
			tree2.appendMessage({ role: 'assistant', id: 'msg-2', content: [] } as Message);

			const recent = SessionTree.findRecent(cwd, agentDir);

			expect(recent).toBeTruthy();
			expect(recent?.id).toBe(tree2.id);
		});

		it('should return null if no sessions exist', () => {
			const recent = SessionTree.findRecent(cwd, agentDir);
			expect(recent).toBeNull();
		});
	});

	describe('continueRecent()', () => {
		it('should continue existing session', () => {
			const tree1 = SessionTree.create(cwd, agentDir);
			tree1.appendMessage({ role: 'assistant', id: 'msg-1', content: [] } as Message);

			const tree2 = SessionTree.continueRecent(cwd, agentDir);

			expect(tree2.id).toBe(tree1.id);
		});

		it('should create new session if none exists', () => {
			const tree = SessionTree.continueRecent(cwd, agentDir, {
				api: 'openai',
				modelId: 'gpt-4',
				providerOptions: {}
			});

			expect(tree).toBeTruthy();
			expect(tree.getLastProvider()?.api).toBe('openai');
		});
	});

	// =========================================================================
	// Node Operations
	// =========================================================================

	describe('appendMessage()', () => {
		it('should append message to current branch', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const node = tree.appendMessage({
				role: 'user',
				id: 'msg-1',
				content: [{ type: 'text', content: 'Hello' }]
			} as Message);

			expect(node.type).toBe('message');
			expect(node.branch).toBe('main');
			expect(node.parentId).toBeNull();
			expect(node.message.id).toBe('msg-1');
		});

		it('should link to parent message', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const node1 = tree.appendMessage({
				role: 'user',
				id: 'msg-1',
				content: []
			} as Message);

			const node2 = tree.appendMessage({
				role: 'assistant',
				id: 'msg-2',
				content: []
			} as Message);

			expect(node2.parentId).toBe(node1.id);
		});

		it('should append to specified branch', () => {
			const tree = SessionTree.create(cwd, agentDir);
			tree.createBranch('feature');

			const node = tree.appendMessage({
				role: 'user',
				id: 'msg-1',
				content: []
			} as Message, 'feature');

			expect(node.branch).toBe('feature');
		});

		it('should generate ID if not provided', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const node = tree.appendMessage({
				role: 'user',
				content: [{ type: 'text', content: 'Test' }]
			} as Message);

			expect(node.id).toBeTruthy();
			// Note: The implementation uses message.id ?? generateUUID() for node.id
			// but doesn't mutate the original message object
		});
	});

	describe('appendProvider()', () => {
		it('should append provider node', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const node = tree.appendProvider('openai', 'gpt-4', { temperature: 0.7 });

			expect(node.type).toBe('provider');
			expect(node.api).toBe('openai');
			expect(node.modelId).toBe('gpt-4');
			expect(node.providerOptions).toEqual({ temperature: 0.7 });
		});

		it('should link to previous node', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const msg = tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);
			const provider = tree.appendProvider('google', 'gemini-3-flash', {});

			expect(provider.parentId).toBe(msg.id);
		});

		it('should update last provider', () => {
			const tree = SessionTree.create(cwd, agentDir, {
				api: 'openai',
				modelId: 'gpt-4',
				providerOptions: {}
			});

			tree.appendProvider('google', 'gemini-3-flash', { temperature: 0.5 });

			const lastProvider = tree.getLastProvider();
			expect(lastProvider?.api).toBe('google');
			expect(lastProvider?.modelId).toBe('gemini-3-flash');
		});
	});

	describe('appendSummary()', () => {
		it('should append summary node', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const msg1 = tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);
			const msg2 = tree.appendMessage({ role: 'assistant', id: 'msg-2', content: [] } as Message);

			const summary = tree.appendSummary(
				'Discussion about feature X',
				[msg1.id, msg2.id]
			);

			expect(summary.type).toBe('summary');
			expect(summary.content).toBe('Discussion about feature X');
			expect(summary.summarizes).toEqual([msg1.id, msg2.id]);
		});

		it('should link to parent', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const msg = tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);
			const summary = tree.appendSummary('Summary', [msg.id]);

			expect(summary.parentId).toBe(msg.id);
		});
	});

	describe('appendCheckpoint()', () => {
		it('should append checkpoint node', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const checkpoint = tree.appendCheckpoint('v1.0', { version: '1.0.0' });

			expect(checkpoint.type).toBe('checkpoint');
			expect(checkpoint.name).toBe('v1.0');
			expect(checkpoint.metadata).toEqual({ version: '1.0.0' });
		});

		it('should work without metadata', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const checkpoint = tree.appendCheckpoint('milestone');

			expect(checkpoint.name).toBe('milestone');
			expect(checkpoint.metadata).toBeUndefined();
		});
	});

	describe('appendCustom()', () => {
		it('should append custom node', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const custom = tree.appendCustom('evaluation', { score: 0.95 }, 'include');

			expect(custom.type).toBe('custom');
			expect(custom.subtype).toBe('evaluation');
			expect(custom.data).toEqual({ score: 0.95 });
			expect(custom.contextBehavior).toBe('include');
		});

		it('should work without context behavior', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const custom = tree.appendCustom('note', 'Important note');

			expect(custom.subtype).toBe('note');
			expect(custom.contextBehavior).toBeUndefined();
		});
	});

	describe('merge()', () => {
		it('should create merge node', () => {
			const tree = SessionTree.create(cwd, agentDir);

			// Create main branch nodes
			tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);

			// Create feature branch
			tree.createBranch('feature');
			tree.switchBranch('feature');
			const featureMsg = tree.appendMessage({
				role: 'user',
				id: 'msg-2',
				content: []
			} as Message);

			// Merge feature into main
			tree.switchBranch('main');
			const merge = tree.merge('feature', 'Merged feature branch');

			expect(merge.type).toBe('merge');
			expect(merge.content).toBe('Merged feature branch');
			expect(merge.fromBranch).toBe('feature');
			expect(merge.fromNodeId).toBe(featureMsg.id);
			expect(merge.branch).toBe('main');
		});

		it('should throw error for empty branch', () => {
			const tree = SessionTree.create(cwd, agentDir);
			tree.createBranch('empty');

			expect(() => {
				tree.merge('empty', 'Cannot merge');
			}).toThrow(/has no nodes to merge/);
		});

		it('should merge into specified branch', () => {
			const tree = SessionTree.create(cwd, agentDir);

			// Create and populate branch-a
			tree.appendMessage({ role: 'user', id: 'msg-0', content: [] } as Message);
			tree.createBranch('branch-a');
			tree.switchBranch('branch-a');
			tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);

			// Create and populate branch-b from msg-0
			tree.switchBranch('main');
			tree.createBranch('branch-b', 'msg-0');
			tree.switchBranch('branch-b');
			tree.appendMessage({ role: 'user', id: 'msg-2', content: [] } as Message);

			const merge = tree.merge('branch-a', 'Merge A into B', 'branch-b');

			expect(merge.branch).toBe('branch-b');
		});
	});

	// =========================================================================
	// Branch Operations
	// =========================================================================

	describe('getBranches()', () => {
		it('should return default branch for new tree', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const branches = tree.getBranches();

			expect(branches).toEqual(['main']);
		});

		it('should return all branches with nodes', () => {
			const tree = SessionTree.create(cwd, agentDir);

			tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);

			tree.createBranch('feature');
			tree.switchBranch('feature');
			tree.appendMessage({ role: 'user', id: 'msg-2', content: [] } as Message);

			const branches = tree.getBranches();

			expect(branches).toContain('main');
			expect(branches).toContain('feature');
			expect(branches.length).toBe(2);
		});
	});

	describe('getBranchInfo()', () => {
		it('should return info for default branch with no nodes', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const info = tree.getBranchInfo('main');

			expect(info).toBeTruthy();
			expect(info?.name).toBe('main');
			expect(info?.headNodeId).toBeNull();
			expect(info?.messageCount).toBe(0);
		});

		it('should return info for branch with nodes', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const msg1 = tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);
			const msg2 = tree.appendMessage({ role: 'assistant', id: 'msg-2', content: [] } as Message);

			const info = tree.getBranchInfo('main');

			expect(info?.headNodeId).toBe(msg2.id);
			expect(info?.messageCount).toBe(2);
			expect(info?.created).toBeInstanceOf(Date);
			expect(info?.lastModified).toBeInstanceOf(Date);
		});

		it('should return null for non-existent branch', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const info = tree.getBranchInfo('non-existent');

			expect(info).toBeNull();
		});

		it('should count only message nodes', () => {
			const tree = SessionTree.create(cwd, agentDir);

			tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);
			tree.appendProvider('openai', 'gpt-4', {});
			tree.appendCheckpoint('test');
			tree.appendMessage({ role: 'assistant', id: 'msg-2', content: [] } as Message);

			const info = tree.getBranchInfo('main');

			expect(info?.messageCount).toBe(2);
		});
	});

	describe('createBranch()', () => {
		it('should create new branch', () => {
			const tree = SessionTree.create(cwd, agentDir);

			tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);
			tree.createBranch('feature');
			tree.switchBranch('feature');
			tree.appendMessage({ role: 'user', id: 'msg-2', content: [] } as Message);

			// Branch should exist after adding nodes
			const branches = tree.getBranches();
			expect(branches).toContain('feature');
		});

		it('should throw error for duplicate branch name', () => {
			const tree = SessionTree.create(cwd, agentDir);

			tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);
			tree.createBranch('feature');
			tree.switchBranch('feature');
			tree.appendMessage({ role: 'user', id: 'msg-2', content: [] } as Message);

			expect(() => {
				tree.createBranch('feature');
			}).toThrow(/already exists/);
		});

		it('should create branch from specific node', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const msg1 = tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);
			const msg2 = tree.appendMessage({ role: 'assistant', id: 'msg-2', content: [] } as Message);

			tree.createBranch('feature', msg1.id);
			tree.switchBranch('feature');

			const newMsg = tree.appendMessage({ role: 'user', id: 'msg-3', content: [] } as Message);

			expect(newMsg.parentId).toBe(msg1.id);
		});

		it('should throw error for non-existent node', () => {
			const tree = SessionTree.create(cwd, agentDir);

			expect(() => {
				tree.createBranch('feature', 'non-existent-id');
			}).toThrow(/does not exist/);
		});

		it('should create branch from current head if no node specified', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const msg = tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);

			tree.createBranch('feature');
			tree.switchBranch('feature');

			const newMsg = tree.appendMessage({ role: 'user', id: 'msg-2', content: [] } as Message);

			expect(newMsg.parentId).toBe(msg.id);
		});
	});

	describe('switchBranch()', () => {
		it('should switch active branch', () => {
			const tree = SessionTree.create(cwd, agentDir);

			tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);
			tree.createBranch('feature');
			tree.switchBranch('feature');

			expect(tree.activeBranch).toBe('feature');
		});

		it('should throw error for non-existent branch', () => {
			const tree = SessionTree.create(cwd, agentDir);

			expect(() => {
				tree.switchBranch('non-existent');
			}).toThrow(/does not exist/);
		});

		it('should persist active branch', () => {
			const tree1 = SessionTree.create(cwd, agentDir);
			tree1.appendMessage({ role: 'assistant', id: 'msg-1', content: [] } as Message);
			tree1.createBranch('feature');
			tree1.switchBranch('feature');

			const tree2 = SessionTree.open(tree1.file);

			expect(tree2.activeBranch).toBe('feature');
		});

		it('should allow switching to pending branch', () => {
			const tree = SessionTree.create(cwd, agentDir);
			tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);
			tree.createBranch('pending');

			expect(() => {
				tree.switchBranch('pending');
			}).not.toThrow();

			expect(tree.activeBranch).toBe('pending');
		});
	});

	// =========================================================================
	// Navigation
	// =========================================================================

	describe('getHeadNode()', () => {
		it('should return null for empty branch', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const head = tree.getHeadNode();

			expect(head).toBeNull();
		});

		it('should return last node on branch', () => {
			const tree = SessionTree.create(cwd, agentDir);

			tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);
			const last = tree.appendMessage({ role: 'assistant', id: 'msg-2', content: [] } as Message);

			const head = tree.getHeadNode();

			expect(head?.id).toBe(last.id);
		});

		it('should return head for specified branch', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const mainMsg = tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);

			tree.createBranch('feature');
			tree.switchBranch('feature');
			const featureMsg = tree.appendMessage({ role: 'user', id: 'msg-2', content: [] } as Message);

			const mainHead = tree.getHeadNode('main');
			const featureHead = tree.getHeadNode('feature');

			expect(mainHead?.id).toBe(mainMsg.id);
			expect(featureHead?.id).toBe(featureMsg.id);
		});
	});

	describe('getNode()', () => {
		it('should return node by ID', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const msg = tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);

			const node = tree.getNode(msg.id);

			expect(node).toBeTruthy();
			expect(node?.id).toBe(msg.id);
		});

		it('should return null for non-existent ID', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const node = tree.getNode('non-existent');

			expect(node).toBeNull();
		});
	});

	describe('getLineage()', () => {
		it('should return path from root to node', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const msg1 = tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);
			const msg2 = tree.appendMessage({ role: 'assistant', id: 'msg-2', content: [] } as Message);
			const msg3 = tree.appendMessage({ role: 'user', id: 'msg-3', content: [] } as Message);

			const lineage = tree.getLineage(msg3.id);

			expect(lineage).toHaveLength(3);
			expect(lineage[0].id).toBe(msg1.id);
			expect(lineage[1].id).toBe(msg2.id);
			expect(lineage[2].id).toBe(msg3.id);
		});

		it('should return single node for root', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const msg = tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);

			const lineage = tree.getLineage(msg.id);

			expect(lineage).toHaveLength(1);
			expect(lineage[0].id).toBe(msg.id);
		});

		it('should handle branched lineage', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const msg1 = tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);

			tree.createBranch('feature', msg1.id);
			tree.switchBranch('feature');
			const msg2 = tree.appendMessage({ role: 'user', id: 'msg-2', content: [] } as Message);

			const lineage = tree.getLineage(msg2.id);

			expect(lineage).toHaveLength(2);
			expect(lineage[0].id).toBe(msg1.id);
			expect(lineage[1].id).toBe(msg2.id);
		});
	});

	describe('getChildren()', () => {
		it('should return direct children of node', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const parent = tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);
			const child1 = tree.appendMessage({ role: 'assistant', id: 'msg-2', content: [] } as Message);

			tree.createBranch('feature', parent.id);
			tree.switchBranch('feature');
			const child2 = tree.appendMessage({ role: 'user', id: 'msg-3', content: [] } as Message);

			const children = tree.getChildren(parent.id);

			expect(children).toHaveLength(2);
			expect(children.map(c => c.id)).toContain(child1.id);
			expect(children.map(c => c.id)).toContain(child2.id);
		});

		it('should return empty array for leaf node', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const msg = tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);

			const children = tree.getChildren(msg.id);

			expect(children).toEqual([]);
		});

		it('should return empty array for non-existent node', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const children = tree.getChildren('non-existent');

			expect(children).toEqual([]);
		});
	});

	// =========================================================================
	// Context Building
	// =========================================================================

	describe('buildContext()', () => {
		it('should build full context by default', () => {
			const tree = SessionTree.create(cwd, agentDir);

			tree.appendMessage({
				role: 'user',
				id: 'msg-1',
				content: [{ type: 'text', content: 'Hello' }]
			} as Message);
			tree.appendMessage({
				role: 'assistant',
				id: 'msg-2',
				content: [{ type: 'text', content: 'Hi' }]
			} as Message);

			const context = tree.buildContext();

			expect(context).toHaveLength(2);
			expect(context[0].id).toBe('msg-1');
			expect(context[1].id).toBe('msg-2');
		});

		it('should return empty array for empty branch', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const context = tree.buildContext();

			expect(context).toEqual([]);
		});

		it('should build context for specific branch', () => {
			const tree = SessionTree.create(cwd, agentDir);

			tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);

			tree.createBranch('feature');
			tree.switchBranch('feature');
			tree.appendMessage({ role: 'user', id: 'msg-2', content: [] } as Message);
			tree.appendMessage({ role: 'assistant', id: 'msg-3', content: [] } as Message);

			const mainContext = tree.buildContext('main');
			const featureContext = tree.buildContext('feature');

			expect(mainContext).toHaveLength(1);
			expect(featureContext).toHaveLength(3); // msg-1, msg-2, msg-3
		});

		it('should skip provider and checkpoint nodes', () => {
			const tree = SessionTree.create(cwd, agentDir);

			tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);
			tree.appendProvider('openai', 'gpt-4', {});
			tree.appendCheckpoint('test');
			tree.appendMessage({ role: 'assistant', id: 'msg-2', content: [] } as Message);

			const context = tree.buildContext();

			expect(context).toHaveLength(2);
			expect(context[0].id).toBe('msg-1');
			expect(context[1].id).toBe('msg-2');
		});

		it('should include merge nodes as messages', () => {
			const tree = SessionTree.create(cwd, agentDir);

			tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);

			tree.createBranch('feature');
			tree.switchBranch('feature');
			tree.appendMessage({ role: 'user', id: 'msg-2', content: [] } as Message);

			tree.switchBranch('main');
			const merge = tree.merge('feature', 'Merged feature');

			const context = tree.buildContext();

			expect(context).toHaveLength(2);
			expect(context[1].id).toBe(merge.id);
			expect(context[1].role).toBe('user');
			expect((context[1].content[0] as any).content).toContain('Merged from feature');
		});

		it('should include summary nodes as messages', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const msg1 = tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);
			const summary = tree.appendSummary('Summary of msg-1', [msg1.id]);

			const context = tree.buildContext();

			expect(context).toHaveLength(2);
			expect(context[1].id).toBe(summary.id);
			expect((context[1].content[0] as any).content).toContain('[Summary]');
		});
	});

	describe('buildContext() - recent strategy', () => {
		it('should return last N messages', () => {
			const tree = SessionTree.create(cwd, agentDir);

			tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);
			tree.appendMessage({ role: 'assistant', id: 'msg-2', content: [] } as Message);
			tree.appendMessage({ role: 'user', id: 'msg-3', content: [] } as Message);
			tree.appendMessage({ role: 'assistant', id: 'msg-4', content: [] } as Message);

			const context = tree.buildContext(undefined, { type: 'recent', count: 2 });

			expect(context).toHaveLength(2);
			expect(context[0].id).toBe('msg-3');
			expect(context[1].id).toBe('msg-4');
		});

		it('should return all messages if count exceeds total', () => {
			const tree = SessionTree.create(cwd, agentDir);

			tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);
			tree.appendMessage({ role: 'assistant', id: 'msg-2', content: [] } as Message);

			const context = tree.buildContext(undefined, { type: 'recent', count: 10 });

			expect(context).toHaveLength(2);
		});
	});

	describe('buildContext() - since-checkpoint strategy', () => {
		it('should return messages after checkpoint', () => {
			const tree = SessionTree.create(cwd, agentDir);

			tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);
			tree.appendCheckpoint('v1.0');
			tree.appendMessage({ role: 'assistant', id: 'msg-2', content: [] } as Message);
			tree.appendMessage({ role: 'user', id: 'msg-3', content: [] } as Message);

			const context = tree.buildContext(undefined, { type: 'since-checkpoint', name: 'v1.0' });

			expect(context).toHaveLength(2);
			expect(context[0].id).toBe('msg-2');
			expect(context[1].id).toBe('msg-3');
		});

		it('should return all messages if checkpoint not found', () => {
			const tree = SessionTree.create(cwd, agentDir);

			tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);
			tree.appendMessage({ role: 'assistant', id: 'msg-2', content: [] } as Message);

			const context = tree.buildContext(undefined, { type: 'since-checkpoint', name: 'non-existent' });

			expect(context).toHaveLength(2);
		});
	});

	describe('buildContext() - use-summaries strategy', () => {
		it('should skip summarized nodes and include summaries', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const msg1 = tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);
			const msg2 = tree.appendMessage({ role: 'assistant', id: 'msg-2', content: [] } as Message);
			const summary = tree.appendSummary('Summary of conversation', [msg1.id, msg2.id]);
			tree.appendMessage({ role: 'user', id: 'msg-3', content: [] } as Message);

			const context = tree.buildContext(undefined, { type: 'use-summaries' });

			expect(context).toHaveLength(2);
			expect(context[0].id).toBe(summary.id);
			expect(context[1].id).toBe('msg-3');
		});

		it('should include non-summarized messages', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const msg1 = tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);
			tree.appendSummary('Summary', [msg1.id]);
			tree.appendMessage({ role: 'assistant', id: 'msg-2', content: [] } as Message);

			const context = tree.buildContext(undefined, { type: 'use-summaries' });

			expect(context).toHaveLength(2);
			expect(context.find(m => m.id === 'msg-2')).toBeTruthy();
		});
	});

	describe('buildContext() - custom strategy', () => {
		it('should use custom function', () => {
			const tree = SessionTree.create(cwd, agentDir);

			tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);
			tree.appendMessage({ role: 'assistant', id: 'msg-2', content: [] } as Message);

			const context = tree.buildContext(undefined, {
				type: 'custom',
				fn: (lineage) => {
					// Return only user messages
					return lineage
						.filter(n => n.type === 'message' && (n as any).message.role === 'user')
						.map(n => (n as any).message);
				}
			});

			expect(context).toHaveLength(1);
			expect(context[0].id).toBe('msg-1');
		});
	});

	// =========================================================================
	// Provider Tracking
	// =========================================================================

	describe('getLastProvider()', () => {
		it('should return null for session without provider', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const provider = tree.getLastProvider();

			expect(provider).toBeNull();
		});

		it('should return initial provider from header', () => {
			const tree = SessionTree.create(cwd, agentDir, {
				api: 'openai',
				modelId: 'gpt-4',
				providerOptions: { temperature: 0.7 }
			});

			const provider = tree.getLastProvider();

			expect(provider).toEqual({
				api: 'openai',
				modelId: 'gpt-4',
				providerOptions: { temperature: 0.7 }
			});
		});

		it('should return last provider node in lineage', () => {
			const tree = SessionTree.create(cwd, agentDir, {
				api: 'openai',
				modelId: 'gpt-4',
				providerOptions: {}
			});

			tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);
			tree.appendProvider('google', 'gemini-3-flash', { temperature: 0.5 });
			tree.appendMessage({ role: 'assistant', id: 'msg-2', content: [] } as Message);

			const provider = tree.getLastProvider();

			expect(provider?.api).toBe('google');
			expect(provider?.modelId).toBe('gemini-3-flash');
		});

		it('should return provider for specific branch', () => {
			const tree = SessionTree.create(cwd, agentDir, {
				api: 'openai',
				modelId: 'gpt-4',
				providerOptions: {}
			});

			tree.appendProvider('google', 'gemini-3-flash', {});

			tree.createBranch('feature');
			tree.switchBranch('feature');
			tree.appendProvider('anthropic', 'claude-3', {});

			const mainProvider = tree.getLastProvider('main');
			const featureProvider = tree.getLastProvider('feature');

			expect(mainProvider?.api).toBe('google');
			expect(featureProvider?.api).toBe('anthropic');
		});
	});

	// =========================================================================
	// Compatibility Methods
	// =========================================================================

	describe('compatibility methods', () => {
		it('should support getSessionId()', () => {
			const tree = SessionTree.create(cwd, agentDir);

			expect(tree.getSessionId()).toBe(tree.id);
		});

		it('should support getSessionFile()', () => {
			const tree = SessionTree.create(cwd, agentDir);

			expect(tree.getSessionFile()).toBe(tree.file);
		});

		it('should support getCwd()', () => {
			const tree = SessionTree.create(cwd, agentDir);

			expect(tree.getCwd()).toBe(cwd);
		});

		it('should support saveMessage()', () => {
			const tree = SessionTree.create(cwd, agentDir);

			tree.saveMessage({ role: 'user', id: 'msg-1', content: [] } as Message);

			const messages = tree.loadMessages();
			expect(messages).toHaveLength(1);
			expect(messages[0].id).toBe('msg-1');
		});

		it('should support saveProvider()', () => {
			const tree = SessionTree.create(cwd, agentDir);

			tree.saveProvider('openai', 'gpt-4', { temperature: 0.7 });

			const model = tree.loadModel();
			expect(model?.api).toBe('openai');
		});

		it('should support loadMessages()', () => {
			const tree = SessionTree.create(cwd, agentDir);

			tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);
			tree.appendMessage({ role: 'assistant', id: 'msg-2', content: [] } as Message);

			const messages = tree.loadMessages();

			expect(messages).toHaveLength(2);
		});

		it('should support loadModel()', () => {
			const tree = SessionTree.create(cwd, agentDir, {
				api: 'google',
				modelId: 'gemini-3-flash',
				providerOptions: {}
			});

			const model = tree.loadModel();

			expect(model?.api).toBe('google');
		});

		it('should support loadSession()', () => {
			const tree = SessionTree.create(cwd, agentDir, {
				api: 'openai',
				modelId: 'gpt-4',
				providerOptions: {}
			});

			tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);

			const session = tree.loadSession();

			expect(session.messages).toHaveLength(1);
			expect(session.model?.api).toBe('openai');
		});
	});

	// =========================================================================
	// Listing
	// =========================================================================

	describe('listSessions()', () => {
		it('should return empty array for no sessions', () => {
			const sessions = SessionTree.listSessions(cwd, agentDir);

			expect(sessions).toEqual([]);
		});

		it('should list all sessions', () => {
			const tree1 = SessionTree.create(cwd, agentDir);
			tree1.appendMessage({ role: 'assistant', id: 'msg-1', content: [] } as Message);

			const tree2 = SessionTree.create(cwd, agentDir);
			tree2.appendMessage({ role: 'assistant', id: 'msg-2', content: [] } as Message);

			const sessions = SessionTree.listSessions(cwd, agentDir);

			expect(sessions).toHaveLength(2);
			expect(sessions.map(s => s.id)).toContain(tree1.id);
			expect(sessions.map(s => s.id)).toContain(tree2.id);
		});

		it('should include session metadata', () => {
			const tree = SessionTree.create(cwd, agentDir);
			tree.appendMessage({
				role: 'user',
				id: 'msg-1',
				content: [{ type: 'text', content: 'Hello world' }]
			} as Message);
			tree.appendMessage({ role: 'assistant', id: 'msg-2', content: [] } as Message);

			const sessions = SessionTree.listSessions(cwd, agentDir);
			const session = sessions[0];

			expect(session.id).toBe(tree.id);
			expect(session.cwd).toBe(cwd);
			expect(session.messageCount).toBe(2);
			expect(session.firstMessage).toBe('Hello world');
			expect(session.activeBranch).toBe('main');
			expect(session.branches).toContain('main');
		});

		it('should sort by modified time descending', () => {
			const tree1 = SessionTree.create(cwd, agentDir);
			tree1.appendMessage({ role: 'assistant', id: 'msg-1', content: [] } as Message);

			const tree2 = SessionTree.create(cwd, agentDir);
			tree2.appendMessage({ role: 'assistant', id: 'msg-2', content: [] } as Message);

			const sessions = SessionTree.listSessions(cwd, agentDir);

			expect(sessions[0].id).toBe(tree2.id);
			expect(sessions[1].id).toBe(tree1.id);
		});

		it('should handle corrupted files gracefully', () => {
			const tree1 = SessionTree.create(cwd, agentDir);
			tree1.appendMessage({ role: 'assistant', id: 'msg-1', content: [] } as Message);

			// Create corrupted file
			const sessionDir = join(agentDir, 'sessions', `--${cwd.replace(/^\//, '').replace(/\//g, '-')}--`);
			const corruptedFile = join(sessionDir, 'corrupted.jsonl');
			writeFileSync(corruptedFile, '{invalid json');

			const sessions = SessionTree.listSessions(cwd, agentDir);

			// Should still list valid session
			expect(sessions.length).toBeGreaterThanOrEqual(1);
		});
	});

	describe('listBranches()', () => {
		it('should return default branch for new tree', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const branches = tree.listBranches();

			expect(branches).toHaveLength(1);
			expect(branches[0].name).toBe('main');
		});

		it('should list all branches with info', () => {
			const tree = SessionTree.create(cwd, agentDir);

			tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);

			tree.createBranch('feature');
			tree.switchBranch('feature');
			tree.appendMessage({ role: 'user', id: 'msg-2', content: [] } as Message);

			const branches = tree.listBranches();

			expect(branches).toHaveLength(2);
			expect(branches.map(b => b.name)).toContain('main');
			expect(branches.map(b => b.name)).toContain('feature');
		});

		it('should sort by last modified descending', async () => {
			const tree = SessionTree.create(cwd, agentDir);

			tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);

			// Wait to ensure different timestamps
			await new Promise(resolve => setTimeout(resolve, 10));

			tree.createBranch('feature');
			tree.switchBranch('feature');
			tree.appendMessage({ role: 'user', id: 'msg-2', content: [] } as Message);

			const branches = tree.listBranches();

			// Feature branch was modified more recently
			expect(branches[0].name).toBe('feature');
			expect(branches[1].name).toBe('main');
		});
	});

	// =========================================================================
	// Edge Cases and Error Handling
	// =========================================================================

	describe('edge cases', () => {
		it('should handle empty sessions', () => {
			const tree = SessionTree.create(cwd, agentDir);

			expect(tree.loadMessages()).toEqual([]);
			expect(tree.getHeadNode()).toBeNull();
			expect(tree.getLastProvider()).toBeNull();
		});

		it('should handle sessions with only provider nodes', () => {
			const tree = SessionTree.create(cwd, agentDir);

			tree.appendProvider('openai', 'gpt-4', {});

			expect(tree.loadMessages()).toEqual([]);
			expect(tree.getLastProvider()?.api).toBe('openai');
		});

		it('should handle multiple provider switches', () => {
			const tree = SessionTree.create(cwd, agentDir);

			tree.appendProvider('openai', 'gpt-4', {});
			tree.appendProvider('google', 'gemini-3-flash', {});
			tree.appendProvider('anthropic', 'claude-3', {});

			const provider = tree.getLastProvider();
			expect(provider?.api).toBe('anthropic');
		});

		it('should handle lineage with no parent', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const msg = tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);

			const lineage = tree.getLineage(msg.id);

			expect(lineage).toHaveLength(1);
			expect(lineage[0].parentId).toBeNull();
		});

		it('should handle getEntries()', () => {
			const tree = SessionTree.create(cwd, agentDir);

			tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);

			const entries = tree.getEntries();

			expect(entries.length).toBeGreaterThan(0);
			expect(entries[0].type).toBe('tree');
		});

		it('should handle reset()', () => {
			const tree1 = SessionTree.create(cwd, agentDir);
			tree1.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);

			const tree2 = tree1.reset(agentDir);

			expect(tree2.id).not.toBe(tree1.id);
			expect(tree2.file).not.toBe(tree1.file);
			expect(tree2.loadMessages()).toEqual([]);
		});

		it('should handle persistence correctly', () => {
			const tree = SessionTree.create(cwd, agentDir);

			// User message should not trigger persistence
			tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);
			expect(existsSync(tree.file)).toBe(false);

			// Assistant message should trigger persistence
			tree.appendMessage({ role: 'assistant', id: 'msg-2', content: [] } as Message);
			expect(existsSync(tree.file)).toBe(true);

			// Read file and verify content
			const content = readFileSync(tree.file, 'utf-8');
			const lines = content.trim().split('\n');
			expect(lines.length).toBeGreaterThanOrEqual(2);
		});

		it('should handle branch creation with null parent', () => {
			const tree = SessionTree.create(cwd, agentDir);

			// On an empty tree, create a branch explicitly and add a message
			// The first message will have null parent
			const msg = tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);

			expect(msg.parentId).toBeNull();
		});

		it('should handle non-existent lineage gracefully', () => {
			const tree = SessionTree.create(cwd, agentDir);

			const lineage = tree.getLineage('non-existent');

			expect(lineage).toEqual([]);
		});
	});

	describe('file format', () => {
		it('should use JSONL format', () => {
			const tree = SessionTree.create(cwd, agentDir);

			tree.appendMessage({ role: 'user', id: 'msg-1', content: [] } as Message);
			tree.appendMessage({ role: 'assistant', id: 'msg-2', content: [] } as Message);

			const content = readFileSync(tree.file, 'utf-8');
			const lines = content.trim().split('\n');

			// Each line should be valid JSON
			lines.forEach(line => {
				expect(() => JSON.parse(line)).not.toThrow();
			});
		});

		it('should have tree header as first entry', () => {
			const tree = SessionTree.create(cwd, agentDir);

			tree.appendMessage({ role: 'assistant', id: 'msg-1', content: [] } as Message);

			const content = readFileSync(tree.file, 'utf-8');
			const firstLine = content.trim().split('\n')[0];
			const header = JSON.parse(firstLine);

			expect(header.type).toBe('tree');
			expect(header.id).toBe(tree.id);
		});

		it('should append entries incrementally', () => {
			const tree = SessionTree.create(cwd, agentDir);

			tree.appendMessage({ role: 'assistant', id: 'msg-1', content: [] } as Message);
			const lines1 = readFileSync(tree.file, 'utf-8').trim().split('\n').length;

			tree.appendMessage({ role: 'user', id: 'msg-2', content: [] } as Message);
			const lines2 = readFileSync(tree.file, 'utf-8').trim().split('\n').length;

			expect(lines2).toBeGreaterThan(lines1);
		});
	});
});
