import { exec } from "child_process";
import { cpSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { promisify } from "util";
import { TaskConfig, VerificationResult } from "../types.js";

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
     * Start the container in detached mode with required mounts.
     */
    async startContainer(imageId: string, taskPath: string, taskName: string, envVars: Record<string, string>): Promise<{ containerId: string, resultDir: string }> {
        // 1. Prepare Result Directory
        const runId = new Date().toISOString().replace(/[:.]/g, "-");
        const taskResultDir = join(this.resultsDir, taskName, runId);
        mkdirSync(taskResultDir, { recursive: true });
        
        // Prepare sub-folders
        mkdirSync(join(taskResultDir, "logs"), { recursive: true });

        // Ensure paths are absolute
        const absoluteTaskPath = resolve(taskPath);
        const absoluteResultDir = resolve(taskResultDir);
        const absoluteLogsDir = join(absoluteResultDir, "logs");

        // 2. Check for instructions
        const instructionsPath = join(absoluteTaskPath, "instruction.md");
        if (!existsSync(instructionsPath)) {
            throw new Error(`instruction.md not found at ${instructionsPath}`);
        }

        // 3. Construct Docker Command
        const envFlags = Object.entries(envVars)
            .map(([k, v]) => `-e ${k}='${v.replace(/'/g, "'\\''")}'`)
            .join(" ");

        const containerName = `eval-${taskName}-${runId}`;

        // Mounts:
        // - /workspace: The task code (instructions, source, tests)
        // - /results: Where agent writes session/events
        // - /logs/verifier: Where test.sh writes reward.txt. We map this to our local logs dir.
        // - /tests: We map taskPath/tests to /tests because test.sh expects absolute /tests/test_state.py
        
        const cmd = `docker run -d \
            --name ${containerName} \
            ${envFlags} \
            -v "${absoluteTaskPath}:/workspace" \
            -v "${absoluteResultDir}:/results" \
            -v "${absoluteLogsDir}:/logs/verifier" \
            -v "${join(absoluteTaskPath, 'tests')}:/tests" \
            ${imageId} \
            tail -f /dev/null`;

        console.log(`Starting container ${containerName}...`);
        const { stdout: containerId } = await execAsync(cmd);
        return { containerId: containerId.trim(), resultDir: absoluteResultDir };
    }

    /**
     * Run the agent inside the running container.
     */
    async runAgent(containerId: string): Promise<void> {
        console.log(`Running Agent in container ${containerId}...`);
        
        // We use docker exec. 
        // Note: 'node' needs to be in PATH. Our wrapper image ensures it is installed.
        // We run the agent runner script.
        const cmd = `docker exec ${containerId} node /opt/agent/dist/evals/agent-runner.js`;
        
        // This will block until agent finishes (or crashes)
        // We capture stdout/stderr to console
        try {
            await execAsync(cmd);
        } catch (error: any) {
            console.error("Agent execution failed:", error.message);
            // Fetch logs to see what happened
            // We can't fetch "docker logs" here easily because the main process is tail -f /dev/null.
            // But 'docker exec' output is captured in error.stdout/stderr if available.
            if (error.stdout) console.log("Agent Stdout:", error.stdout);
            if (error.stderr) console.error("Agent Stderr:", error.stderr);
            
            // We don't throw immediately, we might want to proceed to verify (which will likely fail, but good for data)
            // Actually, if agent crashes, we definitely want to try verifying to see if partial work was done? 
            // Or just mark as failed. Let's throw for now.
            throw error;
        }
        console.log("Agent execution finished.");
    }

    /**
     * Run the verification script inside the container.
     */
    async verify(containerId: string, resultDir: string): Promise<VerificationResult> {
        console.log(`Running Verification in container ${containerId}...`);
        
        // 1. Run test.sh
        // It is located at /workspace/tests/test.sh
        // We assume it exists.
        
        // We wrap in try/catch because if tests fail, the exit code might be non-zero (depending on script).
        // The example script: 
        // if [ $? -eq 0 ]; then echo 1 > ... else echo 0 > ... fi
        // So the script itself might exit 0 even if tests fail? 
        // We'll see. If it exits non-zero, execAsync throws.
        
        const testCmd = `docker exec ${containerId} bash -l /workspace/tests/test.sh`;
        
        try {
            await execAsync(testCmd);
        } catch (e: any) {
            console.log("Verification script exited with error (this might be normal if tests failed):", e.message);
        }

        // 2. Read Reward File
        // It should be in resultDir/logs/reward.txt (since we mounted resultDir/logs -> /logs/verifier)
        const rewardTxtPath = join(resultDir, "logs", "reward.txt");
        const rewardJsonPath = join(resultDir, "logs", "reward.json");
        
        let score = 0;
        let content: string | null = null;

        if (existsSync(rewardTxtPath)) {
            content = readFileSync(rewardTxtPath, "utf-8").trim();
            score = parseFloat(content);
        } else if (existsSync(rewardJsonPath)) {
            content = readFileSync(rewardJsonPath, "utf-8");
            try {
                const json = JSON.parse(content);
                // Assume standard CTRF or simple json { score: 1 }?
                // The prompt said "fallback to this". Let's assume generic structure or simple score.
                // For now, look for a score field or assume content is the score?
                // Let's safe guess: if it's JSON, we might need specific parsing logic later.
                // For now, just store content.
            } catch {}
        }

        // Calculate boolean pass
        const passed = score === 1; // Assuming 1 is pass, 0 is fail

        return {
            score,
            passed,
            rewardFileContent: content
        };
    }

    async stopContainer(containerId: string): Promise<void> {
        console.log(`Stopping container ${containerId}...`);
        await execAsync(`docker stop ${containerId} && docker rm ${containerId}`);
    }

    async archiveSolution(taskPath: string, resultDir: string): Promise<void> {
        const solutionSrc = join(taskPath, "solution");
        if (existsSync(solutionSrc)) {
            const dest = join(resultDir, "solution");
            cpSync(solutionSrc, dest, { recursive: true });
            console.log(`Archived solution to ${dest}`);
        }
    }
}
