import {cli} from './cli/tui.js'

// Run the main function
cli().catch((error) => {
	console.error("Error starting TUI:", error);
	process.exit(1);
});