/**
 * Print mode (single-shot): Send prompts, output result, exit.
 *
 * Used for:
 * - `agent -p "prompt"` - text output
 * - `agent --output json "prompt"` - JSON event stream
 *
 * Designed for scripting, piping, or quick answers.
 */

import type { AgentSession, AgentSessionEvent } from "../core/agent-session.js";
import type { Api, Attachment, BaseAssistantMessage } from "@ank1015/providers";

/**
 * Options for print mode.
 */
export interface PrintModeOptions {
	/** Output mode: "text" for final response only, "json" for all events */
	outputMode: "text" | "json";
	/** First message to send */
	initialMessage: string;
	/** Array of additional prompts to send after initialMessage */
	followUpMessages?: string[];
	/** Attachments (images/files) for the initial message */
	attachments?: Attachment[];
}

/**
 * Run in print (single-shot) mode.
 * Sends prompts to the agent and outputs the result, then exits.
 */
export async function runPrintMode(
	session: AgentSession,
	options: PrintModeOptions
): Promise<void> {
	const { outputMode, initialMessage, followUpMessages = [], attachments } = options;

	// Subscribe to events - enables session persistence and JSON output
	session.subscribe((event: AgentSessionEvent) => {
		// In JSON mode, output all events as they occur
		if (outputMode === "json") {
			console.log(JSON.stringify(event));
		}
	});

	// Send initial message with attachments
	await session.prompt(initialMessage, { attachments });

	// Wait for agent to finish processing
	await session.agent.waitForIdle();

	// Send follow-up messages sequentially
	for (const message of followUpMessages) {
		await session.prompt(message);
		await session.agent.waitForIdle();
	}

	// In text mode, output the final response
	if (outputMode === "text") {
		const state = session.state;
		const lastMessage = state.messages[state.messages.length - 1];

		if (lastMessage?.role === "assistant") {
			const assistantMsg = lastMessage as BaseAssistantMessage<Api>;

			// Check for error/aborted
			if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
				const errorMessage = assistantMsg.errorMessage || `Request ${assistantMsg.stopReason}`;
				console.error(errorMessage);
				process.exit(1);
			}

			// Output text content
			for (const content of assistantMsg.content) {
				if (content.type === "response") {
                    content.content.map((c) => {
                        if(c.type === 'text'){
                            console.log(c.content);
                        }
                    })
				}
			}
		}
	}

	// Ensure stdout is fully flushed before returning
	// This prevents race conditions where the process exits before all output is written
	await new Promise<void>((resolve, reject) => {
		process.stdout.write("", (err) => {
			if (err) reject(err);
			else resolve();
		});
	});
}
