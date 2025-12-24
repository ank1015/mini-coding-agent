/**
 * System prompt construction and project context loading
 */

import chalk from "chalk";
import { existsSync, readFileSync } from "fs";
import type { ToolName } from "./tools/index.js";

/** Tool descriptions for system prompt */
const toolDescriptions: Record<ToolName, string> = {
	read: "Read file contents",
	bash: "Execute bash commands (ls, grep, find, etc.)",
	edit: "Make surgical edits to files (find exact text and replace)",
	write: "Create or overwrite files",
	grep: "Search file contents for patterns (respects .gitignore)",
	find: "Find files by glob pattern (respects .gitignore)",
	ls: "List directory contents",
};

/** Resolve input as file path or literal string */
function resolvePromptInput(input: string | undefined, description: string): string | undefined {
	if (!input) {
		return undefined;
	}

	if (existsSync(input)) {
		try {
			return readFileSync(input, "utf-8");
		} catch (error) {
			console.error(chalk.yellow(`Warning: Could not read ${description} file ${input}: ${error}`));
			return input;
		}
	}

	return input;
}


export interface BuildSystemPromptOptions {
	/** Custom system prompt (replaces default). */
	customPrompt?: string;
	/** Tools to include in prompt. Default: [read, bash, edit, write] */
	selectedTools?: ToolName[];
	/** Text to append to system prompt. */
	appendSystemPrompt?: string;
	/** Working directory. Default: process.cwd() */
	cwd?: string;
}

/** Build the system prompt with tools, guidelines, and context */
export function buildSystemPrompt(options: BuildSystemPromptOptions = {}): string {
	const {
		customPrompt,
		selectedTools,
		appendSystemPrompt,
		cwd,
	} = options;
	const resolvedCwd = cwd ?? process.cwd();
	const resolvedCustomPrompt = resolvePromptInput(customPrompt, "system prompt");
	const resolvedAppendPrompt = resolvePromptInput(appendSystemPrompt, "append system prompt");

	const now = new Date();
	const dateTime = now.toLocaleString("en-US", {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
	});

	const appendSection = resolvedAppendPrompt ? `\n\n${resolvedAppendPrompt}` : "";


	if (resolvedCustomPrompt) {
		let prompt = resolvedCustomPrompt;

		if (appendSection) {
			prompt += appendSection;
		}

		// Add date/time and working directory last
		prompt += `\nCurrent date and time: ${dateTime}`;
		prompt += `\nCurrent working directory: ${resolvedCwd}`;

		return prompt;
	}


	// Build tools list based on selected tools
	const tools = selectedTools || (["read", "bash", "edit", "write"] as ToolName[]);
	const toolsList = tools.map((t) => `- ${t}: ${toolDescriptions[t]}`).join("\n");

	// Build guidelines based on which tools are actually available
	const guidelinesList: string[] = [];

	const hasBash = tools.includes("bash");
	const hasEdit = tools.includes("edit");
	const hasWrite = tools.includes("write");
	const hasGrep = tools.includes("grep");
	const hasFind = tools.includes("find");
	const hasLs = tools.includes("ls");
	const hasRead = tools.includes("read");

	// Read-only mode notice (no bash, edit, or write)
	if (!hasBash && !hasEdit && !hasWrite) {
		guidelinesList.push("You are in READ-ONLY mode - you cannot modify files or execute arbitrary commands");
	}

	// Bash without edit/write = read-only bash mode
	if (hasBash && !hasEdit && !hasWrite) {
		guidelinesList.push(
			"Use bash ONLY for read-only operations (git log, gh issue view, curl, etc.) - do NOT modify any files",
		);
	}

	// File exploration guidelines
	if (hasBash && !hasGrep && !hasFind && !hasLs) {
		guidelinesList.push("Use bash for file operations like ls, grep, find");
	} else if (hasBash && (hasGrep || hasFind || hasLs)) {
		guidelinesList.push("Prefer grep/find/ls tools over bash for file exploration (faster, respects .gitignore)");
	}

	// Read before edit guideline
	if (hasRead && hasEdit) {
		guidelinesList.push("Use read to examine files before editing. You must use this tool instead of cat or sed.");
	}

	// Edit guideline
	if (hasEdit) {
		guidelinesList.push("Use edit for precise changes (old text must match exactly)");
	}

	// Write guideline
	if (hasWrite) {
		guidelinesList.push("Use write only for new files or complete rewrites");
	}

	// Output guideline (only when actually writing/executing)
	if (hasEdit || hasWrite) {
		guidelinesList.push(
			"When summarizing your actions, output plain text directly - do NOT use cat or bash to display what you did",
		);
	}

	// Always include these
	guidelinesList.push("Be concise in your responses");
	guidelinesList.push("Show file paths clearly when working with files");

	const guidelines = guidelinesList.map((g) => `- ${g}`).join("\n");

	let prompt = `You are an expert coding assistant. You help users with coding tasks by reading files, executing commands, editing code, and writing new files.

Available tools:
${toolsList}

Guidelines:
${guidelines}
`;

	if (appendSection) {
		prompt += appendSection;
	}

	// Add date/time and working directory last
	prompt += `\nCurrent date and time: ${dateTime}`;
	prompt += `\nCurrent working directory: ${resolvedCwd}`;

	return prompt;
}
