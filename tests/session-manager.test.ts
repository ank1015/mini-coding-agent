import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionManager, loadSessionFromEntries, parseSessionEntries, type SessionHeader } from '../src/core/session-manager';
import { existsSync, mkdirSync, readFileSync, rmSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('SessionManager', () => {
	let testDir: string;
	let agentDir: string;
	let cwd: string;

	beforeEach(() => {
		// Create temporary directories for each test
		testDir = join(tmpdir(), `session-test-${Date.now()}-${Math.random()}`);
		agentDir = join(testDir, 'agent');
		cwd = join(testDir, 'project');
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(cwd, { recursive: true });
	});

	afterEach(() => {
		// Clean up test directory
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
	});

	describe('create()', () => {
		it('should create a new session without file initially', () => {
			const manager = SessionManager.create(cwd, agentDir);

			expect(manager.getSessionId()).toBeTruthy();
			expect(manager.getSessionFile()).toBeTruthy();
			expect(manager.getCwd()).toBe(cwd);
			expect(manager.isPersisted()).toBe(true);

			// File should not exist yet (lazy persistence)
			expect(existsSync(manager.getSessionFile())).toBe(false);
		});

		it('should create session with initial provider', () => {
			const initialProvider = {
				api: 'openai',
				modelId: 'gpt-4',
				providerOptions: { temperature: 0.7 },
			};

			const manager = SessionManager.create(cwd, agentDir, initialProvider);
			const entries = manager.loadEntries();

			expect(entries).toHaveLength(1);
			expect(entries[0].type).toBe('session');
			const header = entries[0] as any;
			expect(header.api).toBe('openai');
			expect(header.modelId).toBe('gpt-4');
			expect(header.providerOptions).toEqual({ temperature: 0.7 });
		});

		it('should create session directory if it does not exist', () => {
			const manager = SessionManager.create(cwd, agentDir);
			const sessionDir = join(agentDir, 'sessions', `--${cwd.replace(/^\//, '').replace(/\//g, '-')}--`);

			expect(existsSync(sessionDir)).toBe(true);
		});

		it('should create unique session IDs', () => {
			const manager1 = SessionManager.create(cwd, agentDir);
			const manager2 = SessionManager.create(cwd, agentDir);

			expect(manager1.getSessionId()).not.toBe(manager2.getSessionId());
		});
	});

	describe('inMemory()', () => {
		it('should create in-memory session without persistence', () => {
			const manager = SessionManager.inMemory();

			expect(manager.getSessionId()).toBeTruthy();
			expect(manager.isPersisted()).toBe(false);
		});

		it('should support initial provider in memory', () => {
			const initialProvider = {
				api: 'google',
				modelId: 'gemini-3-flash',
				providerOptions: { temperature: 0.5 },
			};

			const manager = SessionManager.inMemory(initialProvider);
			const entries = manager.loadEntries();
			const header = entries[0] as any;

			expect(header.api).toBe('google');
			expect(header.modelId).toBe('gemini-3-flash');
		});

		it('should not create files when saving messages', () => {
			const manager = SessionManager.inMemory();

			manager.saveMessage({
				role: 'user',
				id: 'msg-1',
				content: [{ type: 'text', content: 'Hello' }],
			});

			const sessionDir = join(agentDir, 'sessions');
			expect(existsSync(sessionDir)).toBe(false);
		});
	});

	describe('lazy persistence', () => {
		it('should not create file until first assistant message', () => {
			const manager = SessionManager.create(cwd, agentDir);

			// Save user message
			manager.saveMessage({
				role: 'user',
				id: 'msg-1',
				content: [{ type: 'text', content: 'Hello' }],
			});

			// File should still not exist
			expect(existsSync(manager.getSessionFile())).toBe(false);
		});

		it('should flush all entries on first assistant message', () => {
			const initialProvider = {
				api: 'openai',
				modelId: 'gpt-4',
				providerOptions: { temperature: 0.7 },
			};

			const manager = SessionManager.create(cwd, agentDir, initialProvider);

			manager.saveMessage({
				role: 'user',
				id: 'msg-1',
				content: [{ type: 'text', content: 'Hello' }],
			});

			// Save assistant message - should trigger flush
			manager.saveMessage({
				role: 'assistant',
				id: 'msg-2',
				content: [{ type: 'response', content: [{ type: 'text', content: 'Hi!' }] }],
				model: { id: 'gpt-4' } as any,
				usage: { input: 10, output: 5 } as any,
				stopReason: 'stop',
			} as any);

			// Now file should exist with all entries
			expect(existsSync(manager.getSessionFile())).toBe(true);

			const content = readFileSync(manager.getSessionFile(), 'utf-8');
			const lines = content.trim().split('\n');

			expect(lines).toHaveLength(3); // Header, user message, assistant message
		});

		it('should append subsequent messages after flush', () => {
			const manager = SessionManager.create(cwd, agentDir);

			// First assistant message triggers flush
			manager.saveMessage({
				role: 'assistant',
				id: 'msg-1',
				content: [],
			} as any);

			expect(existsSync(manager.getSessionFile())).toBe(true);

			// Add more messages
			manager.saveMessage({
				role: 'user',
				id: 'msg-2',
				content: [{ type: 'text', content: 'Hello again' }],
			});

			const content = readFileSync(manager.getSessionFile(), 'utf-8');
			const lines = content.trim().split('\n');

			expect(lines).toHaveLength(3); // Header, assistant, user
		});
	});

	describe('saveMessage()', () => {
		it('should add message to in-memory entries', () => {
			const manager = SessionManager.create(cwd, agentDir);

			manager.saveMessage({
				role: 'user',
				id: 'msg-1',
				content: [{ type: 'text', content: 'Test' }],
			});

			const entries = manager.loadEntries();
			expect(entries).toHaveLength(2); // Header + message
			expect(entries[1].type).toBe('message');
		});

		it('should include timestamp in entry', () => {
			const manager = SessionManager.inMemory();
			const beforeTime = new Date().toISOString();

			manager.saveMessage({
				role: 'user',
				id: 'msg-1',
				content: [],
			});

			const entries = manager.loadEntries();
			const messageEntry = entries[1] as any;

			expect(messageEntry.timestamp).toBeTruthy();
			expect(new Date(messageEntry.timestamp).getTime()).toBeGreaterThanOrEqual(
				new Date(beforeTime).getTime()
			);
		});
	});

	describe('saveProvider()', () => {
		it('should add provider entry to in-memory entries', () => {
			const manager = SessionManager.create(cwd, agentDir);

			manager.saveProvider('openai', 'gpt-4', { temperature: 0.8 });

			const entries = manager.loadEntries();
			expect(entries).toHaveLength(2); // Header + provider
			expect(entries[1].type).toBe('provider');

			const providerEntry = entries[1] as any;
			expect(providerEntry.api).toBe('openai');
			expect(providerEntry.modelId).toBe('gpt-4');
			expect(providerEntry.providerOptions).toEqual({ temperature: 0.8 });
		});

		it('should persist provider entry after flush', () => {
			const manager = SessionManager.create(cwd, agentDir);

			// Trigger flush with assistant message
			manager.saveMessage({
				role: 'assistant',
				id: 'msg-1',
				content: [],
			} as any);

			// Add provider entry
			manager.saveProvider('google', 'gemini-3-flash', { temperature: 0.2 });

			const content = readFileSync(manager.getSessionFile(), 'utf-8');
			const lines = content.trim().split('\n');
			const lastEntry = JSON.parse(lines[lines.length - 1]);

			expect(lastEntry.type).toBe('provider');
			expect(lastEntry.api).toBe('google');
		});
	});

	describe('loadSession()', () => {
		it('should return messages and model from entries', () => {
			const initialProvider = {
				api: 'openai',
				modelId: 'gpt-4',
				providerOptions: { temperature: 0.7 },
			};

			const manager = SessionManager.create(cwd, agentDir, initialProvider);

			manager.saveMessage({
				role: 'user',
				id: 'msg-1',
				content: [{ type: 'text', content: 'Hello' }],
			});

			const session = manager.loadSession();

			expect(session.messages).toHaveLength(1);
			expect(session.messages[0].role).toBe('user');
			expect(session.model).toEqual(initialProvider);
		});

		it('should return empty messages for new session', () => {
			const manager = SessionManager.create(cwd, agentDir);
			const session = manager.loadSession();

			expect(session.messages).toHaveLength(0);
			expect(session.model).toBeNull();
		});

		it('should prioritize provider entry over header', () => {
			const initialProvider = {
				api: 'openai',
				modelId: 'gpt-4',
				providerOptions: { temperature: 0.7 },
			};

			const manager = SessionManager.create(cwd, agentDir, initialProvider);

			// Add provider entry with different model
			manager.saveProvider('google', 'gemini-3-flash', { temperature: 0.2 });

			const session = manager.loadSession();

			// Should use provider entry (most recent)
			expect(session.model?.api).toBe('google');
			expect(session.model?.modelId).toBe('gemini-3-flash');
		});
	});

	describe('loadSessionFromEntries()', () => {
		it('should extract messages from entries', () => {
			const entries = [
				{
					type: 'session' as const,
					id: 'session-1',
					timestamp: new Date().toISOString(),
					cwd: '/path',
				},
				{
					type: 'message' as const,
					timestamp: new Date().toISOString(),
					message: {
						role: 'user',
						id: 'msg-1',
						content: [{ type: 'text', content: 'Hello' }],
					} as any,
				},
			];

			const session = loadSessionFromEntries(entries);

			expect(session.messages).toHaveLength(1);
			expect(session.messages[0].role).toBe('user');
		});

		it('should extract model from header', () => {
			const entries = [
				{
					type: 'session' as const,
					id: 'session-1',
					timestamp: new Date().toISOString(),
					cwd: '/path',
					api: 'openai',
					modelId: 'gpt-4',
					providerOptions: { temperature: 0.7 },
				},
			];

			const session = loadSessionFromEntries(entries);

			expect(session.model).toEqual({
				api: 'openai',
				modelId: 'gpt-4',
				providerOptions: { temperature: 0.7 },
			});
		});

		it('should use provider entry if present', () => {
			const entries = [
				{
					type: 'session' as const,
					id: 'session-1',
					timestamp: new Date().toISOString(),
					cwd: '/path',
					api: 'openai',
					modelId: 'gpt-4',
					providerOptions: { temperature: 0.7 },
				},
				{
					type: 'provider' as const,
					timestamp: new Date().toISOString(),
					api: 'google',
					modelId: 'gemini-3-flash',
					providerOptions: { temperature: 0.2 },
				},
			];

			const session = loadSessionFromEntries(entries);

			expect(session.model?.api).toBe('google');
			expect(session.model?.modelId).toBe('gemini-3-flash');
		});

		it('should handle partial provider entries', () => {
			const entries = [
				{
					type: 'session' as const,
					id: 'session-1',
					timestamp: new Date().toISOString(),
					cwd: '/path',
					api: 'openai',
					modelId: 'gpt-4',
					providerOptions: { temperature: 0.7 },
				},
				{
					type: 'provider' as const,
					timestamp: new Date().toISOString(),
					providerOptions: { temperature: 0.5 }, // Only options, no model
				},
			];

			const session = loadSessionFromEntries(entries);

			// Should use header model since provider entry is incomplete
			expect(session.model?.api).toBe('openai');
			expect(session.model?.modelId).toBe('gpt-4');
		});
	});

	describe('reset()', () => {
		it('should generate new session ID', () => {
			const manager = SessionManager.create(cwd, agentDir);
			const oldId = manager.getSessionId();

			manager.reset();

			expect(manager.getSessionId()).not.toBe(oldId);
		});

		it('should clear in-memory entries', () => {
			const manager = SessionManager.create(cwd, agentDir);

			manager.saveMessage({
				role: 'user',
				id: 'msg-1',
				content: [],
			});

			manager.reset();

			const entries = manager.loadEntries();
			expect(entries).toHaveLength(1); // Only new header
			expect(entries[0].type).toBe('session');
		});

		it('should create new session file path', () => {
			const manager = SessionManager.create(cwd, agentDir);
			const oldFile = manager.getSessionFile();

			manager.reset();

			expect(manager.getSessionFile()).not.toBe(oldFile);
		});
	});

	describe('open()', () => {
		it('should load existing session file', () => {
			// Create a session and flush it
			const manager1 = SessionManager.create(cwd, agentDir);
			manager1.saveMessage({
				role: 'assistant',
				id: 'msg-1',
				content: [],
			} as any);

			const sessionFile = manager1.getSessionFile();

			// Open the session
			const manager2 = SessionManager.open(sessionFile, agentDir);

			expect(manager2.getSessionId()).toBe(manager1.getSessionId());
			expect(manager2.getCwd()).toBe(cwd);

			const entries = manager2.loadEntries();
			expect(entries.length).toBeGreaterThan(0);
		});

		it('should extract cwd from session header', () => {
			const manager1 = SessionManager.create(cwd, agentDir);
			manager1.saveMessage({
				role: 'assistant',
				id: 'msg-1',
				content: [],
			} as any);

			const sessionFile = manager1.getSessionFile();
			const manager2 = SessionManager.open(sessionFile, agentDir);

			expect(manager2.getCwd()).toBe(cwd);
		});
	});

	describe('continueRecent()', () => {
		it('should create new session if none exists', () => {
			const manager = SessionManager.continueRecent(cwd, agentDir);

			expect(manager.getSessionId()).toBeTruthy();
			expect(manager.loadSession().messages).toHaveLength(0);
		});

		it('should load most recent session if it exists', async () => {
			// Create first session and flush it
			const manager1 = SessionManager.create(cwd, agentDir);
			manager1.saveMessage({
				role: 'assistant',
				id: 'msg-1',
				content: [],
			} as any);

			// Wait to ensure different file modification times
			await new Promise(resolve => setTimeout(resolve, 10));

			// Create second session and flush it
			const manager2 = SessionManager.create(cwd, agentDir);
			manager2.saveMessage({
				role: 'user',
				id: 'msg-2',
				content: [{ type: 'text', content: 'Recent' }],
			});
			manager2.saveMessage({
				role: 'assistant',
				id: 'msg-3',
				content: [],
			} as any);

			// Continue recent should load manager2's session (most recent)
			const manager3 = SessionManager.continueRecent(cwd, agentDir);

			expect(manager3.getSessionId()).toBe(manager2.getSessionId());
		});

		it('should use initial provider for new session', () => {
			const initialProvider = {
				api: 'openai',
				modelId: 'gpt-4',
				providerOptions: { temperature: 0.7 },
			};

			const manager = SessionManager.continueRecent(cwd, agentDir, initialProvider);
			const session = manager.loadSession();

			expect(session.model).toEqual(initialProvider);
		});
	});

	describe('list()', () => {
		it('should return empty array when no sessions exist', () => {
			const sessions = SessionManager.list(cwd, agentDir);
			expect(sessions).toEqual([]);
		});

		it('should list all sessions for a directory', async () => {
			// Create first session
			const manager1 = SessionManager.create(cwd, agentDir);
			manager1.saveMessage({
				role: 'user',
				id: 'msg-1',
				content: [{ type: 'text', content: 'First session' }],
			});
			manager1.saveMessage({
				role: 'assistant',
				id: 'msg-2',
				content: [],
			} as any);

			// Wait to ensure different modification times
			await new Promise(resolve => setTimeout(resolve, 10));

			// Create second session
			const manager2 = SessionManager.create(cwd, agentDir);
			manager2.saveMessage({
				role: 'user',
				id: 'msg-3',
				content: [{ type: 'text', content: 'Second session' }],
			});
			manager2.saveMessage({
				role: 'assistant',
				id: 'msg-4',
				content: [],
			} as any);

			const sessions = SessionManager.list(cwd, agentDir);

			expect(sessions).toHaveLength(2);
			expect(sessions[0].id).toBe(manager2.getSessionId()); // Most recent first
			expect(sessions[1].id).toBe(manager1.getSessionId());
		});

		it('should include session metadata', () => {
			const manager = SessionManager.create(cwd, agentDir);
			manager.saveMessage({
				role: 'user',
				id: 'msg-1',
				content: [{ type: 'text', content: 'Hello world' }],
			});
			manager.saveMessage({
				role: 'assistant',
				id: 'msg-2',
				content: [],
			} as any);

			const sessions = SessionManager.list(cwd, agentDir);

			expect(sessions[0].path).toBe(manager.getSessionFile());
			expect(sessions[0].firstMessage).toBe('Hello world');
			expect(sessions[0].messageCount).toBe(2);
			expect(sessions[0].allMessagesText).toContain('Hello world');
		});

		it('should sort by modification time descending', async () => {
			const manager1 = SessionManager.create(cwd, agentDir);
			manager1.saveMessage({ role: 'assistant', id: 'msg-1', content: [] } as any);

			// Small delay to ensure different mtime
			await new Promise(resolve => setTimeout(resolve, 10));

			const manager2 = SessionManager.create(cwd, agentDir);
			manager2.saveMessage({ role: 'assistant', id: 'msg-2', content: [] } as any);

			const sessions = SessionManager.list(cwd, agentDir);

			expect(sessions[0].id).toBe(manager2.getSessionId());
			expect(sessions[1].id).toBe(manager1.getSessionId());
		});
	});

	describe('branch()', () => {
		let originalManager: SessionManager;
		let messages: any[];

		beforeEach(() => {
			originalManager = SessionManager.create(cwd, agentDir, {
				api: 'openai',
				modelId: 'gpt-4',
				providerOptions: { temperature: 0.7 }
			});

			messages = [
				{ role: 'user', id: 'msg-1', content: [{ type: 'text', content: 'Message 1' }] },
				{ role: 'assistant', id: 'msg-2', content: [{ type: 'text', content: 'Response 1' }] },
				{ role: 'user', id: 'msg-3', content: [{ type: 'text', content: 'Message 2' }] },
				{ role: 'assistant', id: 'msg-4', content: [{ type: 'text', content: 'Response 2' }] }
			];

			// Save all messages
			messages.forEach(msg => originalManager.saveMessage(msg));
		});

		it('should create new session file', () => {
			const newSessionFile = originalManager.branch('msg-3');
			expect(existsSync(newSessionFile)).toBe(true);
			expect(newSessionFile).not.toBe(originalManager.getSessionFile());
		});

		it('should copy history up to target message', () => {
			const newSessionFile = originalManager.branch('msg-3');
			const newManager = SessionManager.open(newSessionFile, agentDir);
			const newMessages = newManager.loadMessages();

			// Should contain msg-1 and msg-2, but not msg-3 or msg-4
			expect(newMessages).toHaveLength(2);
			expect(newMessages[0].id).toBe('msg-1');
			expect(newMessages[1].id).toBe('msg-2');
		});

		it('should link new session to parent', () => {
			const newSessionFile = originalManager.branch('msg-3');
			const newManager = SessionManager.open(newSessionFile, agentDir);
			const entries = newManager.loadEntries();
			const header = entries.find(e => e.type === 'session') as SessionHeader;

			expect(header.parent).toBeDefined();
			expect(header.parent?.sessionId).toBe(originalManager.getSessionId());
			expect(header.parent?.messageId).toBe('msg-2'); // Last message before branch
		});

		it('should list parent info in list()', () => {
			const newSessionFile = originalManager.branch('msg-3');

			// Get info from list
			const sessions = SessionManager.list(cwd, agentDir);
			const branchedSession = sessions.find(s => s.path === newSessionFile);

			expect(branchedSession).toBeDefined();
			expect(branchedSession?.parentId).toBe(originalManager.getSessionId());
			expect(branchedSession?.parentMessageId).toBe('msg-2');
		});

		it('should throw error if message not found', () => {
			expect(() => {
				originalManager.branch('non-existent-id');
			}).toThrow(/not found/);
		});

		it('should preserve provider settings', () => {
			const newSessionFile = originalManager.branch('msg-3');
			const newManager = SessionManager.open(newSessionFile, agentDir);
			const session = newManager.loadSession();

			expect(session.model?.api).toBe('openai');
			expect(session.model?.modelId).toBe('gpt-4');
		});

		it('should branch from first message', () => {
			const newSessionFile = originalManager.branch('msg-1');
			const newManager = SessionManager.open(newSessionFile, agentDir);
			const newMessages = newManager.loadMessages();

			// Should be empty - branching before first message
			expect(newMessages).toHaveLength(0);
		});

		it('should preserve provider entries in branch', () => {
			// Add a provider switch
			originalManager.saveProvider('google', 'gemini-3-flash', { temperature: 0.5 });
			originalManager.saveMessage({
				role: 'user',
				id: 'msg-5',
				content: [{ type: 'text', content: 'After provider switch' }]
			});

			const newSessionFile = originalManager.branch('msg-5');
			const newManager = SessionManager.open(newSessionFile, agentDir);
			const entries = newManager.loadEntries();

			// Should include the provider entry
			const providerEntry = entries.find(e => e.type === 'provider');
			expect(providerEntry).toBeDefined();
			expect((providerEntry as any).api).toBe('google');
		});

		it('should handle branching with no parent message', () => {
			// Branch from first message means no parent message
			const newSessionFile = originalManager.branch('msg-1');
			const newManager = SessionManager.open(newSessionFile, agentDir);
			const entries = newManager.loadEntries();
			const header = entries.find(e => e.type === 'session') as SessionHeader;

			expect(header.parent?.messageId).toBeNull();
			expect(header.parent?.sessionId).toBe(originalManager.getSessionId());
		});
	});

	describe('clone()', () => {
		let originalManager: SessionManager;

		beforeEach(() => {
			originalManager = SessionManager.create(cwd, agentDir, {
				api: 'openai',
				modelId: 'gpt-4',
				providerOptions: { temperature: 0.7 }
			});

			// Add some messages
			originalManager.saveMessage({
				role: 'user',
				id: 'msg-1',
				content: [{ type: 'text', content: 'Message 1' }]
			});
			originalManager.saveMessage({
				role: 'assistant',
				id: 'msg-2',
				content: [{ type: 'text', content: 'Response 1' }]
			} as any);
		});

		it('should create new session file', () => {
			const newSessionFile = originalManager.clone();
			expect(existsSync(newSessionFile)).toBe(true);
			expect(newSessionFile).not.toBe(originalManager.getSessionFile());
		});

		it('should copy all messages', () => {
			const newSessionFile = originalManager.clone();
			const newManager = SessionManager.open(newSessionFile, agentDir);
			const newMessages = newManager.loadMessages();
			const originalMessages = originalManager.loadMessages();

			expect(newMessages).toHaveLength(originalMessages.length);
			expect(newMessages[0].id).toBe('msg-1');
			expect(newMessages[1].id).toBe('msg-2');
		});

		it('should link to parent at last message', () => {
			const newSessionFile = originalManager.clone();
			const newManager = SessionManager.open(newSessionFile, agentDir);
			const entries = newManager.loadEntries();
			const header = entries.find(e => e.type === 'session') as SessionHeader;

			expect(header.parent).toBeDefined();
			expect(header.parent?.sessionId).toBe(originalManager.getSessionId());
			expect(header.parent?.messageId).toBe('msg-2'); // Last message
		});

		it('should preserve provider settings', () => {
			const newSessionFile = originalManager.clone();
			const newManager = SessionManager.open(newSessionFile, agentDir);
			const session = newManager.loadSession();

			expect(session.model?.api).toBe('openai');
			expect(session.model?.modelId).toBe('gpt-4');
		});

		it('should preserve provider entries', () => {
			// Add provider switch
			originalManager.saveProvider('google', 'gemini-3-flash', { temperature: 0.2 });

			const newSessionFile = originalManager.clone();
			const newManager = SessionManager.open(newSessionFile, agentDir);
			const entries = newManager.loadEntries();

			const providerEntry = entries.find(e => e.type === 'provider');
			expect(providerEntry).toBeDefined();
			expect((providerEntry as any).api).toBe('google');
		});

		it('should handle session with no messages', () => {
			const emptyManager = SessionManager.create(cwd, agentDir);
			const newSessionFile = emptyManager.clone();
			const newManager = SessionManager.open(newSessionFile, agentDir);
			const entries = newManager.loadEntries();
			const header = entries.find(e => e.type === 'session') as SessionHeader;

			expect(header.parent?.messageId).toBeNull();
		});

		it('should generate unique session ID', () => {
			const newSessionFile = originalManager.clone();
			const newManager = SessionManager.open(newSessionFile, agentDir);

			expect(newManager.getSessionId()).not.toBe(originalManager.getSessionId());
		});
	});

	describe('setSessionFile()', () => {
		it('should switch to existing session file', () => {
			// Create first session
			const manager1 = SessionManager.create(cwd, agentDir);
			manager1.saveMessage({
				role: 'assistant',
				id: 'msg-1',
				content: []
			} as any);
			const sessionFile1 = manager1.getSessionFile();

			// Create second session
			const manager2 = SessionManager.create(cwd, agentDir);
			const originalSessionId = manager2.getSessionId();

			// Switch manager2 to manager1's session
			manager2.setSessionFile(sessionFile1);

			expect(manager2.getSessionFile()).toBe(sessionFile1);
			expect(manager2.getSessionId()).toBe(manager1.getSessionId());
			expect(manager2.getSessionId()).not.toBe(originalSessionId);
		});

		it('should load entries from existing file', () => {
			const manager1 = SessionManager.create(cwd, agentDir);
			manager1.saveMessage({
				role: 'user',
				id: 'msg-1',
				content: [{ type: 'text', content: 'Test' }]
			});
			manager1.saveMessage({
				role: 'assistant',
				id: 'msg-2',
				content: []
			} as any);

			const manager2 = SessionManager.create(cwd, agentDir);
			manager2.setSessionFile(manager1.getSessionFile());

			const messages = manager2.loadMessages();
			expect(messages).toHaveLength(2);
			expect(messages[0].id).toBe('msg-1');
		});

		it('should create new session for non-existent file', () => {
			const manager = SessionManager.create(cwd, agentDir);
			const newFile = join(agentDir, 'sessions', 'new-session.jsonl');

			manager.setSessionFile(newFile);

			expect(manager.getSessionFile()).toBe(newFile);
			expect(existsSync(newFile)).toBe(false); // Not created yet (lazy)
		});

		it('should support initial provider for new file', () => {
			const manager = SessionManager.create(cwd, agentDir);
			const newFile = join(agentDir, 'sessions', 'new-session.jsonl');

			manager.setSessionFile(newFile, {
				api: 'google',
				modelId: 'gemini-3-flash',
				providerOptions: { temperature: 0.5 }
			});

			const session = manager.loadSession();
			expect(session.model?.api).toBe('google');
			expect(session.model?.modelId).toBe('gemini-3-flash');
		});

		it('should mark session as flushed when loading existing file', () => {
			const manager1 = SessionManager.create(cwd, agentDir);
			manager1.saveMessage({ role: 'assistant', id: 'msg-1', content: [] } as any);

			const manager2 = SessionManager.create(cwd, agentDir);
			manager2.setSessionFile(manager1.getSessionFile());

			// Add new message - should append to existing file
			manager2.saveMessage({
				role: 'user',
				id: 'msg-2',
				content: [{ type: 'text', content: 'New message' }]
			});

			const content = readFileSync(manager2.getSessionFile(), 'utf-8');
			const lines = content.trim().split('\n');
			expect(lines.length).toBeGreaterThan(2);
		});
	});

	describe('parseSessionEntries()', () => {
		it('should parse valid JSONL content', () => {
			const content = `{"type":"session","id":"s1","timestamp":"2024-01-01","cwd":"/path"}
{"type":"message","timestamp":"2024-01-01","message":{"role":"user","id":"m1","content":[]}}
{"type":"provider","timestamp":"2024-01-01","api":"openai","modelId":"gpt-4","providerOptions":{}}`;

			const entries = parseSessionEntries(content);

			expect(entries).toHaveLength(3);
			expect(entries[0].type).toBe('session');
			expect(entries[1].type).toBe('message');
			expect(entries[2].type).toBe('provider');
		});

		it('should skip empty lines', () => {
			const content = `{"type":"session","id":"s1","timestamp":"2024-01-01","cwd":"/path"}

{"type":"message","timestamp":"2024-01-01","message":{"role":"user","id":"m1","content":[]}}

`;

			const entries = parseSessionEntries(content);

			expect(entries).toHaveLength(2);
		});

		it('should skip malformed JSON lines', () => {
			const content = `{"type":"session","id":"s1","timestamp":"2024-01-01","cwd":"/path"}
{invalid json}
{"type":"message","timestamp":"2024-01-01","message":{"role":"user","id":"m1","content":[]}}`;

			const entries = parseSessionEntries(content);

			expect(entries).toHaveLength(2);
			expect(entries[0].type).toBe('session');
			expect(entries[1].type).toBe('message');
		});

		it('should handle empty content', () => {
			const entries = parseSessionEntries('');
			expect(entries).toEqual([]);
		});

		it('should handle whitespace-only content', () => {
			const entries = parseSessionEntries('   \n  \n  ');
			expect(entries).toEqual([]);
		});
	});

	describe('multiple provider switches', () => {
		it('should track provider changes chronologically', () => {
			const manager = SessionManager.create(cwd, agentDir, {
				api: 'openai',
				modelId: 'gpt-4',
				providerOptions: { temperature: 0.7 }
			});

			// First provider switch
			manager.saveProvider('google', 'gemini-3-flash', { temperature: 0.5 });

			// Second provider switch
			manager.saveProvider('anthropic', 'claude-3', { temperature: 0.3 });

			const session = manager.loadSession();

			// Should use the most recent provider
			expect(session.model?.api).toBe('anthropic');
			expect(session.model?.modelId).toBe('claude-3');
			expect(session.model?.providerOptions).toEqual({ temperature: 0.3 });
		});

		it('should persist all provider entries', () => {
			const manager = SessionManager.create(cwd, agentDir);

			manager.saveMessage({ role: 'assistant', id: 'msg-1', content: [] } as any);
			manager.saveProvider('openai', 'gpt-4', { temperature: 0.7 });
			manager.saveProvider('google', 'gemini-3-flash', { temperature: 0.5 });

			const content = readFileSync(manager.getSessionFile(), 'utf-8');
			const lines = content.trim().split('\n');

			const providerEntries = lines
				.map(line => JSON.parse(line))
				.filter(entry => entry.type === 'provider');

			expect(providerEntries).toHaveLength(2);
			expect(providerEntries[0].api).toBe('openai');
			expect(providerEntries[1].api).toBe('google');
		});
	});

	describe('edge cases and error handling', () => {
		it('should handle session files with only header', () => {
			const manager = SessionManager.create(cwd, agentDir);
			const session = manager.loadSession();

			expect(session.messages).toEqual([]);
			expect(session.model).toBeNull();
		});

		it('should handle loadMessages on empty session', () => {
			const manager = SessionManager.inMemory();
			const messages = manager.loadMessages();

			expect(messages).toEqual([]);
		});

		it('should handle loadModel on session without provider', () => {
			const manager = SessionManager.create(cwd, agentDir);
			const model = manager.loadModel();

			expect(model).toBeNull();
		});

		it('should handle corrupted session file gracefully', () => {
			const sessionFile = join(agentDir, 'sessions', 'test-session.jsonl');
			mkdirSync(join(agentDir, 'sessions'), { recursive: true });
			writeFileSync(sessionFile, '{broken json\n{more broken');

			const manager = SessionManager.open(sessionFile, agentDir);
			const entries = manager.loadEntries();

			// Should return empty array for malformed content
			expect(entries).toEqual([]);
		});

		it('should handle list() with corrupted files', () => {
			const sessionDir = join(agentDir, 'sessions', `--${cwd.replace(/^\//, '').replace(/\//g, '-')}--`);
			mkdirSync(sessionDir, { recursive: true });

			// Create valid session
			const manager1 = SessionManager.create(cwd, agentDir);
			manager1.saveMessage({ role: 'assistant', id: 'msg-1', content: [] } as any);

			// Create corrupted file
			const corruptedFile = join(sessionDir, 'corrupted.jsonl');
			writeFileSync(corruptedFile, '{invalid json');

			const sessions = SessionManager.list(cwd, agentDir);

			// Should still list valid sessions
			expect(sessions.length).toBeGreaterThanOrEqual(1);
		});

		it('should handle messages with no text content', () => {
			const manager = SessionManager.create(cwd, agentDir);
			manager.saveMessage({
				role: 'user',
				id: 'msg-1',
				content: [] // No content
			});
			manager.saveMessage({
				role: 'assistant',
				id: 'msg-2',
				content: []
			} as any);

			const sessions = SessionManager.list(cwd, agentDir);
			const session = sessions[0];

			expect(session.firstMessage).toBe('(no messages)');
			expect(session.allMessagesText).toBe('');
		});

		it('should handle header without provider info', () => {
			const entries = [
				{
					type: 'session' as const,
					id: 's1',
					timestamp: '2024-01-01',
					cwd: '/path'
					// No api, modelId, providerOptions
				}
			];

			const session = loadSessionFromEntries(entries);

			expect(session.model).toBeNull();
		});

		it('should handle partial provider info in header', () => {
			const entries = [
				{
					type: 'session' as const,
					id: 's1',
					timestamp: '2024-01-01',
					cwd: '/path',
					api: 'openai'
					// Missing modelId and providerOptions
				}
			];

			const session = loadSessionFromEntries(entries);

			expect(session.model).toBeNull();
		});
	});
});
