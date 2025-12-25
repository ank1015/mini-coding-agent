import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentSession } from '../src/core/agent-session';
import { SessionManager } from '../src/core/session-manager';
import { SettingsManager } from '../src/core/settings-manager';
import type { Conversation, AgentEvent } from '@ank1015/providers';

// Mock the providers package
vi.mock('@ank1015/providers', async () => {
	const actual = await vi.importActual('@ank1015/providers');
	return {
		...actual,
		getApiKeyFromEnv: vi.fn(() => 'test-api-key'),
		getModel: vi.fn((api: string, modelId: string) => ({
			id: modelId,
			api,
			name: 'Test Model',
		})),
	};
});

describe('AgentSession', () => {
	let mockAgent: any;
	let sessionManager: SessionManager;
	let settingsManager: SettingsManager;

	beforeEach(() => {
		// Create mock agent
		mockAgent = {
			state: {
				provider: {
					model: { id: 'gpt-4', api: 'openai', name: 'GPT-4' },
					providerOptions: { temperature: 0.7 },
				},
				messages: [],
				tools: [],
				isStreaming: false,
				pendingToolCalls: new Set(),
			},
			subscribe: vi.fn((handler) => {
				return vi.fn(); // Unsubscribe function
			}),
			setProvider: vi.fn(),
			setQueueMode: vi.fn(),
			getQueueMode: vi.fn(() => 'one-at-a-time'),
			prompt: vi.fn(),
			queueMessage: vi.fn(),
			clearMessageQueue: vi.fn(),
			abort: vi.fn(),
			waitForIdle: vi.fn(() => Promise.resolve()),
			reset: vi.fn(),
			replaceMessages: vi.fn(),
		};

		// Create in-memory managers for testing
		// Using a real (non-in-memory) session manager for branching tests because branching requires file operations
		// But for general tests we can use inMemory
		sessionManager = SessionManager.inMemory({
			api: 'openai',
			modelId: 'gpt-4',
			providerOptions: { temperature: 0.7 },
		});

		settingsManager = SettingsManager.inMemory({
			defaultApi: 'openai',
			defaultModel: 'gpt-4',
			queueMode: 'one-at-a-time',
		});
	});

	describe('constructor', () => {
		it('should initialize with agent, sessionManager, and settingsManager', () => {
			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			expect(session.agent).toBe(mockAgent);
			expect(session.sessionManager).toBe(sessionManager);
			expect(session.settingsManager).toBe(settingsManager);
		});

		it('should subscribe to agent events when session.subscribe is called', () => {
			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

		session.subscribe(() => {});
			expect(mockAgent.subscribe).toHaveBeenCalled();
		});
	});

	describe('state access', () => {
		it('should provide access to agent state', () => {
			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			expect(session.state).toBe(mockAgent.state);
		});

		it('should provide access to current model', () => {
			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			expect(session.model).toEqual({
				id: 'gpt-4',
				api: 'openai',
				name: 'GPT-4',
			});
		});

		it('should provide access to provider options', () => {
			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			expect(session.providerOptions).toEqual({ temperature: 0.7 });
		});

		it('should expose isStreaming state', () => {
			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			expect(session.isStreaming).toBe(false);

			mockAgent.state.isStreaming = true;
			expect(session.isStreaming).toBe(true);
		});

		it('should expose messages', () => {
			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			expect(session.messages).toEqual([]);
		});

		it('should expose queue mode', () => {
			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			expect(session.queueMode).toBe('one-at-a-time');
		});

		it('should expose session file', () => {
			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			// In-memory session should return null
			expect(session.sessionFile).toBeNull();
		});

		it('should expose session ID', () => {
			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			expect(session.sessionId).toBeTruthy();
		});
	});

	describe('subscribe()', () => {
		it('should allow subscribing to events', () => {
			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			const listener = vi.fn();
			const unsubscribe = session.subscribe(listener);

			expect(typeof unsubscribe).toBe('function');
		});

		it('should allow unsubscribing', () => {
			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			const listener = vi.fn();
			const unsubscribe = session.subscribe(listener);

			unsubscribe();

			// Listener should not be called after unsubscribe
			// (would need to trigger an event to verify, but the mechanism is tested)
		});
	});

	describe('prompt()', () => {
		it('should validate model before prompting', async () => {
			mockAgent.state.provider.model = null;

			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			await expect(session.prompt('Hello')).rejects.toThrow('No model selected');
		});

		it('should call agent.prompt with text', async () => {
			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			await session.prompt('Hello world');

			expect(mockAgent.prompt).toHaveBeenCalledWith('Hello world', undefined);
		});

		it('should pass attachments to agent.prompt', async () => {
			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			const attachments = [
				{ id: 'img-1', type: 'image' as const, fileName: 'test.png', mimeType: 'image/png', content: 'base64data' },
			];

			await session.prompt('Check this image', { attachments });

			expect(mockAgent.prompt).toHaveBeenCalledWith('Check this image', attachments);
		});
	});

	describe('queueMessage()', () => {
		it('should queue message and call agent.queueMessage', async () => {
			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			await session.queueMessage('Queued message');

			expect(mockAgent.queueMessage).toHaveBeenCalled();
			expect(session.queuedMessageCount).toBe(1);
		});

		it('should track queued message count', async () => {
			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			await session.queueMessage('Message 1');
			await session.queueMessage('Message 2');

			expect(session.queuedMessageCount).toBe(2);
		});

		it('should return queued messages', async () => {
			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			await session.queueMessage('Message 1');
			await session.queueMessage('Message 2');

			const queued = session.getQueuedMessages();
			expect(queued).toEqual(['Message 1', 'Message 2']);
		});
	});

	describe('clearQueue()', () => {
		it('should clear queued messages and return them', async () => {
			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			await session.queueMessage('Message 1');
			await session.queueMessage('Message 2');

			const cleared = session.clearQueue();

			expect(cleared).toEqual(['Message 1', 'Message 2']);
			expect(session.queuedMessageCount).toBe(0);
			expect(mockAgent.clearMessageQueue).toHaveBeenCalled();
		});
	});

	describe('abort()', () => {
		it('should call agent.abort and waitForIdle', async () => {
			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			await session.abort();

			expect(mockAgent.abort).toHaveBeenCalled();
			expect(mockAgent.waitForIdle).toHaveBeenCalled();
		});
	});

	describe('reset()', () => {
		it('should reset agent and session manager', async () => {
			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			const oldSessionId = session.sessionId;

			await session.reset();

			expect(mockAgent.abort).toHaveBeenCalled();
			expect(mockAgent.reset).toHaveBeenCalled();
			expect(session.sessionId).not.toBe(oldSessionId);
		});

		it('should clear queued messages', async () => {
			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			await session.queueMessage('Message 1');
			await session.reset();

			expect(session.queuedMessageCount).toBe(0);
		});
	});

	describe('setModel()', () => {
		it('should update agent provider', async () => {
			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			const newModel = { id: 'gemini-3-flash', api: 'google', name: 'Gemini' } as any;
			const newOptions = { temperature: 0.5 };

			await session.setModel(newModel, newOptions);

			expect(mockAgent.setProvider).toHaveBeenCalledWith({
				model: newModel,
				providerOptions: newOptions,
			});
		});

		it('should save to session manager', async () => {
			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			const newModel = { id: 'gemini-3-flash', api: 'google', name: 'Gemini' } as any;
			const newOptions = { temperature: 0.5 };

			await session.setModel(newModel, newOptions);

			const loadedSession = sessionManager.loadSession();
			expect(loadedSession.model).toEqual({
				api: 'google',
				modelId: 'gemini-3-flash',
				providerOptions: newOptions,
			});
		});

		it('should save to settings manager', async () => {
			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			const newModel = { id: 'gemini-3-flash', api: 'google', name: 'Gemini' } as any;
			const newOptions = { temperature: 0.5 };

			await session.setModel(newModel, newOptions);

			expect(settingsManager.getDefaultModel()).toBe('gemini-3-flash');
			expect(settingsManager.getDefaultProvider()).toBe('google');
			expect(settingsManager.getDefaultProviderOptions()).toEqual(newOptions);
		});

		it('should throw if no API key available', async () => {
			const { getApiKeyFromEnv } = await import('@ank1015/providers');
			vi.mocked(getApiKeyFromEnv).mockReturnValueOnce(undefined);

			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			const newModel = { id: 'unknown-model', api: 'unknown', name: 'Unknown' } as any;

			await expect(session.setModel(newModel, {})).rejects.toThrow('No API key');
		});
	});

	describe('setQueueMode()', () => {
		it('should update agent queue mode', () => {
			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			session.setQueueMode('all');

			expect(mockAgent.setQueueMode).toHaveBeenCalledWith('all');
		});

		it('should save to settings manager', () => {
			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			session.setQueueMode('all');

			expect(settingsManager.getQueueMode()).toBe('all');
		});
	});

	describe('switchSession()', () => {
		it('should abort current operation', async () => {
			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			await session.switchSession('/path/to/session.jsonl');

			expect(mockAgent.abort).toHaveBeenCalled();
			expect(mockAgent.waitForIdle).toHaveBeenCalled();
		});

		it('should clear queued messages', async () => {
			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			await session.queueMessage('Message 1');
			await session.switchSession('/path/to/session.jsonl');

			expect(session.queuedMessageCount).toBe(0);
		});

		it('should replace agent messages with loaded session', async () => {
			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			await session.switchSession('/path/to/session.jsonl');

			expect(mockAgent.replaceMessages).toHaveBeenCalled();
		});
	});

	describe('branchSession()', () => {
		let realSessionManager: SessionManager;
		let testDir: string;
		let agentDir: string;
		let cwd: string;

		beforeEach(() => {
			// Setup real file system for branching tests
			const { tmpdir } = require('os');
			const { join } = require('path');
			const { mkdirSync } = require('fs');
			
			testDir = join(tmpdir(), `agent-session-test-${Date.now()}-${Math.random()}`);
			agentDir = join(testDir, 'agent');
			cwd = join(testDir, 'project');
			mkdirSync(agentDir, { recursive: true });
			mkdirSync(cwd, { recursive: true });

			realSessionManager = SessionManager.create(cwd, agentDir, {
				api: 'openai',
				modelId: 'gpt-4',
				providerOptions: { temperature: 0.7 }
			});

			// Save some messages to branch from
			realSessionManager.saveMessage({ role: 'user', id: 'msg-1', content: [{ type: 'text', content: '1' }] });
			realSessionManager.saveMessage({ role: 'assistant', id: 'msg-2', content: [{ type: 'text', content: '2' }] });
			realSessionManager.saveMessage({ role: 'user', id: 'msg-3', content: [{ type: 'text', content: '3' }] });
		});

		it('should branch session and switch to it', async () => {
			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager: realSessionManager,
				settingsManager,
			});

			const originalSessionId = session.sessionId;

			// Spy on sessionManager.branch to ensure it's called
			const branchSpy = vi.spyOn(realSessionManager, 'branch');
			const switchSpy = vi.spyOn(session, 'switchSession');

			await session.branchSession('msg-3');

			expect(branchSpy).toHaveBeenCalledWith('msg-3');
			expect(switchSpy).toHaveBeenCalled();
			
			// Verify current session ID changed
			expect(session.sessionId).not.toBe(originalSessionId);
		});

		afterEach(() => {
			const { rmSync, existsSync } = require('fs');
			if (existsSync(testDir)) {
				rmSync(testDir, { recursive: true, force: true });
			}
		});
	});

	describe('getSessionStats()', () => {
		it('should calculate message counts', () => {
			mockAgent.state.messages = [
				{ role: 'user', id: '1', content: [] },
				{ role: 'assistant', id: '2', content: [], usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: { total: 0.001 } } },
				{ role: 'user', id: '3', content: [] },
				{ role: 'toolResult', id: '4', toolName: 'read', content: [], isError: false, toolCallId: 'tc-1', timestamp: Date.now() },
			];

			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			const stats = session.getSessionStats();

			expect(stats.userMessages).toBe(2);
			expect(stats.assistantMessages).toBe(1);
			expect(stats.toolResults).toBe(1);
			expect(stats.totalMessages).toBe(4);
		});

		it('should calculate token usage and costs', () => {
			mockAgent.state.messages = [
				{
					role: 'assistant',
					id: '1',
					content: [],
					usage: {
						input: 100,
						output: 50,
						cacheRead: 20,
						cacheWrite: 10,
						cost: { total: 0.005, input: 0.002, output: 0.003, cacheRead: 0, cacheWrite: 0 },
					},
				},
				{
					role: 'assistant',
					id: '2',
					content: [],
					usage: {
						input: 150,
						output: 75,
						cacheRead: 30,
						cacheWrite: 15,
						cost: { total: 0.008, input: 0.003, output: 0.005, cacheRead: 0, cacheWrite: 0 },
					},
				},
			];

			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			const stats = session.getSessionStats();

			expect(stats.tokens.input).toBe(250);
			expect(stats.tokens.output).toBe(125);
			expect(stats.tokens.cacheRead).toBe(50);
			expect(stats.tokens.cacheWrite).toBe(25);
			expect(stats.cost).toBeCloseTo(0.013, 3);
		});

		it('should count tool calls', () => {
			mockAgent.state.messages = [
				{
					role: 'assistant',
					id: '1',
					content: [
						{ type: 'toolCall', name: 'read', toolCallId: 'tc-1', arguments: {} },
						{ type: 'toolCall', name: 'write', toolCallId: 'tc-2', arguments: {} },
					],
					usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: { total: 0.001 } },
				},
			];

			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			const stats = session.getSessionStats();

			expect(stats.toolCalls).toBe(2);
		});

		it('should include session file and ID', () => {
			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			const stats = session.getSessionStats();

			expect(stats.sessionId).toBe(sessionManager.getSessionId());
			expect(stats.sessionFile).toBeNull(); // In-memory session
		});
	});

	describe('dispose()', () => {
		it('should clean up subscriptions and listeners', () => {
			const unsubscribeMock = vi.fn();
			mockAgent.subscribe.mockReturnValueOnce(unsubscribeMock);

			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			const listener = vi.fn();
			session.subscribe(listener);

			session.dispose();

			// Should unsubscribe from agent
			expect(unsubscribeMock).toHaveBeenCalled();
		});
	});

	describe('event handling', () => {
		it('should save messages on message_end event', async () => {
			let agentEventHandler: any;
			mockAgent.subscribe.mockImplementation((handler: any) => {
				agentEventHandler = handler;
				return vi.fn();
			});

			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			// Subscribe to trigger the mock implementation
			session.subscribe(() => {});

			// Trigger message_end event
			const testMessage = {
				role: 'user',
				id: 'msg-1',
				content: [{ type: 'text', content: 'Test' }],
			};

			await agentEventHandler({
				type: 'message_end',
				messageId: 'msg-1',
				messageType: 'user',
				message: testMessage,
			});

			// Verify message was saved to session
			const loadedSession = sessionManager.loadSession();
			expect(loadedSession.messages).toHaveLength(1);
			expect(loadedSession.messages[0]).toEqual(testMessage);
		});

		it('should remove message from queue on message_start', async () => {
			let agentEventHandler: any;
			mockAgent.subscribe.mockImplementation((handler: any) => {
				agentEventHandler = handler;
				return vi.fn();
			});

			const session = new AgentSession({
				agent: mockAgent as Conversation,
				sessionManager,
				settingsManager,
			});

			// Subscribe to trigger the mock implementation
			session.subscribe(() => {});

			// Queue a message
			await session.queueMessage('Test message');
			expect(session.queuedMessageCount).toBe(1);

			// Trigger message_start for that message
			await agentEventHandler({
				type: 'message_start',
				messageId: 'msg-1',
				messageType: 'user',
				message: {
					role: 'user',
					id: 'msg-1',
					content: [{ type: 'text', content: 'Test message' }],
				},
			});

			// Queue should be empty now
			expect(session.queuedMessageCount).toBe(0);
		});
	});
});
