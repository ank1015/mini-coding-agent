import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "child_process";
import {
	CombinedAutocompleteProvider,
	type Component,
	Container,
	getCapabilities,
	Loader,
	Markdown,
	ProcessTerminal,
	SlashCommand,
	Spacer,
	Text,
	TruncatedText,
	TUI,
	visibleWidth,
} from "@ank1015/agents-tui";
import { AgentSession, AgentSessionEvent } from "../core/agent-session.js";
import { discoverAvailableModels } from "../core/sdk.js";
import { CustomEditor } from "./components/custom-editor.js";
import { FooterComponent } from "./components/footer.js";
import { AssistantMessageComponent } from "./components/assistant-message.js";
import { ToolExecutionComponent } from "./components/tool-execution.js";
import { getEditorTheme, getMarkdownTheme, onThemeChange, theme } from "./theme/theme.js";
import { APP_NAME, getDebugLogPath } from "../config.js";
import { AgentState, Api, BaseAssistantEvent, BaseAssistantMessage, Message } from "@ank1015/providers";
import { UserMessageComponent } from "./components/user-message.js";
import { DynamicBorder } from "./components/dynamic-border.js";
import { SessionManager } from "../core/session-manager.js";
import { QueueModeSelectorComponent } from "./components/queue-mode-selector.js";
import { SessionSelectorComponent } from "./components/session-selector.js";
import { MessageSelectorComponent } from "./components/message-selector.js";
import { ModelSelectorComponent } from "./components/model-selector.js";
import { ShowImagesSelectorComponent } from "./components/show-images-selector.js";
import { WelcomeBox } from "./components/welcome-box.js";
import { Model } from "@ank1015/providers";

export class InteractiveMode {
    private session: AgentSession;
	private ui: TUI;
	private chatContainer: Container;
	private pendingMessagesContainer: Container;
	private statusContainer: Container;
	private editor: CustomEditor;
	private editorContainer: Container;
	private footer: FooterComponent;
	private version: string;
	private isInitialized = false;
	private onInputCallback?: (text: string) => void;
	private loadingAnimation: Loader | null = null;

	private lastSigintTime = 0;
	private lastEscapeTime = 0;

	// Streaming message tracking
	private streamingComponent: AssistantMessageComponent | null = null;

	// Tool execution tracking: toolCallId -> component
	private pendingTools = new Map<string, ToolExecutionComponent>();

	// Track if this is the first user message (to skip spacer)
	private isFirstUserMessage = true;

	// Tool output expansion state
	private toolOutputExpanded = false;

	// Thinking block visibility state
	private hideThinkingBlock = false;

	// Agent subscription unsubscribe function
	private unsubscribe?: () => void;

	// Convenience accessors
	private get agent() {
		return this.session.agent;
	}
	private get sessionManager() {
		return this.session.sessionManager;
	}
	private get settingsManager() {
		return this.session.settingsManager;
	}

    constructor(
		session: AgentSession,
		version: string,
		fdPath: string | null = null,
	) {
		this.session = session;
		this.version = version;
		this.ui = new TUI(new ProcessTerminal());
		this.chatContainer = new Container();
		this.pendingMessagesContainer = new Container();
		this.statusContainer = new Container();
		this.editor = new CustomEditor(getEditorTheme());
		this.editorContainer = new Container();
		this.editorContainer.addChild(this.editor);
		this.footer = new FooterComponent(session.state);

		// Define slash commands for autocomplete
		const slashCommands: SlashCommand[] = [
			{ name: "export", description: "Export session to HTML file" },
			{ name: "session", description: "Show session info and stats" },
			{ name: "hotkeys", description: "Show all keyboard shortcuts" },
			{ name: "branch", description: "Create a new branch from a previous message" },
			{ name: "queue", description: "Select message queue mode (opens selector UI)" },
			{ name: "clear", description: "Clear context and start a fresh session" },
			{ name: "resume", description: "Resume a different session" },
			{ name: "model", description: "Switch model (branches session if API changes)" },
		];

		// Add image toggle command only if terminal supports images
		if (getCapabilities().images) {
			slashCommands.push({ name: "show-images", description: "Toggle inline image display" });
		}

		// Setup autocomplete
		const autocompleteProvider = new CombinedAutocompleteProvider(
			[...slashCommands,],
			process.cwd(),
			fdPath,
		);
		this.editor.setAutocompleteProvider(autocompleteProvider);
    }

	async init(): Promise<void> {
		if (this.isInitialized) return;

		// Add header
		const logo = theme.bold(theme.fg("accent", APP_NAME)) + theme.fg("dim", ` v${this.version}`);
		const instructions =
			theme.fg("dim", "esc") +
			theme.fg("muted", " to interrupt") +
			"\n" +
			theme.fg("dim", "ctrl+c") +
			theme.fg("muted", " to clear") +
			"\n" +
			theme.fg("dim", "ctrl+c twice") +
			theme.fg("muted", " to exit") +
			"\n" +
			theme.fg("dim", "ctrl+d") +
			theme.fg("muted", " to exit (empty)") +
			"\n" +
			theme.fg("dim", "ctrl+z") +
			theme.fg("muted", " to suspend") +
			"\n" +
			theme.fg("dim", "ctrl+k") +
			theme.fg("muted", " to delete line") +
			"\n" +
			theme.fg("dim", "ctrl+o") +
			theme.fg("muted", " to expand tools") +
			"\n" +
			theme.fg("dim", "ctrl+g") +
			theme.fg("muted", " for external editor") +
			"\n" +
			theme.fg("dim", "/") +
			theme.fg("muted", " for commands") +
			"\n" +
			theme.fg("dim", "drop files") +
			theme.fg("muted", " to attach");
		const header = new Text(`${logo}\n${instructions}`, 1, 0);

		this.ui.addChild(new WelcomeBox())

		// Setup UI layout
		this.ui.addChild(new Spacer(1));
		this.ui.addChild(header);
		this.ui.addChild(new Spacer(1));

		this.ui.addChild(this.chatContainer);
		this.ui.addChild(this.pendingMessagesContainer);
		this.ui.addChild(this.statusContainer);
		this.ui.addChild(new Spacer(1));
		this.ui.addChild(this.editorContainer);
		this.ui.addChild(this.footer);
		this.ui.setFocus(this.editor);

		this.setupKeyHandlers();
		this.setupEditorSubmitHandler();

		// Start the UI
		this.ui.start();
		this.isInitialized = true;


		// Subscribe to agent events
		this.subscribeToAgent();

		// Set up theme file watcher
		onThemeChange(() => {
			this.ui.invalidate();
			this.updateEditorBorderColor();
			this.ui.requestRender();
		});

		// Set up git branch watcher
		this.footer.watchBranch(() => {
			this.ui.requestRender();
		});
	}

	// =========================================================================
	// Key Handlers
	// =========================================================================

    private setupKeyHandlers(): void {
		this.editor.onEscape = () => {
			if (this.loadingAnimation) {
				// Abort and restore queued messages to editor
				const queuedMessages = this.session.clearQueue();
				const queuedText = queuedMessages.join("\n\n");
				const currentText = this.editor.getText();
				const combinedText = [queuedText, currentText].filter((t) => t.trim()).join("\n\n");
				this.editor.setText(combinedText);
				this.updatePendingMessagesDisplay();
				this.agent.abort();
			}
		};

		this.editor.onCtrlC = () => this.handleCtrlC();
		this.editor.onCtrlD = () => this.handleCtrlD();
		this.editor.onCtrlZ = () => this.handleCtrlZ();
		this.editor.onCtrlO = () => this.toggleToolOutputExpansion();
		this.editor.onCtrlG = () => this.openExternalEditor();

	}

    private setupEditorSubmitHandler(): void {
		this.editor.onSubmit = async (text: string) => {
			text = text.trim();
			if (!text) return;

			if (text.startsWith("/export")) {
				this.handleExportCommand(text);
				this.editor.setText("");
				return;
			}
			if (text === "/session") {
				this.handleSessionCommand();
				this.editor.setText("");
				return;
			}
			if (text === "/hotkeys") {
				this.handleHotkeysCommand();
				this.editor.setText("");
				return;
			}
			if (text === "/branch") {
				this.showBranchSelector();
				this.editor.setText("");
				return;
			}
			if (text === "/queue") {
				this.showQueueModeSelector();
				this.editor.setText("");
				return;
			}
			if (text === "/clear") {
				this.editor.setText("");
				await this.handleClearCommand();
				return;
			}
			if (text === "/show-images") {
				this.showShowImagesSelector();
				this.editor.setText("");
				return;
			}
			if (text === "/debug") {
				this.handleDebugCommand();
				this.editor.setText("");
				return;
			}
			if (text === "/resume") {
				this.showSessionSelector();
				this.editor.setText("");
				return;
			}
			if (text === "/model") {
				this.showModelSelector();
				this.editor.setText("");
				return;
			}

			// Queue message if agent is streaming
			if (this.session.isStreaming) {
				await this.session.queueMessage(text);
				this.updatePendingMessagesDisplay();
				this.editor.addToHistory(text);
				this.editor.setText("");
				this.ui.requestRender();
				return;
			}


			if (this.onInputCallback) {
				this.onInputCallback(text);
			}
			this.editor.addToHistory(text);
		};
	}

    private subscribeToAgent(): void {
		this.unsubscribe = this.session.subscribe(async (event) => {
			await this.handleEvent(event, this.session.state);
		});
	}

	private async handleEvent(event: AgentSessionEvent, state: AgentState): Promise<void> {
		if (!this.isInitialized) {
			await this.init();
		}
		try {
			this.footer.updateState(state);

			switch (event.type) {
				case "agent_start":
					if (this.loadingAnimation) {
						this.loadingAnimation.stop();
					}
					this.statusContainer.clear();
					this.loadingAnimation = new Loader(
						this.ui,
						(spinner) => theme.fg("accent", spinner),
						(text) => theme.fg("muted", text),
						"Working... (esc to interrupt)",
					);
					this.statusContainer.addChild(this.loadingAnimation);
					this.ui.requestRender();
					break;
	
				case "message_start":
					if (event.message.role === "user") {
						this.addMessageToChat(event.message);
						this.editor.setText("");
						this.updatePendingMessagesDisplay();
						this.ui.requestRender();
					} else if (event.message.role === "assistant") {
						this.streamingComponent = new AssistantMessageComponent(undefined, this.hideThinkingBlock);
						this.chatContainer.addChild(this.streamingComponent);
						this.streamingComponent.updateContent(event.message as BaseAssistantMessage<Api>);
						this.ui.requestRender();
					}
					break;
	
				case "message_update":
					if (this.streamingComponent && event.messageType === "assistant") {
						const assistantMsg = event.message as BaseAssistantEvent<Api>;
						this.streamingComponent.updateContent(assistantMsg.message);
	
						for (const content of assistantMsg.message.content) {
							if (content.type === "toolCall") {
								if (!this.pendingTools.has(content.toolCallId)) {
									this.chatContainer.addChild(new Text("", 0, 0));
									const component = new ToolExecutionComponent(
										content.name,
										content.arguments,
										{
											showImages: this.settingsManager.getShowImages(),
										},
										this.ui,
									);
									this.chatContainer.addChild(component);
									this.pendingTools.set(content.toolCallId, component);
								} else {
									const component = this.pendingTools.get(content.toolCallId);
									if (component) {
										component.updateArgs(content.arguments);
									}
								}
							}
						}
						this.ui.requestRender();
					}
					break;
	
				case "message_end":
					if (event.message.role === "user") break;
					if (this.streamingComponent && event.message.role === "assistant") {
						const assistantMsg = event.message as BaseAssistantMessage<Api>;
						this.streamingComponent.updateContent(assistantMsg);
	
						if (assistantMsg.stopReason === "aborted" || assistantMsg.stopReason === "error") {
							const errorMessage =
								assistantMsg.stopReason === "aborted" ? "Operation aborted" : assistantMsg.errorMessage || "Error";
							for (const [, component] of this.pendingTools.entries()) {
								component.updateResult({
									content: [{ type: "text", content: errorMessage }],
									isError: true,
								});
							}
							this.pendingTools.clear();
						}
						this.streamingComponent = null;
						this.footer.invalidate();
					}
					this.ui.requestRender();
					break;
	
				case "tool_execution_start": {
					if (!this.pendingTools.has(event.toolCallId)) {
						const component = new ToolExecutionComponent(
							event.toolName,
							event.args,
							{
								showImages: this.settingsManager.getShowImages(),
							},
							this.ui,
						);
						this.chatContainer.addChild(component);
						this.pendingTools.set(event.toolCallId, component);
						this.ui.requestRender();
					}
					break;
				}
	
				case "tool_execution_update": {
					const component = this.pendingTools.get(event.toolCallId);
					if (component) {
						component.updateResult({ ...event.partialResult, isError: false }, true);
						this.ui.requestRender();
					}
					break;
				}
	
				case "tool_execution_end": {
					const component = this.pendingTools.get(event.toolCallId);
					if (component) {
						component.updateResult({ ...event.result, isError: event.isError });
						this.pendingTools.delete(event.toolCallId);
						this.ui.requestRender();
					}
					break;
				}
	
				case "agent_end":
					if (this.loadingAnimation) {
						this.loadingAnimation.stop();
						this.loadingAnimation = null;
						this.statusContainer.clear();
					}
					if (this.streamingComponent) {
						this.chatContainer.removeChild(this.streamingComponent);
						this.streamingComponent = null;
					}
					this.pendingTools.clear();
					this.ui.requestRender();
					break;
			}
		}catch(error){
			this.showError(`Internal error: ${error instanceof Error ? error.message : 'Unknown'}`);
		}
	}

	/** Extract text content from a user message */
	private getUserMessageText(message: Message): string {
		if (message.role !== "user") return "";
		const textBlocks = message.content.filter((c) => c.type === "text");
		return textBlocks.map((c) => c.content).join("");
	}

	/** Show a status message in the chat */
	private showStatus(message: string): void {
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(theme.fg("dim", message), 1, 0));
		this.ui.requestRender();
	}

	private addMessageToChat(message: Message ): void {
		if (message.role === "user") {
			const textContent = this.getUserMessageText(message);
			if (textContent) {
				const userComponent = new UserMessageComponent(textContent, this.isFirstUserMessage);
				this.chatContainer.addChild(userComponent);
				this.isFirstUserMessage = false;
			}
		} else if (message.role === "assistant") {
			const assistantComponent = new AssistantMessageComponent(message as BaseAssistantMessage<Api>, this.hideThinkingBlock);
			this.chatContainer.addChild(assistantComponent);
		}
	}

	/**
	 * Render messages to chat. Used for initial load.
	 * @param messages Messages to render
	 * @param options.updateFooter Update footer state
	 * @param options.populateHistory Add user messages to editor history
	 */
	private renderMessages(
		messages: readonly (Message)[],
		options: { updateFooter?: boolean; populateHistory?: boolean } = {},
	): void {

		this.isFirstUserMessage = true;
		this.pendingTools.clear();

		if (options.updateFooter) {
			this.footer.updateState(this.session.state);
			this.updateEditorBorderColor();
		}

		for (const message of messages) {

			if (message.role === "user") {
				const textContent = this.getUserMessageText(message);
				if (textContent) {
					const userComponent = new UserMessageComponent(textContent, this.isFirstUserMessage);
					this.chatContainer.addChild(userComponent);
					this.isFirstUserMessage = false;
					if (options.populateHistory) {
						this.editor.addToHistory(textContent);
					}
				}
			} else if (message.role === "assistant") {
				const assistantMsg = message as BaseAssistantMessage<Api>;
				const assistantComponent = new AssistantMessageComponent(assistantMsg, this.hideThinkingBlock);
				this.chatContainer.addChild(assistantComponent);

				for (const content of assistantMsg.content) {
					if (content.type === "toolCall") {
						const component = new ToolExecutionComponent(
							content.name,
							content.arguments,
							{
								showImages: this.settingsManager.getShowImages(),
							},
							this.ui,
						);
						this.chatContainer.addChild(component);

						if (assistantMsg.stopReason === "aborted" || assistantMsg.stopReason === "error") {
							const errorMessage =
								assistantMsg.stopReason === "aborted"
									? "Operation aborted"
									: assistantMsg.errorMessage || "Error";
							component.updateResult({ content: [{ type: "text", content: errorMessage }], isError: true });
						} else {
							this.pendingTools.set(content.toolCallId, component);
						}
					}
				}
			} else if (message.role === "toolResult") {
				const component = this.pendingTools.get(message.toolCallId);
				if (component) {
					component.updateResult(message);
					this.pendingTools.delete(message.toolCallId);
				}
			}
		}
		this.pendingTools.clear();
		this.ui.requestRender();
	}

	renderInitialMessages(state: AgentState): void {
		this.renderMessages(state.messages, { updateFooter: true, populateHistory: true });
	}

	async getUserInput(): Promise<string> {
		return new Promise((resolve) => {
			this.onInputCallback = (text: string) => {
				this.onInputCallback = undefined;
				resolve(text);
			};
		});
	}

	private rebuildChatFromMessages(): void {
		this.renderMessages(this.session.messages);
	}

	// =========================================================================
	// Key handlers
	// =========================================================================

	private handleCtrlC(): void {
		const now = Date.now();
		if (now - this.lastSigintTime < 500) {
			void this.shutdown();
		} else {
			this.clearEditor();
			this.lastSigintTime = now;
		}
	}

	private handleCtrlD(): void {
		// Only called when editor is empty (enforced by CustomEditor)
		void this.shutdown();
	}

	/**
	 * Gracefully shutdown the agent.
	 * Emits shutdown event to hooks, then exits.
	 */
	private async shutdown(): Promise<void> {
		this.stop();
		process.exit(0);
	}

	private handleCtrlZ(): void {
		// Set up handler to restore TUI when resumed
		process.once("SIGCONT", () => {
			this.ui.start();
			this.ui.requestRender();
		});

		// Stop the TUI (restore terminal to normal mode)
		this.ui.stop();

		// Send SIGTSTP to process group (pid=0 means all processes in group)
		process.kill(0, "SIGTSTP");
	}

	private updateEditorBorderColor(): void {
		this.ui.requestRender();
	}

	private toggleToolOutputExpansion(): void {
		this.toolOutputExpanded = !this.toolOutputExpanded;
		for (const child of this.chatContainer.children) {
			if (child instanceof ToolExecutionComponent) {
				child.setExpanded(this.toolOutputExpanded);
			}
		}
		this.ui.requestRender();
	}

	private openExternalEditor(): void {
		// Determine editor (respect $VISUAL, then $EDITOR)
		const editorCmd = process.env.VISUAL || process.env.EDITOR;
		if (!editorCmd) {
			this.showWarning("No editor configured. Set $VISUAL or $EDITOR environment variable.");
			return;
		}

		const currentText = this.editor.getText();
		const tmpFile = path.join(os.tmpdir(), `mini-editor-${Date.now()}.mini.md`);

		try {
			// Write current content to temp file
			fs.writeFileSync(tmpFile, currentText, "utf-8");

			// Stop TUI to release terminal
			this.ui.stop();

			// Split by space to support editor arguments (e.g., "code --wait")
			const [editor, ...editorArgs] = editorCmd.split(" ");

			// Spawn editor synchronously with inherited stdio for interactive editing
			const result = spawnSync(editor, [...editorArgs, tmpFile], {
				stdio: "inherit",
			});

			// On successful exit (status 0), replace editor content
			if (result.status === 0) {
				const newContent = fs.readFileSync(tmpFile, "utf-8").replace(/\n$/, "");
				this.editor.setText(newContent);
			}
			// On non-zero exit, keep original text (no action needed)
		} finally {
			// Clean up temp file
			try {
				fs.unlinkSync(tmpFile);
			} catch {
				// Ignore cleanup errors
			}

			// Restart TUI
			this.ui.start();
			this.ui.requestRender();
		}
	}

	// =========================================================================
	// UI helpers
	// =========================================================================

	clearEditor(): void {
		this.editor.setText("");
		this.ui.requestRender();
	}

	showError(errorMessage: string): void {
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(theme.fg("error", `Error: ${errorMessage}`), 1, 0));
		this.ui.requestRender();
	}

	showWarning(warningMessage: string): void {
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(theme.fg("warning", `Warning: ${warningMessage}`), 1, 0));
		this.ui.requestRender();
	}

	private updatePendingMessagesDisplay(): void {
		this.pendingMessagesContainer.clear();
		const queuedMessages = this.session.getQueuedMessages();
		if (queuedMessages.length > 0) {
			this.pendingMessagesContainer.addChild(new Spacer(1));
			for (const message of queuedMessages) {
				const queuedText = theme.fg("dim", `Queued: ${message}`);
				this.pendingMessagesContainer.addChild(new TruncatedText(queuedText, 1, 0));
			}
		}
	}

	// =========================================================================
	// Selectors
	// =========================================================================

	/**
	 * Shows a selector component in place of the editor.
	 * @param create Factory that receives a `done` callback and returns the component and focus target
	 */
	private showSelector(create: (done: () => void) => { component: Component; focus: Component }): void {
		const done = () => {
			this.editorContainer.clear();
			this.editorContainer.addChild(this.editor);
			this.ui.setFocus(this.editor);
		};
		const { component, focus } = create(done);
		this.editorContainer.clear();
		this.editorContainer.addChild(component);
		this.ui.setFocus(focus);
		this.ui.requestRender();
	}

	private showBranchSelector(): void {
		this.showSelector((done) => {
			const selector = new MessageSelectorComponent(
				this.session.messages,
				async (messageId) => {
					done();
					await this.handleBranchSession(messageId);
				},
				() => {
					done();
					this.ui.requestRender();
				},
				() => {
					void this.shutdown();
				},
			);
			return { component: selector, focus: selector.getMessageList() };
		});
	}

	private async handleBranchSession(messageId: string): Promise<void> {
		// Stop loading animation
		if (this.loadingAnimation) {
			this.loadingAnimation.stop();
			this.loadingAnimation = null;
		}
		this.statusContainer.clear();

		// Branch session via AgentSession (emits hook and tool session events)
		const newSessionPath = this.session.branchSession(messageId);

		// Clear UI state
		this.pendingMessagesContainer.clear();
		this.streamingComponent = null;
		this.pendingTools.clear();

		// Switch session via AgentSession (emits hook and tool session events)
		await this.session.switchSession(newSessionPath);

		// Clear and re-render the chat
		this.chatContainer.clear();
		this.ui.fullRefresh();

		this.isFirstUserMessage = true;
		this.renderInitialMessages(this.session.state);
		this.showStatus("Branched session");
	}

	private showQueueModeSelector(): void {
		this.showSelector((done) => {
			const selector = new QueueModeSelectorComponent(
				this.session.queueMode,
				(mode) => {
					this.session.setQueueMode(mode);
					done();
					this.showStatus(`Queue mode: ${mode}`);
				},
				() => {
					done();
					this.ui.requestRender();
				},
			);
			return { component: selector, focus: selector.getSelectList() };
		});
	}

	private showSessionSelector(): void {
		this.showSelector((done) => {
			const sessions = SessionManager.list(this.sessionManager.getCwd());
			const selector = new SessionSelectorComponent(
				sessions,
				async (sessionPath) => {
					done();
					await this.handleResumeSession(sessionPath);
				},
				() => {
					done();
					this.ui.requestRender();
				},
				() => {
					void this.shutdown();
				},
			);
			return { component: selector, focus: selector.getSessionList() };
		});
	}

	private showModelSelector(): void {
		const models = discoverAvailableModels();
		this.showSelector((done) => {
			const selector = new ModelSelectorComponent(
				models,
				async (model) => {
					done();
					await this.handleModelChange(model);
				},
				() => {
					done();
					this.ui.requestRender();
				},
				() => {
					void this.shutdown();
				},
			);
			return { component: selector, focus: selector.getModelList() };
		});
	}

	private async handleModelChange(model: Model<Api>): Promise<void> {
		const oldSessionId = this.session.sessionId;
		
		try {
			await this.session.smartChangeModel(model);
			
			const newSessionId = this.session.sessionId;
			const branched = oldSessionId !== newSessionId;
			
			if (branched) {
				// Clear UI state as we have a new session (even if content is same)
				this.pendingMessagesContainer.clear();
				this.streamingComponent = null;
				this.pendingTools.clear();
				this.isFirstUserMessage = true; // Reset spacers
				
				// Re-render chat
				this.chatContainer.clear();
				this.ui.fullRefresh();
				this.renderInitialMessages(this.session.state);
				
				this.showStatus(`Branched to new session for ${model.api}`);
			} else {
				this.showStatus(`Switched to ${model.id}`);
			}
			
			// Update footer to show new model
			this.footer.updateState(this.session.state);
			this.ui.requestRender();
			
		} catch (error) {
			this.showError(`Failed to change model: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	}

	private async handleResumeSession(sessionPath: string): Promise<void> {

		// Stop loading animation
		if (this.loadingAnimation) {
			this.loadingAnimation.stop();
			this.loadingAnimation = null;
		}
		this.statusContainer.clear();

		// Clear UI state
		this.pendingMessagesContainer.clear();
		this.streamingComponent = null;
		this.pendingTools.clear();

		// Switch session via AgentSession (emits hook and tool session events)
		await this.session.switchSession(sessionPath);

		// Clear and re-render the chat
		this.chatContainer.clear();
		this.ui.fullRefresh();


		this.isFirstUserMessage = true;
		this.renderInitialMessages(this.session.state);

		this.showStatus("Resumed session");
	}

	// =========================================================================
	// Command handlers
	// =========================================================================

	private handleExportCommand(text: string): void {
		const parts = text.split(/\s+/);
		const outputPath = parts.length > 1 ? parts[1] : undefined;

		try {
			const filePath = this.session.exportToHtml(outputPath);
			this.showStatus(`Session exported to: ${filePath}`);
		} catch (error: unknown) {
			this.showError(`Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	}

	private handleSessionCommand(): void {
		const stats = this.session.getSessionStats();

		let info = `${theme.bold("Session Info")}\n\n`;
		info += `${theme.fg("dim", "File:")} ${stats.sessionFile}\n`;
		info += `${theme.fg("dim", "ID:")} ${stats.sessionId}\n\n`;
		info += `${theme.bold("Messages")}\n`;
		info += `${theme.fg("dim", "User:")} ${stats.userMessages}\n`;
		info += `${theme.fg("dim", "Assistant:")} ${stats.assistantMessages}\n`;
		info += `${theme.fg("dim", "Tool Calls:")} ${stats.toolCalls}\n`;
		info += `${theme.fg("dim", "Tool Results:")} ${stats.toolResults}\n`;
		info += `${theme.fg("dim", "Total:")} ${stats.totalMessages}\n\n`;
		info += `${theme.bold("Tokens")}\n`;
		info += `${theme.fg("dim", "Input:")} ${stats.tokens.input.toLocaleString()}\n`;
		info += `${theme.fg("dim", "Output:")} ${stats.tokens.output.toLocaleString()}\n`;
		if (stats.tokens.cacheRead > 0) {
			info += `${theme.fg("dim", "Cache Read:")} ${stats.tokens.cacheRead.toLocaleString()}\n`;
		}
		if (stats.tokens.cacheWrite > 0) {
			info += `${theme.fg("dim", "Cache Write:")} ${stats.tokens.cacheWrite.toLocaleString()}\n`;
		}
		info += `${theme.fg("dim", "Total:")} ${stats.tokens.total.toLocaleString()}\n`;

		if (stats.cost > 0) {
			info += `\n${theme.bold("Cost")}\n`;
			info += `${theme.fg("dim", "Total:")} ${stats.cost.toFixed(4)}`;
		}

		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(info, 1, 0));
		this.ui.requestRender();
	}

	private handleHotkeysCommand(): void {
		const hotkeys = `
**Navigation**
| Key | Action |
|-----|--------|
| \`Arrow keys\` | Move cursor / browse history (Up when empty) |
| \`Option+Left/Right\` | Move by word |
| \`Ctrl+A\` / \`Home\` / \`Cmd+Left\` | Start of line |
| \`Ctrl+E\` / \`End\` / \`Cmd+Right\` | End of line |

**Editing**
| Key | Action |
|-----|--------|
| \`Enter\` | Send message |
| \`Shift+Enter\` / \`Alt+Enter\` | New line |
| \`Ctrl+W\` / \`Option+Backspace\` | Delete word backwards |
| \`Ctrl+U\` | Delete to start of line |
| \`Ctrl+K\` | Delete to end of line |

**Other**
| Key | Action |
|-----|--------|
| \`Tab\` | Path completion / accept autocomplete |
| \`Escape\` | Cancel autocomplete / abort streaming |
| \`Ctrl+C\` | Clear editor (first) / exit (second) |
| \`Ctrl+D\` | Exit (when editor is empty) |
| \`Ctrl+Z\` | Suspend to background |
| \`Ctrl+O\` | Toggle tool output expansion |
| \`Ctrl+G\` | Edit message in external editor |
| \`/\` | Slash commands |
`;
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new DynamicBorder());
		this.chatContainer.addChild(new Text(theme.bold(theme.fg("accent", "Keyboard Shortcuts")), 1, 0));
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Markdown(hotkeys.trim(), 1, 1, getMarkdownTheme()));
		this.chatContainer.addChild(new DynamicBorder());
		this.ui.requestRender();
	}

    private async handleClearCommand(): Promise<void> {
		// Stop loading animation
		if (this.loadingAnimation) {
			this.loadingAnimation.stop();
			this.loadingAnimation = null;
		}
		this.statusContainer.clear();

		// Reset via session (emits hook and tool session events)
		await this.session.reset();

		// Clear UI state
		this.chatContainer.clear();
		this.pendingMessagesContainer.clear();
		this.streamingComponent = null;
		this.pendingTools.clear();
		this.isFirstUserMessage = true;

		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(
			new Text(`${theme.fg("accent", "✓ Context cleared")}\n${theme.fg("muted", "Started fresh session")}`, 1, 1),
		);
		this.ui.requestRender();
	}

	private handleDebugCommand(): void {
		const width = this.ui.terminal.columns;
		const allLines = this.ui.render(width);

		const debugLogPath = getDebugLogPath();
		const debugData = [
			`Debug output at ${new Date().toISOString()}`,
			`Terminal width: ${width}`,
			`Total lines: ${allLines.length}`,
			"",
			"=== All rendered lines with visible widths ===",
			...allLines.map((line, idx) => {
				const vw = visibleWidth(line);
				const escaped = JSON.stringify(line);
				return `[${idx}] (w=${vw}) ${escaped}`;
			}),
			"",
			"=== Agent messages (JSONL) ===",
			...this.session.messages.map((msg) => JSON.stringify(msg)),
			"",
		].join("\n");

		fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
		fs.writeFileSync(debugLogPath, debugData);

		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(
			new Text(`${theme.fg("accent", "✓ Debug log written")}\n${theme.fg("muted", debugLogPath)}`, 1, 1),
		);
		this.ui.requestRender();
	}

	private showShowImagesSelector(): void {
		// Only available if terminal supports images
		const caps = getCapabilities();
		if (!caps.images) {
			this.showWarning("Your terminal does not support inline images");
			return;
		}

		this.showSelector((done) => {
			const selector = new ShowImagesSelectorComponent(
				this.settingsManager.getShowImages(),
				(newValue) => {
					this.settingsManager.setShowImages(newValue);

					// Update all existing tool execution components with new setting
					for (const child of this.chatContainer.children) {
						if (child instanceof ToolExecutionComponent) {
							child.setShowImages(newValue);
						}
					}

					done();
					this.showStatus(`Inline images: ${newValue ? "on" : "off"}`);
				},
				() => {
					done();
					this.ui.requestRender();
				},
			);
			return { component: selector, focus: selector.getSelectList() };
		});
	}

	stop(): void {
		if (this.loadingAnimation) {
			this.loadingAnimation.stop();
			this.loadingAnimation = null;
		}
		this.footer.dispose();
		if (this.unsubscribe) {
			this.unsubscribe();
		}
		if (this.isInitialized) {
			this.ui.stop();
			this.isInitialized = false;
		}
	}

}