/**
 * MockServer - A console-based RemoteServer for local testing.
 *
 * Simulates a messaging platform using stdin/stdout:
 * - Type messages in the console to send to the agent
 * - Agent responses are printed to the console
 */

import * as readline from "readline";
import { RemoteServer, type RemoteServerConfig } from "./remote-server.js";
import type { RemoteResponse } from "./types.js";

export interface MockServerConfig extends RemoteServerConfig {
	/** User ID to simulate */
	userId?: string;

	/** Username to display */
	username?: string;

	/** Channel ID to simulate */
	channelId?: string;

	/** Prompt string to show */
	prompt?: string;
}

export class MockServer extends RemoteServer {
	private mockConfig: MockServerConfig;
	private rl: readline.Interface | null = null;
	private messageCounter = 0;

	constructor(config: MockServerConfig = {}) {
		super(config);
		this.mockConfig = {
			userId: "mock-user-1",
			username: "TestUser",
			channelId: "mock-channel-1",
			prompt: "You> ",
			...config,
		};
	}

	get platform(): string {
		return "mock";
	}

	async start(): Promise<void> {
		if (this._isConnected) {
			return;
		}

		this.rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});

		this._isConnected = true;

		console.log("\n┌────────────────────────────────────────┐");
		console.log("│     Mock Messaging Server Started      │");
		console.log("├────────────────────────────────────────┤");
		console.log("│  Type messages to send to the agent   │");
		console.log("│  Type 'exit' or Ctrl+C to quit        │");
		console.log("└────────────────────────────────────────┘\n");

		// Start reading input
		this.promptForInput();

		this.rl.on("line", async (line: string) => {
			const text = line.trim();

			// Handle exit command
			if (text.toLowerCase() === "exit") {
				await this.stop();
				process.exit(0);
			}

			// Skip empty lines
			if (!text) {
				this.promptForInput();
				return;
			}

			// Create mock message
			const message = {
				id: `mock-msg-${++this.messageCounter}`,
				channelId: this.mockConfig.channelId!,
				userId: this.mockConfig.userId!,
				username: this.mockConfig.username!,
				text,
				platform: "mock",
			};

			// Handle the message (will dispatch to handlers)
			await this.handleIncomingMessage(message);
		});

		this.rl.on("close", () => {
			this._isConnected = false;
		});
	}

	async stop(): Promise<void> {
		if (this.rl) {
			this.rl.close();
			this.rl = null;
		}
		this._isConnected = false;
		console.log("\n[MockServer] Stopped");
	}

	async sendMessage(_channelId: string, response: RemoteResponse): Promise<void> {
		console.log("\n┌─ Agent ─────────────────────────────────");

		// Format the response with proper indentation
		const lines = response.text.split("\n");
		for (const line of lines) {
			console.log("│ " + line);
		}

		console.log("└──────────────────────────────────────────\n");

		// Show prompt again after response
		this.promptForInput();
	}

	async sendTypingIndicator(_channelId: string): Promise<void> {
		// Show a simple typing indicator
		process.stdout.write("\r[Agent is thinking...]\r");
	}

	private promptForInput(): void {
		if (this.rl && this._isConnected) {
			this.rl.prompt();
			process.stdout.write(this.mockConfig.prompt!);
		}
	}
}
