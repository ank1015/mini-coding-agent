import type { Component } from "@ank1015/agents-tui";

/**
 * Wrapper component that adds left and right margins to any child component
 */
export class MarginWrapper implements Component {
	private child: Component;
	private marginSize: number;

	constructor(child: Component, marginSize: number = 2) {
		this.child = child;
		this.marginSize = marginSize;
	}

	invalidate(): void {
		this.child.invalidate();
	}

	render(width: number): string[] {
		const margin = " ".repeat(this.marginSize);
		const innerWidth = Math.max(1, width - (this.marginSize * 2));

		// Render child with reduced width
		const childLines = this.child.render(innerWidth);

		// Add margins to each line
		return childLines.map(line => margin + line);
	}
}
