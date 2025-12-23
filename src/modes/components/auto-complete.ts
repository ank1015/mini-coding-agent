import {
	type AutocompleteItem,
	type AutocompleteProvider,
	type SlashCommand,
} from "@ank1015/agents-tui";

export class Autocomplete implements AutocompleteProvider {
	private commands: SlashCommand[];
	private mockFiles: string[];

	constructor(commands: SlashCommand[]) {
		this.commands = commands;
		// Mock file list for @ completion
		this.mockFiles = [
			"src/index.ts",
			"src/main.ts",
			"src/utils/helpers.ts",
			"src/components/button.tsx",
			"src/components/input.tsx",
			"src/styles/theme.css",
			"package.json",
			"tsconfig.json",
			"README.md",
		];
	}

	getSuggestions(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
	): { items: AutocompleteItem[]; prefix: string } | null {
		const currentLine = lines[cursorLine] || "";
		const textBeforeCursor = currentLine.slice(0, cursorCol);

		// Check for @ file reference - must have at least one character after @
		const atMatch = textBeforeCursor.match(/(?:^|[\s])(@[^\s]+)$/);
		if (atMatch) {
			const prefix = atMatch[1] || "@";
			const query = prefix.slice(1).toLowerCase(); // Remove the @

			// Filter mock files by query
			const filtered = this.mockFiles
				.filter((f) => f.toLowerCase().includes(query))
				.map((f) => ({
					value: "@" + f,
					label: f.split("/").pop() || f,
					description: f,
				}));

			if (filtered.length === 0) return null;
			return { items: filtered, prefix };
		}

		// Check for slash commands - only if "/" is at the start of the message
		const trimmedText = textBeforeCursor.trimStart();
		if (trimmedText.startsWith("/") && !trimmedText.includes(" ")) {
			const prefix = trimmedText.slice(1); // Remove the "/"
			const filtered = this.commands
				.filter((cmd) => cmd.name.toLowerCase().startsWith(prefix.toLowerCase()))
				.map((cmd) => ({
					value: cmd.name,
					label: cmd.name,
					description: cmd.description,
				}));

			if (filtered.length === 0) return null;
			return { items: filtered, prefix: trimmedText };
		}

		return null;
	}

	applyCompletion(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		item: AutocompleteItem,
		prefix: string,
	): { lines: string[]; cursorLine: number; cursorCol: number } {
		const currentLine = lines[cursorLine] || "";
		const beforePrefix = currentLine.slice(0, cursorCol - prefix.length);
		const afterCursor = currentLine.slice(cursorCol);

		let newLine: string;
		let newCursorCol: number;

		if (prefix.startsWith("/")) {
			// Slash command - insert "/command "
			newLine = beforePrefix + "/" + item.value + " " + afterCursor;
			newCursorCol = beforePrefix.length + item.value.length + 2;
		} else if (prefix.startsWith("@")) {
			// File reference - insert "@filepath "
			newLine = beforePrefix + item.value + " " + afterCursor;
			newCursorCol = beforePrefix.length + item.value.length + 1;
		} else {
			// Fallback
			newLine = beforePrefix + item.value + afterCursor;
			newCursorCol = beforePrefix.length + item.value.length;
		}

		const newLines = [...lines];
		newLines[cursorLine] = newLine;

		return { lines: newLines, cursorLine, cursorCol: newCursorCol };
	}
}
