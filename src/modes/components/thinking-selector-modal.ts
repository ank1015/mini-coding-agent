import {
	type Component,
	isArrowDown,
	isArrowUp,
	isCtrlC,
	isCtrlP,
	isEnter,
	isEscape,
	Modal,
	type ModalTheme,
	padToWidth,
	visibleWidth,
} from "@ank1015/agents-tui";
import { theme } from "../theme/theme.js";

/**
 * Thinking level option
 */
export type ThinkingLevel = 'low' | 'high';

interface ThinkingOption {
	value: ThinkingLevel;
	label: string;
	description: string;
}

/**
 * Theme for thinking selector modal styling
 */
export interface ThinkingSelectorModalTheme {
	modal: ModalTheme;
	selectedItem: (text: string) => string;
	itemLabel: (text: string) => string;
	itemDescription: (text: string) => string;
}

/**
 * Internal list component for rendering thinking level options
 */
class ThinkingListModal implements Component {
	private options: ThinkingOption[] = [
		{ value: "low", label: "Low", description: "Less effort, faster response" },
		{ value: "high", label: "High", description: "More effort, higher quality" },
	];
	private selectedIndex: number = 0;
	private theme: ThinkingSelectorModalTheme;

	public onSelect?: (level: ThinkingLevel) => void;
	public onCancel?: () => void;

	constructor(currentValue: ThinkingLevel | undefined, modalTheme: ThinkingSelectorModalTheme) {
		this.theme = modalTheme;

		// Preselect current value
		if (currentValue === "high") {
			this.selectedIndex = 1;
		} else {
			this.selectedIndex = 0;
		}
	}

	invalidate(): void {}

	render(width: number): string[] {
		const lines: string[] = [];

		for (let i = 0; i < this.options.length; i++) {
			const option = this.options[i];
			const isSelected = i === this.selectedIndex;

			// Build the item line
			const prefix = "  ";
			const label = option.label;
			const description = option.description;

			// Calculate spacing between label and description
			const prefixWidth = visibleWidth(prefix);
			const labelWidth = visibleWidth(label);
			const descWidth = visibleWidth(description);
			const minSpacing = 3;
			const usedWidth = prefixWidth + labelWidth + minSpacing + descWidth;
			const extraSpacing = Math.max(0, width - usedWidth);
			const spacing = " ".repeat(minSpacing + extraSpacing);

			let line: string;
			if (isSelected) {
				// Build content and pad to exact width for full background coverage
				const content = prefix + label + spacing + description;
				const exactWidth = padToWidth(content, width);
				line = this.theme.selectedItem(exactWidth);
			} else {
				// Normal item
				const labelStyled = this.theme.itemLabel(label);
				const descStyled = this.theme.itemDescription(description);
				line = prefix + labelStyled + spacing + descStyled;
			}

			lines.push(line);

			// Add spacing between items
			if (i < this.options.length - 1) {
				lines.push("");
			}
		}

		return lines;
	}

	handleInput(keyData: string): void {
		if (isArrowUp(keyData)) {
			this.selectedIndex = this.selectedIndex === 0
				? this.options.length - 1
				: this.selectedIndex - 1;
		} else if (isArrowDown(keyData)) {
			this.selectedIndex = this.selectedIndex === this.options.length - 1
				? 0
				: this.selectedIndex + 1;
		} else if (isEnter(keyData)) {
			const selected = this.options[this.selectedIndex];
			if (selected && this.onSelect) {
				this.onSelect(selected.value);
			}
		} else if (isEscape(keyData) || isCtrlC(keyData) || isCtrlP(keyData)) {
			this.onCancel?.();
		}
	}
}

/**
 * Thinking Selector Modal - a centered overlay for selecting thinking level
 *
 * Usage:
 * ```
 * const modal = new ThinkingSelectorModal(currentLevel, modalTheme);
 * modal.setOnSelect((level) => { handleThinkingChange(level); });
 * modal.setOnClose(() => { ui.hideModal(); });
 * ui.showModal(modal, { width: 50 });
 * ```
 */
export class ThinkingSelectorModal extends Modal {
	private thinkingList: ThinkingListModal;

	constructor(currentValue: ThinkingLevel | undefined, modalTheme: ThinkingSelectorModalTheme) {
		super(modalTheme.modal, {
			title: "Thinking Level",
			closeHint: "esc",
			showSeparator: false,
		});

		this.thinkingList = new ThinkingListModal(currentValue, modalTheme);
		this.addChild(this.thinkingList);

		// Wire up list cancel to modal close
		this.thinkingList.onCancel = () => {
			this.onClose?.();
		};
	}

	/**
	 * Set callback for when a thinking level is selected
	 */
	setOnSelect(callback: (level: ThinkingLevel) => void): void {
		this.thinkingList.onSelect = callback;
	}

	/**
	 * Set callback for when modal should close
	 */
	setOnClose(callback: () => void): void {
		this.onClose = callback;
		this.thinkingList.onCancel = callback;
	}
}

/**
 * Create a default thinking selector modal theme based on the app theme
 */
export function getThinkingSelectorModalTheme(): ThinkingSelectorModalTheme {
	return {
		modal: {
			border: (text) => theme.fg("dim", text),
			background: (text) => theme.bgHex("#141414", text),
			title: (text) => theme.bold(text),
			closeHint: (text) => theme.fg("muted", text),
			separator: (text) => theme.fg("dim", text),
		},
		// Selection highlight
		selectedItem: (text) => {
			const mode = theme.getColorMode();
			const bgCode = mode === "truecolor"
				? `\x1b[48;2;250;178;131m`  // #FAB283 in RGB
				: `\x1b[48;5;216m`;          // Closest 256-color
			const fgCode = mode === "truecolor"
				? `\x1b[38;2;20;20;20m`      // #141414 in RGB
				: `\x1b[38;5;234m`;          // Closest 256-color
			const modalBgCode = mode === "truecolor"
				? `\x1b[48;2;20;20;20m`      // #141414 in RGB
				: `\x1b[48;5;234m`;          // Closest 256-color
			const defaultFg = `\x1b[39m`;
			return `${bgCode}${fgCode}${text}${modalBgCode}${defaultFg}`;
		},
		itemLabel: (text) => text,
		itemDescription: (text) => theme.fg("muted", text),
	};
}
