import { Container, type SelectItem, SelectList, Spacer, Text } from "@ank1015/agents-tui";
import { getSelectListTheme, theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";

/**
 * Component that renders a thinking level selector with borders
 */
export class ThinkingSelectorComponent extends Container {
	private selectList: SelectList;

	constructor(currentValue: 'low' | 'high' | undefined, onSelect: (level: 'low' | 'high') => void, onCancel: () => void) {
		super();

		const items: SelectItem[] = [
			{ value: "low", label: "Low", description: "Less effort/thoughts, faster response" },
			{ value: "high", label: "High", description: "More effort/thoughts, higher quality" },
		];

		// Add header
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.bold("Select Thinking Level"), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));

		// Create selector
		this.selectList = new SelectList(items, 5, getSelectListTheme());

		// Preselect current value
		if (currentValue === "high") {
			this.selectList.setSelectedIndex(1);
		} else {
			this.selectList.setSelectedIndex(0);
		}

		this.selectList.onSelect = (item) => {
			onSelect(item.value as 'low' | 'high');
		};

		this.selectList.onCancel = () => {
			onCancel();
		};

		this.addChild(this.selectList);

		// Add bottom border
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
	}

	getSelectList(): SelectList {
		return this.selectList;
	}
}
