import { writeFileSync } from "fs";
import { join } from "path";
import type { Api, Model, OptionsForApi } from "@ank1015/providers";
import { performQuantitativeAnalysis, type QuantitativeResult } from "./quantitative.js";
import { performLLMJudgeAnalysis, type LLMJudgeResult } from "./llm-judge.js";

// ============================================================================
// Type Definitions
// ============================================================================

export interface AnalysisConfig {
    /** Directory containing the evaluation results */
    resultDir: string;
    /** Name of the task being analyzed */
    taskName: string;
    /** Run quantitative analysis */
    quantitative?: boolean;
    /** Run LLM-as-judge analysis */
    llmJudge?: boolean;
    /** LLM configuration (required if llmJudge is true) */
    llmConfig?: {
        model: Model<Api>;
        providerOptions: OptionsForApi<Api>;
    };
}

export interface AnalysisResult {
    taskName: string;
    quantitative?: QuantitativeResult;
    llmJudge?: LLMJudgeResult;
    savedFiles: string[];
}

// ============================================================================
// Re-exports
// ============================================================================

export { performQuantitativeAnalysis, type QuantitativeResult } from "./quantitative.js";
export { performLLMJudgeAnalysis, type LLMJudgeResult, type LLMJudgeConfig } from "./llm-judge.js";
export { loadResultTrace } from "./utils.js";

// ============================================================================
// Main Analysis Function
// ============================================================================

/**
 * Perform analysis on an evaluation result.
 *
 * Runs the specified analyses and saves results to files in the result directory.
 *
 * @param config - Analysis configuration
 * @returns AnalysisResult with results and saved file paths
 *
 * @example
 * ```typescript
 * // Run both analyses
 * const result = await performAnalysis({
 *     resultDir: "./eval-results/task-1",
 *     taskName: "bayesian-network",
 *     quantitative: true,
 *     llmJudge: true,
 *     llmConfig: {
 *         model: geminiFlash,
 *         providerOptions: {}
 *     }
 * });
 *
 * // Run only quantitative
 * const result = await performAnalysis({
 *     resultDir: "./eval-results/task-1",
 *     taskName: "bayesian-network",
 *     quantitative: true
 * });
 * ```
 */
export async function performAnalysis(config: AnalysisConfig): Promise<AnalysisResult> {
    const { resultDir, taskName, quantitative, llmJudge, llmConfig } = config;
    const savedFiles: string[] = [];

    const result: AnalysisResult = {
        taskName,
        savedFiles,
    };

    // Validate LLM config if llmJudge is requested
    if (llmJudge && !llmConfig) {
        throw new Error("llmConfig is required when llmJudge is true");
    }

    // Run quantitative analysis
    if (quantitative) {
        console.log(`[${taskName}] Running quantitative analysis...`);

        const quantResult = await performQuantitativeAnalysis(resultDir, taskName);
        result.quantitative = quantResult;

        // Save to file
        const quantFilePath = join(resultDir, "analysis-quantitative.json");
        writeFileSync(quantFilePath, JSON.stringify(quantResult, null, 2), "utf-8");
        savedFiles.push(quantFilePath);

        console.log(`[${taskName}] Quantitative analysis saved to ${quantFilePath}`);
    }

    // Run LLM judge analysis
    if (llmJudge && llmConfig) {
        console.log(`[${taskName}] Running LLM judge analysis with ${llmConfig.model.id}...`);

        const llmResult = await performLLMJudgeAnalysis(resultDir, taskName, {
            model: llmConfig.model,
            providerOptions: llmConfig.providerOptions,
        });
        result.llmJudge = llmResult;

        // Save to file (both JSON metadata and markdown analysis)
        const llmJsonPath = join(resultDir, "analysis-llm-judge.json");
        const llmMarkdownPath = join(resultDir, "analysis-llm-judge.md");

        // Save JSON with metadata
        writeFileSync(llmJsonPath, JSON.stringify({
            taskName: llmResult.taskName,
            passed: llmResult.passed,
            model: llmResult.model,
            tokenUsage: llmResult.tokenUsage,
        }, null, 2), "utf-8");
        savedFiles.push(llmJsonPath);

        // Save markdown analysis for easy reading
        const markdownContent = `# LLM Judge Analysis: ${taskName}

**Status**: ${llmResult.passed ? "PASSED" : "FAILED"}
**Judge Model**: ${llmResult.model}
**Tokens Used**: ${llmResult.tokenUsage.total} (in: ${llmResult.tokenUsage.input}, out: ${llmResult.tokenUsage.output})

---

${llmResult.analysis}
`;
        writeFileSync(llmMarkdownPath, markdownContent, "utf-8");
        savedFiles.push(llmMarkdownPath);

        console.log(`[${taskName}] LLM judge analysis saved to ${llmMarkdownPath}`);
    }

    return result;
}

/**
 * Perform analysis on multiple evaluation results.
 *
 * @param configs - Array of analysis configurations
 * @returns Array of AnalysisResults
 */
export async function performBulkAnalysis(configs: AnalysisConfig[]): Promise<AnalysisResult[]> {
    const results: AnalysisResult[] = [];

    for (const config of configs) {
        try {
            const result = await performAnalysis(config);
            results.push(result);
        } catch (error: any) {
            console.error(`[${config.taskName}] Analysis failed:`, error.message);
            results.push({
                taskName: config.taskName,
                savedFiles: [],
            });
        }
    }

    return results;
}
