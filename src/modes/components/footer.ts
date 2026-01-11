import { type BaseAssistantMessage, type AgentState, type Api } from "@ank1015/providers";
import { type Component, visibleWidth } from "@ank1015/agents-tui";
import { theme } from "../theme/theme.js";

/**
 * Footer component that shows token stats, context usage, and session branch
 */
export class FooterComponent implements Component {
	private state: AgentState;
	private activeBranch: string = "main"; // Default
	private autoCompactEnabled: boolean = true;

	constructor(state: AgentState) {
		this.state = state;
	}

	setAutoCompactEnabled(enabled: boolean): void {
		this.autoCompactEnabled = enabled;
	}

	/**
	 * Clean up resources (no-op now, kept for API compatibility)
	 */
	dispose(): void {
		// No resources to clean up
	}

	updateState(state: AgentState, activeBranch?: string): void {
		this.state = state;
		if (activeBranch) {
			this.activeBranch = activeBranch;
		}
	}

	invalidate(): void {
		// No cached state to invalidate
	}

	render(width: number): string[] {
		// Calculate cumulative usage from all assistant messages
		let totalInput = 0;
		let totalOutput = 0;
		let totalCacheRead = 0;
		let totalCacheWrite = 0;
		let totalCost = 0;

		for (const message of this.state.messages) {
			if (message.role === "assistant") {
				const assistantMsg = message as BaseAssistantMessage<Api>;
				totalInput += assistantMsg.usage.input;
				totalOutput += assistantMsg.usage.output;
				totalCacheRead += assistantMsg.usage.cacheRead;
				totalCacheWrite += assistantMsg.usage.cacheWrite;
				totalCost += assistantMsg.usage.cost.total;
			}
		}

		// Get last assistant message for context percentage calculation (skip aborted messages)
		const lastAssistantMessage = this.state.messages
			.slice()
			.reverse()
			.find((m) => m.role === "assistant" && m.stopReason !== "aborted") as BaseAssistantMessage<Api> | undefined;

		// Calculate context percentage from last message (input + output + cacheRead + cacheWrite)
		const contextTokens = lastAssistantMessage
			? lastAssistantMessage.usage.input +
				lastAssistantMessage.usage.output +
				lastAssistantMessage.usage.cacheRead +
				lastAssistantMessage.usage.cacheWrite
			: 0;
		const contextWindow = this.state.provider.model?.contextWindow || 0;
		const contextPercentValue = contextWindow > 0 ? (contextTokens / contextWindow) * 100 : 0;
		const contextPercent = contextPercentValue.toFixed(1);

		// Format token counts (similar to web-ui)
		const formatTokens = (count: number): string => {
			if (count < 1000) return count.toString();
			if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
			if (count < 1000000) return `${Math.round(count / 1000)}k`;
			if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
			return `${Math.round(count / 1000000)}M`;
		};

		// Build stats line
		const statsParts = [];
		if (totalInput) statsParts.push(`↑${formatTokens(totalInput)}`);
		if (totalOutput) statsParts.push(`↓${formatTokens(totalOutput)}`);
		if (totalCacheRead) statsParts.push(`R${formatTokens(totalCacheRead)}`);
		if (totalCacheWrite) statsParts.push(`W${formatTokens(totalCacheWrite)}`);

		// Show cost with "(sub)" indicator if using OAuth subscription
		const usingSubscription = false;
		if (totalCost || usingSubscription) {
			const costStr = `$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`;
			statsParts.push(costStr);
		}

		// Colorize context percentage based on usage
		let contextPercentStr: string;
		const autoIndicator = this.autoCompactEnabled ? " (auto)" : "";
		const contextPercentDisplay = `${contextPercent}%/${formatTokens(contextWindow)}${autoIndicator}`;
		if (contextPercentValue > 90) {
			contextPercentStr = theme.fg("error", contextPercentDisplay);
		} else if (contextPercentValue > 70) {
			contextPercentStr = theme.fg("warning", contextPercentDisplay);
		} else {
			contextPercentStr = contextPercentDisplay;
		}
		statsParts.push(contextPercentStr);

		// Add active branch name
		statsParts.push(`[${this.activeBranch}]`);

		let statsLine = statsParts.join(" ");

		// Add left margin (2 columns)
		const leftMargin = "  ";
		const availableWidth = width - leftMargin.length;

		// Truncate if too wide
		const statsLineWidth = visibleWidth(statsLine);
		if (statsLineWidth > availableWidth) {
			const plainStatsLine = statsLine.replace(/\x1b\[[0-9;]*m/g, "");
			statsLine = `${plainStatsLine.substring(0, availableWidth - 3)}...`;
		}

		// Return 3 lines: spacer, content with margin, spacer
		return [
			"",
			leftMargin + theme.fg("dim", statsLine),
			"",
		];
	}
}
