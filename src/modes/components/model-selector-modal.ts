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
	padToWidth,
	truncateToWidth,
	visibleWidth,
} from "@ank1015/agents-tui";
import type { Api, Model } from "@ank1015/providers";
import { fuzzyFilter } from "../../utils/fuzzy.js";
import { theme } from "../theme/theme.js";

/**
 * Theme for model selector modal styling
 */
export interface ModelSelectorModalTheme {
	modal: ModalTheme;
	selectedItem: (text: string) => string;
	modelId: (text: string) => string;
	provider: (text: string) => string;
	noResults: (text: string) => string;
	scrollInfo: (text: string) => string;
	placeholder: (text: string) => string;
}

/**
 * Internal list component for rendering model items
 */
class ModelListModal implements Component {
	private allModels: Model<Api>[] = [];
	private filteredModels: Model<Api>[] = [];
	private selectedIndex: number = 0;
	private searchInput: Input;
	private maxVisible: number = 6;
	private theme: ModelSelectorModalTheme;

	public onSelect?: (model: Model<Api>) => void;
	public onCancel?: () => void;

	constructor(models: Model<Api>[], modalTheme: ModelSelectorModalTheme) {
		this.allModels = models;
		this.filteredModels = models;
		this.theme = modalTheme;
		this.searchInput = new Input({
			prompt: "",
			placeholder: "Search models",
			placeholderStyle: modalTheme.placeholder,
		});

		this.searchInput.onSubmit = () => {
			const selected = this.filteredModels[this.selectedIndex];
			if (selected && this.onSelect) {
				this.onSelect(selected);
			}
		};
	}

	private filterModels(query: string): void {
		if (!query.trim()) {
			this.filteredModels = this.allModels;
		} else {
			this.filteredModels = fuzzyFilter(
				this.allModels,
				query,
				(model) => `${model.api} ${model.id}`
			);
		}
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredModels.length - 1));
	}

	invalidate(): void {}

	render(width: number): string[] {
		const lines: string[] = [];

		// Render search input
		const inputLines = this.searchInput.render(width);
		lines.push(...inputLines);
		lines.push(""); // Blank line after search

		if (this.filteredModels.length === 0) {
			lines.push(this.theme.noResults("  No models found"));
			return lines;
		}

		// Calculate visible range with scrolling
		const startIndex = Math.max(
			0,
			Math.min(
				this.selectedIndex - Math.floor(this.maxVisible / 2),
				this.filteredModels.length - this.maxVisible
			)
		);
		const endIndex = Math.min(startIndex + this.maxVisible, this.filteredModels.length);

		// Render visible models
		for (let i = startIndex; i < endIndex; i++) {
			const model = this.filteredModels[i];
			const isSelected = i === this.selectedIndex;

			// Build the item line
			const prefix = "  ";
			const modelId = truncateToWidth(model.id, width - 4, "...");
			const provider = model.api;

			// Calculate spacing between model ID and provider
			const prefixWidth = visibleWidth(prefix);
			const modelIdWidth = visibleWidth(modelId);
			const providerWidth = visibleWidth(provider);
			const minSpacing = 2;
			const usedWidth = prefixWidth + modelIdWidth + minSpacing + providerWidth;
			const extraSpacing = Math.max(0, width - usedWidth);
			const spacing = " ".repeat(minSpacing + extraSpacing);

			let line: string;
			if (isSelected) {
				// Build content and pad to exact width for full background coverage
				const content = prefix + modelId + spacing + provider;
				const exactWidth = padToWidth(content, width);
				line = this.theme.selectedItem(exactWidth);
			} else {
				// Normal item
				const modelIdStyled = this.theme.modelId(modelId);
				const providerStyled = this.theme.provider(provider);
				line = prefix + modelIdStyled + spacing + providerStyled;
			}

			lines.push(line);
		}

		// Add scroll indicator if needed
		if (this.filteredModels.length > this.maxVisible) {
			const scrollText = `  (${this.selectedIndex + 1}/${this.filteredModels.length})`;
			lines.push(this.theme.scrollInfo(scrollText));
		}

		return lines;
	}

	handleInput(keyData: string): void {
		if (isArrowUp(keyData)) {
			this.selectedIndex = this.selectedIndex === 0
				? this.filteredModels.length - 1
				: this.selectedIndex - 1;
		} else if (isArrowDown(keyData)) {
			this.selectedIndex = this.selectedIndex === this.filteredModels.length - 1
				? 0
				: this.selectedIndex + 1;
		} else if (isEnter(keyData)) {
			const selected = this.filteredModels[this.selectedIndex];
			if (selected && this.onSelect) {
				this.onSelect(selected);
			}
		} else if (isEscape(keyData) || isCtrlC(keyData) || isCtrlP(keyData)) {
			this.onCancel?.();
		} else {
			// Forward to search input
			this.searchInput.handleInput(keyData);
			this.filterModels(this.searchInput.getValue());
		}
	}
}

/**
 * Model Selector Modal - a centered overlay for selecting models
 *
 * Usage:
 * ```
 * const modal = new ModelSelectorModal(models, modalTheme);
 * modal.setOnSelect((model) => { handleModelChange(model); });
 * modal.setOnClose(() => { ui.hideModal(); });
 * ui.showModal(modal, { width: 60 });
 * ```
 */
export class ModelSelectorModal extends Modal {
	private modelList: ModelListModal;

	constructor(models: Model<Api>[], modalTheme: ModelSelectorModalTheme) {
		super(modalTheme.modal, {
			title: "Switch Model",
			closeHint: "esc",
			showSeparator: false,
		});

		this.modelList = new ModelListModal(models, modalTheme);
		this.addChild(this.modelList);

		// Wire up model list cancel to modal close
		this.modelList.onCancel = () => {
			this.onClose?.();
		};
	}

	/**
	 * Set callback for when a model is selected
	 */
	setOnSelect(callback: (model: Model<Api>) => void): void {
		this.modelList.onSelect = callback;
	}

	/**
	 * Set callback for when modal should close
	 */
	setOnClose(callback: () => void): void {
		this.onClose = callback;
		this.modelList.onCancel = callback;
	}
}

/**
 * Create a default model selector modal theme based on the app theme
 */
export function getModelSelectorModalTheme(): ModelSelectorModalTheme {
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
		modelId: (text) => text,
		provider: (text) => theme.fg("dim", text),
		noResults: (text) => theme.fg("muted", text),
		scrollInfo: (text) => theme.fg("dim", text),
		placeholder: (text) => theme.fg("muted", text),
	};
}
