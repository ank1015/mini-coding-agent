/**
 * CLI argument parsing for the coding agent.
 */

import { VERSION } from "../config.js";

export type Mode = "interactive" | "print" | "rpc" | "mock" | "discord";
export type OutputFormat = "text" | "json";

export interface Args {
	// Mode selection
	mode: Mode;
	outputFormat: OutputFormat;

	// Session options
	continue?: boolean;
	resume?: boolean;
	noSession?: boolean;
	session?: string;

	// Messages (positional arguments)
	messages: string[];

	// Help/version
	help?: boolean;
	version?: boolean;

	// Remote server options
	workingDir?: string;
}

export function parseArgs(args: string[]): Args {
	const result: Args = {
		mode: "interactive",
		outputFormat: "text",
		messages: [],
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		// Help and version
		if (arg === "--help" || arg === "-h") {
			result.help = true;
		} else if (arg === "--version" || arg === "-v") {
			result.version = true;
		}

		// Mode selection
		else if (arg === "--mode" && i + 1 < args.length) {
			const modeArg = args[++i];
			if (["rpc", "print", "interactive", "mock", "discord"].includes(modeArg)) {
				result.mode = modeArg as Mode;
			}
		} else if (arg === "--print" || arg === "-p") {
			result.mode = "print";
		} else if (arg === "--mock") {
			result.mode = "mock";
		} else if (arg === "--discord") {
			result.mode = "discord";
		}

		// Output format (for print mode)
		else if (arg === "--output" && i + 1 < args.length) {
			const outputArg = args[++i];
			if (outputArg === "json" || outputArg === "text") {
				result.outputFormat = outputArg;
			}
		}

		// Session options
		else if (arg === "--continue" || arg === "-c") {
			result.continue = true;
		} else if (arg === "--resume" || arg === "-r") {
			result.resume = true;
		} else if (arg === "--no-session") {
			result.noSession = true;
		} else if (arg === "--session" && i + 1 < args.length) {
			result.session = args[++i];
		}

		// Working directory (for remote modes)
		else if ((arg === "--cwd" || arg === "-d") && i + 1 < args.length) {
			result.workingDir = args[++i];
		}

		// Positional arguments (messages)
		else if (!arg.startsWith("-")) {
			result.messages.push(arg);
		}
	}

	// If print mode with no messages, that's an error (handled in main)
	// If messages provided without explicit mode, default to print mode
	if (result.messages.length > 0 && result.mode === "interactive") {
		result.mode = "print";
	}

	return result;
}

export function printHelp(): void {
	console.log(`
Usage: mini [options] [message...]

Modes:
  (default)              Interactive TUI mode
  -p, --print            Print mode (single-shot, output and exit)
  --mode <mode>          Explicit mode: interactive, print, rpc, mock, discord
  --mock                 Start mock server (console-based testing)
  --discord              Start Discord bot

Output (print mode):
  --output <format>      Output format: text (default), json

Session:
  -c, --continue         Continue most recent session
  -r, --resume           Pick a session to resume
  --session <path>       Use specific session file
  --no-session           Don't persist session (in-memory only)

Remote servers:
  -d, --cwd <path>       Working directory for the agent

Discord environment variables:
  DISCORD_BOT_TOKEN      Required: Your Discord bot token
  DISCORD_ALLOWED_USERS  Optional: Comma-separated user IDs
  DISCORD_ALLOWED_CHANNELS Optional: Comma-separated channel IDs
  DISCORD_COMMAND_PREFIX Optional: Require prefix (e.g., "!agent")
  DISCORD_DM_ONLY        Optional: "true" for DM-only mode
  DISCORD_REQUIRE_MENTION Optional: "true" to require @mention

Other:
  -h, --help             Show this help
  -v, --version          Show version

Examples:
  mini                           Start interactive mode
  mini "What is 2+2?"            Print mode with prompt
  mini -p "Hello" --output json  Print mode with JSON events
  mini --mode rpc                Start RPC server mode
  mini --mock                    Start mock server for testing
  mini --discord                 Start Discord bot
  mini --discord -d /path/to/project  Discord bot with custom working dir
  mini -c                        Continue last session
  mini -r                        Pick a session to resume

Version: ${VERSION}
`);
}
