import { getModel, GoogleProviderOptions, GoogleThinkingLevel } from "@ank1015/providers";
import { Evals } from "../src/evals/orchestrator.js";
import { getTaskIdByName, mediumTasks } from "./tasks.js";

const buildTBenchSystemPrompt = (resolvedCwd: string) => {

    const tools = ["bash", "edit", "find", "grep", "ls", "read", "write"];
    /** Tool descriptions for system prompt */
    const toolDescriptions: Record<any, string> = {
        read: "Read file contents (text and images: jpg, png, gif, webp)",
        bash: "Execute bash commands (ls, grep, find, etc.)",
        edit: "Make surgical edits to files (find exact text and replace)",
        write: "Create or overwrite files",
        grep: "Search file contents for patterns (respects .gitignore)",
        find: "Find files by glob pattern (respects .gitignore)",
        ls: "List directory contents",
    };	
    
    const now = new Date();
    const dateTime = now.toLocaleString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
    });
    
    const guidelines = [
        'Prefer grep/find/ls tools over bash for file exploration (faster, respects .gitignore)',
        'Bash output is aggressively truncated by default (first/last few lines). Use `fullOutput: true` variable while calling bash tool to see more.',
        'You have FULL root access. You can install any packages (apt-get, npm, pip, etc.) without asking for permission. Do not hesitate to install dependencies or run system commands as needed or instructed by user if they provide a more reliable solution.',
        'Use read to examine files before editing. You must use this tool instead of cat or sed.',
        'Use edit for precise changes (old text must match exactly)',
        'Use write only for new files or complete rewrites',
        'When summarizing your actions, output plain text directly - do NOT use cat or bash to display what you did',
        'Be concise in your responses',
        'Show file paths clearly when working with files',
        'Make sure you match all the user constraints specified before finishing.',
        'Try to act like a senior engineer. Use best practices.',
    ]
    const toolsList = tools.map((t) => `- ${t}: ${toolDescriptions[t]}`).join("\n");
    
    return `
    You are an expert coding assistant. You have full root access to this system. You help users with any tasks they mention by reading files, executing commands, editing code, and writing new files. You may install any tools required for the purpose.
    
    Available tools:
    ${toolsList}
    
    Guidelines:
    ${guidelines}
    
    Today's date: ${dateTime}
    You are in a Debian-based environment.
    Current working directory: ${resolvedCwd}
    `
}


// === CONFIGURATION START ===
const CONFIG = {
    // Number of times to run the evaluation
    runsCount: 2,
    
    // Registry and Task Index to evaluate
    registryIndex: 3, // REPLACE WITH YOUR REGISTRY INDEX
    taskIndex: 9,     // REPLACE WITH YOUR TASK INDEX

    // Optional: Provider Configuration (if different from env vars)
    provider: {
        model: getModel('google', 'gemini-3-pro-preview')!,
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
    const baseResultsDir = `eval_runs/batch_0`;
    
    console.log(`\n=== Starting Batch Evaluation ===`);
    console.log(`Target: Registry ${CONFIG.registryIndex}, Task ${CONFIG.taskIndex}`);
    console.log(`Runs: ${CONFIG.runsCount}`);
    console.log(`Results Directory: ${baseResultsDir}`);

    const id = await getTaskIdByName('gpt2-codegolf');

    // const injectedPrompt = `
    // Note:
    // - Output Formatting: When saving the coords_x and coords_y columns to the CSV, ensure they are formatted as stringified Python lists including square brackets (e.g., "[10, 20, 30]"). Do not mimic the input CSV format (which mimics tuples like "10, 20, 30"). The test suite parses these strings using ast.literal_eval() and specifically checks that the result is a list, not a tuple.
    // `

    for (let i = 0; i < CONFIG.runsCount; i++) {
        console.log(`\n--- Run ${i + 1} of ${CONFIG.runsCount} ---`);
        try {
            await evals.runBulkEvaluation({
                registryIndex: CONFIG.registryIndex,
                taskIndices: [id!],
                resultsDir: baseResultsDir,
                provider: CONFIG.provider, // Uncomment if using custom provider
                analysis: CONFIG.analysis as any,
                systemPrompt: buildTBenchSystemPrompt,
                // injectedPrompt: injectedPrompt
            });
        } catch (error) {
            console.error(`Run ${i + 1} failed:`, error);
        }
    }
    
    console.log(`\n=== Batch Evaluation Complete ===`);
    console.log(`Results stored in: ${baseResultsDir}`);
}

runTestTask().catch(console.error);
