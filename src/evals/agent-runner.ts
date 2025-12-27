import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createAgentSession, findModel } from "../core/sdk.js";
import { AgentEvent, getApiKeyFromEnv, getModel } from "@ank1015/providers";
import { getDefaultProviderOption } from "../utils/default-provider-options.js";

async function main() {
	try {
		// 1. Parse Arguments / Environment
		const taskPath = process.env.TASK_PATH || "/workspace";
		const outputDir = process.env.OUTPUT_DIR || "/results";
		const instructionsFile = join(taskPath, "instruction.md");
        const workDir = '/app'

		console.log(`Starting Agent Runner...`);
		console.log(`Task Path: ${taskPath}`);
		console.log(`Output Dir: ${outputDir}`);

		// 2. Read Instructions
		if (!existsSync(instructionsFile)) {
			console.error(`Error: instruction.md not found at ${instructionsFile}`);
			process.exit(1);
		}
		const instructions = readFileSync(instructionsFile, "utf-8");

		// 3. Initialize Agent
        // We use the default settings, but ensure the session file is saved to the output directory
        // The SDK's createAgentSession uses SessionManager which saves to <agentDir>/sessions by default.
        // We want to force it to use our output directory or copy it later. 
        // A cleaner way for this headless mode is to let it save normally, and then we copy the file to /results at the end.
        // OR we can pass a custom SessionManager. 
        
        // Let's use the standard creation, it will use process.cwd() (which is /workspace) or agentDir settings.
        // To ensure we capture the specific session file, we'll grab the path from the session object.

		const { session } = await createAgentSession({
            cwd: workDir,
            // We assume API keys are passed as Env Vars (OPENAI_API_KEY, etc.)
            provider: {
                model: getModel('google', 'gemini-3-flash-preview')!,
                providerOptions: getDefaultProviderOption('google')
            }
        });

		console.log(`Agent Session Initialized. ID: ${session.sessionId}`);

        // 4. Setup Event Logging
        const eventsPath = join(outputDir, "events.jsonl");
        // Ensure output dir exists (it should be mounted, but good to check)
        if (!existsSync(outputDir)) {
             // If it's a bind mount, it exists. If we are running locally for test, maybe not.
             // inside container /results usually exists if mounted. 
        }

        const eventLogStream: string[] = [];
        
        session.subscribe((event: AgentEvent) => {
            const entry = JSON.stringify({
                timestamp: new Date().toISOString(),
                event
            });
            eventLogStream.push(entry);
            // Append to file immediately for safety
            try {
                 // Using fs.appendFileSync for simplicity in this runner
                 // import { appendFileSync } from "fs"; -- need to add to imports if using
                 // For now, let's just write at the end or use a simple flush?
                 // Real-time logging is safer against crashes.
            } catch (e) {
                console.error("Failed to log event", e);
            }
        });

        // We will use appendFileSync for real-time logging
        const { appendFileSync } = await import("fs");

        session.subscribe((event: AgentEvent) => {
             try {
                const line = JSON.stringify({ timestamp: new Date().toISOString(), event }) + "\n";
                appendFileSync(eventsPath, line);
             } catch (e) {
                 // ignore write errors to avoid crashing agent
             }
        });

		// 5. Run the Agent
		console.log("Prompting agent...");
		await session.prompt(instructions);

        // 6. Finalize
        console.log("Agent finished.");
        
        // Copy the session file to the result directory so it's easy to find
        const sessionFile = session.sessionFile;
        if (sessionFile && existsSync(sessionFile)) {
            const dest = join(outputDir, "session.jsonl");
            writeFileSync(dest, readFileSync(sessionFile));
            console.log(`Session file saved to ${dest}`);
        }

	} catch (error) {
		console.error("Fatal Error in Agent Runner:", error);
		process.exit(1);
	}
}

main();
