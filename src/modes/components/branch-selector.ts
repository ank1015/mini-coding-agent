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
import type { BranchInfo } from "../../core/session-tree.js";
import { fuzzyFilter } from "../../utils/fuzzy.js";
import { theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";

/**
 * Custom branch list component with search
 */
class BranchList implements Component {
	private allBranches: BranchInfo[] = [];
	private filteredBranches: BranchInfo[] = [];
	private selectedIndex: number = 0;
	private searchInput: Input;
	public onSelect?: (branchName: string) => void;
	public onCancel?: () => void;
	public onExit: () => void = () => {};
	private maxVisible: number = 5;
	private activeBranch: string;

	constructor(branches: BranchInfo[], activeBranch: string) {
		this.allBranches = branches;
		this.filteredBranches = branches;
		this.activeBranch = activeBranch;
		this.searchInput = new Input();

		// Handle Enter in search input - select current item
		this.searchInput.onSubmit = () => {
			if (this.filteredBranches[this.selectedIndex]) {
				const selected = this.filteredBranches[this.selectedIndex];
				if (this.onSelect) {
					this.onSelect(selected.name);
				}
			}
		};
	}

	private filterBranches(query: string): void {
		this.filteredBranches = fuzzyFilter(this.allBranches, query, (branch) => branch.name);
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredBranches.length - 1));
	}

	invalidate(): void {
		// No cached state to invalidate currently
	}

	render(width: number): string[] {
		const lines: string[] = [];

		// Render search input
		lines.push(...this.searchInput.render(width));
		lines.push(""); // Blank line after search

		if (this.filteredBranches.length === 0) {
			lines.push(theme.fg("muted", "  No branches found"));
			return lines;
		}

		// Format dates
		const formatDate = (date: Date): string => {
			const now = new Date();
			const diffMs = now.getTime() - date.getTime();
			const diffMins = Math.floor(diffMs / 60000);
			const diffHours = Math.floor(diffMs / 3600000);
			const diffDays = Math.floor(diffMs / 86400000);

			if (diffMins < 1) return "just now";
			if (diffMins < 60) return `${diffMins}m ago`;
			if (diffHours < 24) return `${diffHours}h ago`;
			return `${diffDays}d ago`;
		};

		// Calculate visible range with scrolling
		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), this.filteredBranches.length - this.maxVisible),
		);
		const endIndex = Math.min(startIndex + this.maxVisible, this.filteredBranches.length);

		// Render visible branches
		for (let i = startIndex; i < endIndex; i++) {
			const branch = this.filteredBranches[i];
			const isSelected = i === this.selectedIndex;
			const isActive = branch.name === this.activeBranch;

			// First line: cursor + name + status
			const cursor = isSelected ? theme.fg("accent", "› ") : "  ";
			const activeMarker = isActive ? theme.fg("success", " (active)") : "";
			
			const branchName = isSelected ? theme.bold(branch.name) : branch.name;
			const firstLine = cursor + branchName + activeMarker;

			// Second line: metadata
			const modified = formatDate(branch.lastModified);
			const msgCount = `${branch.messageCount} msgs`;
			const created = `created ${formatDate(branch.created)}`;
			const metadata = `  ${msgCount} · last activity ${modified} · ${created}`;
			const metadataLine = theme.fg("dim", truncateToWidth(metadata, width, ""));

			lines.push(firstLine);
			lines.push(metadataLine);
			lines.push(""); // Blank line
		}

		// Add scroll indicator if needed
		if (startIndex > 0 || endIndex < this.filteredBranches.length) {
			const scrollText = `  (${this.selectedIndex + 1}/${this.filteredBranches.length})`;
			const scrollInfo = theme.fg("muted", truncateToWidth(scrollText, width, ""));
			lines.push(scrollInfo);
		}

		return lines;
	}

	handleInput(keyData: string): void {
		// Up arrow
		if (isArrowUp(keyData)) {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
		}
		// Down arrow
		else if (isArrowDown(keyData)) {
			this.selectedIndex = Math.min(this.filteredBranches.length - 1, this.selectedIndex + 1);
		}
		// Enter
		else if (isEnter(keyData)) {
			const selected = this.filteredBranches[this.selectedIndex];
			if (selected && this.onSelect) {
				this.onSelect(selected.name);
			}
		}
		// Escape - cancel
		else if (isEscape(keyData)) {
			if (this.onCancel) {
				this.onCancel();
			}
		}
		// Ctrl+C - exit
		else if (isCtrlC(keyData)) {
			this.onExit();
		}
		// Pass everything else to search input
		else {
			this.searchInput.handleInput(keyData);
			this.filterBranches(this.searchInput.getValue());
		}
	}
}

/**
 * Component that renders a branch selector
 */
export class BranchSelectorComponent extends Container {
	private branchList: BranchList;

	constructor(
		branches: BranchInfo[],
		activeBranch: string,
		onSelect: (branchName: string) => void,
		onCancel: () => void,
		onExit: () => void,
	) {
		super();

		// Add header
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.bold("Select Branch"), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));

		// Create branch list
		this.branchList = new BranchList(branches, activeBranch);
		this.branchList.onSelect = onSelect;
		this.branchList.onCancel = onCancel;
		this.branchList.onExit = onExit;

		this.addChild(this.branchList);

		// Add bottom border
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());

		// Auto-cancel if no branches (shouldn't happen as there is always default)
		if (branches.length === 0) {
			setTimeout(() => onCancel(), 100);
		}
	}

	getBranchList(): BranchList {
		return this.branchList;
	}
}
