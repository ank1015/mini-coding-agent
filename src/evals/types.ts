export interface TaskRegistry {
	name: string;
	version: string;
	description: string;
	tasks: RegistryTaskEntry[];
}

export interface RegistryTaskEntry {
	name: string;
	git_url: string;
	git_commit_id?: string;
	path: string;
}

export interface TaskConfig {
	version?: string;
	metadata?: {
		author_name?: string;
		author_email?: string;
		difficulty?: string;
		category?: string;
		tags?: string[];
	};
	verifier?: {
		timeout_sec?: number;
	};
	agent?: {
		timeout_sec?: number;
	};
	environment?: {
		build_timeout_sec?: number;
		docker_image?: string;
		cpus?: number;
		memory_mb?: number;
		storage_mb?: number;
	};
}

export interface TaskEnvironment {
	taskName: string;
	taskPath: string; // Local path where repo is checked out
	dockerImageId: string;
	config: TaskConfig;
}
