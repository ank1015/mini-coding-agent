import type { BaseAssistantEvent, Message, ToolResultMessage, UserMessage, AgentState, Api, BaseAssistantMessage } from "@ank1015/providers";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { basename } from "path";
import { APP_NAME, VERSION } from "../config.js";
import type { SessionManager } from "./session-manager.js";

// ============================================================================
// Types
// ============================================================================

interface MessageEvent {
	type: "message";
	message: Message;
	timestamp?: number;
}

interface ModelChangeEvent {
	type: "model_change";
	provider: string;
	modelId: string;
	timestamp?: number;
}

type SessionEvent = MessageEvent | ModelChangeEvent ;

interface ParsedSessionData {
	sessionId: string;
	timestamp: string;
	systemPrompt?: string;
	modelsUsed: Set<string>;
	messages: Message[];
	toolResultsMap: Map<string, ToolResultMessage>;
	sessionEvents: SessionEvent[];
	tokenStats: { input: number; output: number; cacheRead: number; cacheWrite: number };
	costStats: { input: number; output: number; cacheRead: number; cacheWrite: number };
	tools?: { name: string; description: string }[];
	contextWindow?: number;
	isStreamingFormat?: boolean;
}

// ============================================================================
// Color scheme (matching TUI)
// ============================================================================

const COLORS = {
	userMessageBg: "rgb(52, 53, 65)",
	toolPendingBg: "rgb(40, 40, 50)",
	toolSuccessBg: "rgb(40, 50, 40)",
	toolErrorBg: "rgb(60, 40, 40)",
	userBashBg: "rgb(50, 48, 35)", // Faint yellow/brown for user-executed bash
	userBashErrorBg: "rgb(60, 45, 35)", // Slightly more orange for errors
	bodyBg: "rgb(24, 24, 30)",
	containerBg: "rgb(30, 30, 36)",
	text: "rgb(229, 229, 231)",
	textDim: "rgb(161, 161, 170)",
	cyan: "rgb(103, 232, 249)",
	green: "rgb(34, 197, 94)",
	red: "rgb(239, 68, 68)",
	yellow: "rgb(234, 179, 8)",
};

// ============================================================================
// Utility functions
// ============================================================================

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

function shortenPath(path: string): string {
	const home = homedir();
	return path.startsWith(home) ? "~" + path.slice(home.length) : path;
}

function replaceTabs(text: string): string {
	return text.replace(/\t/g, "   ");
}

function formatTimestamp(timestamp: number | string | undefined): string {
	if (!timestamp) return "";
	const date = new Date(typeof timestamp === "string" ? timestamp : timestamp);
	return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatExpandableOutput(lines: string[], maxLines: number): string {
	const displayLines = lines.slice(0, maxLines);
	const remaining = lines.length - maxLines;

	if (remaining > 0) {
		let out = '<div class="tool-output expandable" onclick="this.classList.toggle(\'expanded\')">';
		out += '<div class="output-preview">';
		for (const line of displayLines) {
			out += `<div>${escapeHtml(replaceTabs(line))}</div>`;
		}
		out += `<div class="expand-hint">... (${remaining} more lines) - click to expand</div>`;
		out += "</div>";
		out += '<div class="output-full">';
		for (const line of lines) {
			out += `<div>${escapeHtml(replaceTabs(line))}</div>`;
		}
		out += "</div></div>";
		return out;
	}

	let out = '<div class="tool-output">';
	for (const line of displayLines) {
		out += `<div>${escapeHtml(replaceTabs(line))}</div>`;
	}
	out += "</div>";
	return out;
}

// ============================================================================
// Parsing functions
// ============================================================================

function parseSessionManagerFormat(lines: string[]): ParsedSessionData {
	const data: ParsedSessionData = {
		sessionId: "unknown",
		timestamp: new Date().toISOString(),
		modelsUsed: new Set(),
		messages: [],
		toolResultsMap: new Map(),
		sessionEvents: [],
		tokenStats: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		costStats: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};

	for (const line of lines) {
		let entry: { type: string; [key: string]: unknown };
		try {
			entry = JSON.parse(line) as { type: string; [key: string]: unknown };
		} catch {
			continue;
		}

		switch (entry.type) {
			case "session":
				data.sessionId = (entry.id as string) || "unknown";
				data.timestamp = (entry.timestamp as string) || data.timestamp;
				data.systemPrompt = entry.systemPrompt as string | undefined;
				if (entry.modelId) {
					const modelInfo = entry.provider ? `${entry.provider}/${entry.modelId}` : (entry.modelId as string);
					data.modelsUsed.add(modelInfo);
				}
				break;

			case "message": {
				const message = entry.message as Message;
				data.messages.push(message);
				data.sessionEvents.push({
					type: "message",
					message,
					timestamp: entry.timestamp as number | undefined,
				});

				if (message.role === "toolResult") {
					const toolResult = message as ToolResultMessage;
					data.toolResultsMap.set(toolResult.toolCallId, toolResult);
				} else if (message.role === "assistant") {
					const assistantMsg = message as BaseAssistantMessage<Api>;
					if (assistantMsg.usage) {
						data.tokenStats.input += assistantMsg.usage.input || 0;
						data.tokenStats.output += assistantMsg.usage.output || 0;
						data.tokenStats.cacheRead += assistantMsg.usage.cacheRead || 0;
						data.tokenStats.cacheWrite += assistantMsg.usage.cacheWrite || 0;
						if (assistantMsg.usage.cost) {
							data.costStats.input += assistantMsg.usage.cost.input || 0;
							data.costStats.output += assistantMsg.usage.cost.output || 0;
							data.costStats.cacheRead += assistantMsg.usage.cost.cacheRead || 0;
							data.costStats.cacheWrite += assistantMsg.usage.cost.cacheWrite || 0;
						}
					}
				}
				break;
			}

			case "model_change":
				data.sessionEvents.push({
					type: "model_change",
					provider: entry.provider as string,
					modelId: entry.modelId as string,
					timestamp: entry.timestamp as number | undefined,
				});
				if (entry.modelId) {
					const modelInfo = entry.provider ? `${entry.provider}/${entry.modelId}` : (entry.modelId as string);
					data.modelsUsed.add(modelInfo);
				}
				break;

		}
	}

	return data;
}

function parseStreamingEventFormat(lines: string[]): ParsedSessionData {
	const data: ParsedSessionData = {
		sessionId: "unknown",
		timestamp: new Date().toISOString(),
		modelsUsed: new Set(),
		messages: [],
		toolResultsMap: new Map(),
		sessionEvents: [],
		tokenStats: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		costStats: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		isStreamingFormat: true,
	};

	let timestampSet = false;

	for (const line of lines) {
		let entry: { type: string; message?: Message };
		try {
			entry = JSON.parse(line) as { type: string; message?: Message };
		} catch {
			continue;
		}

		if (entry.type === "message_end" && entry.message) {
			const msg = entry.message;
			data.messages.push(msg);
			data.sessionEvents.push({
				type: "message",
				message: msg,
				timestamp: (msg as { timestamp?: number }).timestamp,
			});

			if (msg.role === "toolResult") {
				const toolResult = msg as ToolResultMessage;
				data.toolResultsMap.set(toolResult.toolCallId, toolResult);
			} else if (msg.role === "assistant") {
				const assistantMsg = msg as BaseAssistantMessage<Api>;
				if (assistantMsg.model) {
					const modelInfo = `${assistantMsg.api}/${assistantMsg.model}`
					data.modelsUsed.add(modelInfo);
				}
				if (assistantMsg.usage) {
					data.tokenStats.input += assistantMsg.usage.input || 0;
					data.tokenStats.output += assistantMsg.usage.output || 0;
					data.tokenStats.cacheRead += assistantMsg.usage.cacheRead || 0;
					data.tokenStats.cacheWrite += assistantMsg.usage.cacheWrite || 0;
					if (assistantMsg.usage.cost) {
						data.costStats.input += assistantMsg.usage.cost.input || 0;
						data.costStats.output += assistantMsg.usage.cost.output || 0;
						data.costStats.cacheRead += assistantMsg.usage.cost.cacheRead || 0;
						data.costStats.cacheWrite += assistantMsg.usage.cost.cacheWrite || 0;
					}
				}
			}

			if (!timestampSet && (msg as { timestamp?: number }).timestamp) {
				data.timestamp = new Date((msg as { timestamp: number }).timestamp).toISOString();
				timestampSet = true;
			}
		}
	}

	data.sessionId = `stream-${data.timestamp.replace(/[:.]/g, "-")}`;
	return data;
}

function detectFormat(lines: string[]): "session-manager" | "streaming-events" | "unknown" {
	for (const line of lines) {
		try {
			const entry = JSON.parse(line) as { type: string };
			if (entry.type === "session") return "session-manager";
			if (entry.type === "agent_start" || entry.type === "message_start" || entry.type === "turn_start") {
				return "streaming-events";
			}
		} catch {}
	}
	return "unknown";
}

function parseSessionFile(content: string): ParsedSessionData {
	const lines = content
		.trim()
		.split("\n")
		.filter((l) => l.trim());

	if (lines.length === 0) {
		throw new Error("Empty session file");
	}

	const format = detectFormat(lines);
	if (format === "unknown") {
		throw new Error("Unknown session file format");
	}

	return format === "session-manager" ? parseSessionManagerFormat(lines) : parseStreamingEventFormat(lines);
}

// ============================================================================
// HTML formatting functions
// ============================================================================

function formatToolExecution(
	toolName: string,
	args: Record<string, unknown>,
	result?: ToolResultMessage,
): { html: string; bgColor: string } {
	let html = "";
	const isError = result?.isError || false;
	const bgColor = result ? (isError ? COLORS.toolErrorBg : COLORS.toolSuccessBg) : COLORS.toolPendingBg;

	const getTextOutput = (): string => {
		if (!result) return "";
		const textBlocks = result.content.filter((c) => c.type === "text");
		return textBlocks.map((c) => c.content).join("\n");
	};

	switch (toolName) {
		case "bash": {
			const command = (args?.command as string) || "";
			html = `<div class="tool-command">$ ${escapeHtml(command || "...")}</div>`;
			if (result) {
				const output = getTextOutput().trim();
				if (output) {
					html += formatExpandableOutput(output.split("\n"), 5);
				}
			}
			break;
		}

		case "read": {
			const path = shortenPath((args?.file_path as string) || (args?.path as string) || "");
			const offset = args?.offset as number | undefined;
			const limit = args?.limit as number | undefined;

			// Build path display with offset/limit suffix (in yellow color if offset/limit used)
			let pathHtml = escapeHtml(path || "...");
			if (offset !== undefined || limit !== undefined) {
				const startLine = offset ?? 1;
				const endLine = limit !== undefined ? startLine + limit - 1 : "";
				pathHtml += `<span class="line-numbers" style="color: ${COLORS.yellow}">:${startLine}${endLine ? `-${endLine}` : ""}</span>`;
			}

			html = `<div class="tool-header"><span class="tool-name">read</span> <span class="tool-path">${pathHtml}</span></div>`;
			if (result) {
				const output = getTextOutput();
				if (output) {
					html += formatExpandableOutput(output.split("\n"), 10);
				}
			}
			break;
		}

		case "write": {
			const path = shortenPath((args?.file_path as string) || (args?.path as string) || "");
			const fileContent = (args?.content as string) || "";
			const lines = fileContent ? fileContent.split("\n") : [];

			html = `<div class="tool-header"><span class="tool-name">write</span> <span class="tool-path">${escapeHtml(path || "...")}</span>`;
			if (lines.length > 10) {
				html += ` <span class="line-count">(${lines.length} lines)</span>`;
			}
			html += "</div>";

			if (fileContent) {
				html += formatExpandableOutput(lines, 10);
			}
			if (result) {
				const output = getTextOutput().trim();
				if (output) {
					html += `<div class="tool-output"><div>${escapeHtml(output)}</div></div>`;
				}
			}
			break;
		}

		case "edit": {
			const path = shortenPath((args?.file_path as string) || (args?.path as string) || "");
			html = `<div class="tool-header"><span class="tool-name">edit</span> <span class="tool-path">${escapeHtml(path || "...")}</span></div>`;

			if (result?.details?.diff) {
				const diffLines = result.details.diff.split("\n");
				html += '<div class="tool-diff">';
				for (const line of diffLines) {
					if (line.startsWith("+")) {
						html += `<div class="diff-line-new">${escapeHtml(line)}</div>`;
					} else if (line.startsWith("-")) {
						html += `<div class="diff-line-old">${escapeHtml(line)}</div>`;
					} else {
						html += `<div class="diff-line-context">${escapeHtml(line)}</div>`;
					}
				}
				html += "</div>";
			}
			if (result) {
				const output = getTextOutput().trim();
				if (output) {
					html += `<div class="tool-output"><div>${escapeHtml(output)}</div></div>`;
				}
			}
			break;
		}

		default: {
			html = `<div class="tool-header"><span class="tool-name">${escapeHtml(toolName)}</span></div>`;
			html += `<div class="tool-output"><pre>${escapeHtml(JSON.stringify(args, null, 2))}</pre></div>`;
			if (result) {
				const output = getTextOutput();
				if (output) {
					html += `<div class="tool-output"><div>${escapeHtml(output)}</div></div>`;
				}
			}
		}
	}

	return { html, bgColor };
}

function formatMessage(message: Message, toolResultsMap: Map<string, ToolResultMessage>): string {
	let html = "";
	const timestamp = (message as { timestamp?: number }).timestamp;
	const timestampHtml = timestamp ? `<div class="message-timestamp">${formatTimestamp(timestamp)}</div>` : "";


	if (message.role === "user") {
		const userMsg = message as UserMessage;
		let textContent = "";

		if (typeof userMsg.content === "string") {
			textContent = userMsg.content;
		} else {
			const textBlocks = userMsg.content.filter((c) => c.type === "text");
			textContent = textBlocks.map((c) => c.content).join("");
		}

		if (textContent.trim()) {
			html += `<div class="user-message">${timestampHtml}${escapeHtml(textContent).replace(/\n/g, "<br>")}</div>`;
		}
	} else if (message.role === "assistant") {
		const assistantMsg = message as BaseAssistantMessage<Api>;
		html += timestampHtml ? `<div class="assistant-message">${timestampHtml}` : "";

		for (const content of assistantMsg.content) {
			if (content.type === "response") {
				const textBlock = content.content.filter(c => c.type==='text');
				let text = '';
				textBlock.map(b => {
					text += b.content
				})
				html += `<div class="assistant-text">${escapeHtml(text.trim()).replace(/\n/g, "<br>")}</div>`;
			} else if (content.type === "thinking" && content.thinkingText.trim()) {
				html += `<div class="thinking-text">${escapeHtml(content.thinkingText.trim()).replace(/\n/g, "<br>")}</div>`;
			}
		}

		for (const content of assistantMsg.content) {
			if (content.type === "toolCall") {
				const toolResult = toolResultsMap.get(content.toolCallId);
				const { html: toolHtml, bgColor } = formatToolExecution(
					content.name,
					content.arguments as Record<string, unknown>,
					toolResult,
				);
				html += `<div class="tool-execution" style="background-color: ${bgColor}">${toolHtml}</div>`;
			}
		}

		const hasToolCalls = assistantMsg.content.some((c) => c.type === "toolCall");
		if (!hasToolCalls) {
			if (assistantMsg.stopReason === "aborted") {
				html += '<div class="error-text">Aborted</div>';
			} else if (assistantMsg.stopReason === "error") {
				html += `<div class="error-text">Error: ${escapeHtml(assistantMsg.errorMessage || "Unknown error")}</div>`;
			}
		}

		if (timestampHtml) {
			html += "</div>";
		}
	}

	return html;
}

function formatModelChange(event: ModelChangeEvent): string {
	const timestamp = formatTimestamp(event.timestamp);
	const timestampHtml = timestamp ? `<div class="message-timestamp">${timestamp}</div>` : "";
	const modelInfo = `${event.provider}/${event.modelId}`;
	return `<div class="model-change">${timestampHtml}<div class="model-change-text">Switched to model: <span class="model-name">${escapeHtml(modelInfo)}</span></div></div>`;
}


// ============================================================================
// HTML generation
// ============================================================================

function generateHtml(data: ParsedSessionData, filename: string): string {
	const userMessages = data.messages.filter((m) => m.role === "user").length;
	const assistantMessages = data.messages.filter((m) => m.role === "assistant").length;

	let toolCallsCount = 0;
	for (const message of data.messages) {
		if (message.role === "assistant") {
			toolCallsCount += (message as BaseAssistantMessage<Api>).content.filter((c) => c.type === "toolCall").length;
		}
	}

	const lastAssistantMessage = data.messages
		.slice()
		.reverse()
		.find((m) => m.role === "assistant" && (m as BaseAssistantMessage<Api>).stopReason !== "aborted") as
		| BaseAssistantMessage<Api>
		| undefined;

	const contextTokens = lastAssistantMessage
		? lastAssistantMessage.usage.input +
			lastAssistantMessage.usage.output +
			lastAssistantMessage.usage.cacheRead +
			lastAssistantMessage.usage.cacheWrite
		: 0;

	const lastModel = lastAssistantMessage?.model || "unknown";
	const lastProvider = lastAssistantMessage?.api || "";
	const lastModelInfo = `${lastProvider}/${lastModel}`;

	const contextWindow = data.contextWindow || 0;
	const contextPercent = contextWindow > 0 ? ((contextTokens / contextWindow) * 100).toFixed(1) : null;

	let messagesHtml = "";
	for (const event of data.sessionEvents) {
		switch (event.type) {
			case "message":
				if (event.message.role !== "toolResult") {
					messagesHtml += formatMessage(event.message, data.toolResultsMap);
				}
				break;
			case "model_change":
				messagesHtml += formatModelChange(event);
				break;
		}
	}

    // Collect usage data for visualization
    const assistantUsage = data.messages
        .filter(m => m.role === 'assistant')
        .map((m, index) => {
            const am = m as BaseAssistantMessage<Api>;
            return {
                id: `Message ${index + 1}`,
                input: am.usage?.input || 0,
                output: am.usage?.output || 0,
                cacheRead: am.usage?.cacheRead || 0,
                cacheWrite: am.usage?.cacheWrite || 0,
                total: (am.usage?.input || 0) + (am.usage?.output || 0) + (am.usage?.cacheRead || 0) + (am.usage?.cacheWrite || 0)
            };
        });

    // ========================================================================
    // Context Analysis - Three Message Types
    // ========================================================================
    //
    // Context is made up of three types of messages:
    // 1. User messages - what the user types
    // 2. Assistant messages - what the assistant outputs (thinking, response, tool calls)
    // 3. Tool Results - what tools return (read content, bash output, etc.)

    // Helper to count chars in a message
    const countChars = (msg: Message): number => {
        if (Array.isArray(msg.content)) {
            return msg.content.reduce((acc, part) => {
                if (part.type === 'text') return acc + part.content.length;
                return acc;
            }, 0);
        }
        return 0;
    };

    // Estimate tokens from chars (rough: 1 token ≈ 4 chars)
    const estimateTokens = (chars: number): number => Math.ceil(chars / 4);

    // Build toolCallId -> toolName mapping
    const toolIdToName = new Map<string, string>();
    for (const msg of data.messages) {
        if (msg.role === 'assistant') {
            const am = msg as BaseAssistantMessage<Api>;
            am.content.forEach(c => {
                if (c.type === 'toolCall') {
                    toolIdToName.set(c.toolCallId, c.name);
                }
            });
        }
    }

    // ========================================================================
    // 1. User Messages Analysis
    // ========================================================================

    interface UserStats {
        count: number;
        totalTokens: number;
    }

    const userStats: UserStats = { count: 0, totalTokens: 0 };

    for (const msg of data.messages) {
        if (msg.role === 'user') {
            userStats.count++;
            userStats.totalTokens += estimateTokens(countChars(msg));
        }
    }

    // ========================================================================
    // 2. Assistant Messages Analysis
    // ========================================================================

    interface AssistantStats {
        // Content type breakdown
        thinkingTokens: number;
        thinkingCount: number;
        responseTokens: number;
        responseCount: number;
        toolCallTokens: number;
        toolCallCount: number;
        totalOutputTokens: number; // Actual from API
    }

    const assistantStats: AssistantStats = {
        thinkingTokens: 0,
        thinkingCount: 0,
        responseTokens: 0,
        responseCount: 0,
        toolCallTokens: 0,
        toolCallCount: 0,
        totalOutputTokens: 0,
    };

    // Tool calls breakdown (assistant calling tools)
    const toolCallCounts: { [toolName: string]: number } = {};
    const toolCallTokensByTool: { [toolName: string]: number } = {};
    const readFilePaths: { path: string; turnNumber: number }[] = [];

    let turnNum = 0;
    for (const msg of data.messages) {
        if (msg.role === 'assistant') {
            turnNum++;
            const am = msg as BaseAssistantMessage<Api>;
            assistantStats.totalOutputTokens += am.usage?.output || 0;

            for (const content of am.content) {
                if (content.type === 'thinking') {
                    const chars = content.thinkingText?.length || 0;
                    assistantStats.thinkingTokens += estimateTokens(chars);
                    assistantStats.thinkingCount++;
                } else if (content.type === 'response') {
                    let responseChars = 0;
                    if (Array.isArray(content.content)) {
                        for (const block of content.content) {
                            if (block.type === 'text') {
                                responseChars += block.content?.length || 0;
                            }
                        }
                    }
                    assistantStats.responseTokens += estimateTokens(responseChars);
                    assistantStats.responseCount++;
                } else if (content.type === 'toolCall') {
                    const argsStr = JSON.stringify(content.arguments || {});
                    const toolCallChars = (content.name?.length || 0) + argsStr.length;
                    const tokens = estimateTokens(toolCallChars);
                    assistantStats.toolCallTokens += tokens;
                    assistantStats.toolCallCount++;

                    const toolName = content.name || 'unknown';
                    toolCallCounts[toolName] = (toolCallCounts[toolName] || 0) + 1;
                    toolCallTokensByTool[toolName] = (toolCallTokensByTool[toolName] || 0) + tokens;

                    // Track read file paths
                    if (toolName === 'read') {
                        const args = content.arguments as Record<string, unknown>;
                        const filePath = (args?.file_path as string) || (args?.path as string) || 'unknown';
                        readFilePaths.push({ path: filePath, turnNumber: turnNum });
                    }
                }
            }
        }
    }

    // ========================================================================
    // 3. Tool Results Analysis
    // ========================================================================

    interface ToolResultStats {
        totalTokens: number;
        byTool: { [toolName: string]: number };
    }

    const toolResultStats: ToolResultStats = {
        totalTokens: 0,
        byTool: {},
    };

    for (const msg of data.messages) {
        if (msg.role === 'toolResult') {
            const tr = msg as ToolResultMessage;
            const toolName = toolIdToName.get(tr.toolCallId) || 'unknown';
            const tokens = estimateTokens(countChars(msg));
            toolResultStats.totalTokens += tokens;
            toolResultStats.byTool[toolName] = (toolResultStats.byTool[toolName] || 0) + tokens;
        }
    }

    // ========================================================================
    // Context Growth Data (for charts) - 3 categories: User, Assistant, ToolResults
    // ========================================================================

    interface ContextDataPoint {
        id: string;
        user: number;
        assistant: number;
        toolResults: number;
        total: number;
    }

    const contextAnalysis: ContextDataPoint[] = [];
    let cumulativeUser = 0;
    let cumulativeAssistant = 0;
    let cumulativeToolResults = 0;
    let turnCount = 0;

    for (const msg of data.messages) {
        if (msg.role === 'user') {
            cumulativeUser += estimateTokens(countChars(msg));
        } else if (msg.role === 'toolResult') {
            cumulativeToolResults += estimateTokens(countChars(msg));
        } else if (msg.role === 'assistant') {
            const am = msg as BaseAssistantMessage<Api>;
            turnCount++;
            const currentContextSize = (am.usage?.input || 0) + (am.usage?.cacheRead || 0);

            contextAnalysis.push({
                id: `Turn ${turnCount}`,
                user: cumulativeUser,
                assistant: cumulativeAssistant,
                toolResults: cumulativeToolResults,
                total: currentContextSize
            });

            // Assistant output becomes part of context for next turn
            cumulativeAssistant += am.usage?.output || 0;
        }
    }

	const systemPromptHtml = data.systemPrompt
		? `<div class="system-prompt">
            <div class="system-prompt-header">System Prompt</div>
            <div class="system-prompt-content">${escapeHtml(data.systemPrompt)}</div>
        </div>`
		: "";

	const toolsHtml = data.tools
		? `<div class="tools-list">
            <div class="tools-header">Available Tools</div>
            <div class="tools-content">
                ${data.tools.map((tool) => `<div class="tool-item"><span class="tool-item-name">${escapeHtml(tool.name)}</span> - ${escapeHtml(tool.description)}</div>`).join("")}
            </div>
        </div>`
		: "";

	const streamingNotice = data.isStreamingFormat
		? `<div class="streaming-notice">
            <em>Note: This session was reconstructed from raw agent event logs, which do not contain system prompt or tool definitions.</em>
        </div>`
		: "";

	const contextUsageText = contextPercent
		? `${contextTokens.toLocaleString()} / ${contextWindow.toLocaleString()} tokens (${contextPercent}%) - ${escapeHtml(lastModelInfo)}`
		: `${contextTokens.toLocaleString()} tokens (last turn) - ${escapeHtml(lastModelInfo)}`;

	return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Session Export - ${escapeHtml(filename)}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, 'DejaVu Sans Mono', monospace;
            font-size: 12px;
            line-height: 1.6;
            color: ${COLORS.text};
            background: ${COLORS.bodyBg};
            padding: 24px;
        }
        .container { max-width: 700px; margin: 0 auto; }
        .header {
            margin-bottom: 24px;
            padding: 16px;
            background: ${COLORS.containerBg};
            border-radius: 4px;
        }
        .header h1 {
            font-size: 14px;
            font-weight: bold;
            margin-bottom: 12px;
            color: ${COLORS.cyan};
        }
        .header-info { display: flex; flex-direction: column; gap: 3px; font-size: 11px; }
        .info-item { color: ${COLORS.textDim}; display: flex; align-items: baseline; }
        .info-label { font-weight: 600; margin-right: 8px; min-width: 100px; }
        .info-value { color: ${COLORS.text}; flex: 1; }
        .info-value.cost { font-family: 'SF Mono', monospace; }
        .messages { display: flex; flex-direction: column; gap: 16px; }
        .message-timestamp { font-size: 10px; color: ${COLORS.textDim}; margin-bottom: 4px; opacity: 0.8; }
        .user-message {
            background: ${COLORS.userMessageBg};
            padding: 12px 16px;
            border-radius: 4px;
            white-space: pre-wrap;
            word-wrap: break-word;
            overflow-wrap: break-word;
            word-break: break-word;
        }
        .assistant-message { padding: 0; }
        .assistant-text, .thinking-text {
            padding: 12px 16px;
            white-space: pre-wrap;
            word-wrap: break-word;
            overflow-wrap: break-word;
            word-break: break-word;
        }
        .thinking-text { color: ${COLORS.textDim}; font-style: italic; }
        .model-change { padding: 8px 16px; background: rgb(40, 40, 50); border-radius: 4px; }
        .model-change-text { color: ${COLORS.textDim}; font-size: 11px; }
        .model-name { color: ${COLORS.cyan}; font-weight: bold; }
        .compaction-container { background: rgb(60, 55, 35); border-radius: 4px; overflow: hidden; }
        .compaction-header { padding: 12px 16px; cursor: pointer; }
        .compaction-header:hover { background: rgba(255, 255, 255, 0.05); }
        .compaction-header-row { display: flex; align-items: center; gap: 8px; }
        .compaction-toggle { color: ${COLORS.cyan}; font-size: 10px; transition: transform 0.2s; }
        .compaction-container.expanded .compaction-toggle { transform: rotate(90deg); }
        .compaction-title { color: ${COLORS.text}; font-weight: bold; }
        .compaction-hint { color: ${COLORS.textDim}; font-size: 11px; }
        .compaction-content { display: none; padding: 0 16px 16px 16px; }
        .compaction-container.expanded .compaction-content { display: block; }
        .compaction-summary { background: rgba(0, 0, 0, 0.2); border-radius: 4px; padding: 12px; }
        .compaction-summary-header { font-weight: bold; color: ${COLORS.cyan}; margin-bottom: 8px; font-size: 11px; }
        .compaction-summary-content { color: ${COLORS.text}; white-space: pre-wrap; word-wrap: break-word; }
        .tool-execution { padding: 12px 16px; border-radius: 4px; margin-top: 8px; }
        .tool-header, .tool-name { font-weight: bold; }
        .tool-path { color: ${COLORS.cyan}; word-break: break-all; }
        .line-count { color: ${COLORS.textDim}; }
        .tool-command { font-weight: bold; white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word; word-break: break-word; }
        .tool-output {
            margin-top: 12px;
            color: ${COLORS.textDim};
            white-space: pre-wrap;
            word-wrap: break-word;
            overflow-wrap: break-word;
            word-break: break-word;
            font-family: inherit;
            overflow-x: auto;
        }
        .tool-output > div { line-height: 1.4; }
        .tool-output pre { margin: 0; font-family: inherit; color: inherit; white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word; }
        .tool-output.expandable { cursor: pointer; }
        .tool-output.expandable:hover { opacity: 0.9; }
        .tool-output.expandable .output-full { display: none; }
        .tool-output.expandable.expanded .output-preview { display: none; }
        .tool-output.expandable.expanded .output-full { display: block; }
        .expand-hint { color: ${COLORS.cyan}; font-style: italic; margin-top: 4px; }
        .system-prompt, .tools-list { background: rgb(60, 55, 40); padding: 12px 16px; border-radius: 4px; margin-bottom: 16px; }
        .system-prompt-header, .tools-header { font-weight: bold; color: ${COLORS.yellow}; margin-bottom: 8px; }
        .system-prompt-content, .tools-content { color: ${COLORS.textDim}; white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word; word-break: break-word; font-size: 11px; }
        .tool-item { margin: 4px 0; }
        .tool-item-name { font-weight: bold; color: ${COLORS.text}; }
        .tool-diff { margin-top: 12px; font-size: 11px; font-family: inherit; overflow-x: auto; max-width: 100%; }
        .diff-line-old { color: ${COLORS.red}; white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word; }
        .diff-line-new { color: ${COLORS.green}; white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word; }
        .diff-line-context { color: ${COLORS.textDim}; white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word; }
        .error-text { color: ${COLORS.red}; padding: 12px 16px; }
        .footer { margin-top: 48px; padding: 20px; text-align: center; color: ${COLORS.textDim}; font-size: 10px; }
        .streaming-notice { background: rgb(50, 45, 35); padding: 12px 16px; border-radius: 4px; margin-bottom: 16px; color: ${COLORS.textDim}; font-size: 11px; }
        .view-link { color: ${COLORS.cyan}; text-decoration: underline; cursor: pointer; margin-left: 8px; font-size: 11px; }
        @media print { body { background: white; color: black; } .tool-execution { border: 1px solid #ddd; } }
    </style>
</head>
<body>
    <div id="cache-view" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:${COLORS.bodyBg}; z-index:1000; overflow:auto; padding:20px;">
        <div class="container" style="max-width:1200px; height: 90vh; display: flex; flex-direction: column;">
            <div class="header">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <h1>Context & Caching Analysis</h1>
                    <button onclick="hideCacheView()" style="padding:8px 16px; cursor:pointer; background:${COLORS.containerBg}; color:${COLORS.text}; border:1px solid ${COLORS.textDim}; border-radius:4px;">Close</button>
                </div>
            </div>
            <div style="position: relative; flex: 1; width: 100%; min-height: 0;">
                <canvas id="cacheChart"></canvas>
            </div>
            <div style="display: flex; justify-content: center; gap: 10px; margin-top: 20px; padding-bottom: 20px;">
                <button id="prevBtn" onclick="moveWindow(-5)" style="padding:8px 16px; cursor:pointer; background:${COLORS.containerBg}; color:${COLORS.text}; border:1px solid ${COLORS.textDim}; border-radius:4px;">&larr; Previous</button>
                <span id="chartRange" style="display: flex; align-items: center; color: ${COLORS.textDim}; font-family: monospace;"></span>
                <button id="nextBtn" onclick="moveWindow(5)" style="padding:8px 16px; cursor:pointer; background:${COLORS.containerBg}; color:${COLORS.text}; border:1px solid ${COLORS.textDim}; border-radius:4px;">Next &rarr;</button>
            </div>
        </div>
    </div>

    <div id="context-view" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:${COLORS.bodyBg}; z-index:1000; overflow:auto; padding:20px;">
        <div class="container" style="max-width:1200px; min-height: 90vh;">
            <div class="header">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <h1>Context Composition Analysis</h1>
                    <button onclick="hideContextView()" style="padding:8px 16px; cursor:pointer; background:${COLORS.containerBg}; color:${COLORS.text}; border:1px solid ${COLORS.textDim}; border-radius:4px;">Close</button>
                </div>
            </div>

            <!-- Top Charts: Context Growth & Composition (3 categories) -->
            <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px; margin-bottom: 20px;">
                <div style="background: ${COLORS.containerBg}; padding: 15px; border-radius: 4px; height: 350px;">
                    <h3 style="color:${COLORS.cyan}; margin-bottom: 10px;">Context Growth Timeline</h3>
                    <div style="position: relative; height: 300px; width: 100%;">
                        <canvas id="contextGrowthChart"></canvas>
                    </div>
                </div>
                <div style="background: ${COLORS.containerBg}; padding: 15px; border-radius: 4px; height: 350px;">
                    <h3 style="color:${COLORS.cyan}; margin-bottom: 10px;">Current Composition</h3>
                    <div style="position: relative; height: 300px; width: 100%;">
                        <canvas id="compositionChart"></canvas>
                    </div>
                </div>
            </div>

            <!-- Section 1: User Messages -->
            <div style="background: ${COLORS.containerBg}; padding: 15px; border-radius: 4px; margin-bottom: 20px;">
                <h3 style="color:${COLORS.cyan}; margin-bottom: 15px;">User Messages</h3>
                <div style="display: flex; gap: 40px; font-family: monospace; font-size: 14px;">
                    <div>
                        <span style="color: ${COLORS.textDim};">Count:</span>
                        <span style="color: ${COLORS.text}; font-weight: bold; margin-left: 8px;">${userStats.count}</span>
                    </div>
                    <div>
                        <span style="color: ${COLORS.textDim};">Total Tokens:</span>
                        <span style="color: ${COLORS.text}; font-weight: bold; margin-left: 8px;">~${userStats.totalTokens.toLocaleString()}</span>
                    </div>
                </div>
            </div>

            <!-- Section 2: Assistant Messages Analysis -->
            <div style="background: ${COLORS.containerBg}; padding: 15px; border-radius: 4px; margin-bottom: 20px;">
                <h3 style="color:${COLORS.cyan}; margin-bottom: 15px;">Assistant Messages Analysis</h3>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                    <!-- Output Breakdown -->
                    <div style="background: rgba(255,255,255,0.03); padding: 15px; border-radius: 4px;">
                        <h4 style="color:${COLORS.text}; margin-bottom: 12px; font-size: 13px;">Output Breakdown</h4>
                        <div style="font-family: monospace; font-size: 12px;">
                            <div style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">
                                <span style="color: ${COLORS.text};">Thinking</span>
                                <span style="color: ${COLORS.textDim};">~${assistantStats.thinkingTokens.toLocaleString()} tokens (${assistantStats.thinkingCount} blocks)</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">
                                <span style="color: ${COLORS.text};">Response</span>
                                <span style="color: ${COLORS.green};">~${assistantStats.responseTokens.toLocaleString()} tokens (${assistantStats.responseCount} blocks)</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">
                                <span style="color: ${COLORS.text};">Tool Calls</span>
                                <span style="color: ${COLORS.yellow};">~${assistantStats.toolCallTokens.toLocaleString()} tokens (${assistantStats.toolCallCount} calls)</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; padding: 8px 0; margin-top: 8px; font-weight: bold;">
                                <span style="color: ${COLORS.text};">Actual Output (API)</span>
                                <span style="color: ${COLORS.cyan};">${assistantStats.totalOutputTokens.toLocaleString()} tokens</span>
                            </div>
                        </div>
                    </div>

                    <!-- Tool Call Counts -->
                    <div style="background: rgba(255,255,255,0.03); padding: 15px; border-radius: 4px;">
                        <h4 style="color:${COLORS.text}; margin-bottom: 12px; font-size: 13px;">Tool Calls Summary</h4>
                        <div style="font-family: monospace; font-size: 12px;">
                            ${Object.entries(toolCallCounts)
                                .sort((a, b) => b[1] - a[1])
                                .map(([tool, count]) => `
                                    <div style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">
                                        <span style="color: ${COLORS.text};">${escapeHtml(tool)}</span>
                                        <span style="color: ${COLORS.cyan};">${count} calls</span>
                                    </div>
                                `).join('')}
                            <div style="display: flex; justify-content: space-between; padding: 8px 0; margin-top: 8px; font-weight: bold;">
                                <span style="color: ${COLORS.text};">Total</span>
                                <span style="color: ${COLORS.green};">${Object.values(toolCallCounts).reduce((a, b) => a + b, 0)} calls</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Tool Calls Token Chart -->
                <div style="margin-top: 20px; height: 250px;">
                    <h4 style="color:${COLORS.text}; margin-bottom: 12px; font-size: 13px;">Tool Calls Tokens (Assistant Output)</h4>
                    <div style="position: relative; height: 200px; width: 100%;">
                        <canvas id="toolCallsChart"></canvas>
                    </div>
                </div>

                <!-- Read Files List -->
                ${readFilePaths.length > 0 ? `
                <div style="margin-top: 20px;">
                    <h4 style="color:${COLORS.text}; margin-bottom: 12px; font-size: 13px;">Files Read (${readFilePaths.length} total)</h4>
                    <div style="font-family: monospace; font-size: 11px; max-height: 200px; overflow-y: auto; background: rgba(0,0,0,0.2); border-radius: 4px; padding: 10px;">
                        ${readFilePaths.map((item, idx) => `
                            <div style="display: flex; gap: 10px; padding: 3px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                                <span style="color: ${COLORS.textDim}; min-width: 25px;">${idx + 1}.</span>
                                <span style="color: ${COLORS.textDim}; min-width: 55px;">Turn ${item.turnNumber}</span>
                                <span style="color: ${COLORS.text}; word-break: break-all;">${escapeHtml(shortenPath(item.path))}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
                ` : ''}
            </div>

            <!-- Section 3: Tool Results Analysis -->
            <div style="background: ${COLORS.containerBg}; padding: 15px; border-radius: 4px; margin-bottom: 20px;">
                <h3 style="color:${COLORS.cyan}; margin-bottom: 15px;">Tool Results Analysis (Context Input)</h3>

                <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 20px;">
                    <!-- Tool Results Summary -->
                    <div style="background: rgba(255,255,255,0.03); padding: 15px; border-radius: 4px;">
                        <h4 style="color:${COLORS.text}; margin-bottom: 12px; font-size: 13px;">Tokens by Tool</h4>
                        <div style="font-family: monospace; font-size: 12px;">
                            ${Object.entries(toolResultStats.byTool)
                                .sort((a, b) => b[1] - a[1])
                                .map(([tool, tokens]) => `
                                    <div style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">
                                        <span style="color: ${COLORS.text};">${escapeHtml(tool)}</span>
                                        <span style="color: ${COLORS.yellow};">~${tokens.toLocaleString()}</span>
                                    </div>
                                `).join('')}
                            <div style="display: flex; justify-content: space-between; padding: 8px 0; margin-top: 8px; font-weight: bold;">
                                <span style="color: ${COLORS.text};">Total</span>
                                <span style="color: ${COLORS.cyan};">~${toolResultStats.totalTokens.toLocaleString()} tokens</span>
                            </div>
                        </div>
                    </div>

                    <!-- Tool Results Chart -->
                    <div style="height: 250px;">
                        <h4 style="color:${COLORS.text}; margin-bottom: 12px; font-size: 13px;">Tool Results Token Distribution</h4>
                        <div style="position: relative; height: 200px; width: 100%;">
                            <canvas id="toolResultsChart"></canvas>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div class="container">
        <div class="header">
            <h1>${APP_NAME} v${VERSION}</h1>
            <div class="header-info">
                <div class="info-item"><span class="info-label">Session:</span><span class="info-value">${escapeHtml(data.sessionId)}</span></div>
                <div class="info-item"><span class="info-label">Date:</span><span class="info-value">${new Date(data.timestamp).toLocaleString()}</span></div>
                <div class="info-item"><span class="info-label">Models:</span><span class="info-value">${
							Array.from(data.modelsUsed)
								.map((m) => escapeHtml(m))
								.join(", ") || "unknown"
						}</span></div>
            </div>
        </div>

        <div class="header">
            <h1>Messages</h1>
            <div class="header-info">
                <div class="info-item"><span class="info-label">User:</span><span class="info-value">${userMessages}</span></div>
                <div class="info-item"><span class="info-label">Assistant:</span><span class="info-value">${assistantMessages}</span></div>
                <div class="info-item"><span class="info-label">Tool Calls:</span><span class="info-value">${toolCallsCount}</span></div>
            </div>
        </div>

        <div class="header">
            <div style="display:flex; align-items:center; justify-content:space-between;">
                <h1>Tokens & Cost</h1>
                <div style="display:flex; gap: 15px;">
                    <a onclick="showContextView()" class="view-link">Visualize Context</a>
                    <a onclick="showCacheView()" class="view-link">View caching details</a>
                </div>
            </div>
            <div class="header-info">
                <div class="info-item"><span class="info-label">Input:</span><span class="info-value">${data.tokenStats.input.toLocaleString()} tokens</span></div>
                <div class="info-item"><span class="info-label">Output:</span><span class="info-value">${data.tokenStats.output.toLocaleString()} tokens</span></div>
                <div class="info-item"><span class="info-label">Cache Read:</span><span class="info-value">${data.tokenStats.cacheRead.toLocaleString()} tokens</span></div>
                <div class="info-item"><span class="info-label">Cache Write:</span><span class="info-value">${data.tokenStats.cacheWrite.toLocaleString()} tokens</span></div>
                <div class="info-item"><span class="info-label">Total:</span><span class="info-value">${(data.tokenStats.input + data.tokenStats.output + data.tokenStats.cacheRead + data.tokenStats.cacheWrite).toLocaleString()} tokens</span></div>
                <div class="info-item"><span class="info-label">Input Cost:</span><span class="info-value cost">$${data.costStats.input.toFixed(4)}</span></div>
                <div class="info-item"><span class="info-label">Output Cost:</span><span class="info-value cost">$${data.costStats.output.toFixed(4)}</span></div>
                <div class="info-item"><span class="info-label">Cache Read Cost:</span><span class="info-value cost">$${data.costStats.cacheRead.toFixed(4)}</span></div>
                <div class="info-item"><span class="info-label">Cache Write Cost:</span><span class="info-value cost">$${data.costStats.cacheWrite.toFixed(4)}</span></div>
                <div class="info-item"><span class="info-label">Total Cost:</span><span class="info-value cost"><strong>$${(data.costStats.input + data.costStats.output + data.costStats.cacheRead + data.costStats.cacheWrite).toFixed(4)}</strong></span></div>
                <div class="info-item"><span class="info-label">Context Usage:</span><span class="info-value">${contextUsageText}</span></div>
            </div>
        </div>

        ${systemPromptHtml}
        ${toolsHtml}
        ${streamingNotice}

        <div class="messages">
            ${messagesHtml}
        </div>

        <div class="footer">
            Generated by ${APP_NAME} coding-agent on ${new Date().toLocaleString()}
        </div>
    </div>

    <script>
        const usageData = ${JSON.stringify(assistantUsage)};
        const contextData = ${JSON.stringify(contextAnalysis)};
        const toolCallData = ${JSON.stringify(toolCallTokensByTool)};
        const toolResultData = ${JSON.stringify(toolResultStats.byTool)};

        let chartInstance = null;
        let contextCharts = { growth: null, composition: null, toolCalls: null, toolResults: null };
        let windowStart = 0;
        const windowSize = 10;

        function showCacheView() {
            document.getElementById('cache-view').style.display = 'block';
            if (!chartInstance && usageData.length > 0) {
                renderChart();
            }
        }

        function hideCacheView() {
            document.getElementById('cache-view').style.display = 'none';
        }

        function showContextView() {
             document.getElementById('context-view').style.display = 'block';
             if (!contextCharts.growth && contextData.length > 0) {
                 renderContextCharts();
             }
        }

        function hideContextView() {
            document.getElementById('context-view').style.display = 'none';
        }

        function moveWindow(step) {
            const newStart = windowStart + step;
            // Prevent going below 0 or beyond data length (unless it's a small overlap)
            // We allow moving until the end of the window hits the end of data roughly
            if (newStart < 0) {
                windowStart = 0;
            } else if (newStart < usageData.length) {
                windowStart = newStart;
            }
            updateChartData();
        }

        function getVisibleData() {
            return usageData.slice(windowStart, windowStart + windowSize);
        }

        function updateChartControls() {
            const prevBtn = document.getElementById('prevBtn');
            const nextBtn = document.getElementById('nextBtn');
            const rangeLabel = document.getElementById('chartRange');
            
            // Disable prev if we are at the start
            prevBtn.disabled = windowStart <= 0;
            prevBtn.style.opacity = windowStart <= 0 ? 0.5 : 1;
            
            // Disable next if we are showing the last item
            const hasMore = (windowStart + windowSize) < usageData.length;
            nextBtn.disabled = !hasMore;
            nextBtn.style.opacity = !hasMore ? 0.5 : 1;

            const end = Math.min(windowStart + windowSize, usageData.length);
            const total = usageData.length;
            if (total === 0) {
                rangeLabel.innerText = 'No data';
            } else {
                rangeLabel.innerText = \`\${windowStart + 1} - \${end} of \${total}\`;
            }
        }

        function updateChartData() {
            if (!chartInstance) return;
            
            const visible = getVisibleData();
            chartInstance.data.labels = visible.map(d => d.id);
            chartInstance.data.datasets[0].data = visible.map(d => d.cacheRead);
            chartInstance.data.datasets[1].data = visible.map(d => d.input);
            chartInstance.data.datasets[2].data = visible.map(d => d.cacheWrite);
            chartInstance.data.datasets[3].data = visible.map(d => d.output);
            
            chartInstance.update();
            updateChartControls();
        }

        function renderChart() {
            const ctx = document.getElementById('cacheChart').getContext('2d');
            const visible = getVisibleData();
            
            const cacheReadData = visible.map(d => d.cacheRead);
            const inputData = visible.map(d => d.input);
            const cacheWriteData = visible.map(d => d.cacheWrite);
            const outputData = visible.map(d => d.output);

            chartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: visible.map(d => d.id),
                    datasets: [
                        {
                            label: 'Cache Read',
                            data: cacheReadData,
                            backgroundColor: '${COLORS.cyan}',
                            stack: 'Stack 0',
                        },
                        {
                            label: 'Input',
                            data: inputData,
                            backgroundColor: '${COLORS.textDim}', 
                            stack: 'Stack 0',
                        },
                        {
                            label: 'Cache Write',
                            data: cacheWriteData,
                            backgroundColor: '${COLORS.yellow}',
                            stack: 'Stack 0',
                        },
                        {
                            label: 'Output',
                            data: outputData,
                            backgroundColor: '${COLORS.green}',
                            stack: 'Stack 0',
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            labels: {
                                color: '${COLORS.text}'
                            }
                        },
                        tooltip: {
                            mode: 'index',
                            intersect: false,
                            callbacks: {
                                footer: function(tooltipItems) {
                                    let total = 0;
                                    tooltipItems.forEach(function(tooltipItem) {
                                        total += tooltipItem.parsed.y;
                                    });
                                    return 'Total Tokens: ' + total.toLocaleString();
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            ticks: { color: '${COLORS.textDim}' },
                            grid: { color: 'rgba(255, 255, 255, 0.1)' }
                        },
                        y: {
                            ticks: { color: '${COLORS.textDim}' },
                            grid: { color: 'rgba(255, 255, 255, 0.1)' },
                            stacked: true,
                            title: {
                                display: true,
                                text: 'Tokens',
                                color: '${COLORS.text}'
                            }
                        }
                    }
                }
            });
            updateChartControls();
        }

        function renderContextCharts() {
            const palette = ['#eab308', '#f97316', '#ef4444', '#ec4899', '#8b5cf6', '#3b82f6', '#06b6d4'];

            // 1. Stacked Area Chart (Timeline) - 3 categories: User, Assistant, Tool Results
            const ctxGrowth = document.getElementById('contextGrowthChart').getContext('2d');

            const datasets = [
                {
                    label: 'User',
                    data: contextData.map(d => d.user),
                    backgroundColor: 'rgba(103, 232, 249, 0.3)', // Cyan
                    borderColor: 'rgba(103, 232, 249, 1)',
                    fill: true,
                    tension: 0.3
                },
                {
                    label: 'Assistant',
                    data: contextData.map(d => d.assistant),
                    backgroundColor: 'rgba(34, 197, 94, 0.3)', // Green
                    borderColor: 'rgba(34, 197, 94, 1)',
                    fill: true,
                    tension: 0.3
                },
                {
                    label: 'Tool Results',
                    data: contextData.map(d => d.toolResults),
                    backgroundColor: 'rgba(234, 179, 8, 0.3)', // Yellow
                    borderColor: 'rgba(234, 179, 8, 1)',
                    fill: true,
                    tension: 0.3
                }
            ];

            contextCharts.growth = new Chart(ctxGrowth, {
                type: 'line',
                data: {
                    labels: contextData.map(d => d.id),
                    datasets: datasets
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        mode: 'nearest',
                        axis: 'x',
                        intersect: false
                    },
                    scales: {
                         x: { ticks: { color: '${COLORS.textDim}' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                         y: {
                             stacked: true,
                             ticks: { color: '${COLORS.textDim}' },
                             grid: { color: 'rgba(255,255,255,0.1)' },
                             title: { display: true, text: 'Cumulative Tokens', color: '${COLORS.textDim}' }
                         }
                    },
                    plugins: { legend: { labels: { color: '${COLORS.text}' } } }
                }
            });

            // 2. Composition (Doughnut) - 3 categories
            const lastPoint = contextData[contextData.length - 1];
            if (lastPoint) {
                 const ctxComp = document.getElementById('compositionChart').getContext('2d');
                 const labels = ['User', 'Assistant', 'Tool Results'];
                 const data = [lastPoint.user, lastPoint.assistant, lastPoint.toolResults];
                 const bgColors = ['rgb(103, 232, 249)', 'rgb(34, 197, 94)', 'rgb(234, 179, 8)'];

                 contextCharts.composition = new Chart(ctxComp, {
                    type: 'doughnut',
                    data: {
                        labels: labels,
                        datasets: [{ data: data, backgroundColor: bgColors, borderColor: '${COLORS.containerBg}' }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { position: 'bottom', labels: { color: '${COLORS.text}' } } }
                    }
                 });
            }

            // 3. Tool Calls Chart (Assistant output - what assistant requested)
            const ctxToolCalls = document.getElementById('toolCallsChart').getContext('2d');
            const toolCallLabels = Object.keys(toolCallData);
            const toolCallValues = Object.values(toolCallData);

            if (toolCallLabels.length > 0) {
                contextCharts.toolCalls = new Chart(ctxToolCalls, {
                    type: 'bar',
                    data: {
                        labels: toolCallLabels,
                        datasets: [{
                            label: 'Tokens (estimated)',
                            data: toolCallValues,
                            backgroundColor: toolCallLabels.map((_, i) => palette[i % palette.length]),
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        indexAxis: 'y',
                        scales: {
                            x: { ticks: { color: '${COLORS.textDim}' }, grid: { color: 'rgba(255,255,255,0.1)' } },
                            y: { ticks: { color: '${COLORS.text}' }, grid: { display: false } }
                        },
                        plugins: { legend: { display: false } }
                    }
                });
            }

            // 4. Tool Results Chart (Context input - what tools returned)
            const ctxToolResults = document.getElementById('toolResultsChart').getContext('2d');
            const toolResultLabels = Object.keys(toolResultData);
            const toolResultValues = Object.values(toolResultData);

            if (toolResultLabels.length > 0) {
                contextCharts.toolResults = new Chart(ctxToolResults, {
                    type: 'bar',
                    data: {
                        labels: toolResultLabels,
                        datasets: [{
                            label: 'Tokens (estimated)',
                            data: toolResultValues,
                            backgroundColor: toolResultLabels.map((_, i) => palette[i % palette.length]),
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        indexAxis: 'y',
                        scales: {
                            x: { ticks: { color: '${COLORS.textDim}' }, grid: { color: 'rgba(255,255,255,0.1)' } },
                            y: { ticks: { color: '${COLORS.text}' }, grid: { display: false } }
                        },
                        plugins: { legend: { display: false } }
                    }
                });
            }
        }
    </script>
</body>
</html>`;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Export session to HTML using SessionManager and AgentState.
 * Used by TUI's /export command.
 */
export function exportSessionToHtml(sessionManager: SessionManager, state: AgentState, outputPath?: string): string {
	const sessionFile = sessionManager.getSessionFile();
	const content = readFileSync(sessionFile, "utf8");
	const data = parseSessionFile(content);

	// Enrich with data from AgentState (tools, context window)
	data.tools = state.tools.map((t) => ({ name: t.name, description: t.description }));
	data.contextWindow = state.provider.model?.contextWindow;
	if (!data.systemPrompt) {
		data.systemPrompt = state.systemPrompt;
	}

	if (!outputPath) {
		const sessionBasename = basename(sessionFile, ".jsonl");
		outputPath = `${APP_NAME}-session-${sessionBasename}.html`;
	}

	const html = generateHtml(data, basename(sessionFile));
	writeFileSync(outputPath, html, "utf8");
	return outputPath;
}

/**
 * Export session file to HTML (standalone, without AgentState).
 * Auto-detects format: session manager format or streaming event format.
 * Used by CLI for exporting arbitrary session files.
 */
export function exportFromFile(inputPath: string, outputPath?: string): string {
	if (!existsSync(inputPath)) {
		throw new Error(`File not found: ${inputPath}`);
	}

	const content = readFileSync(inputPath, "utf8");
	const data = parseSessionFile(content);

	if (!outputPath) {
		const inputBasename = basename(inputPath, ".jsonl");
		outputPath = `${APP_NAME}-session-${inputBasename}.html`;
	}

	const html = generateHtml(data, basename(inputPath));
	writeFileSync(outputPath, html, "utf8");
	return outputPath;
}
