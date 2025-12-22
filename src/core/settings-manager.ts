import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getAgentDir } from "../config.js";

export interface CompactionSettings {
	enabled?: boolean; // default: true
	reserveTokens?: number; // default: 16384
	keepRecentTokens?: number; // default: 20000
}

export interface RetrySettings {
	enabled?: boolean; // default: true
	maxRetries?: number; // default: 3
	baseDelayMs?: number; // default: 2000 (exponential backoff: 2s, 4s, 8s)
}

export interface SkillsSettings {
	enabled?: boolean; // default: true
}

export interface TerminalSettings {
	showImages?: boolean; // default: true (only relevant if terminal supports images)
}

export interface Settings {
	lastChangelogVersion?: string;
	defaultProvider?: string;
	defaultModel?: string;
	defaultThinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
	queueMode?: "all" | "one-at-a-time";
	theme?: string;
	compaction?: CompactionSettings;
	retry?: RetrySettings;
	hideThinkingBlock?: boolean;
	shellPath?: string; // Custom shell path (e.g., for Cygwin users on Windows)
	collapseChangelog?: boolean; // Show condensed changelog after update (use /changelog for full)
	hooks?: string[]; // Array of hook file paths
	hookTimeout?: number; // Timeout for hook execution in ms (default: 30000)
	customTools?: string[]; // Array of custom tool file paths
	skills?: SkillsSettings;
	terminal?: TerminalSettings;
}

export class SettingsManager {
	private settingsPath: string;
	private settings: Settings;

	constructor(baseDir?: string) {
		const dir = baseDir || getAgentDir();
		this.settingsPath = join(dir, "settings.json");
		this.settings = this.load();
	}

	private load(): Settings {
		if (!existsSync(this.settingsPath)) {
			return {};
		}

		try {
			const content = readFileSync(this.settingsPath, "utf-8");
			return JSON.parse(content);
		} catch (error) {
			console.error(`Warning: Could not read settings file: ${error}`);
			return {};
		}
	}

	private save(): void {
		try {
			// Ensure directory exists
			const dir = dirname(this.settingsPath);
			if (!existsSync(dir)) {
				mkdirSync(dir, { recursive: true });
			}

			writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2), "utf-8");
		} catch (error) {
			console.error(`Warning: Could not save settings file: ${error}`);
		}
	}

	getDefaultProvider(): string | undefined {
		return this.settings.defaultProvider;
	}

	getDefaultModel(): string | undefined {
		return this.settings.defaultModel;
	}

	setDefaultProvider(provider: string): void {
		this.settings.defaultProvider = provider;
		this.save();
	}

	setDefaultModel(modelId: string): void {
		this.settings.defaultModel = modelId;
		this.save();
	}

	setDefaultModelAndProvider(provider: string, modelId: string): void {
		this.settings.defaultProvider = provider;
		this.settings.defaultModel = modelId;
		this.save();
	}

	getQueueMode(): "all" | "one-at-a-time" {
		return this.settings.queueMode || "one-at-a-time";
	}

	setQueueMode(mode: "all" | "one-at-a-time"): void {
		this.settings.queueMode = mode;
		this.save();
	}

	getRetryEnabled(): boolean {
		return this.settings.retry?.enabled ?? true;
	}

	setRetryEnabled(enabled: boolean): void {
		if (!this.settings.retry) {
			this.settings.retry = {};
		}
		this.settings.retry.enabled = enabled;
		this.save();
	}

	getRetrySettings(): { enabled: boolean; maxRetries: number; baseDelayMs: number } {
		return {
			enabled: this.getRetryEnabled(),
			maxRetries: this.settings.retry?.maxRetries ?? 3,
			baseDelayMs: this.settings.retry?.baseDelayMs ?? 2000,
		};
	}

	getShellPath(): string | undefined {
		return this.settings.shellPath;
	}

	setShellPath(path: string | undefined): void {
		this.settings.shellPath = path;
		this.save();
	}

	getShowImages(): boolean {
		return this.settings.terminal?.showImages ?? true;
	}

	setShowImages(show: boolean): void {
		if (!this.settings.terminal) {
			this.settings.terminal = {};
		}
		this.settings.terminal.showImages = show;
		this.save();
	}
}
