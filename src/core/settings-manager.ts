import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { CONFIG_DIR_NAME, getAgentDir } from "../config.js";
import { Api, Model, OptionsForApi } from "@ank1015/providers";

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

/** Deep merge settings: project/overrides take precedence, nested objects merge recursively */
function deepMergeSettings(base: Settings, overrides: Settings): Settings {
	const result: Settings = { ...base };

	for (const key of Object.keys(overrides) as (keyof Settings)[]) {
		const overrideValue = overrides[key];
		const baseValue = base[key];

		if (overrideValue === undefined) {
			continue;
		}

		// For nested objects, merge recursively
		if (
			typeof overrideValue === "object" &&
			overrideValue !== null &&
			!Array.isArray(overrideValue) &&
			typeof baseValue === "object" &&
			baseValue !== null &&
			!Array.isArray(baseValue)
		) {
			(result as Record<string, unknown>)[key] = { ...baseValue, ...overrideValue };
		} else {
			// For primitives and arrays, override value wins
			(result as Record<string, unknown>)[key] = overrideValue;
		}
	}

	return result;
}

export class SettingsManager {
	private settingsPath: string | null;
	private projectSettingsPath: string | null;
	private globalSettings: Settings;
	private settings: Settings;
	private persist: boolean;

	private constructor(
		settingsPath: string | null,
		projectSettingsPath: string | null,
		initialSettings: Settings,
		persist: boolean,
	) {
		this.settingsPath = settingsPath;
		this.projectSettingsPath = projectSettingsPath;
		this.persist = persist;
		this.globalSettings = initialSettings;
		const projectSettings = this.loadProjectSettings();
		this.settings = deepMergeSettings(this.globalSettings, projectSettings);
	}

	/** Create a SettingsManager that loads from files */
	static create(cwd: string = process.cwd(), agentDir: string = getAgentDir()): SettingsManager {
		const settingsPath = join(agentDir, "settings.json");
		const projectSettingsPath = join(cwd, CONFIG_DIR_NAME, "settings.json");
		const globalSettings = SettingsManager.loadFromFile(settingsPath);
		return new SettingsManager(settingsPath, projectSettingsPath, globalSettings, true);
	}

	/** Create an in-memory SettingsManager (no file I/O) */
	static inMemory(settings: Partial<Settings> = {}): SettingsManager {
		return new SettingsManager(null, null, settings, false);
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

	private loadProjectSettings(): Settings {
		if (!this.projectSettingsPath || !existsSync(this.projectSettingsPath)) {
			return {};
		}

		try {
			const content = readFileSync(this.projectSettingsPath, "utf-8");
			return JSON.parse(content);
		} catch (error) {
			console.error(`Warning: Could not read project settings file: ${error}`);
			return {};
		}
	}

	/** Apply additional overrides on top of current settings */
	applyOverrides(overrides: Partial<Settings>): void {
		this.settings = deepMergeSettings(this.settings, overrides);
	}

	private save(): void {
		if (!this.persist || !this.settingsPath) return;

		try {
			const dir = dirname(this.settingsPath);
			if (!existsSync(dir)) {
				mkdirSync(dir, { recursive: true });
			}

			// Save only global settings (project settings are read-only)
			writeFileSync(this.settingsPath, JSON.stringify(this.globalSettings, null, 2), "utf-8");

			// Re-merge project settings into active settings
			const projectSettings = this.loadProjectSettings();
			this.settings = deepMergeSettings(this.globalSettings, projectSettings);
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
		this.globalSettings.defaultProviderOptions = providerSettings;
		this.save();
	}

	setDefaultModelAndSettings(model: Model<Api>, providerSettings: OptionsForApi<Api>): void {
		this.globalSettings.defaultModel = model.id;
		this.globalSettings.defaultApi = model.api;
		this.globalSettings.defaultProviderOptions = providerSettings;
		this.save();
	}

	getQueueMode(): "all" | "one-at-a-time" {
		return this.settings.queueMode || "one-at-a-time";
	}

	setQueueMode(mode: "all" | "one-at-a-time"): void {
		this.globalSettings.queueMode = mode;
		this.save();
	}

	getShellPath(): string | undefined {
		return this.settings.shellPath;
	}

	setShellPath(path: string | undefined): void {
		this.globalSettings.shellPath = path;
		this.save();
	}

	getShowImages(): boolean {
		return this.settings.terminal?.showImages ?? true;
	}

	setShowImages(show: boolean): void {
		if (!this.globalSettings.terminal) {
			this.globalSettings.terminal = {};
		}
		this.globalSettings.terminal.showImages = show;
		this.save();
	}
}
