import { AgentSession } from "./core/agent-session.js";
import { InteractiveMode } from "./modes/interactive.js";
import { SessionTree } from "./core/session-tree.js";
import { Args } from "./cli/args.js";
import { ensureTool } from "./utils/tools-manager.js";
import { VERSION } from "./config.js";
import { SettingsManager } from "./core/settings-manager.js";
import { initTheme } from "./modes/theme/theme.js";
import chalk from "chalk";
import { selectSession } from "./cli/session-picker.js";
import { createAgentSession } from "./core/sdk.js";
import { parseArgs } from "./cli/args.js";

async function runInteractiveMode(
	session: AgentSession,
	version: string,
	fdPath: string | null = null,
): Promise<void> {
	const mode = new InteractiveMode(session, version, fdPath);

	await mode.init();

	mode.renderInitialMessages(session.state);

	while (true) {
		const userInput = await mode.getUserInput();
		try {
			await session.prompt(userInput);
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
			mode.showError(errorMessage);
		}
	}
}

export async function main(args: string[]) {

	const parsed: Args = parseArgs(args);

    const fdPath = await ensureTool("fd");
	const cwd = process.cwd();

	const settingsManager = SettingsManager.create();
    initTheme("custom", false);
    let sessionTree: SessionTree | undefined = undefined;

    if(parsed.noSession){
        sessionTree = SessionTree.inMemory();
    }
    if(parsed.session){
        sessionTree = SessionTree.open(parsed.session);
    }
    if(parsed.continue){
        sessionTree = SessionTree.continueRecent(cwd);
    }
    if(parsed.resume){
		const sessions = SessionTree.listSessions(cwd);
		if (sessions.length === 0) {
			console.log(chalk.dim("No sessions found"));
			return;
		}
		const selectedPath = await selectSession(sessions);
		if (!selectedPath) {
			console.log(chalk.dim("No session selected"));
			return;
		}
		// Clear screen after session selection
		process.stdout.write("\x1b[3J\x1b[2J\x1b[H");
		sessionTree = SessionTree.open(selectedPath);
    }

    const {session} = await createAgentSession({
        cwd,
        settingsManager,
        sessionTree
    })


    await runInteractiveMode(
        session,
        VERSION,
        fdPath,
    );

}