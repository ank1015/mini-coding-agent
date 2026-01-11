/**
 * Main entry point for the coding agent CLI.
 *
 * Handles CLI argument parsing and routes to the appropriate mode:
 * - Interactive: TUI-based chat interface
 * - Print: Single-shot mode for scripting/piping
 * - RPC: Headless JSON protocol for embedding in other applications
 */

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
		console.error(chalk.dim('Usage: agent -p "Your prompt here"'));
		process.exit(1);
	}

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
