import { RegistryManager } from "./setup/registry-manager.js";
import { EnvironmentManager } from "./setup/environment-manager.js";
import { TaskExecutor } from "./execution/task-executor.js";
import { join } from "path";
import { existsSync } from "fs";

async function main() {
	try {
        // 0. Check Keys
        if (!process.env.GEMINI_API_KEY) {
            console.error("Error: GEMINI_API_KEY must be set.");
            process.exit(1);
        }

		console.log("=== 1. Setup Phase ===");
		const registryManager = new RegistryManager();
		const envManager = new EnvironmentManager(process.cwd());

		// Get Hello World Task
		const registry = await registryManager.fetchRegistry();
		const suite = registry.find(s => s.name === "hello-world");
        if (!suite) throw new Error("Hello world suite not found");
        
		const taskEntry = suite.tasks[0];
		console.log(`Selected Task: ${taskEntry.name}`);

		const { taskPath, config } = await registryManager.prepareTask(taskEntry);
		const imageId = await envManager.setupEnvironment(taskPath, config);
		console.log(`Environment Ready: ${imageId}`);

        console.log("\n=== 2. Execution Phase ===");
        const executor = new TaskExecutor("test-results");
        
        // Pass API keys to the container
        const envVars: Record<string, string> = {};
        if (process.env.GEMINI_API_KEY) envVars.GEMINI_API_KEY = process.env.GEMINI_API_KEY;
        // For testing, we might want to force a specific model if needed, but agent picks default.

        await executor.runTask(imageId, taskPath, taskEntry.name, envVars);

        console.log("\n=== 3. Verification ===");
        // Check if results exist
        // We know TaskExecutor creates results/task/runId
        // We can just list the latest
        
	} catch (error) {
		console.error("Error:", error);
	}
}

main();
