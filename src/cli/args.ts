/**
 * CLI argument parsing for the coding agent.
 */

import { VERSION } from "../config.js";

export type Mode = "interactive" | "print" | "rpc";
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
			if (modeArg === "rpc" || modeArg === "print" || modeArg === "interactive") {
				result.mode = modeArg;
			}
		} else if (arg === "--print" || arg === "-p") {
			result.mode = "print";
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
Usage: agent [options] [message...]

Modes:
  (default)              Interactive TUI mode
  -p, --print            Print mode (single-shot, output and exit)
  --mode <mode>          Explicit mode: interactive, print, rpc

Output (print mode):
  --output <format>      Output format: text (default), json

Session:
  -c, --continue         Continue most recent session
  -r, --resume           Pick a session to resume
  --session <path>       Use specific session file
  --no-session           Don't persist session (in-memory only)

Other:
  -h, --help             Show this help
  -v, --version          Show version

Examples:
  agent                          Start interactive mode
  agent "What is 2+2?"           Print mode with prompt
  agent -p "Hello" --output json Print mode with JSON events
  agent --mode rpc               Start RPC server mode
  agent -c                       Continue last session
  agent -r                       Pick a session to resume

Version: ${VERSION}
`);
}
