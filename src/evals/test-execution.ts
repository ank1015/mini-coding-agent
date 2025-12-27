import { RegistryManager } from "./setup/registry-manager.js";
import { EnvironmentManager } from "./setup/environment-manager.js";
import { TaskExecutor } from "./execution/task-executor.js";
import { join } from "path";
import { existsSync } from "fs";

async function main() {
	try {
        // 0. Check Keys
        if (!process.env.GEMINI_API_KEY) {
            console.error("Error: API KEY must be set.");
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

        console.log("\n=== 2. Execution & Verification Phase ===");
        const executor = new TaskExecutor("test-results");
        
        // Pass API keys to the container
        const envVars: Record<string, string> = {};
        if (process.env.GEMINI_API_KEY) envVars.GEMINI_API_KEY = process.env.GEMINI_API_KEY;

        // 1. Start
        const { containerId, resultDir } = await executor.startContainer(imageId, taskPath, taskEntry.name, envVars);

        try {
            // 2. Run Agent
            await executor.runAgent(containerId);
            
            // 3. Archive Solution (Host side)
            await executor.archiveSolution(taskPath, resultDir);

            // 4. Verify
            const verification = await executor.verify(containerId, resultDir);
            console.log("\n=== Verification Results ===");
            console.log("Passed:", verification.passed);
            console.log("Score:", verification.score);
            console.log("Reward Content:", verification.rewardFileContent);

        } catch (e) {
            console.error("Execution failed:", e);
        } finally {
            // 5. Cleanup
            // await executor.stopContainer(containerId);
        }

        console.log(`\nFull results archived in: ${resultDir}`);
        
	} catch (error) {
		console.error("Error:", error);
	}
}

main();
