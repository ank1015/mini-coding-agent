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
import { Message, TextContent } from "@ank1015/providers";
import { fuzzyFilter } from "../../utils/fuzzy.js";
import { theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";

interface MessageItem {
	id: string;
	text: string;
	timestamp: number;
	originalMessage: Message;
	disabled?: boolean;
}

/**
 * Custom message list component for selecting a branch point
 */
class MessageList implements Component {
	private allMessages: MessageItem[] = [];
	private filteredMessages: MessageItem[] = [];
	private selectedIndex: number = 0;
	private searchInput: Input;
	public onSelect?: (messageId: string) => void;
	public onCancel?: () => void;
	public onExit: () => void = () => {};
	private maxVisible: number = 5;

	constructor(messages: Message[]) {
		const userMessages = messages.filter((m) => m.role === "user");
		const firstMessageId = userMessages[0]?.id;

		this.allMessages = userMessages
			.map((m) => {
				const textContent = m.content
					.filter((c) => c.type === "text")
					.map((c) => (c as TextContent).content)
					.join(" ");
				
				return {
					id: m.id || "",
					text: textContent,
					timestamp: m.timestamp || 0,
					originalMessage: m,
					disabled: m.id === firstMessageId,
				};
			})
			.reverse(); // Newest first

		this.filteredMessages = this.allMessages;
		this.searchInput = new Input();

		this.searchInput.onSubmit = () => {
			if (this.filteredMessages[this.selectedIndex]) {
				const selected = this.filteredMessages[this.selectedIndex];
				if (this.onSelect) {
					this.onSelect(selected.id);
				}
			}
		};
	}

	private filterMessages(query: string): void {
		this.filteredMessages = fuzzyFilter(this.allMessages, query, (msg) => msg.text);
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredMessages.length - 1));
	}

	invalidate(): void {
		// No cached state
	}

	render(width: number): string[] {
		const lines: string[] = [];

		lines.push(...this.searchInput.render(width));
		lines.push("");

		if (this.filteredMessages.length === 0) {
			lines.push(theme.fg("muted", "  No messages found"));
			return lines;
		}

		// Format dates
		const formatDate = (ts: number): string => {
			if (!ts) return "";
			const date = new Date(ts);
			const now = new Date();
			const diffMs = now.getTime() - date.getTime();
			const diffMins = Math.floor(diffMs / 60000);
			
			if (diffMins < 1) return "just now";
			if (diffMins < 60) return `${diffMins}m ago`;
			if (diffMins < 1440) return `${Math.floor(diffMins/60)}h ago`;
			return date.toLocaleDateString();
		};

		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), this.filteredMessages.length - this.maxVisible),
		);
		const endIndex = Math.min(startIndex + this.maxVisible, this.filteredMessages.length);

		for (let i = startIndex; i < endIndex; i++) {
			const msg = this.filteredMessages[i];
			const isSelected = i === this.selectedIndex;

			// Normalize message text
			const normalizedMessage = msg.text.replace(/\n/g, " ").trim();

			// First line: cursor + message
			const cursor = isSelected ? theme.fg("accent", "› ") : "  ";
			const maxMsgWidth = width - 2;
			const truncatedMsg = truncateToWidth(normalizedMessage, maxMsgWidth, "...");
			let messageText = isSelected ? theme.bold(truncatedMsg) : truncatedMsg;
			if (msg.disabled) {
				messageText = theme.fg("dim", messageText);
			}
			const messageLine = cursor + messageText;

			// Second line: metadata
			const time = formatDate(msg.timestamp);
			const disabledText = msg.disabled ? " · Cannot branch from start" : "";
			const metadata = `  ${time} · User${disabledText}`;
			const metadataLine = theme.fg("dim", truncateToWidth(metadata, width, ""));

			lines.push(messageLine);
			lines.push(metadataLine);
			lines.push("");
		}

		if (startIndex > 0 || endIndex < this.filteredMessages.length) {
			const scrollText = `  (${this.selectedIndex + 1}/${this.filteredSessionsCount()})`;
			const scrollInfo = theme.fg("muted", truncateToWidth(scrollText, width, ""));
			lines.push(scrollInfo);
		}

		return lines;
	}

	private filteredSessionsCount(): number {
		return this.filteredMessages.length;
	}

	handleInput(keyData: string): void {
		if (isArrowUp(keyData)) {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
		} else if (isArrowDown(keyData)) {
			this.selectedIndex = Math.min(this.filteredMessages.length - 1, this.selectedIndex + 1);
		} else if (isEnter(keyData)) {
			const selected = this.filteredMessages[this.selectedIndex];
			if (selected && !selected.disabled && this.onSelect) {
				this.onSelect(selected.id);
			}
		} else if (isEscape(keyData)) {
			if (this.onCancel) {
				this.onCancel();
			}
		} else if (isCtrlC(keyData)) {
			this.onExit();
		} else {
			this.searchInput.handleInput(keyData);
			this.filterMessages(this.searchInput.getValue());
		}
	}
}

/**
 * Component that renders a message selector for branching
 */
export class MessageSelectorComponent extends Container {
	private messageList: MessageList;

	constructor(
		messages: Message[],
		onSelect: (messageId: string) => void,
		onCancel: () => void,
		onExit: () => void,
	) {
		super();

		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.bold("Branch from Message"), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));

		this.messageList = new MessageList(messages);
		this.messageList.onSelect = onSelect;
		this.messageList.onCancel = onCancel;
		this.messageList.onExit = onExit;

		this.addChild(this.messageList);

		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());

		// Auto-cancel if no user messages
		if (messages.filter(m => m.role === 'user').length === 0) {
			setTimeout(() => onCancel(), 100);
		}
	}

	getMessageList(): MessageList {
		return this.messageList;
	}
}
