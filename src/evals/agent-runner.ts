import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createAgentSession } from "../core/sdk.js";
import { AgentEvent, getModel, Api } from "@ank1015/providers";
import { getDefaultProviderOption } from "../utils/default-provider-options.js";

async function main() {
	try {
		// 1. Parse Arguments / Environment
		const taskPath = process.env.TASK_PATH || "/workspace";
		const outputDir = process.env.OUTPUT_DIR || "/results";
		const instructionsFile = join(taskPath, "instruction.md");
		// Use TASK_WORKDIR from environment (extracted from Dockerfile), fallback to /workspace
		const workDir = process.env.TASK_WORKDIR || "/workspace";

		console.log(`Starting Agent Runner...`);
		console.log(`Task Path: ${taskPath}`);
		console.log(`Output Dir: ${outputDir}`);
		console.log(`Work Dir: ${workDir}`);

		// 2. Read Instructions
		if (!existsSync(instructionsFile)) {
			console.error(`Error: instruction.md not found at ${instructionsFile}`);
			process.exit(1);
		}
		const instructions = readFileSync(instructionsFile, "utf-8");

		// 3. Initialize Agent
        let providerConfig: any = {
             model: getModel('google', 'gemini-3-flash-preview')!,
             providerOptions: getDefaultProviderOption('google')
        };

        if (process.env.AGENT_PROVIDER_CONFIG) {
            try {
                console.log("Found AGENT_PROVIDER_CONFIG env var, parsing...");
                const parsed = JSON.parse(process.env.AGENT_PROVIDER_CONFIG);
                if (parsed.api && parsed.modelId) {
                    const model = getModel(parsed.api as Api, parsed.modelId);
                    if (model) {
                         providerConfig = {
                             model,
                             providerOptions: parsed.providerOptions || getDefaultProviderOption(parsed.api)
                         };
                         console.log(`Using configured provider: ${model.api}/${model.id}`);
                    } else {
                        console.warn(`Model not found for ${parsed.api}/${parsed.modelId}, using default.`);
                    }
                }
            } catch (e) {
                console.error("Failed to parse AGENT_PROVIDER_CONFIG", e);
            }
        }

		const { session } = await createAgentSession({
            cwd: workDir,
            provider: providerConfig,
            ultraDangerousMode: true
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
