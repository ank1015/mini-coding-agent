import { getModel, GoogleProviderOptions, GoogleThinkingLevel } from "@ank1015/providers";
import { Evals } from "../src/evals/orchestrator.js";
import { mediumTasks } from "./tasks.js";

// === CONFIGURATION START ===
const CONFIG = {
    // Number of times to run the evaluation
    runsCount: 2,
    
    // Registry and Task Index to evaluate
    registryIndex: 1, // REPLACE WITH YOUR REGISTRY INDEX
    taskIndex: 9,     // REPLACE WITH YOUR TASK INDEX

    // Optional: Provider Configuration (if different from env vars)
    provider: {
        model: getModel('google', 'gemini-3-flash-preview')!,
        providerOptions: {
            thinkingConfig: {
                thinkingLevel: GoogleThinkingLevel.HIGH
            }
        } as GoogleProviderOptions
    }, 

    // Analysis Configuration
    analysis: {
        quantitative: true,
        llmJudge: true,
        // LLM configuration for judge analysis (required if llmJudge is true)
        llmConfig: {
            model: getModel('google', 'gemini-3-pro-preview'),
            providerOptions: {
                thinkingConfig: {
                    thinkingLevel: GoogleThinkingLevel.HIGH
                }
            } as GoogleProviderOptions
             // model: new Model(Api.Anthropic, "claude-3-5-sonnet-20241022"),
             // providerOptions: { apiKey: process.env.ANTHROPIC_API_KEY }
        }
    }
};
// === CONFIGURATION END ===

async function runTestTask() {
    const evals = new Evals();
    
    // Create a unique directory for this batch of runs
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const baseResultsDir = `eval_runs/batch_medium`;
    
    console.log(`\n=== Starting Batch Evaluation ===`);
    console.log(`Target: Registry ${CONFIG.registryIndex}, Task ${CONFIG.taskIndex}`);
    console.log(`Runs: ${CONFIG.runsCount}`);
    console.log(`Results Directory: ${baseResultsDir}`);

    for (let i = 0; i < CONFIG.runsCount; i++) {
        console.log(`\n--- Run ${i + 1} of ${CONFIG.runsCount} ---`);
        try {
            await evals.runBulkEvaluation({
                registryIndex: CONFIG.registryIndex,
                taskIndices: mediumTasks.slice(0,5),
                resultsDir: baseResultsDir,
                provider: CONFIG.provider, // Uncomment if using custom provider
                analysis: CONFIG.analysis as any
            });
        } catch (error) {
            console.error(`Run ${i + 1} failed:`, error);
        }
    }
    
    console.log(`\n=== Batch Evaluation Complete ===`);
    console.log(`Results stored in: ${baseResultsDir}`);
}

runTestTask().catch(console.error);
