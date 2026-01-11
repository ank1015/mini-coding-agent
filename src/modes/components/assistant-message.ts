import type { BaseAssistantMessage, Api, TextContent, BaseAssistantEventMessage } from "@ank1015/providers";
import { Container, Markdown, Spacer, Text } from "@ank1015/agents-tui";
import { getMarkdownTheme, theme } from "../theme/theme.js";

// Margin to match editor layout (editorMargin = 4, marginLeft = 2)
const MARGIN_LEFT = "  "; // 2 spaces
const MARGIN_TOTAL = 4; // Total width reduction to match editor

/**
 * Component that renders a complete assistant message
 */
export class AssistantMessageComponent extends Container {
	private contentContainer: Container;
	private hideThinkingBlock: boolean;

	constructor(message?: BaseAssistantMessage<Api>, hideThinkingBlock = false) {
		super();

		this.hideThinkingBlock = hideThinkingBlock;

		// Container for text/thinking content
		this.contentContainer = new Container();
		this.addChild(this.contentContainer);

		if (message) {
			this.updateContent(message);
		}
	}

	setHideThinkingBlock(hide: boolean): void {
		this.hideThinkingBlock = hide;
	}

	updateContent(message: BaseAssistantEventMessage<Api>): void {
		// Clear content container
		this.contentContainer.clear();

		if (
			message.content.length > 0 &&
			message.content.some(
				(c) => (c.type === "response" && c.content.length > 0) || (c.type === "thinking" && c.thinkingText.trim()),
			)
		) {
			this.contentContainer.addChild(new Spacer(1));
		}

		// Render content in order
		for (let i = 0; i < message.content.length; i++) {
			const content = message.content[i];
			if (content.type === "response") {
				// Assistant text messages with no background - trim the text
				// Set paddingY=0 to avoid extra spacing before tool executions
				const textBlocks = content.content.filter(tb => tb.type === 'text');
				let text = ''
				textBlocks.map(block => {
					text += (block.content + '\n')
				})
				this.contentContainer.addChild(new Markdown(text.trim(), 1, 0, getMarkdownTheme()));
			} else if (content.type === "thinking" && content.thinkingText.trim()) {
				// Check if there's text content after this thinking block
				const hasTextAfter = message.content.slice(i + 1).some((c) => c.type === "response" && (c.content[0] as TextContent).content.trim());

				if (this.hideThinkingBlock) {
					// Show static "Thinking..." label when hidden
					this.contentContainer.addChild(new Text(theme.fg("muted", "Thinking..."), 1, 0));
					if (hasTextAfter) {
						this.contentContainer.addChild(new Spacer(1));
					}
				} else {
					// Thinking traces in muted color, italic
					// Use Markdown component with default text style for consistent styling
					this.contentContainer.addChild(
						new Markdown(content.thinkingText.trim(), 1, 0, getMarkdownTheme(), {
							color: (text: string) => theme.fg("muted", text),
							italic: true,
						}),
					);
					this.contentContainer.addChild(new Spacer(1));
				}
			}
		}

		// Check if aborted - show after partial content
		// But only if there are no tool calls (tool execution components will show the error)
		const hasToolCalls = message.content.some((c) => c.type === "toolCall");
		if (!hasToolCalls) {
			if (message.stopReason === "aborted") {
				this.contentContainer.addChild(new Text(theme.fg("error", "\nAborted"), 1, 0));
			} else if (message.stopReason === "error") {
				const errorMsg = message.errorMessage || "Unknown error";
				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(new Text(theme.fg("error", `Error: ${errorMsg}`), 1, 0));
			}
		}
	}

	render(width: number): string[] {
		const lines = super.render(width - MARGIN_TOTAL);
		return lines.map(line => MARGIN_LEFT + line);
	}
}
