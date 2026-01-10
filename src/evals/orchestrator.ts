import { Provider, Api, Model, OptionsForApi } from "@ank1015/providers";
import { EnvironmentManager } from "./setup/environment-manager.js";
import { RegistryManager } from "./setup/registry-manager.js";
import { TaskExecutor } from "./execution/task-executor.js";
import { VerificationResult } from "./types.js";
import { performAnalysis, type QuantitativeResult, type LLMJudgeResult } from "./evaluation/index.js";

/** Configuration for post-evaluation analysis */
export interface AnalysisOptions {
    /** Run quantitative analysis */
    quantitative?: boolean;
    /** Run LLM-as-judge analysis */
    llmJudge?: boolean;
    /** LLM configuration for judge analysis (required if llmJudge is true) */
    llmConfig?: {
        model: Model<Api>;
        providerOptions: OptionsForApi<Api>;
    };
}

export interface EvalConfig {
	registryIndex: number;
	taskIndex: number;
	resultsDir?: string;
	provider?: Provider<Api>;
    envVars?: Record<string, string>;
    /** Optional system prompt builder function. Receives the workdir and returns the prompt string. */
    systemPrompt?: (cwd: string) => string;
    /** Optional prompt to append to task instructions (e.g., guidelines or hints). */
    injectedPrompt?: string;
    /** Post-evaluation analysis options */
    analysis?: AnalysisOptions;
}

export interface BulkEvalConfig {
    registryIndex: number;
    taskIndices?: number[]; // specific tasks to run. If undefined/empty, runs ALL tasks.
    resultsDir?: string;
    provider?: Provider<Api>;
    envVars?: Record<string, string>;
    /** Optional system prompt builder function. Receives the workdir and returns the prompt string (applied to all tasks). */
    systemPrompt?: (cwd: string) => string;
    /** Optional prompt to append to task instructions (e.g., guidelines or hints). Applied to all tasks. */
    injectedPrompt?: string;
    /** Post-evaluation analysis options (applied to all tasks) */
    analysis?: AnalysisOptions;
}

export interface EvalResult {
    taskName: string;
    passed: boolean;
    score: number;
    resultDir: string;
    durationMs: number;
    error?: string;
    /** Quantitative analysis result (if requested) */
    quantitativeAnalysis?: QuantitativeResult;
    /** LLM judge analysis result (if requested) */
    llmJudgeAnalysis?: LLMJudgeResult;
}

export interface BulkEvalResult {
    suiteName: string;
    totalTasks: number;
    passedTasks: number;
    failedTasks: number;
    results: EvalResult[];
}

export class Evals {
    private registryManager: RegistryManager;
    private envManager: EnvironmentManager;

    constructor() {
        this.registryManager = new RegistryManager();
        this.envManager = new EnvironmentManager(process.cwd());
    }

    async runBulkEvaluation(config: BulkEvalConfig): Promise<BulkEvalResult> {
        console.log(`=== Starting Bulk Evaluation (Registry: ${config.registryIndex}) ===`);
        
        const registry = await this.registryManager.fetchRegistry();
        if (config.registryIndex < 0 || config.registryIndex >= registry.length) {
            throw new Error(`Registry index ${config.registryIndex} out of bounds (found ${registry.length})`);
        }
        const suite = registry[config.registryIndex];
        const results: EvalResult[] = [];

        // Determine tasks to run
        let indices = config.taskIndices;
        if (!indices || indices.length === 0) {
            // Run all
            if (!suite.tasks) indices = [];
            else indices = suite.tasks.map((_, i) => i);
        }

        console.log(`Selected suite: ${suite.name}. Running ${indices.length} tasks.`);

        let passed = 0;
        let failed = 0;

        for (const idx of indices) {
            try {
                const result = await this.runEvaluation({
                    registryIndex: config.registryIndex,
                    taskIndex: idx,
                    resultsDir: config.resultsDir,
                    provider: config.provider,
                    envVars: config.envVars,
                    systemPrompt: config.systemPrompt,
                    injectedPrompt: config.injectedPrompt,
                    analysis: config.analysis
                });
                results.push(result);
                if (result.passed) passed++; else failed++;
            } catch (error: any) {
                console.error(`Task index ${idx} failed to run:`, error);
                results.push({
                    taskName: suite.tasks?.[idx]?.name || `Unknown-${idx}`,
                    passed: false,
                    score: 0,
                    resultDir: "",
                    durationMs: 0,
                    error: error.message
                });
                failed++;
            }
        }

        console.log(`=== Bulk Evaluation Complete ===`);
        console.log(`Total: ${indices.length}, Passed: ${passed}, Failed: ${failed}`);

        return {
            suiteName: suite.name,
            totalTasks: indices.length,
            passedTasks: passed,
            failedTasks: failed,
            results
        };
    }

    async runEvaluation(config: EvalConfig): Promise<EvalResult> {
        const startTime = Date.now();
        const resultsDir = config.resultsDir || "eval-results";
        const executor = new TaskExecutor(resultsDir);

        console.log(`=== Starting Evaluation (Registry: ${config.registryIndex}, Task: ${config.taskIndex}) ===`);

        // 1. Fetch Task
        const registry = await this.registryManager.fetchRegistry();
        if (config.registryIndex < 0 || config.registryIndex >= registry.length) {
            throw new Error(`Registry index ${config.registryIndex} out of bounds (found ${registry.length})`);
        }
        const suite = registry[config.registryIndex];
        
        if (!suite.tasks || config.taskIndex < 0 || config.taskIndex >= suite.tasks.length) {
             throw new Error(`Task index ${config.taskIndex} out of bounds (suite '${suite.name}' has ${suite.tasks?.length || 0})`);
        }
        const taskEntry = suite.tasks[config.taskIndex];
        console.log(`Selected Task: ${taskEntry.name} (${suite.name})`);

        // 2. Prepare & Build
        const { taskPath, config: taskConfig } = await this.registryManager.prepareTask(taskEntry);
        const { imageId, workdir } = await this.envManager.setupEnvironment(taskPath, taskConfig);
        console.log(`Environment Ready: ${imageId} (workdir: ${workdir})`);

        // 3. Prepare Env Vars (Merge passed vars with process env keys if needed)
        const envVars = { ...config.envVars };

        // Pass the task workdir to the agent runner
        envVars.TASK_WORKDIR = workdir;

        // Ensure API keys are present if not explicitly passed
        if (!envVars.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY) envVars.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
        if (!envVars.OPENAI_API_KEY && process.env.OPENAI_API_KEY) envVars.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
        if (!envVars.GEMINI_API_KEY && process.env.GEMINI_API_KEY) envVars.GEMINI_API_KEY = process.env.GEMINI_API_KEY;
        if (!envVars.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY) envVars.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

        // Pass Provider config via special Env Vars if customized
        if (config.provider) {
             envVars.AGENT_PROVIDER_CONFIG = JSON.stringify({
                 api: config.provider.model.api,
                 modelId: config.provider.model.id,
                 providerOptions: config.provider.providerOptions
             });
        }

        // Pass system prompt via env var if provided (call the builder function with workdir)
        if (config.systemPrompt) {
            envVars.AGENT_SYSTEM_PROMPT = config.systemPrompt(workdir);
        }

        // Pass injected prompt via env var if provided (appended to task instructions)
        if (config.injectedPrompt) {
            envVars.AGENT_INJECTED_PROMPT = config.injectedPrompt;
        }

        // 4. Execution
        const { containerId, resultDir } = await executor.startContainer(imageId, taskPath, taskEntry.name, envVars);
        
        let verification: VerificationResult = { passed: false, score: 0, rewardFileContent: null };

        try {
            await executor.runAgent(containerId);
            await executor.archiveSolution(taskPath, resultDir);
            verification = await executor.verify(containerId, resultDir, taskPath);
        } catch (error: any) {
            console.error("Evaluation failed during execution:", error);
            // We rethrow so bulk runner knows it failed hard (or return error result)
            throw error;
        } finally {
            await executor.stopContainer(containerId);
        }

        const durationMs = Date.now() - startTime;
        console.log(`=== Finished: ${verification.passed ? "PASSED" : "FAILED"} (Score: ${verification.score}) in ${durationMs}ms ===`);

        // Build the result
        const result: EvalResult = {
            taskName: taskEntry.name,
            passed: verification.passed,
            score: verification.score,
            resultDir,
            durationMs
        };

        // 5. Run post-evaluation analysis if requested
        if (config.analysis?.quantitative || config.analysis?.llmJudge) {
            console.log(`=== Running Post-Evaluation Analysis ===`);

            try {
                const analysisResult = await performAnalysis({
                    resultDir,
                    taskName: taskEntry.name,
                    quantitative: config.analysis.quantitative,
                    llmJudge: config.analysis.llmJudge,
                    llmConfig: config.analysis.llmConfig,
                });

                if (analysisResult.quantitative) {
                    result.quantitativeAnalysis = analysisResult.quantitative;
                }
                if (analysisResult.llmJudge) {
                    result.llmJudgeAnalysis = analysisResult.llmJudge;
                }

                console.log(`=== Analysis Complete (files saved to ${resultDir}) ===`);
            } catch (error: any) {
                console.error(`Analysis failed:`, error.message);
                // Don't fail the whole evaluation if analysis fails
            }
        }

        return result;
    }
}
