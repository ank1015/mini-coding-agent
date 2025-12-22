import {
	type AutocompleteItem,
	type AutocompleteProvider,
	Container,
	ProcessTerminal,
	Spacer,
	type SlashCommand,
	TUI,
} from "@ank1015/agents-tui";
import { getEditorTheme, initTheme, theme } from "./theme/theme.js";
import { CustomEditor } from "./components/custom-editor.js";
import { ToolExecutionComponent } from "./components/tool-execution.js";
import { DynamicBorder } from "./components/dynamic-border.js";
import { AssistantMessageComponent } from "./components/assistant-message.js";
import { UserMessageComponent } from "./components/user-message.js";
import { WelcomeBox } from "./components/welcome-box.js";
// import { PromptHint } from "./components/prompt-hint.js";
import { MarginWrapper } from "./components/margin-wrapper.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { Autocomplete } from "./components/auto-complete.js";

/**
 * Simple autocomplete provider that handles:
 * - Slash commands: triggered by "/" at start of input
 * - File references: triggered by "@" followed by text (mocked)
 */

// ============================================================================
// Slash Commands
// ============================================================================

const SLASH_COMMANDS: SlashCommand[] = [
	{ name: "/model", description: "Select model (opens selector UI)" },
	{ name: "/export", description: "Export session to HTML file" },
	{ name: "/options", description: "Setup provider options" },
	{ name: "/config", description: "Mini Coding agent setting" },
	{ name: "/copy", description: "Copy last agent message to clipboard" },
	{ name: "/session", description: "Show session info and stats" },
	{ name: "/changelog", description: "Show changelog entries" },
	{ name: "/hotkeys", description: "Show all keyboard shortcuts" },
	{ name: "/branch", description: "Create a new branch from a previous message" },
];
class MockChatApp {
	private tui: TUI;
	private messagesContainer: Container;
	private editor: CustomEditor;
	private hideThinkingBlocks = false;
	private expandToolOutputs = false;
	private toolComponents: ToolExecutionComponent[] = [];
	private toolComponentsMap: Map<string, ToolExecutionComponent> = new Map(); // Map toolCallId -> component
	private messages: any[] = [];
	private currentMessageIndex = 0;
	private isFirstUserMessage = true;

	constructor() {
		// Initialize theme first (required before using any themed components)
		initTheme("custom");

		// Load messages from messages.json
		this.loadMessages();

		// Create the TUI with a real terminal
		const terminal = new ProcessTerminal();
		this.tui = new TUI(terminal);

		// Add welcome box at the top
		this.tui.addChild(new WelcomeBox());
		this.tui.addChild(new Spacer(1));

		// Create the messages container (holds all chat messages)
		this.messagesContainer = new Container();
		this.tui.addChild(this.messagesContainer);

		// Add separator before editor
		this.tui.addChild(new Spacer(1));

		// this.tui.addChild(new DynamicBorder());

		// Create the editor for user input with "> " prefix
		this.editor = new CustomEditor(getEditorTheme());
		this.tui.addChild(new MarginWrapper(this.editor, 2));

		// Set up autocomplete provider for slash commands and @ file references
		const autocompleteProvider = new Autocomplete(SLASH_COMMANDS);
		this.editor.setAutocompleteProvider(autocompleteProvider);

		// Add a footer-like status line
		// this.tui.addChild(new DynamicBorder());

		// Add hint below editor
		// this.tui.addChild(new MarginWrapper(new PromptHint(), 2));
		this.tui.addChild(new Spacer(1));

		// Set up editor callbacks
		this.editor.onSubmit = (text) => this.handleSubmit(text);
		this.editor.onCtrlC = () => this.handleExit();
		this.editor.onCtrlD = () => this.handleExit();
		this.editor.onEscape = () => this.handleExit();
		this.editor.onCtrlT = () => this.toggleThinkingBlocks();
		this.editor.onCtrlO = () => this.toggleToolOutputs();

		// Set focus to editor
		this.tui.setFocus(this.editor);
    }

	/**
	 * Load messages from messages.json
	 */
	private loadMessages(): void {
		try {
			const messagesPath = path.join(process.cwd(), "messages.json");
			const data = fs.readFileSync(messagesPath, "utf-8");
			this.messages = JSON.parse(data);
		} catch (error) {
			console.error("Failed to load messages.json:", error);
			this.messages = [];
		}
	}

	/**
	 * Handle user submitting a message (pressing Enter)
	 * Loads the next message from messages.json and displays it
	 */
	private handleSubmit(text: string): void {
		// Clear the editor
		this.editor.setText("");

		// Check if we have more messages to display
		if (this.currentMessageIndex >= this.messages.length) {
			// No more messages
			return;
		}

		// Get the next message
		const message = this.messages[this.currentMessageIndex];
		this.currentMessageIndex++;

		// Render the message based on its role
		if (message.role === "user") {
			this.renderUserMessage(message);
		} else if (message.role === "assistant") {
			this.renderAssistantMessage(message);
		}

		// Request a re-render
		this.tui.requestRender();
	}

	/**
	 * Render a user message
	 */
	private renderUserMessage(message: any): void {
		// Extract text from content
		const textContent = message.content.find((c: any) => c.type === "text");
		if (textContent) {
			this.messagesContainer.addChild(
				new MarginWrapper(
					new UserMessageComponent(textContent.content, this.isFirstUserMessage),
					2
				)
			);
			this.isFirstUserMessage = false;
		}
	}

	/**
	 * Render an assistant message with tool calls and tool results
	 */
	private renderAssistantMessage(message: any): void {
		// Create assistant message component
		const assistantComponent = new AssistantMessageComponent(message, this.hideThinkingBlocks);
		this.messagesContainer.addChild(new MarginWrapper(assistantComponent, 2));

		// Process content in order to handle both toolCalls and toolResults
		for (const content of message.content) {
			if (content.type === "toolCall") {
				// Create tool execution component
				const toolComponent = new ToolExecutionComponent(
					content.name,
					content.arguments
				);

				// Store the component mapped by its toolCallId for later updates
				this.toolComponentsMap.set(content.toolCallId, toolComponent);

				toolComponent.setExpanded(this.expandToolOutputs);
				this.toolComponents.push(toolComponent);
				this.messagesContainer.addChild(new MarginWrapper(toolComponent, 2));
			} else if (content.type === "toolResult") {
				// Find the corresponding tool component by toolCallId
				const toolComponent = this.toolComponentsMap.get(content.toolCallId);

				if (toolComponent) {
					// Update with the result
					toolComponent.updateResult(
						{
							content: content.content,
							isError: content.isError || false,
						},
						false
					);
				}
			}
		}
	}

	/**
	 * Load mock conversation into the UI
	 */
	// loadMockConversation(): void {
	// 	let isFirstUser = true;

	// 	for (const item of MOCK_CONVERSATION) {
	// 		if (item.type === "user") {
	// 			this.messagesContainer.addChild(new UserMessageComponent(item.text, isFirstUser));
	// 			isFirstUser = false;
	// 		} else if (item.type === "assistant") {
	// 			// Type assertion to match the expected type
	// 			const component = new AssistantMessageComponent(
	// 				item.message as any,
	// 				this.hideThinkingBlocks,
	// 			);
	// 			this.messagesContainer.addChild(component);
	// 		} else if (item.type === "tool") {
	// 			const toolComponent = new ToolExecutionComponent(item.name, item.args);
	// 			toolComponent.updateResult(item.result, false);
	// 			toolComponent.setExpanded(this.expandToolOutputs);
	// 			this.toolComponents.push(toolComponent);
	// 			this.messagesContainer.addChild(toolComponent);
	// 		}
	// 	}
	// }

	/**
	 * Toggle visibility of thinking blocks
	 */
	private toggleThinkingBlocks(): void {
		this.hideThinkingBlocks = !this.hideThinkingBlocks;

		// Update all assistant message components
		for (const child of this.messagesContainer.children) {
			if (child instanceof AssistantMessageComponent) {
				child.setHideThinkingBlock(this.hideThinkingBlocks);
			}
		}

		this.tui.requestRender();
	}

	/**
	 * Toggle expansion of tool outputs
	 */
	private toggleToolOutputs(): void {
		this.expandToolOutputs = !this.expandToolOutputs;

		for (const tool of this.toolComponents) {
			tool.setExpanded(this.expandToolOutputs);
		}

		this.tui.requestRender();
	}

	/**
	 * Handle exit
	 */
	private handleExit(): void {
		this.stop();
		// console.log("\nGoodbye!");
		process.exit(0);
	}

	/**
	 * Start the TUI
	 */
	start(): void {
		this.tui.start();
	}

	/**
	 * Stop the TUI
	 */
	stop(): void {
		this.tui.stop();
	}
}



// ============================================================================
// Main Entry Point
// ============================================================================

export async function cli(): Promise<void> {

	const app = new MockChatApp();

	// Handle process signals
	process.on("SIGINT", () => {
		app.stop();
		console.log("\nGoodbye!");
		process.exit(0);
	});

	process.on("SIGTERM", () => {
		app.stop();
		process.exit(0);
	});

	// Start the app
	app.start();
}

