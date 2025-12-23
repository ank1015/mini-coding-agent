/**
 * SDK for programmatic usage of AgentSession.
 *
 * Provides a factory function and discovery helpers that allow full control
 * over agent configuration, or sensible defaults that match CLI behavior.
 *
 * @example
 * ```typescript
 * // Minimal - everything auto-discovered
 * const session = await createAgentSession();
 *
 * // Full control
 * const session = await createAgentSession({
 *   model: myModel,
 *   getApiKey: async () => process.env.MY_KEY,
 *   tools: [readTool, bashTool],
 *   sessionFile: false,
 * });
 * ```
 */

import { Api, Conversation, getApiKeyFromEnv, getAvailableModels, getModel, Model, OptionsForApi } from "@ank1015/providers";
import { SessionManager } from "./session-manager";
import { Settings, SettingsManager } from "./settings-manager";
import { AgentSession } from "./agent-session";
import {
	buildSystemPrompt as buildSystemPromptInternal,
} from "./system-prompt.js";
import {
	allTools,
	bashTool,
	codingTools,
	createBashTool,
	createCodingTools,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadOnlyTools,
	createReadTool,
	createWriteTool,
	editTool,
	findTool,
	grepTool,
	lsTool,
	readOnlyTools,
	readTool,
	type Tool,
	writeTool,
} from "./tools/index.js";
import { getAgentDir } from "../config";

export interface CreateAgentSessionOptions {
	/** Working directory for project-local discovery. Default: process.cwd() */
	cwd?: string;
	/** Global config directory. Default: ~/.pi/agent */
	agentDir?: string;

	/** Model to use. Default: from settings, else first available */
	model?: Model<Api>;

	/** Provider Options to use. Default: from settings, else {} */
	providerOptions?: OptionsForApi<Api>;

	/** API key resolver. Default: defaultGetApiKey() */
	getApiKey?: (model: Model<any>) => Promise<string | undefined>;

	/** System prompt. String replaces default, function receives default and returns final. */
	systemPrompt?: string | ((defaultPrompt: string) => string);

	/** Built-in tools to use. Default: allTools [read, bash, edit, write] */
	tools?: Tool[];

	/** Session manager. Default: SessionManager.create(cwd) */
	sessionManager?: SessionManager;

	/** Settings manager. Default: SettingsManager.create(cwd, agentDir) */
	settingsManager?: SettingsManager;
}


/** Result from createAgentSession */
export interface CreateAgentSessionResult {
	/** The created session */
	session: AgentSession;
}

// Re-exports

export type { Settings} from "./settings-manager.js";
export type { Tool } from "./tools/index.js";

export {
	// Pre-built tools (use process.cwd())
	readTool,
	bashTool,
	editTool,
	writeTool,
	grepTool,
	findTool,
	lsTool,
	codingTools,
	readOnlyTools,
	allTools as allBuiltInTools,
	// Tool factories (for custom cwd)
	createCodingTools,
	createReadOnlyTools,
	createReadTool,
	createBashTool,
	createEditTool,
	createWriteTool,
	createGrepTool,
	createFindTool,
	createLsTool,
};

// Helper Functions

function getDefaultAgentDir(): string {
	return getAgentDir();
}

/**
 * Get models that have valid API keys available.
 */
export function discoverAvailableModels(agentDir: string = getDefaultAgentDir()): Model<Api>[] {
    return getAvailableModels()
}

/**
 * Find a model by provider and ID.
 * @returns The model, or null if not found
 */
export function findModel(
	api: string,
	modelId: string,
): Model<any> | undefined {
	const model = getModel(api as Api, modelId as any);
	return model;
}

// API Key Helpers

/**
 * Create the default API key resolver.
 * Checks custom providers (models.json), OAuth, and environment variables.
 */
export function defaultGetApiKey(): (api: Api) => string | undefined {
	return getApiKeyFromEnv;
}

// System Prompt

export interface BuildSystemPromptOptions {
	tools?: Tool[];
	cwd?: string;
	appendPrompt?: string;
}

/**
 * Build the default system prompt.
 */
export function buildSystemPrompt(options: BuildSystemPromptOptions = {}): string {
	return buildSystemPromptInternal({
		cwd: options.cwd,
		appendSystemPrompt: options.appendPrompt,
	});
}

// Settings

/**
 * Load settings from agentDir/settings.json.
 */
export function loadSettings(agentDir?: string): Settings {
	const manager = SettingsManager.create(agentDir ?? getDefaultAgentDir());
	return {
		defaultApi: manager.getDefaultProvider(),
		defaultModel: manager.getDefaultModel(),
        defaultProviderOptions: manager.getDefaultProviderOptions(),
		queueMode: manager.getQueueMode(),
		shellPath: manager.getShellPath(),
		terminal: { showImages: manager.getShowImages() },
	};
}


// Factory

/**
 * Create an AgentSession with the specified options.
 */
export async function createAgentSession(options: CreateAgentSessionOptions = {}): Promise<CreateAgentSessionResult> {

	const cwd = options.cwd ?? process.cwd();
	const agentDir = options.agentDir ?? getDefaultAgentDir();

	const settingsManager = options.settingsManager ?? SettingsManager.create(agentDir);

	// Discover model before creating session manager
    let model = options.model;
    let providerOptions = options.providerOptions;

	// Try settings default first
	if (!model) {
		const defaultProvider = settingsManager.getDefaultProvider();
		const defaultModelId = settingsManager.getDefaultModel();
        const defaultProviderOptions = settingsManager.getDefaultProviderOptions();

        if(defaultProviderOptions && defaultModelId && defaultProvider){
            const settingsModel = findModel(defaultProvider, defaultModelId);
            if(settingsModel){
                const key = getApiKeyFromEnv(settingsModel.api);
                if(key){
                    model = settingsModel;
                    providerOptions = defaultProviderOptions;
                }
            }
        }
    }

	// Fall back to first available
    if(!model){
        const available = getAvailableModels();
		if (available.length === 0) {
			throw new Error(
				"No models available. Set an API key environment variable " +
					"(ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.) or provide a model explicitly.",
			);
		}
        model = available[0];
        providerOptions = {};
    }

	// Create session manager with initial provider
	const sessionManager = options.sessionManager ?? SessionManager.create(
		cwd,
		agentDir,
		model && providerOptions ? {
			api: model.api,
			modelId: model.id,
			providerOptions: providerOptions
		} : undefined
	);

	// Check if session has existing data to restore
	const existingSession = sessionManager.loadSession();
	const hasExistingSession = existingSession.messages.length > 0;

	// If session has data, restore model from it (overrides discovered model)
	if (hasExistingSession && existingSession.model) {
        const restoredModel = findModel(existingSession.model.api, existingSession.model.modelId);
		if (restoredModel) {
			const key = getApiKeyFromEnv(restoredModel.api);
			if (key) {
				model = restoredModel
                providerOptions = existingSession.model.providerOptions;
			}
		}
	}

	const builtInTools = options.tools ?? createCodingTools(cwd);

	let systemPrompt: string;
	const defaultPrompt = buildSystemPromptInternal({
		cwd,
		agentDir
	});

	if (options.systemPrompt === undefined) {
		systemPrompt = defaultPrompt;
	} else if (typeof options.systemPrompt === "string") {
		systemPrompt = options.systemPrompt;
	} else {
		systemPrompt = options.systemPrompt(defaultPrompt);
	}

	const agent = new Conversation({
		initialState: {
			systemPrompt,
			provider: {
                model,
                providerOptions: providerOptions as any
            },
            tools: builtInTools
		},
		queueMode: settingsManager.getQueueMode(),
	});

	// Restore messages if session has existing data
	if (hasExistingSession) {
		agent.replaceMessages(existingSession.messages);
	}

	const session = new AgentSession({
		agent,
		sessionManager,
		settingsManager,
	});

    return {
		session
	};
}
