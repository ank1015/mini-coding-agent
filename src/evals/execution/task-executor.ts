import { exec } from "child_process";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { promisify } from "util";
import { TaskConfig } from "../types.js";

const execAsync = promisify(exec);

export class TaskExecutor {
    private resultsDir: string;

    constructor(resultsDir: string = "results") {
        this.resultsDir = resolve(resultsDir);
        if (!existsSync(this.resultsDir)) {
            mkdirSync(this.resultsDir, { recursive: true });
        }
    }

    /**
     * Runs the agent on the prepared environment.
     * @param imageId The Docker image ID to run
     * @param taskPath Local path to the task (for checking instructions existence, though they are inside image too if we copied or mounted)
     * @param taskName Name of the task (for result folder naming)
     * @param envVars API keys and other env vars
     */
    async runTask(imageId: string, taskPath: string, taskName: string, envVars: Record<string, string>): Promise<string> {
        // 1. Prepare Result Directory for this specific run
        const runId = new Date().toISOString().replace(/[:.]/g, "-");
        const taskResultDir = join(this.resultsDir, taskName, runId);
        mkdirSync(taskResultDir, { recursive: true });

        // Ensure paths are absolute for Docker volume mounting
        const absoluteTaskPath = resolve(taskPath);
        const absoluteResultDir = resolve(taskResultDir);

        // 2. Check for instructions (Host side check)
        // In our setup, the task repo (including instruction.md) is checked out at taskPath.
        // We need to make sure the agent inside the container can access it.
        // Option A: We COPY the whole task repo into /workspace during 'docker build'. (We did not explicitly do this in EnvironmentManager yet!)
        // Option B: We bind mount the taskPath to /workspace.
        
        // Let's look at EnvironmentManager again. 
        // It sets WORKDIR /workspace. 
        // It does NOT copy the task code into /workspace in the wrapper Dockerfile.
        // So we MUST mount taskPath -> /workspace.

        const instructionsPath = join(absoluteTaskPath, "instruction.md");
        if (!existsSync(instructionsPath)) {
            throw new Error(`instruction.md not found at ${instructionsPath}`);
        }

        // 3. Construct Docker Command
        // - Mount task code to /workspace
        // - Mount results dir to /results
        // - Pass Env Vars
        // - Command: node /opt/agent/dist/evals/agent-runner.js
        
        const envFlags = Object.entries(envVars)
            .map(([k, v]) => `-e ${k}="${v}"`)
            .join(" ");

        const containerName = `eval-${taskName}-${runId}`;

        // Note: We use the absolute path for taskPath and taskResultDir
        const cmd = `docker run -d \
            --name ${containerName} \
            ${envFlags} \
            -v "${absoluteTaskPath}:/workspace" \
            -v "${absoluteResultDir}:/results" \
            ${imageId} \
            node /opt/agent/dist/evals/agent-runner.js`;

        console.log(`Starting execution container ${containerName}...`);
        const { stdout: containerId } = await execAsync(cmd);
        const trimmedId = containerId.trim();
        
        // 4. Wait for completion
        // We can poll 'docker inspect' or 'docker wait'
        console.log(`Waiting for container ${trimmedId} to finish...`);
        await execAsync(`docker wait ${trimmedId}`);

        // Capture logs for debugging/audit
        console.log(`Fetching logs for container ${trimmedId}...`);
        try {
            const { stdout: logs, stderr: errLogs } = await execAsync(`docker logs ${trimmedId}`);
            if (logs) console.log("--- Container Logs (stdout) ---\n", logs);
            if (errLogs) console.error("--- Container Logs (stderr) ---\n", errLogs);
        } catch (e) {
            console.error("Failed to fetch logs:", e);
        }

        console.log(`Task execution finished. Results in ${taskResultDir}`);
        
        // We don't remove the container automatically here, allowing for post-run analysis/debugging.
        // The orchestrator can cleanup later.
        
        return containerId.trim();
    }
}
