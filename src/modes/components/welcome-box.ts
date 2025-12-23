import type { Component } from "@ank1015/agents-tui";
import { theme } from "../theme/theme.js";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Welcome box component that displays app info, user greeting, and tips
 */
export class WelcomeBox implements Component {
	private appVersion = "v0.0.1";
	private agentName = "Mini Agent";
	private userName: string;
	private modelName = "Sonnet 4.5";
	private accountType = "Claude Pro";
	private userEmail: string;
	private currentDir: string;
	private marginSize = 2; // Left and right margin in spaces

	constructor() {
		// Get user info
		this.userName = os.userInfo().username || "User";
		this.userEmail = `${this.userName}@example.com`;
		this.currentDir = this.formatPath(process.cwd());
	}

	private formatPath(dirPath: string): string {
		const home = os.homedir();
		if (dirPath.startsWith(home)) {
			return "~" + dirPath.slice(home.length);
		}
		return dirPath;
	}

	invalidate(): void {
		// No cached state to invalidate
	}

	render(width: number): string[] {
		const lines: string[] = [];
		const margin = " ".repeat(this.marginSize);

		// Calculate box width (terminal width minus margins)
		const boxWidth = Math.max(1, width - (this.marginSize * 2));
		const innerWidth = Math.max(1, boxWidth - 4); // Account for borders and padding

		// Top border
		const titleText = `${this.agentName} ${this.appVersion}`;
		const titleLength = titleText.length + 1; // "─ " + text + " "
		const topBorder = margin + theme.fg("box", "┌─ ") +
			theme.fg("box", titleText + " ") +
			theme.fg("box", "─".repeat(Math.max(0, innerWidth - titleLength)) + "┐");
		lines.push(topBorder);

		// Content lines
		const contentLines = this.buildContent(innerWidth);

		for (const line of contentLines) {
			lines.push(margin + theme.fg("box", "│ ") + line + theme.fg("box", " │"));
		}

		// Bottom border
		const bottomBorder = margin + theme.fg("box", "└" + "─".repeat(innerWidth + 2) + "┘");
		lines.push(bottomBorder);

		return lines;
	}

	private buildContent(contentWidth: number): string[] {
		const lines: string[] = [];

		// Empty line
		lines.push(this.centerLine("", contentWidth));

		// Welcome message (centered)
		const welcomeMsg = `Welcome back!`;
		lines.push(this.centerLine(welcomeMsg, contentWidth));

		lines.push(this.centerLine("", contentWidth));
		lines.push(this.centerLine("", contentWidth));

		// ASCII Robot (simple pixelated design inspired by the image)
		// const robot = [
		// 	" *  ▄  █    █  ▄  * ",
		// 	"*   █▄█▀████▀█▄█   *", 
		// 	"*   ▀████▄▄████▀   *",
		// 	" *    █      █    * ",
		// 	]

		const robot = [
		" *  ▄  █   █  ▄  * ",
		"*   █▄█▀███▀█▄█   *", 
		"*   ▀█████████▀   *",
		" *    █     █    * ",
		]


		// Center and render robot
		for (const robotLine of robot) {
			lines.push(this.centerLine(theme.fg("borderAccent", robotLine), contentWidth));
		}

		lines.push(this.centerLine("", contentWidth));
		lines.push(this.centerLine("", contentWidth));

		// Model and account info (centered)
		// const modelInfo = `${this.modelName} · ${this.accountType} ·`;
		// lines.push(this.centerLine(theme.fg("dim", modelInfo), contentWidth));

		// Current directory (centered)
		lines.push(this.centerLine(theme.fg("dim", this.currentDir), contentWidth));

		lines.push(this.centerLine("", contentWidth));

		return lines;
	}

	private centerLine(text: string, width: number): string {
		// Strip ANSI codes to calculate actual display length
		const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, "");
		const displayLength = stripAnsi(text).length;

		// Calculate padding for centering
		const totalPadding = Math.max(0, width - displayLength);
		const leftPadding = Math.floor(totalPadding / 2);
		const rightPadding = totalPadding - leftPadding;

		return " ".repeat(leftPadding) + text + " ".repeat(rightPadding);
	}
}
