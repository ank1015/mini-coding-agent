import {
	type AutocompleteState,
	type Component,
	padToWidth,
	truncateToWidth,
	visibleWidth,
} from "@ank1015/agents-tui";
import { theme } from "../theme/theme.js";

/**
 * Theme for autocomplete overlay styling
 */
export interface AutocompleteOverlayTheme {
	background: (text: string) => string;
	selectedItem: (text: string) => string;
	command: (text: string) => string;
	description: (text: string) => string;
	scrollInfo: (text: string) => string;
}

/**
 * AutocompleteOverlay - renders autocomplete suggestions as an overlay
 *
 * This component is designed to be shown via TUI.showOverlay() positioned
 * above the editor input.
 */
export class AutocompleteOverlay implements Component {
	private state: AutocompleteState;
	private maxVisible: number = 10;
	private theme: AutocompleteOverlayTheme;

	constructor(state: AutocompleteState, overlayTheme: AutocompleteOverlayTheme) {
		this.state = state;
		this.theme = overlayTheme;
	}

	/**
	 * Update the autocomplete state
	 */
	setState(state: AutocompleteState): void {
		this.state = state;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const lines: string[] = [];
		const { items, selectedIndex } = this.state;

		if (items.length === 0) {
			return lines;
		}

		// Calculate visible range with scrolling
		const startIndex = Math.max(
			0,
			Math.min(
				selectedIndex - Math.floor(this.maxVisible / 2),
				items.length - this.maxVisible
			)
		);
		const endIndex = Math.min(startIndex + this.maxVisible, items.length);

		// Render visible items
		for (let i = startIndex; i < endIndex; i++) {
			const item = items[i];
			const isSelected = i === selectedIndex;

			// Build the item line
			const prefix = isSelected ? "→ " : "  ";
			const command = item.label || item.value;
			const description = item.description || "";

			// Calculate spacing
			const prefixWidth = visibleWidth(prefix);
			const commandWidth = visibleWidth(command);

			// Fixed width for command column (for alignment)
			const commandColumnWidth = 14;
			const paddedCommand = command.length < commandColumnWidth
				? command + " ".repeat(commandColumnWidth - command.length)
				: truncateToWidth(command, commandColumnWidth, "");

			// Calculate remaining space for description
			const usedWidth = prefixWidth + commandColumnWidth + 2; // +2 for spacing
			const descMaxWidth = Math.max(10, width - usedWidth - 2);
			const truncatedDesc = truncateToWidth(description, descMaxWidth, "...");

			let line: string;
			if (isSelected) {
				// Build content and pad to exact width for full background coverage
				const content = prefix + paddedCommand + truncatedDesc;
				const exactWidth = padToWidth(content, width);
				line = this.theme.selectedItem(exactWidth);
			} else {
				// Normal item - style command and description differently
				const commandStyled = this.theme.command(paddedCommand);
				const descStyled = this.theme.description(truncatedDesc);
				const content = prefix + commandStyled + descStyled;
				// Apply background to entire line
				line = this.theme.background(padToWidth(content, width));
			}

			lines.push(line);
		}

		return lines;
	}
}

/**
 * Create a default autocomplete overlay theme
 */
export function getAutocompleteOverlayTheme(): AutocompleteOverlayTheme {
	const bgHex = "#1a1a1a";

	return {
		background: (text) => theme.bgHex(bgHex, text),
		selectedItem: (text) => {
			const mode = theme.getColorMode();
			// Selection colors - orange background, dark text
			const bgCode = mode === "truecolor"
				? `\x1b[48;2;250;178;131m`  // #FAB283 in RGB
				: `\x1b[48;5;216m`;
			const fgCode = mode === "truecolor"
				? `\x1b[38;2;20;20;20m`      // Dark text
				: `\x1b[38;5;234m`;
			// Reset to overlay background at end
			const bgResetCode = mode === "truecolor"
				? `\x1b[48;2;26;26;26m`      // #1a1a1a
				: `\x1b[48;5;234m`;
			const defaultFg = `\x1b[39m`;
			return `${bgCode}${fgCode}${text}${bgResetCode}${defaultFg}`;
		},
		command: (text) => theme.fg("accent", text),
		description: (text) => theme.fg("muted", text),
		scrollInfo: (text) => theme.fg("dim", text),
	};
}
