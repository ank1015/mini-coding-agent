import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { exec } from "child_process";
import { promisify } from "util";
import toml from "toml";
import { RegistryTaskEntry, TaskConfig, TaskRegistry } from "../types.js";

const execAsync = promisify(exec);

export class RegistryManager {
	private registryUrl: string;
	private cacheDir: string;

	constructor(registryUrl: string = "https://raw.githubusercontent.com/laude-institute/harbor/refs/heads/main/registry.json", cacheDir: string = "evals-cache") {
		this.registryUrl = registryUrl;
		this.cacheDir = cacheDir;
		if (!existsSync(this.cacheDir)) {
			mkdirSync(this.cacheDir, { recursive: true });
		}
	}

	async fetchRegistry(): Promise<TaskRegistry[]> {
		try {
			const response = await fetch(this.registryUrl);
			if (!response.ok) {
				throw new Error(`Failed to fetch registry: ${response.statusText}`);
			}
			return await response.json() as TaskRegistry[];
		} catch (error) {
			throw new Error(`Error fetching registry: ${error}`);
		}
	}

	async prepareTask(taskEntry: RegistryTaskEntry): Promise<{ taskPath: string; config: TaskConfig }> {
		const repoName = taskEntry.git_url.split("/").pop()?.replace(".git", "") || "repo";
		const repoDir = join(this.cacheDir, "repos", repoName);
		const taskDir = join(repoDir, taskEntry.path);

		// Clone or fetch
		if (!existsSync(repoDir)) {
			console.log(`Cloning ${taskEntry.git_url}...`);
			await execAsync(`git clone ${taskEntry.git_url} ${repoDir}`);
		} else {
			// Ensure we have the latest info (though we are checking out a specific commit)
			// await execAsync(`cd ${repoDir} && git fetch`); // Optional optimization
		}

		// Checkout commit
		if (taskEntry.git_commit_id) {
			console.log(`Checking out commit ${taskEntry.git_commit_id}...`);
			await execAsync(`cd ${repoDir} && git checkout ${taskEntry.git_commit_id}`);
		}

		// Read task.toml
		const tomlPath = join(taskDir, "task.toml");
		if (!existsSync(tomlPath)) {
			throw new Error(`task.toml not found at ${tomlPath}`);
		}

		const tomlContent = readFileSync(tomlPath, "utf-8");
		const config = toml.parse(tomlContent) as TaskConfig;

		return {
			taskPath: taskDir,
			config
		};
	}

    getCacheDir(): string {
        return this.cacheDir;
    }
}
