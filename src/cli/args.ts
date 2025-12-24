

export interface Args {
	continue?: boolean;
	resume?: boolean;
	noSession?: boolean;
	session?: string;
}

export function parseArgs(args: string[]): Args {
	const result: Args = {
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];	
		if (arg === "--continue" || arg === "-c") {
			result.continue = true;
		} else if (arg === "--resume" || arg === "-r") {
			result.resume = true;
		} else if (arg === "--no-session") {
			result.noSession = true;
		} else if (arg === "--session" && i + 1 < args.length) {
			result.session = args[++i];
		}
	}
	return result;
}
