import {
	type Component,
	Input,
	isArrowDown,
	isArrowUp,
	isCtrlC,
	isCtrlP,
	isEnter,
	isEscape,
	Modal,
	type ModalTheme,
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

	constructor(items: CommandItem[], theme: CommandPaletteTheme) {
		this.allItems = items;
		this.filteredItems = items;
		this.theme = theme;
		this.searchInput = new Input();

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

		// Render visible items
		for (let i = startIndex; i < endIndex; i++) {
			const item = this.filteredItems[i];
			const isSelected = i === this.selectedIndex;

			// Render section header if changed
			if (item.section && item.section !== currentSection) {
				currentSection = item.section;
				lines.push(this.theme.sectionHeader(item.section));
			}

			// Build the item line
			const prefix = isSelected ? "› " : "  ";
			const label = item.label;
			const shortcut = item.shortcut || "";

			// Calculate spacing
			const prefixWidth = visibleWidth(prefix);
			const labelWidth = visibleWidth(label);
			const shortcutWidth = visibleWidth(shortcut);
			const availableForSpacing = width - prefixWidth - labelWidth - shortcutWidth - 2;
			const spacing = " ".repeat(Math.max(1, availableForSpacing));

			let line: string;
			if (isSelected) {
				// Highlight entire selected line
				const content = prefix + label + spacing + shortcut;
				line = this.theme.selectedItem(truncateToWidth(content, width, ""));
			} else {
				// Normal item
				const labelStyled = this.theme.itemLabel(label);
				const shortcutStyled = shortcut ? this.theme.shortcut(shortcut) : "";
				line = prefix + labelStyled + spacing + shortcutStyled;
				line = truncateToWidth(line, width, "");
			}

			lines.push(line);
		}

		// Add scroll indicator if needed
		if (this.filteredItems.length > this.maxVisible) {
			const scrollText = `  (${this.selectedIndex + 1}/${this.filteredItems.length})`;
			lines.push(this.theme.scrollInfo(scrollText));
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
	return {
		modal: {
			border: (text) => theme.fg("dim", text),
			background: (text) => theme.bgHex("#141414", text),
			title: (text) => theme.bold(text),
			closeHint: (text) => theme.fg("muted", text),
			separator: (text) => theme.fg("dim", text),
		},
		sectionHeader: (text) => theme.fg("accent", text),
		selectedItem: (text) => theme.bg("toolPendingBg", theme.bold(text)),
		itemLabel: (text) => text,
		itemDescription: (text) => theme.fg("muted", text),
		shortcut: (text) => theme.fg("dim", text),
		noResults: (text) => theme.fg("muted", text),
		scrollInfo: (text) => theme.fg("dim", text),
	};
}
