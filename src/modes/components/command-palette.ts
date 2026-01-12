import {
	type Component,
	Input,
	type InputOptions,
	isArrowDown,
	isArrowUp,
	isCtrlC,
	isCtrlP,
	isEnter,
	isEscape,
	Modal,
	type ModalComponentOptions,
	type ModalTheme,
	padToWidth,
	truncateToWidth,
	visibleWidth,
} from "@ank1015/agents-tui";
import { theme } from "../theme/theme.js";
import { fuzzyFilter } from "../../utils/fuzzy.js";

/**
 * Command item for the palette
 */
export interface CommandItem {
	id: string;
	label: string;
	description?: string;
	shortcut?: string;
	section?: string;
}

/**
 * Theme for command palette styling
 */
export interface CommandPaletteTheme {
	modal: ModalTheme;
	sectionHeader: (text: string) => string;
	selectedItem: (text: string) => string;
	itemLabel: (text: string) => string;
	itemDescription: (text: string) => string;
	shortcut: (text: string) => string;
	noResults: (text: string) => string;
	scrollInfo: (text: string) => string;
	placeholder: (text: string) => string;
}

/**
 * Internal list component for rendering command items
 */
class CommandList implements Component {
	private allItems: CommandItem[] = [];
	private filteredItems: CommandItem[] = [];
	private selectedIndex: number = 0;
	private searchInput: Input;
	private maxVisible: number = 8;
	private theme: CommandPaletteTheme;

	public onSelect?: (item: CommandItem) => void;
	public onCancel?: () => void;

	constructor(items: CommandItem[], paletteTheme: CommandPaletteTheme) {
		this.allItems = items;
		this.filteredItems = items;
		this.theme = paletteTheme;
		this.searchInput = new Input({
			prompt: "",
			placeholder: "Search",
			placeholderStyle: paletteTheme.placeholder,
		});

		this.searchInput.onSubmit = () => {
			const selected = this.filteredItems[this.selectedIndex];
			if (selected && this.onSelect) {
				this.onSelect(selected);
			}
		};
	}

	private filterItems(query: string): void {
		if (!query.trim()) {
			this.filteredItems = this.allItems;
		} else {
			this.filteredItems = fuzzyFilter(
				this.allItems,
				query,
				(item) => `${item.label} ${item.description || ""}`
			);
		}
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredItems.length - 1));
	}

	invalidate(): void {}

	render(width: number): string[] {
		const lines: string[] = [];

		// Render search input with placeholder styling
		const inputLines = this.searchInput.render(width);
		lines.push(...inputLines);
		lines.push(""); // Blank line after search

		if (this.filteredItems.length === 0) {
			lines.push(this.theme.noResults("  No matching commands"));
			return lines;
		}

		// Calculate visible range with scrolling
		const startIndex = Math.max(
			0,
			Math.min(
				this.selectedIndex - Math.floor(this.maxVisible / 2),
				this.filteredItems.length - this.maxVisible
			)
		);
		const endIndex = Math.min(startIndex + this.maxVisible, this.filteredItems.length);

		// Track current section for headers
		let currentSection = "";
		let isFirstSection = true;

		// Render visible items
		for (let i = startIndex; i < endIndex; i++) {
			const item = this.filteredItems[i];
			const isSelected = i === this.selectedIndex;

			// Render section header if changed
			if (item.section && item.section !== currentSection) {
				// Add spacer above new sections (except the first one)
				if (!isFirstSection) {
					lines.push("");
				}
				isFirstSection = false;
				currentSection = item.section;
				// Add same prefix as items for alignment
				lines.push("  " + this.theme.sectionHeader(item.section));
			}

			// Build the item line (no prefix indicator, use background color for selection)
			const prefix = "  ";
			const label = item.label;
			const shortcut = item.shortcut || "";

			// Calculate spacing between label and shortcut
			const prefixWidth = visibleWidth(prefix);
			const labelWidth = visibleWidth(label);
			const shortcutWidth = visibleWidth(shortcut);
			const minSpacing = 2;
			const usedWidth = prefixWidth + labelWidth + minSpacing + shortcutWidth;
			const extraSpacing = Math.max(0, width - usedWidth);
			const spacing = " ".repeat(minSpacing + extraSpacing);

			let line: string;
			if (isSelected) {
				// Build content and pad to EXACT width for full background coverage
				const content = prefix + label + spacing + shortcut;
				const exactWidth = padToWidth(content, width);
				line = this.theme.selectedItem(exactWidth);
			} else {
				// Normal item
				const labelStyled = this.theme.itemLabel(label);
				const shortcutStyled = shortcut ? this.theme.shortcut(shortcut) : "";
				line = prefix + labelStyled + spacing + shortcutStyled;
			}

			lines.push(line);
		}

		return lines;
	}

	handleInput(keyData: string): void {
		if (isArrowUp(keyData)) {
			this.selectedIndex = this.selectedIndex === 0
				? this.filteredItems.length - 1
				: this.selectedIndex - 1;
		} else if (isArrowDown(keyData)) {
			this.selectedIndex = this.selectedIndex === this.filteredItems.length - 1
				? 0
				: this.selectedIndex + 1;
		} else if (isEnter(keyData)) {
			const selected = this.filteredItems[this.selectedIndex];
			if (selected && this.onSelect) {
				this.onSelect(selected);
			}
		} else if (isEscape(keyData) || isCtrlC(keyData) || isCtrlP(keyData)) {
			this.onCancel?.();
		} else {
			// Forward to search input
			this.searchInput.handleInput(keyData);
			this.filterItems(this.searchInput.getValue());
		}
	}
}

/**
 * Command Palette Modal - a centered overlay for quick command access
 *
 * Usage:
 * ```
 * const palette = new CommandPaletteModal(commands, paletteTheme);
 * palette.onSelect = (cmd) => { executeCommand(cmd.id); };
 * palette.onClose = () => { ui.hideModal(); };
 * ui.showModal(palette, { width: 60 });
 * ```
 */
export class CommandPaletteModal extends Modal {
	private commandList: CommandList;

	constructor(commands: CommandItem[], paletteTheme: CommandPaletteTheme) {
		super(paletteTheme.modal, {
			title: "Commands",
			closeHint: "esc",
			showSeparator: false,
		});

		this.commandList = new CommandList(commands, paletteTheme);
		this.addChild(this.commandList);

		// Wire up command list cancel to modal close
		this.commandList.onCancel = () => {
			this.onClose?.();
		};
	}

	/**
	 * Set callback for when a command is selected
	 */
	setOnSelect(callback: (item: CommandItem) => void): void {
		this.commandList.onSelect = callback;
	}

	/**
	 * Set callback for when modal should close
	 */
	setOnClose(callback: () => void): void {
		this.onClose = callback;
		this.commandList.onCancel = callback;
	}
}

/**
 * Create a default command palette theme based on the app theme
 */
export function getCommandPaletteTheme(): CommandPaletteTheme {
	// Selection colors - configurable
	const selectionBg = "#FAB283";
	const selectionFg = "#141414";

	return {
		modal: {
			border: (text) => theme.fg("dim", text),
			background: (text) => theme.bgHex("#141414", text),
			title: (text) => theme.bold(text),
			closeHint: (text) => theme.fg("muted", text),
			separator: (text) => theme.fg("dim", text),
		},
		sectionHeader: (text) => theme.fg("accent", text),
		// Selection highlight: reset to modal background at end to prevent bleed
		selectedItem: (text) => {
			const mode = theme.getColorMode();
			// Selection colors
			const bgCode = mode === "truecolor"
				? `\x1b[48;2;250;178;131m`  // #FAB283 in RGB
				: `\x1b[48;5;216m`;          // Closest 256-color
			const fgCode = mode === "truecolor"
				? `\x1b[38;2;20;20;20m`      // #141414 in RGB
				: `\x1b[38;5;234m`;          // Closest 256-color
			// Reset to modal background (#141414) at end, not terminal default
			const modalBgCode = mode === "truecolor"
				? `\x1b[48;2;20;20;20m`      // #141414 in RGB
				: `\x1b[48;5;234m`;          // Closest 256-color
			const defaultFg = `\x1b[39m`;    // Reset foreground to default
			return `${bgCode}${fgCode}${text}${modalBgCode}${defaultFg}`;
		},
		itemLabel: (text) => text,
		itemDescription: (text) => theme.fg("muted", text),
		shortcut: (text) => theme.fg("dim", text),
		noResults: (text) => theme.fg("muted", text),
		scrollInfo: (text) => theme.fg("dim", text),
		placeholder: (text) => theme.fg("muted", text),
	};
}
