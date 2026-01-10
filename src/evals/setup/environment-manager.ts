import { exec } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { promisify } from "util";
import { TaskConfig } from "../types.js";

const execAsync = promisify(exec);

/**
 * Extract the WORKDIR from a Dockerfile.
 * Returns the last WORKDIR directive found, or a default value.
 */
function extractWorkdirFromDockerfile(dockerfilePath: string): string {
	const content = readFileSync(dockerfilePath, 'utf-8');
	const lines = content.split('\n');
	let workdir = '/workspace'; // default fallback

	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.toUpperCase().startsWith('WORKDIR ')) {
			workdir = trimmed.substring(8).trim();
		}
	}
	return workdir;
}

export interface SetupEnvironmentResult {
	imageId: string;
	workdir: string;
}

export class EnvironmentManager {
	private agentDir: string;

	constructor(agentDir: string = process.cwd()) {
		this.agentDir = resolve(agentDir);
	}

	/**
	 * Builds the complete environment for a task.
	 * 1. Builds the task's base image (from Dockerfile or pulls base).
	 * 2. Builds a wrapper image that includes the Agent (Node.js + Source).
	 * @returns The final image ID/tag and the workdir extracted from the Dockerfile.
	 */
	async setupEnvironment(taskPath: string, config: TaskConfig): Promise<SetupEnvironmentResult> {
		const taskName = config.metadata?.tags?.[0] || "unknown-task";
		const baseImageTag = `task-base:${taskName}`;

		// 1. Build Base Image
		const dockerfilePath = join(taskPath, "environment", "Dockerfile");
		let baseImage: string;
		let workdir = '/workspace'; // default fallback

		if (existsSync(dockerfilePath)) {
			console.log(`Building base image from ${dockerfilePath}...`);
			// Extract WORKDIR from the Dockerfile
			workdir = extractWorkdirFromDockerfile(dockerfilePath);
			console.log(`Extracted WORKDIR from Dockerfile: ${workdir}`);
			// We build with the context of the 'environment' folder, as is standard
			const envDir = join(taskPath, "environment");
			await execAsync(`docker build -t ${baseImageTag} ${envDir}`);
			baseImage = baseImageTag;
		} else if (config.environment?.docker_image) {
			console.log(`Using pre-defined image: ${config.environment.docker_image}`);
			baseImage = config.environment.docker_image;
			// Ensure we have it
			await execAsync(`docker pull ${baseImage}`);
			// For pre-defined images, we can't easily extract WORKDIR, use default
			console.log(`Using default WORKDIR for pre-defined image: ${workdir}`);
		} else {
			throw new Error("No Dockerfile found and no docker_image specified in task config.");
		}

		// 2. Build Wrapper Image (Agent Runner)
		const runnerImageTag = `agent-runner:${taskName}`;
		console.log(`Building runner image ${runnerImageTag} on top of ${baseImage}...`);
		
		const wrapperDockerfile = this.generateWrapperDockerfile(baseImage, workdir);
		const wrapperPath = join(taskPath, "wrapper.Dockerfile");
		writeFileSync(wrapperPath, wrapperDockerfile);

		try {
			// Build the wrapper. We need the context to be the AGENT directory to copy agent files.
			// So we point -f to the wrapper file we just wrote inside the task repo,
			// but run the build from the agent's root.
			await execAsync(`docker build -t ${runnerImageTag} -f ${wrapperPath} ${this.agentDir}`);
		} finally {
			// Cleanup
			// rmSync(wrapperPath); // Keep for debugging for now
		}

		return { imageId: runnerImageTag, workdir };
	}

	private generateWrapperDockerfile(baseImage: string, taskWorkdir: string): string {
		return `
FROM ${baseImage}

# 1. Install Node.js 20 (assuming Debian/Ubuntu based)
# Using nodesource for up-to-date node
RUN apt-get update && \
    apt-get install -y curl ca-certificates gnupg && \
    mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && \
    apt-get install -y nodejs

# 2. Setup Agent Directory
WORKDIR /opt/agent

# 3. Copy Agent Dependencies and Source
# We assume we are building from the agent's root
COPY package.json .
# COPY package-lock.json .

# 4. Install dependencies (omitting dev deps to save time/space)
RUN npm install --omit=dev

# 5. Copy built source
COPY dist ./dist
COPY src ./src
# (Copying src might be useful if we need to read templates or raw files, though dist should suffice for execution.
#  Keeping it simple: just dist and package.json is usually enough if main points to dist)

# 6. Set Environment Variables
ENV NODE_ENV=production
ENV AGENT_MODE=headless

# 7. Setup Workspace - use the task's WORKDIR extracted from its Dockerfile
WORKDIR ${taskWorkdir}
`;
	}

	/**
	 * Runs the agent in the secured container.
	 * @param imageId The image tag to run
	 * @param envVars Environment variables to inject (API keys, etc)
	 * @returns The container ID
	 */
	async runContainer(imageId: string, envVars: Record<string, string> = {}): Promise<string> {
		const envFlags = Object.entries(envVars)
			.map(([k, v]) => `-e ${k}="${v}"`)
			.join(" ");

		// Run detached, keep alive (we'll exec into it or run command directly)
		// We use 'tail -f /dev/null' to keep it running if no entrypoint
		const cmd = `docker run -d ${envFlags} ${imageId} tail -f /dev/null`;
		
		const { stdout } = await execAsync(cmd);
		return stdout.trim();
	}

	async stopContainer(containerId: string): Promise<void> {
		await execAsync(`docker stop ${containerId} && docker rm ${containerId}`);
	}

    async execCommand(containerId: string, command: string): Promise<string> {
        const { stdout } = await execAsync(`docker exec ${containerId} ${command}`);
        return stdout;
    }
}
