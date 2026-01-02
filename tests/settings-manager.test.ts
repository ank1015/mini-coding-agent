import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SettingsManager } from '../src/core/settings-manager';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('SettingsManager', () => {
	let testDir: string;
	let settingsPath: string;

	beforeEach(() => {
		// Create a temporary directory for each test
		testDir = join(tmpdir(), `settings-test-${Date.now()}-${Math.random()}`);
		settingsPath = join(testDir, 'settings.json');
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		// Clean up test directory
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
	});

	describe('create()', () => {
		it('should create default settings file if it does not exist', () => {
			const manager = SettingsManager.create(testDir);

			expect(existsSync(settingsPath)).toBe(true);
			const content = JSON.parse(readFileSync(settingsPath, 'utf-8'));
			expect(content).toEqual({
				defaultApi: 'google',
				defaultModel: 'gemini-3-flash-preview',
				defaultProviderOptions: {
					thinkingConfig: {
						includeThoughts: true,
						thinkingLevel: "MEDIUM"
					}
				},
				queueMode: 'one-at-a-time',
				terminal: {
					showImages: true,
				},
			});
		});

		it('should load existing settings file', () => {
			// Create a settings file
			const existingSettings = {
				defaultApi: 'openai',
				defaultModel: 'gpt-4',
				queueMode: 'all' as const,
			};
			writeFileSync(settingsPath, JSON.stringify(existingSettings, null, 2));

			const manager = SettingsManager.create(testDir);

			expect(manager.getDefaultProvider()).toBe('openai');
			expect(manager.getDefaultModel()).toBe('gpt-4');
			expect(manager.getQueueMode()).toBe('all');
		});

		it('should handle corrupted settings file gracefully', () => {
			// Write invalid JSON
			writeFileSync(settingsPath, 'invalid json{{{');

			const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const manager = SettingsManager.create(testDir);

			// Should fall back to defaults
			expect(manager.getQueueMode()).toBe('one-at-a-time');
			expect(consoleErrorSpy).toHaveBeenCalled();
			consoleErrorSpy.mockRestore();
		});

		it('should create directory if it does not exist', () => {
			const nestedDir = join(testDir, 'nested', 'path');
			const manager = SettingsManager.create(nestedDir);

			expect(existsSync(nestedDir)).toBe(true);
			expect(existsSync(join(nestedDir, 'settings.json'))).toBe(true);
		});
	});

	describe('inMemory()', () => {
		it('should create in-memory settings without file I/O', () => {
			const manager = SettingsManager.inMemory({
				defaultApi: 'openai',
				defaultModel: 'gpt-4',
			});

			expect(manager.getDefaultProvider()).toBe('openai');
			expect(manager.getDefaultModel()).toBe('gpt-4');

			// Should not create any files
			expect(existsSync(settingsPath)).toBe(false);
		});

		it('should allow empty initialization', () => {
			const manager = SettingsManager.inMemory();

			expect(manager.getDefaultProvider()).toBeUndefined();
			expect(manager.getDefaultModel()).toBeUndefined();
			expect(manager.getQueueMode()).toBe('one-at-a-time');
		});

		it('should not persist changes to disk', () => {
			const manager = SettingsManager.inMemory({
				defaultApi: 'openai',
			});

			manager.setQueueMode('all');
			manager.setShellPath('/bin/zsh');

			expect(existsSync(settingsPath)).toBe(false);
		});
	});

	describe('getDefaultProvider()', () => {
		it('should return undefined when not set', () => {
			const manager = SettingsManager.inMemory();
			expect(manager.getDefaultProvider()).toBeUndefined();
		});

		it('should return the default provider', () => {
			const manager = SettingsManager.inMemory({ defaultApi: 'google' });
			expect(manager.getDefaultProvider()).toBe('google');
		});
	});

	describe('getDefaultModel()', () => {
		it('should return undefined when not set', () => {
			const manager = SettingsManager.inMemory();
			expect(manager.getDefaultModel()).toBeUndefined();
		});

		it('should return the default model', () => {
			const manager = SettingsManager.inMemory({ defaultModel: 'gemini-3-flash' });
			expect(manager.getDefaultModel()).toBe('gemini-3-flash');
		});
	});

	describe('getDefaultProviderOptions()', () => {
		it('should return undefined when not set', () => {
			const manager = SettingsManager.inMemory();
			expect(manager.getDefaultProviderOptions()).toBeUndefined();
		});

		it('should return provider options', () => {
			const options = { temperature: 0.7, maxTokens: 4096 };
			const manager = SettingsManager.inMemory({ defaultProviderOptions: options });
			expect(manager.getDefaultProviderOptions()).toEqual(options);
		});
	});

	describe('setDefaultProviderOptions()', () => {
		it('should update provider options', () => {
			const manager = SettingsManager.inMemory();
			const options = { temperature: 0.5 };

			manager.setDefaultProviderOptions(options);

			expect(manager.getDefaultProviderOptions()).toEqual(options);
		});

		it('should persist to file', () => {
			const manager = SettingsManager.create(testDir);
			const options = { temperature: 0.8, maxTokens: 2048 };

			manager.setDefaultProviderOptions(options);

			const content = JSON.parse(readFileSync(settingsPath, 'utf-8'));
			expect(content.defaultProviderOptions).toEqual(options);
		});
	});

	describe('setDefaultModelAndSettings()', () => {
		it('should update model, api, and provider options', () => {
			const manager = SettingsManager.inMemory();
			const model = { id: 'gpt-4', api: 'openai' as const, name: 'GPT-4' } as any;
			const options = { temperature: 0.7 };

			manager.setDefaultModelAndSettings(model, options);

			expect(manager.getDefaultModel()).toBe('gpt-4');
			expect(manager.getDefaultProvider()).toBe('openai');
			expect(manager.getDefaultProviderOptions()).toEqual(options);
		});

		it('should persist all changes to file', () => {
			const manager = SettingsManager.create(testDir);
			const model = { id: 'gemini-3-flash', api: 'google' as const, name: 'Gemini' } as any;
			const options = { temperature: 0.2 };

			manager.setDefaultModelAndSettings(model, options);

			const content = JSON.parse(readFileSync(settingsPath, 'utf-8'));
			expect(content.defaultModel).toBe('gemini-3-flash');
			expect(content.defaultApi).toBe('google');
			expect(content.defaultProviderOptions).toEqual(options);
		});
	});

	describe('getQueueMode()', () => {
		it('should return default queue mode', () => {
			const manager = SettingsManager.inMemory();
			expect(manager.getQueueMode()).toBe('one-at-a-time');
		});

		it('should return configured queue mode', () => {
			const manager = SettingsManager.inMemory({ queueMode: 'all' });
			expect(manager.getQueueMode()).toBe('all');
		});
	});

	describe('setQueueMode()', () => {
		it('should update queue mode', () => {
			const manager = SettingsManager.inMemory({ queueMode: 'one-at-a-time' });

			manager.setQueueMode('all');

			expect(manager.getQueueMode()).toBe('all');
		});

		it('should persist to file', () => {
			const manager = SettingsManager.create(testDir);

			manager.setQueueMode('all');

			const content = JSON.parse(readFileSync(settingsPath, 'utf-8'));
			expect(content.queueMode).toBe('all');
		});
	});

	describe('getShellPath()', () => {
		it('should return undefined when not set', () => {
			const manager = SettingsManager.inMemory();
			expect(manager.getShellPath()).toBeUndefined();
		});

		it('should return configured shell path', () => {
			const manager = SettingsManager.inMemory({ shellPath: '/bin/zsh' });
			expect(manager.getShellPath()).toBe('/bin/zsh');
		});
	});

	describe('setShellPath()', () => {
		it('should update shell path', () => {
			const manager = SettingsManager.inMemory();

			manager.setShellPath('/bin/bash');

			expect(manager.getShellPath()).toBe('/bin/bash');
		});

		it('should allow setting to undefined', () => {
			const manager = SettingsManager.inMemory({ shellPath: '/bin/zsh' });

			manager.setShellPath(undefined);

			expect(manager.getShellPath()).toBeUndefined();
		});

		it('should persist to file', () => {
			const manager = SettingsManager.create(testDir);

			manager.setShellPath('/usr/local/bin/fish');

			const content = JSON.parse(readFileSync(settingsPath, 'utf-8'));
			expect(content.shellPath).toBe('/usr/local/bin/fish');
		});
	});

	describe('getShowImages()', () => {
		it('should return true by default', () => {
			const manager = SettingsManager.inMemory();
			expect(manager.getShowImages()).toBe(true);
		});

		it('should return configured value', () => {
			const manager = SettingsManager.inMemory({
				terminal: { showImages: false },
			});
			expect(manager.getShowImages()).toBe(false);
		});
	});

	describe('setShowImages()', () => {
		it('should update showImages setting', () => {
			const manager = SettingsManager.inMemory();

			manager.setShowImages(false);

			expect(manager.getShowImages()).toBe(false);
		});

		it('should create terminal object if it does not exist', () => {
			const manager = SettingsManager.create(testDir);

			manager.setShowImages(false);

			const content = JSON.parse(readFileSync(settingsPath, 'utf-8'));
			expect(content.terminal).toEqual({ showImages: false });
		});

		it('should preserve other terminal settings', () => {
			const manager = SettingsManager.create(testDir);
			// Manually add another terminal setting
			writeFileSync(
				settingsPath,
				JSON.stringify({ terminal: { showImages: true, otherSetting: 'value' } })
			);

			const manager2 = SettingsManager.create(testDir);
			manager2.setShowImages(false);

			const content = JSON.parse(readFileSync(settingsPath, 'utf-8'));
			expect(content.terminal.showImages).toBe(false);
		});

		it('should persist to file', () => {
			const manager = SettingsManager.create(testDir);

			manager.setShowImages(false);

			const content = JSON.parse(readFileSync(settingsPath, 'utf-8'));
			expect(content.terminal.showImages).toBe(false);
		});
	});

	describe('Integration tests', () => {
		it('should handle multiple updates correctly', () => {
			const manager = SettingsManager.create(testDir);
			const model = { id: 'gpt-4', api: 'openai' as const, name: 'GPT-4' } as any;
			const options = { temperature: 0.7 };

			manager.setDefaultModelAndSettings(model, options);
			manager.setQueueMode('all');
			manager.setShellPath('/bin/zsh');
			manager.setShowImages(false);

			// Verify all settings are persisted
			const content = JSON.parse(readFileSync(settingsPath, 'utf-8'));
			expect(content).toEqual({
				defaultModel: 'gpt-4',
				defaultApi: 'openai',
				defaultProviderOptions: { temperature: 0.7 },
				queueMode: 'all',
				shellPath: '/bin/zsh',
				terminal: { showImages: false },
			});

			// Verify all getters work
			expect(manager.getDefaultModel()).toBe('gpt-4');
			expect(manager.getDefaultProvider()).toBe('openai');
			expect(manager.getDefaultProviderOptions()).toEqual(options);
			expect(manager.getQueueMode()).toBe('all');
			expect(manager.getShellPath()).toBe('/bin/zsh');
			expect(manager.getShowImages()).toBe(false);
		});

		it('should reload settings from file correctly', () => {
			const manager1 = SettingsManager.create(testDir);
			const model = { id: 'gpt-4', api: 'openai' as const, name: 'GPT-4' } as any;
			manager1.setDefaultModelAndSettings(model, { temperature: 0.5 });

			// Create a new manager that reads the same file
			const manager2 = SettingsManager.create(testDir);

			expect(manager2.getDefaultModel()).toBe('gpt-4');
			expect(manager2.getDefaultProvider()).toBe('openai');
			expect(manager2.getDefaultProviderOptions()).toEqual({ temperature: 0.5 });
		});
	});
});
