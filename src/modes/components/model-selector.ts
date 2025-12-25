import {
	type Component,
	Container,
	Input,
	isArrowDown,
	isArrowUp,
	isCtrlC,
	isEnter,
	isEscape,
	Spacer,
	Text,
	truncateToWidth,
} from "@ank1015/agents-tui";
import type { Api, Model } from "@ank1015/providers";
import { fuzzyFilter } from "../../utils/fuzzy.js";
import { theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";

/**
 * Custom model list component with search
 */
class ModelList implements Component {
	private allModels: Model<Api>[] = [];
	private filteredModels: Model<Api>[] = [];
	private selectedIndex: number = 0;
	private searchInput: Input;
	public onSelect?: (model: Model<Api>) => void;
	public onCancel?: () => void;
	public onExit: () => void = () => {};
	private maxVisible: number = 5;

	constructor(models: Model<Api>[]) {
		this.allModels = models;
		this.filteredModels = models;
		this.searchInput = new Input();

		// Handle Enter in search input
		this.searchInput.onSubmit = () => {
			if (this.filteredModels[this.selectedIndex]) {
				const selected = this.filteredModels[this.selectedIndex];
				if (this.onSelect) {
					this.onSelect(selected);
				}
			}
		};
	}

	private filterModels(query: string): void {
		this.filteredModels = fuzzyFilter(this.allModels, query, (model) => `${model.api} ${model.id}`);
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredModels.length - 1));
	}

	invalidate(): void {
		// No cached state
	}

	render(width: number): string[] {
		const lines: string[] = [];

		// Render search input
		lines.push(...this.searchInput.render(width));
		lines.push(""); // Blank line after search

		if (this.filteredModels.length === 0) {
			lines.push(theme.fg("muted", "  No models found"));
			return lines;
		}

		// Calculate visible range
		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), this.filteredModels.length - this.maxVisible),
		);
		const endIndex = Math.min(startIndex + this.maxVisible, this.filteredModels.length);

		// Render visible models
		for (let i = startIndex; i < endIndex; i++) {
			const model = this.filteredModels[i];
			const isSelected = i === this.selectedIndex;

			// First line: cursor + model ID
			const cursor = isSelected ? theme.fg("accent", "› ") : "  ";
			const maxIdWidth = width - 2;
			const truncatedId = truncateToWidth(model.id, maxIdWidth, "...");
			const idLine = cursor + (isSelected ? theme.bold(truncatedId) : truncatedId);

			// Second line: Provider (dimmed)
			const providerInfo = `  Provider: ${model.api}`;
			const providerLine = theme.fg("dim", truncateToWidth(providerInfo, width, ""));

			lines.push(idLine);
			lines.push(providerLine);
			lines.push(""); // Blank line between items
		}

		// Add scroll indicator
		if (startIndex > 0 || endIndex < this.filteredModels.length) {
			const scrollText = `  (${this.selectedIndex + 1}/${this.filteredModels.length})`;
			const scrollInfo = theme.fg("muted", truncateToWidth(scrollText, width, ""));
			lines.push(scrollInfo);
		}

		return lines;
	}

	handleInput(keyData: string): void {
		if (isArrowUp(keyData)) {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
		} else if (isArrowDown(keyData)) {
			this.selectedIndex = Math.min(this.filteredModels.length - 1, this.selectedIndex + 1);
		} else if (isEnter(keyData)) {
			const selected = this.filteredModels[this.selectedIndex];
			if (selected && this.onSelect) {
				this.onSelect(selected);
			}
		} else if (isEscape(keyData)) {
			if (this.onCancel) {
				this.onCancel();
			}
		} else if (isCtrlC(keyData)) {
			this.onExit();
		} else {
			this.searchInput.handleInput(keyData);
			this.filterModels(this.searchInput.getValue());
		}
	}
}

/**
 * Component that renders a model selector
 */
export class ModelSelectorComponent extends Container {
	private modelList: ModelList;

	constructor(
		models: Model<Api>[],
		onSelect: (model: Model<Api>) => void,
		onCancel: () => void,
		onExit: () => void,
	) {
		super();

		// Add header
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.bold("Select Model"), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));

		// Create model list
		this.modelList = new ModelList(models);
		this.modelList.onSelect = onSelect;
		this.modelList.onCancel = onCancel;
		this.modelList.onExit = onExit;

		this.addChild(this.modelList);

		// Add bottom border
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());

		// Auto-cancel if no models
		if (models.length === 0) {
			setTimeout(() => onCancel(), 100);
		}
	}

	getModelList(): ModelList {
		return this.modelList;
	}
}
