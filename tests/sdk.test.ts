import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createAgentSession, loadSettings, discoverAvailableModels, findModel } from '../src/core/sdk';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock the providers package
vi.mock('@ank1015/providers', async () => {
	const actual = await vi.importActual('@ank1015/providers');

	const mockModels = {
		openai: {
			"gpt-5-nano": {
				id: "gpt-5-nano",
				name: "GPT-5 Nano",
				api: "openai",
				baseUrl: "https://api.openai.com/v1",
				reasoning: true,
				input: ["text", "image", "file"],
				cost: {
					input: 0.05,
					output: 0.4,
					cacheRead: 0.005,
					cacheWrite: 0,
				},
				contextWindow: 400000,
				maxTokens: 128000,
				tools: ['function_calling'],
			},
		},
		google: {
			"gemini-3-flash-preview": {
				id: "gemini-3-flash-preview",
				name: "Gemini 3 Flash Preview",
				api: "google",
				baseUrl: "https://generativelanguage.googleapis.com/v1beta",
				reasoning: true,
				input: ["text", "image", "file"],
				cost: {
					input: 0.50,
					output: 3,
					cacheRead: 0.05,
					cacheWrite: 0,
				},
				contextWindow: 1048576,
				maxTokens: 65536,
				tools: ['function_calling'],
			}
		},
	};

	return {
		...actual,
		Conversation: vi.fn().mockImplementation((opts: any) => ({
			state: {
				provider: opts.initialState?.provider || {},
				messages: [],
				tools: opts.initialState?.tools || [],
				isStreaming: false,
				pendingToolCalls: new Set(),
				systemPrompt: opts.initialState?.systemPrompt,
			},
			subscribe: vi.fn(() => vi.fn()),
			setProvider: vi.fn(),
			setQueueMode: vi.fn(),
			getQueueMode: vi.fn(() => opts.queueMode || 'one-at-a-time'),
			replaceMessages: vi.fn(),
			reset: vi.fn(),
		})),
		getApiKeyFromEnv: vi.fn((api: string) => {
			if (api === 'openai') return 'test-openai-key';
			if (api === 'google') return 'test-google-key';
			return undefined;
		}),
		getModel: vi.fn((api: string, modelId: string) => {
			return (mockModels as any)[api]?.[modelId];
		}),
		getAvailableModels: vi.fn(() => [
			mockModels.openai['gpt-5-nano'],
			mockModels.google['gemini-3-flash-preview'],
		]),
		generateUUID: () => `test-uuid-${Math.random()}`,
	};
});

describe('SDK', () => {
	let testDir: string;
	let agentDir: string;
	let cwd: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `sdk-test-${Date.now()}-${Math.random()}`);
		agentDir = join(testDir, 'agent');
		cwd = join(testDir, 'project');
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(cwd, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
		vi.clearAllMocks();
	});

	describe('createAgentSession()', () => {
		it('should create a session with default settings', async () => {
			const result = await createAgentSession({
				cwd,
				agentDir,
			});

			expect(result.session).toBeDefined();
			expect(result.session.sessionManager).toBeDefined();
			expect(result.session.settingsManager).toBeDefined();
			expect(result.session.agent).toBeDefined();
		});

		it('should use provided model', async () => {
			const { getModel } = await import('@ank1015/providers');
			const customModel = vi.mocked(getModel)('openai', 'gpt-5-nano');

			if(customModel){
				const result = await createAgentSession({
					cwd,
					agentDir,
					provider: {model: customModel, providerOptions: {temperature: 0.5}}
				});
	
				expect(result.session.model?.id).toBe('gpt-5-nano');
				expect(result.session.providerOptions).toEqual({ temperature: 0.5 });
			}
		});

		it('should discover model from settings', async () => {
			// Create settings file with default model
			const settingsPath = join(agentDir, 'settings.json');
			writeFileSync(
				settingsPath,
				JSON.stringify({
					defaultApi: 'google',
					defaultModel: 'gemini-3-flash-preview',
					defaultProviderOptions: { temperature: 0.3 },
				})
			);

			const result = await createAgentSession({
				cwd,
				agentDir,
			});

			expect(result.session.model?.id).toBe('gemini-3-flash-preview');
			expect(result.session.providerOptions).toEqual({ temperature: 0.3 });
		});

		it('should fall back to first available model', async () => {
			const result = await createAgentSession({
				cwd,
				agentDir,
			});

			// Should use first model from getAvailableModels()
			expect(result.session.model).toBeDefined();
			expect(['gpt-5-nano', 'gemini-3-flash-preview']).toContain(result.session.model?.id);
		});

		it('should throw if no models available', async () => {
			const { getAvailableModels, getApiKeyFromEnv } = await import('@ank1015/providers');

			vi.mocked(getAvailableModels).mockReturnValueOnce([]);
			vi.mocked(getApiKeyFromEnv).mockReturnValue(undefined);

			await expect(
				createAgentSession({ cwd, agentDir })
			).rejects.toThrow('No models available');
		});

		it('should restore model from existing session', async () => {
			const { SessionManager } = await import('../src/core/session-manager');

			// Create a session with a specific model and save messages
			const sessionManager1 = SessionManager.create(cwd, agentDir, {
				api: 'openai',
				modelId: 'gpt-5-nano',
				providerOptions: { temperature: 0.7 },
			});

			sessionManager1.saveMessage({
				role: 'user',
				id: 'msg-1',
				content: [{ type: 'text', content: 'Hello' }],
			});
			sessionManager1.saveMessage({
				role: 'assistant',
				id: 'msg-2',
				content: [],
			} as any);

			// Open the same session file and verify model is restored
			const sessionManager2 = SessionManager.open(sessionManager1.getSessionFile(), agentDir);
			const loadedModel = sessionManager2.loadModel();

			// Verify the session was persisted and loaded correctly
			expect(loadedModel?.modelId).toBe('gpt-5-nano');
			expect(loadedModel?.api).toBe('openai');
			expect(loadedModel?.providerOptions).toEqual({ temperature: 0.7 });

			const result2 = await createAgentSession({
				cwd,
				agentDir,
				sessionManager: sessionManager2,
			});

			expect(result2.session.model?.id).toBe('gpt-5-nano');
		});

		it('should save initial provider to session header', async () => {

			const customModel = vi.mocked(await import('@ank1015/providers')).getModel('openai', 'gpt-5-nano')
			if(customModel){
				const result = await createAgentSession({
					cwd,
					agentDir,
					provider: {model: customModel, providerOptions: { temperature: 0.8 }}
				});
	
				const entries = result.session.sessionManager.loadEntries();
				const header = entries[0] as any;
	
				expect(header.type).toBe('session');
				expect(header.api).toBe('openai');
				expect(header.modelId).toBe('gpt-5-nano');
				expect(header.providerOptions).toEqual({ temperature: 0.8 });
			}
		});

		it('should use custom system prompt', async () => {
			const customPrompt = 'You are a helpful assistant.';

			const result = await createAgentSession({
				cwd,
				agentDir,
				systemPrompt: customPrompt,
			});

			expect(result.session.state.systemPrompt).toBe(customPrompt);
		});

		it('should use system prompt transformer', async () => {
			const transformer = (defaultPrompt: string) => {
				return `${defaultPrompt}\n\nAdditional instructions.`;
			};

			const result = await createAgentSession({
				cwd,
				agentDir,
				systemPrompt: transformer,
			});

			expect(result.session.state.systemPrompt).toContain('Additional instructions');
		});

		it('should use custom tools', async () => {
			const customTools = [
				{
					name: 'custom_tool',
					description: 'A custom tool',
					parameters: {} as any,
					label: 'Custom Tool',
					execute: async () => ({ content: [], details: {} }),
				},
			];

			const result = await createAgentSession({
				cwd,
				agentDir,
				tools: customTools,
			});

			expect(result.session.state.tools).toEqual(customTools);
		});

		it('should restore messages from existing session', async () => {
			const { SessionManager } = await import('../src/core/session-manager');

			// Create session with messages
			const sessionManager1 = SessionManager.create(cwd, agentDir);

			sessionManager1.saveMessage({
				role: 'user',
				id: 'msg-1',
				content: [{ type: 'text', content: 'Hello' }],
			});
			sessionManager1.saveMessage({
				role: 'assistant',
				id: 'msg-2',
				content: [],
			} as any);

			// Open the same session file - messages should be restored
			const sessionManager2 = SessionManager.open(sessionManager1.getSessionFile(), agentDir);
			const result2 = await createAgentSession({
				cwd,
				agentDir,
				sessionManager: sessionManager2,
			});

			// Verify messages were restored from the session
			const loadedSession = sessionManager2.loadSession();
			expect(loadedSession.messages.length).toBeGreaterThan(0);
			expect(loadedSession.messages[0].role).toBe('user');
		});

		it('should use queue mode from settings', async () => {
			const settingsPath = join(agentDir, 'settings.json');
			writeFileSync(
				settingsPath,
				JSON.stringify({ queueMode: 'all' })
			);

			const result = await createAgentSession({
				cwd,
				agentDir,
			});

			expect(result.session.settingsManager.getQueueMode()).toBe('all');
		});

		it('should accept custom session manager', async () => {
			const { SessionManager } = await import('../src/core/session-manager');
			const customSessionManager = SessionManager.inMemory();

			const result = await createAgentSession({
				cwd,
				agentDir,
				sessionManager: customSessionManager,
			});

			expect(result.session.sessionManager).toBe(customSessionManager);
		});

		it('should accept custom settings manager', async () => {
			const { SettingsManager } = await import('../src/core/settings-manager');
			const customSettingsManager = SettingsManager.inMemory({
				queueMode: 'all',
			});

			const result = await createAgentSession({
				cwd,
				agentDir,
				settingsManager: customSettingsManager,
			});

			expect(result.session.settingsManager).toBe(customSettingsManager);
		});
	});

	describe('loadSettings()', () => {
		it('should load settings from agentDir', () => {
			const settingsPath = join(agentDir, 'settings.json');
			writeFileSync(
				settingsPath,
				JSON.stringify({
					defaultApi: 'openai',
					defaultModel: 'gpt-5-nano',
					defaultProviderOptions: { temperature: 0.7 },
					queueMode: 'all',
					shellPath: '/bin/zsh',
					terminal: { showImages: false },
				})
			);

			const settings = loadSettings(agentDir);

			expect(settings.defaultApi).toBe('openai');
			expect(settings.defaultModel).toBe('gpt-5-nano');
			expect(settings.defaultProviderOptions).toEqual({ temperature: 0.7 });
			expect(settings.queueMode).toBe('all');
			expect(settings.shellPath).toBe('/bin/zsh');
			expect(settings.terminal).toEqual({ showImages: false });
		});

		it('should return default values for missing settings', () => {
			const settings = loadSettings(agentDir);

			expect(settings.defaultApi).toBeUndefined();
			expect(settings.defaultModel).toBeUndefined();
			expect(settings.queueMode).toBe('one-at-a-time');
			expect(settings.terminal?.showImages).toBe(true);
		});

		it('should create default settings file if missing', () => {
			const settingsPath = join(agentDir, 'settings.json');
			expect(existsSync(settingsPath)).toBe(false);

			loadSettings(agentDir);

			expect(existsSync(settingsPath)).toBe(true);
		});
	});

	describe('discoverAvailableModels()', () => {
		it('should return models with valid API keys', () => {
			const models = discoverAvailableModels(agentDir);

			expect(models.length).toBeGreaterThan(0);
			expect(models.some(m => m.api === 'openai')).toBe(true);
		});

		it('should work with default agentDir', () => {
			const models = discoverAvailableModels();

			expect(Array.isArray(models)).toBe(true);
		});
	});

	describe('findModel()', () => {
		it('should find model by api and id', () => {
			const model = findModel('openai', 'gpt-5-nano');

			expect(model).toBeDefined();
			expect(model?.id).toBe('gpt-5-nano');
			expect(model?.api).toBe('openai');
		});

		it('should return undefined for unknown model', () => {
			const model = findModel('openai', 'nonexistent-model');

			expect(model).toBeUndefined();
		});

		it('should return undefined for unknown api', () => {
			const model = findModel('unknown-api', 'some-model');

			expect(model).toBeUndefined();
		});
	});

	describe('Integration scenarios', () => {
		it('should handle complete workflow: create → use → resume', async () => {
			const { SessionManager } = await import('../src/core/session-manager');

			// 1. Create initial session with model and provider options
			const sessionManager1 = SessionManager.create(cwd, agentDir, {
				api: 'openai',
				modelId: 'gpt-5-nano',
				providerOptions: { temperature: 0.7 },
			});

			const result1 = await createAgentSession({
				cwd,
				agentDir,
				sessionManager: sessionManager1,
			});

			expect(result1.session.model?.id).toBe('gpt-5-nano');

			// 2. Save some messages
			result1.session.sessionManager.saveMessage({
				role: 'user',
				id: 'msg-1',
				content: [{ type: 'text', content: 'Hello' }],
			});
			result1.session.sessionManager.saveMessage({
				role: 'assistant',
				id: 'msg-2',
				content: [],
			} as any);

			// 3. Resume session (open the same session file)
			const sessionManager2 = SessionManager.open(sessionManager1.getSessionFile(), agentDir);
			const result2 = await createAgentSession({
				cwd,
				agentDir,
				sessionManager: sessionManager2,
			});

			// Should restore model and messages
			expect(result2.session.model?.id).toBe('gpt-5-nano');
			expect(result2.session.sessionManager.loadSession().messages.length).toBeGreaterThan(0);
		});

		it('should handle model changes persisted across sessions', async () => {
			// 1. Create session with initial model
			const result1 = await createAgentSession({
				cwd,
				agentDir,
			});

			const initialModelId = result1.session.model?.id;

			// 2. Change model settings directly (simulating what setModel would do)
			const newModel = vi.mocked(await import('@ank1015/providers')).getModel('google', 'gemini-3-flash-preview');
			result1.session.settingsManager.setDefaultModelAndSettings(newModel!, { temperature: 0.5 });

			// 3. Create new session (should use changed model from settings)
			const result2 = await createAgentSession({
				cwd,
				agentDir,
			});

			expect(result2.session.settingsManager.getDefaultModel()).toBe('gemini-3-flash-preview');
			expect(result2.session.settingsManager.getDefaultProvider()).toBe('google');
		});

		it('should isolate sessions by cwd', async () => {
			const cwd1 = join(testDir, 'project1');
			const cwd2 = join(testDir, 'project2');
			mkdirSync(cwd1, { recursive: true });
			mkdirSync(cwd2, { recursive: true });

			// Create two sessions in different directories
			const result1 = await createAgentSession({ cwd: cwd1, agentDir });
			const result2 = await createAgentSession({ cwd: cwd2, agentDir });

			// Should have different session IDs
			expect(result1.session.sessionId).not.toBe(result2.session.sessionId);

			// Sessions should be isolated
			result1.session.sessionManager.saveMessage({
				role: 'user',
				id: 'msg-1',
				content: [{ type: 'text', content: 'Project 1' }],
			});

			result2.session.sessionManager.saveMessage({
				role: 'user',
				id: 'msg-2',
				content: [{ type: 'text', content: 'Project 2' }],
			});

			const session1Messages = result1.session.sessionManager.loadMessages();
			const session2Messages = result2.session.sessionManager.loadMessages();

			expect(session1Messages[0].content).not.toEqual(session2Messages[0].content);
		});
	});
});
