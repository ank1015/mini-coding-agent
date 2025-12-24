import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getAgentDir } from "../config.js";
import { Api, GoogleThinkingLevel, Model, OptionsForApi } from "@ank1015/providers";

export interface TerminalSettings {
	showImages?: boolean; // default: true (only relevant if terminal supports images)
}

export interface Settings {
	defaultApi?: string;
	defaultModel?: string;
	defaultProviderOptions?: OptionsForApi<Api>;
	queueMode?: "all" | "one-at-a-time";
	shellPath?: string; // Custom shell path (e.g., for Cygwin users on Windows)
	terminal?: TerminalSettings;
}

/** Default settings configuration */
const DEFAULT_SETTINGS: Settings = {
	queueMode: "one-at-a-time",
	defaultApi: 'google',
	defaultModel: 'gemini-3-flash-preview',
	defaultProviderOptions: {
		thinkingConfig: {
			includeThoughts: true,
			thinkingLevel: GoogleThinkingLevel.MEDIUM
		}
	},
	terminal: {
		showImages: true,
	},
};

export class SettingsManager {
	private settingsPath: string | null;
	private settings: Settings;
	private persist: boolean;

	private constructor(settingsPath: string | null, initialSettings: Settings, persist: boolean) {
		this.settingsPath = settingsPath;
		this.settings = initialSettings;
		this.persist = persist;
	}

	/** Create a SettingsManager that loads from files */
	static create(agentDir: string = getAgentDir()): SettingsManager {
		const settingsPath = join(agentDir, "settings.json");
		const settings = SettingsManager.loadFromFile(settingsPath);
		const manager = new SettingsManager(settingsPath, settings, true);

		// If settings file doesn't exist, create it with defaults
		if (!existsSync(settingsPath)) {
			manager.settings = { ...DEFAULT_SETTINGS };
			manager.save();
		}

		return manager;
	}

	/** Create an in-memory SettingsManager (no file I/O) */
	static inMemory(settings: Partial<Settings> = {}): SettingsManager {
		return new SettingsManager(null, settings, false);
	}

	private static loadFromFile(path: string): Settings {
		if (!existsSync(path)) {
			return {};
		}
		try {
			const content = readFileSync(path, "utf-8");
			return JSON.parse(content);
		} catch (error) {
			console.error(`Warning: Could not read settings file ${path}: ${error}`);
			return {};
		}
	}

	private save(): void {
		if (!this.persist || !this.settingsPath) return;

		try {
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
		return this.settings.defaultApi;
	}

	getDefaultModel(): string | undefined {
		return this.settings.defaultModel;
	}

	getDefaultProviderOptions(): OptionsForApi<Api> | undefined {
		return this.settings.defaultProviderOptions;
	}

	setDefaultProviderOptions(providerSettings: OptionsForApi<Api>): void {
		this.settings.defaultProviderOptions = providerSettings;
		this.save();
	}

	setDefaultModelAndSettings(model: Model<Api>, providerSettings: OptionsForApi<Api>): void {
		this.settings.defaultModel = model.id;
		this.settings.defaultApi = model.api;
		this.settings.defaultProviderOptions = providerSettings;
		this.save();
	}

	getQueueMode(): "all" | "one-at-a-time" {
		return this.settings.queueMode || "one-at-a-time";
	}

	setQueueMode(mode: "all" | "one-at-a-time"): void {
		this.settings.queueMode = mode;
		this.save();
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
