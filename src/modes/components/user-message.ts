import { Container, Markdown, Spacer, visibleWidth } from "@ank1015/agents-tui";
import { getMarkdownTheme, theme } from "../theme/theme.js";

// Margin to match editor layout (editorMargin = 4, marginLeft = 2)
const MARGIN_LEFT = 2;
const MARGIN_TOTAL = 4; // Total width reduction to match editor

/**
 * Component that renders a user message
 */
export class UserMessageComponent extends Container {
	constructor(text: string, isFirst: boolean) {
		super();

		// Add spacer before user message (except first one)
		if (!isFirst) {
			this.addChild(new Spacer(1));
		}
		this.addChild(
			new Markdown(text, 1, 1, getMarkdownTheme(), {
				bgColor: (text: string) => theme.bg("userMessageBg", text),
				color: (text: string) => theme.fg("userMessageText", text),
			}),
		);
	}

	render(width: number): string[] {
		const contentWidth = width - MARGIN_TOTAL;
		const lines = super.render(contentWidth);
		const rightPadding = width - MARGIN_LEFT - contentWidth;

		return lines.map(line => {
			// Add left margin with background
			const leftMargin = theme.bg("background", " ".repeat(MARGIN_LEFT));
			// Add right padding with background to fill full width
			const lineWidth = visibleWidth(line);
			const rightPad = Math.max(0, contentWidth - lineWidth) + rightPadding;
			const rightMargin = theme.bg("background", " ".repeat(rightPad));
			return leftMargin + line + rightMargin;
		});
	}
}
