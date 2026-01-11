/**
 * Main entry point for the coding agent CLI.
 *
 * Handles CLI argument parsing and routes to the appropriate mode:
 * - Interactive: TUI-based chat interface
 * - Print: Single-shot mode for scripting/piping
 * - RPC: Headless JSON protocol for embedding in other applications
 * - Mock: Console-based testing server
 * - Discord: Discord bot server
 */

import * as path from "path";
import chalk from "chalk";
import { AgentSession } from "./core/agent-session.js";
import { createAgentSession } from "./core/sdk.js";
import { SessionTree } from "./core/session-tree.js";
import { SettingsManager } from "./core/settings-manager.js";
import { VERSION } from "./config.js";
import { parseArgs, printHelp, type Args } from "./cli/args.js";
import { selectSession } from "./cli/session-picker.js";
import { ensureTool } from "./utils/tools-manager.js";
import { InteractiveMode } from "./modes/interactive.js";
import { runPrintMode } from "./modes/print-mode.js";
import { runRpcMode } from "./modes/rpc/rpc-mode.js";
import { initTheme } from "./modes/theme/theme.js";
import { RemoteAgent } from "./remote/remote-agent.js";
import { MockServer } from "./remote/servers/mock.js";
import { DiscordServer } from "./remote/servers/discord.js";

/**
 * Run interactive TUI mode.
 */
async function runInteractiveMode(
	session: AgentSession,
	version: string,
	fdPath: string | null = null
): Promise<void> {
	const mode = new InteractiveMode(session, version, fdPath);

	await mode.init();
	mode.renderInitialMessages(session.state);

	while (true) {
		const userInput = await mode.getUserInput();
		try {
			await session.prompt(userInput);
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
			mode.showError(errorMessage);
		}
	}
}

/**
 * Create session tree based on CLI arguments.
 */
function createSessionTree(parsed: Args, cwd: string): SessionTree | undefined {
	if (parsed.noSession) {
		return SessionTree.inMemory();
	}
	if (parsed.session) {
		return SessionTree.open(parsed.session);
	}
	if (parsed.continue) {
		return SessionTree.continueRecent(cwd);
	}
	// --resume is handled separately (needs picker UI)
	// Default: undefined (SDK will create new session)
	return undefined;
}

/**
 * Run mock server mode.
 */
async function runMockMode(cwd: string, cliPath: string): Promise<void> {
	console.log(`[Mock] Working directory: ${cwd}`);
	console.log(`[Mock] CLI path: ${cliPath}`);

	const server = new MockServer({
		username: "You",
		prompt: "You> ",
	});

	const agent = new RemoteAgent(server, {
		rpc: {
			cliPath,
			cwd,
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
		console.log("\n[Mock] Shutting down...");
		await agent.stop();
		process.exit(0);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	await agent.start();
}

/**
 * Run Discord bot mode.
 */
async function runDiscordMode(cwd: string, cliPath: string): Promise<void> {
	// Get token from environment
	const token = process.env.DISCORD_BOT_TOKEN;
	if (!token) {
		console.error(chalk.red("Error: DISCORD_BOT_TOKEN environment variable is required"));
		console.error(chalk.dim("\nUsage:"));
		console.error(chalk.dim("  DISCORD_BOT_TOKEN=your_token mini --discord"));
		process.exit(1);
	}

	console.log(`[Discord] Working directory: ${cwd}`);

	// Parse optional config from environment
	const allowedUsers = process.env.DISCORD_ALLOWED_USERS?.split(",").map((s) => s.trim()).filter(Boolean);
	const allowedChannels = process.env.DISCORD_ALLOWED_CHANNELS?.split(",").map((s) => s.trim()).filter(Boolean);
	const commandPrefix = process.env.DISCORD_COMMAND_PREFIX;
	const dmOnly = process.env.DISCORD_DM_ONLY === "true";
	const requireMention = process.env.DISCORD_REQUIRE_MENTION === "true";

	if (allowedUsers?.length) {
		console.log(`[Discord] Allowed users: ${allowedUsers.join(", ")}`);
	}
	if (allowedChannels?.length) {
		console.log(`[Discord] Allowed channels: ${allowedChannels.join(", ")}`);
	}
	if (commandPrefix) {
		console.log(`[Discord] Command prefix: "${commandPrefix}"`);
	}
	if (dmOnly) {
		console.log(`[Discord] DM-only mode enabled`);
	}
	if (requireMention) {
		console.log(`[Discord] Require @mention enabled`);
	}

	const server = new DiscordServer({
		token,
		allowedUsers,
		allowedChannels,
		commandPrefix,
		dmOnly,
		requireMention,
	});

	const agent = new RemoteAgent(server, {
		rpc: {
			cliPath,
			cwd,
		},
		showTypingIndicator: true,
		onAgentStart: (msg) => {
			console.log(`[Discord] Processing message from ${msg.username}: "${msg.text.substring(0, 50)}${msg.text.length > 50 ? "..." : ""}"`);
		},
		onAgentEnd: (msg, response) => {
			console.log(`[Discord] Sent response to ${msg.username} (${response.length} chars)`);
		},
		onError: (err, msg) => {
			console.error(`[Discord] Error processing message from ${msg.username}:`, err.message);
		},
	});

	// Handle graceful shutdown
	const shutdown = async () => {
		console.log("\n[Discord] Shutting down...");
		await agent.stop();
		process.exit(0);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	await agent.start();
	console.log("[Discord] Bot is running. Press Ctrl+C to stop.");
}

export async function main(args: string[]) {
	const parsed = parseArgs(args);

	// Handle help and version early
	if (parsed.help) {
		printHelp();
		return;
	}

	if (parsed.version) {
		console.log(VERSION);
		return;
	}

	// Validate print mode has a message
	if (parsed.mode === "print" && parsed.messages.length === 0) {
		console.error(chalk.red("Error: Print mode requires at least one message"));
		console.error(chalk.dim('Usage: mini -p "Your prompt here"'));
		process.exit(1);
	}

	// Handle remote server modes (mock, discord)
	// These use RpcClient internally, not AgentSession directly
	if (parsed.mode === "mock" || parsed.mode === "discord") {
		const cwd = parsed.workingDir ? path.resolve(parsed.workingDir) : process.cwd();
		const cliPath = path.resolve(import.meta.dirname, "cli.js");

		if (parsed.mode === "mock") {
			await runMockMode(cwd, cliPath);
		} else {
			await runDiscordMode(cwd, cliPath);
		}
		return;
	}

	// Standard modes (interactive, print, rpc) use AgentSession directly
	const fdPath = await ensureTool("fd");
	const cwd = process.cwd();
	const settingsManager = SettingsManager.create();

	// Initialize theme (only for interactive mode)
	const isInteractive = parsed.mode === "interactive";
	initTheme("custom", isInteractive);

	// Create session tree based on CLI flags
	let sessionTree = createSessionTree(parsed, cwd);

	// Handle --resume: show session picker
	if (parsed.resume) {
		const sessions = SessionTree.listSessions(cwd);
		if (sessions.length === 0) {
			console.log(chalk.dim("No sessions found"));
			return;
		}
		const selectedPath = await selectSession(sessions);
		if (!selectedPath) {
			console.log(chalk.dim("No session selected"));
			return;
		}
		// Clear screen after session selection (interactive only)
		if (isInteractive) {
			process.stdout.write("\x1b[3J\x1b[2J\x1b[H");
		}
		sessionTree = SessionTree.open(selectedPath);
	}

	// Create agent session
	const { session } = await createAgentSession({
		cwd,
		settingsManager,
		sessionTree,
	});

	// Validate model availability for non-interactive modes
	if (!isInteractive && !session.model) {
		console.error(chalk.red("No models available."));
		console.error(chalk.yellow("\nSet an API key environment variable:"));
		console.error("  ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, etc.");
		process.exit(1);
	}

	// Route to appropriate mode
	switch (parsed.mode) {
		case "rpc":
			await runRpcMode(session);
			break;

		case "print": {
			const initialMessage = parsed.messages[0];
			const followUpMessages = parsed.messages.slice(1);

			await runPrintMode(session, {
				outputMode: parsed.outputFormat,
				initialMessage,
				followUpMessages,
			});

			// Ensure clean exit
			process.exit(0);
		}

		case "interactive":
		default:
			await runInteractiveMode(session, VERSION, fdPath);
			break;
	}
}
