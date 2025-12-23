import type { Component } from "@ank1015/agents-tui";
import { theme } from "../theme/theme.js";

/**
 * Simple hint component below the editor
 */
export class PromptHint implements Component {
	invalidate(): void {
		// No cached state
	}

	render(width: number): string[] {
		const hint = "? for shortcuts";
		return [theme.fg("dim", hint)];
	}
}
