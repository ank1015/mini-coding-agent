import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@ank1015/providers";
import { Type } from "@sinclair/typebox";
import { spawn } from "child_process";
import { getShellConfig, killProcessTree } from "../../utils/shell.js";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	type TruncationResult,
	truncateHead,
	truncateMiddle,
	truncateTail,
} from "./truncate.js";

/**
 * Generate a unique temp file path for bash output
 */
function getTempFilePath(): string {
	const id = randomBytes(8).toString("hex");
	return join(tmpdir(), `mini-bash-${id}.log`);
}

const bashSchema = Type.Object({
	command: Type.String({ description: "Bash command to execute" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
	fullOutput: Type.Optional(
		Type.Boolean({
			description:
				"If true, returns up to 50KB of output (tail). If false (default), aggressively truncates to show only the first and last few lines.",
		}),
	),
});

export interface BashToolDetails {
	truncation?: TruncationResult;
	fullOutputPath?: string;
}

const DEFAULT_PREVIEW_LINES = 20;

export function createBashTool(cwd: string): AgentTool<typeof bashSchema> {
	return {
		name: "bash",
		label: "bash",
		description: `Execute a bash command. stdout/stderr are captured. By default, output is truncated to first/last ${
			DEFAULT_PREVIEW_LINES / 2
		} lines to reduce context. Use fullOutput=true to see more (up to ${DEFAULT_MAX_BYTES / 1024}KB).`,
		parameters: bashSchema,
		execute: async (
			_toolCallId: string,
			{
				command,
				timeout,
				fullOutput,
			}: { command: string; timeout?: number; fullOutput?: boolean },
			signal?: AbortSignal,
			onUpdate?,
		) => {
			return new Promise((resolve, reject) => {
				const { shell, args } = getShellConfig();
				const child = spawn(shell, [...args, command], {
					cwd,
					detached: true,
					stdio: ["ignore", "pipe", "pipe"],
				});

				// We'll stream to a temp file if output gets large
				let tempFilePath: string | undefined;
				let tempFileStream: ReturnType<typeof createWriteStream> | undefined;
				let totalBytes = 0;

				// Head buffer (for default mode) - keep first 5KB
				const headChunks: Buffer[] = [];
				let headChunksBytes = 0;
				const MAX_HEAD_BYTES = 5 * 1024;

				// Tail buffer (rolling) - keep enough for fullOutput mode (100KB buffer for safety)
				const tailChunks: Buffer[] = [];
				let tailChunksBytes = 0;
				const MAX_TAIL_BYTES = DEFAULT_MAX_BYTES * 2;

				let timedOut = false;

				// Set timeout if provided
				let timeoutHandle: NodeJS.Timeout | undefined;
				if (timeout !== undefined && timeout > 0) {
					timeoutHandle = setTimeout(() => {
						timedOut = true;
						onAbort();
					}, timeout * 1000);
				}

				const handleData = (data: Buffer) => {
					totalBytes += data.length;

					// Start writing to temp file once we exceed the threshold
					if (totalBytes > DEFAULT_MAX_BYTES && !tempFilePath) {
						tempFilePath = getTempFilePath();
						tempFileStream = createWriteStream(tempFilePath);
						// Write all buffered chunks to the file
						// Note: tailChunks contains everything so far since we haven't started dropping yet (if limit is high enough)
						// But wait, tailChunks might have already dropped if we set MAX_TAIL_BYTES low?
						// MAX_TAIL_BYTES is 100KB, DEFAULT_MAX_BYTES is 50KB. So tailChunks has everything.
						for (const chunk of tailChunks) {
							tempFileStream.write(chunk);
						}
					}

					// Write to temp file if we have one
					if (tempFileStream) {
						tempFileStream.write(data);
					}

					// Update Head Buffer
					if (headChunksBytes < MAX_HEAD_BYTES) {
						const remaining = MAX_HEAD_BYTES - headChunksBytes;
						if (data.length <= remaining) {
							headChunks.push(data);
							headChunksBytes += data.length;
						} else {
							headChunks.push(data.subarray(0, remaining));
							headChunksBytes += remaining;
						}
					}

					// Update Tail Buffer (Rolling)
					tailChunks.push(data);
					tailChunksBytes += data.length;

					while (tailChunksBytes > MAX_TAIL_BYTES && tailChunks.length > 1) {
						const removed = tailChunks.shift()!;
						tailChunksBytes -= removed.length;
					}

					// Stream partial output to callback (if requested)
					// We just send the tail for live updates usually
					if (onUpdate) {
						const fullBuffer = Buffer.concat(tailChunks);
						const fullText = fullBuffer.toString("utf-8");
						const truncation = truncateTail(fullText);
						onUpdate({
							content: [{ type: "text", content: truncation.content || "" }],
							details: {
								truncation: truncation.truncated ? truncation : undefined,
								fullOutputPath: tempFilePath,
							},
						});
					}
				};

				// Collect stdout and stderr together
				if (child.stdout) {
					child.stdout.on("data", handleData);
				}
				if (child.stderr) {
					child.stderr.on("data", handleData);
				}

				// Handle process exit
				child.on("close", (code) => {
					if (timeoutHandle) {
						clearTimeout(timeoutHandle);
					}
					if (signal) {
						signal.removeEventListener("abort", onAbort);
					}

					// Close temp file stream
					if (tempFileStream) {
						tempFileStream.end();
					}

					if (signal?.aborted) {
						reject(new Error("Command aborted"));
						return;
					}

					if (timedOut) {
						reject(new Error(`Command timed out after ${timeout} seconds`));
						return;
					}

					// Construct output based on mode
					let outputText = "";
					let details: BashToolDetails | undefined;

					const tailBuffer = Buffer.concat(tailChunks);
					const tailString = tailBuffer.toString("utf-8");

					if (fullOutput) {
						// Full Output Mode: Use tail truncation (existing behavior)
						// If we streamed to file, tailChunks has the last MAX_TAIL_BYTES
						const truncation = truncateTail(tailString);
						outputText = truncation.content || "(no output)";

						if (truncation.truncated) {
							details = { truncation, fullOutputPath: tempFilePath };
							const startLine = truncation.totalLines - truncation.outputLines + 1;
							const endLine = truncation.totalLines;

							// If we have a temp file, it means the TOTAL output was huge, but we only have the tail in memory.
							// TruncationResult.totalLines is based on the CONTENT passed to it.
							// So if we have dropped data, the "line numbers" from truncateTail are relative to the chunk we passed, not absolute.
							// But for simplicity, we report what we have.

							if (truncation.truncatedBy === "lines") {
								outputText += `\n\n[Showing lines ${startLine}-${endLine}. Full output: ${tempFilePath}]`;
							} else {
								outputText += `\n\n[Showing last ${formatSize(truncation.outputBytes)}. Full output: ${tempFilePath}]`;
							}
						}
					} else {
						// Default Mode: Head + Tail (Aggressive Truncation)
						const headBuffer = Buffer.concat(headChunks);
						const headString = headBuffer.toString("utf-8");

						// Check if we have the FULL content in memory (no gap)
						// Gap exists if totalBytes > tailChunksBytes AND headChunksBytes doesn't overlap tail.
						// Simplest check: if totalBytes <= MAX_TAIL_BYTES, then tailChunks contains EVERYTHING.
						// (Since MAX_TAIL_BYTES = 100KB and DEFAULT_MAX_BYTES = 50KB, if we haven't streamed, we have everything)
						
						const hasFullContent = totalBytes <= MAX_TAIL_BYTES;

						if (hasFullContent) {
							// We have everything in tailString
							const truncation = truncateMiddle(tailString, { maxLines: DEFAULT_PREVIEW_LINES });
							outputText = truncation.content || "(no output)";
							
							if (truncation.truncated) {
								details = { truncation, fullOutputPath: tempFilePath }; // tempFilePath might be set if > 50KB
								outputText += `\n\n[Output truncated to ${DEFAULT_PREVIEW_LINES} lines. Use fullOutput=true to see more. Full output: ${tempFilePath || "available in memory"}]`;
							}
						} else {
							// We have a gap. We must stitch Head + Tail.
							// Use slightly smaller limits for the parts to sum up to ~20 lines
							const halfLines = Math.floor(DEFAULT_PREVIEW_LINES / 2);
							
							const headTrunc = truncateHead(headString, { maxLines: halfLines });
							const tailTrunc = truncateTail(tailString, { maxLines: halfLines });
							
							outputText = headTrunc.content;
							outputText += `\n\n... [${formatSize(totalBytes - headTrunc.outputBytes - tailTrunc.outputBytes)} of output truncated] ...\n\n`;
							outputText += tailTrunc.content;

							details = {
								fullOutputPath: tempFilePath,
								truncation: {
									truncated: true,
									truncatedBy: "lines",
									content: outputText,
									totalBytes,
									totalLines: 0, // Unknown
									outputBytes: Buffer.byteLength(outputText),
									outputLines: headTrunc.outputLines + tailTrunc.outputLines,
									lastLinePartial: false,
									firstLineExceedsLimit: false,
									maxLines: DEFAULT_PREVIEW_LINES,
									maxBytes: DEFAULT_MAX_BYTES
								}
							};
							
							outputText += `\n\n[Output truncated. Use fullOutput=true to see more. Full output: ${tempFilePath}]`;
						}
					}

					if (code !== 0 && code !== null) {
						outputText += `\n\nCommand exited with code ${code}`;
						reject(new Error(outputText));
					} else {
						resolve({ content: [{ type: "text", content: outputText }], details });
					}
				});

				// Handle abort signal - kill entire process tree
				const onAbort = () => {
					if (child.pid) {
						killProcessTree(child.pid);
					}
				};

				if (signal) {
					if (signal.aborted) {
						onAbort();
					} else {
						signal.addEventListener("abort", onAbort, { once: true });
					}
				}
			});
		},
	};
}

/** Default bash tool using process.cwd() - for backwards compatibility */
export const bashTool = createBashTool(process.cwd());
