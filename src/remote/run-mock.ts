#!/usr/bin/env node
/**
 * Run the mock server for testing the remote agent architecture.
 *
 * Usage:
 *   npx ts-node src/remote/run-mock.ts [working-directory]
 *
 * Or after build:
 *   node dist/remote/run-mock.js [working-directory]
 */

import * as path from "path";
import { MockServer } from "./mock-server.js";
import { RemoteAgent } from "./remote-agent.js";

async function main() {
	// Get working directory from args or use current
	const cwd = process.argv[2] || process.cwd();
	const absoluteCwd = path.resolve(cwd);

	console.log(`[MockRunner] Working directory: ${absoluteCwd}`);

	// Find the CLI path
	const cliPath = path.resolve(import.meta.dirname, "../cli.js");
	console.log(`[MockRunner] CLI path: ${cliPath}`);

	// Create mock server
	const server = new MockServer({
		username: "You",
		prompt: "You> ",
	});

	// Create remote agent
	const agent = new RemoteAgent(server, {
		rpc: {
			cliPath,
			cwd: absoluteCwd,
			// No --continue flag = new session each time server starts
			// All messages within this server run share the same session
		},
		showTypingIndicator: true,
		onAgentStart: (msg) => {
			console.log(`\n[Processing: "${msg.text.substring(0, 50)}${msg.text.length > 50 ? "..." : ""}"]\n`);
		},
		onError: (err) => {
			console.error(`\n[Error: ${err.message}]\n`);
		},
	});

	// Handle graceful shutdown
	const shutdown = async () => {
		console.log("\n[MockRunner] Shutting down...");
		await agent.stop();
		process.exit(0);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	// Start the agent
	try {
		await agent.start();
	} catch (error) {
		console.error("[MockRunner] Failed to start:", error);
		process.exit(1);
	}
}

main().catch((error) => {
	console.error("[MockRunner] Fatal error:", error);
	process.exit(1);
});
