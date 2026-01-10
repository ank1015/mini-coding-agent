import type { AgentTool, Content, ImageContent, Message, TextContent } from "@ank1015/providers";
import { Type } from "@sinclair/typebox";
import { constants } from "fs";
import { access, readFile } from "fs/promises";
import { detectSupportedImageMimeTypeFromFile } from "../../utils/mime.js";
import { resolveReadPath } from "./path-utils.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, type TruncationResult, truncateHead } from "./truncate.js";

const readSchema = Type.Object({
	path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
	offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});

interface ToolExecutionContext {
	/** Read-only conversation history (messages up to but not including current tool results) */
	messages: readonly Message[];
}

export interface ReadToolDetails {
	truncation?: TruncationResult;
}

/**
 * Compare two Content arrays for equality
 */
function contentEquals(a: Content, b: Content): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		const itemA = a[i];
		const itemB = b[i];
		if (itemA.type !== itemB.type) return false;
		if (itemA.type === "text" && itemB.type === "text") {
			if (itemA.content !== itemB.content) return false;
		} else if (itemA.type === "image" && itemB.type === "image") {
			if (itemA.data !== itemB.data || itemA.mimeType !== itemB.mimeType) return false;
		} else if (itemA.type === "file" && itemB.type === "file") {
			if (itemA.data !== itemB.data || itemA.mimeType !== itemB.mimeType || itemA.filename !== itemB.filename) return false;
		}
	}
	return true;
}

/**
 * Find previous read of the same file with same parameters
 * Returns the previous content if found, null otherwise
 */
function findPreviousRead(
	context: ToolExecutionContext | undefined,
	absolutePath: string,
	offset: number | undefined,
	limit: number | undefined,
	cwd: string,
): Content | null {
	if (!context?.messages) return null;

	// Build a map of toolCallId to arguments from assistant messages
	const toolCallArgs = new Map<string, Record<string, any>>();
	for (const msg of context.messages) {
		if (msg.role === "assistant") {
			for (const item of msg.content) {
				if (item.type === "toolCall" && item.name === "read") {
					toolCallArgs.set(item.toolCallId, item.arguments);
				}
			}
		}
	}

	// Find matching tool result (iterate in reverse to find most recent)
	for (let i = context.messages.length - 1; i >= 0; i--) {
		const msg = context.messages[i] as Message;
		if (msg.role === "toolResult" && msg.toolName === "read" && !msg.isError) {
			const args = toolCallArgs.get(msg.toolCallId);
			if (!args) continue;

			// Compare path (resolve to absolute)
			const prevPath = resolveReadPath(args.path, cwd);
			if (prevPath !== absolutePath) continue;

			// Compare offset and limit (treat undefined as equivalent)
			if (args.offset !== offset || args.limit !== limit) continue;

			// Found a match - return the content
			return msg.content as Content;
		}
	}

	return null;
}

export function createReadTool(cwd: string): AgentTool<typeof readSchema> {
	return {
		name: "read",
		label: "read",
		description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp). Images are sent as attachments. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files.`,
		parameters: readSchema,
		execute: async (
			_toolCallId: string,
			{ path, offset, limit }: { path: string; offset?: number; limit?: number },
			signal?: AbortSignal,
			_onUpdate?: unknown,
			context?: ToolExecutionContext,
		) => {
			const absolutePath = resolveReadPath(path, cwd);

			return new Promise<{ content: (TextContent | ImageContent)[]; details: ReadToolDetails | undefined }>(
				(resolve, reject) => {
					// Check if already aborted
					if (signal?.aborted) {
						reject(new Error("Operation aborted"));
						return;
					}

					let aborted = false;

					// Set up abort handler
					const onAbort = () => {
						aborted = true;
						reject(new Error("Operation aborted"));
					};

					if (signal) {
						signal.addEventListener("abort", onAbort, { once: true });
					}

					// Perform the read operation
					(async () => {
						try {
							// Check if file exists
							await access(absolutePath, constants.R_OK);

							// Check if aborted before reading
							if (aborted) {
								return;
							}

							const mimeType = await detectSupportedImageMimeTypeFromFile(absolutePath);

							// Read the file based on type
							let content: (TextContent | ImageContent)[];
							let details: ReadToolDetails | undefined;

							if (mimeType) {
								// Read as image (binary)
								const buffer = await readFile(absolutePath);
								const base64 = buffer.toString("base64");

								content = [
									{ type: "text", content: `Read image file [${mimeType}]` },
									{ type: "image", data: base64, mimeType },
								];
							} else {
								// Read as text
								const textContent = await readFile(absolutePath, "utf-8");
								const allLines = textContent.split("\n");
								const totalFileLines = allLines.length;

								// Apply offset if specified (1-indexed to 0-indexed)
								const startLine = offset ? Math.max(0, offset - 1) : 0;
								const startLineDisplay = startLine + 1; // For display (1-indexed)

								// Check if offset is out of bounds
								if (startLine >= allLines.length) {
									throw new Error(`Offset ${offset} is beyond end of file (${allLines.length} lines total)`);
								}

								// If limit is specified by user, use it; otherwise we'll let truncateHead decide
								let selectedContent: string;
								let userLimitedLines: number | undefined;
								if (limit !== undefined) {
									const endLine = Math.min(startLine + limit, allLines.length);
									selectedContent = allLines.slice(startLine, endLine).join("\n");
									userLimitedLines = endLine - startLine;
								} else {
									selectedContent = allLines.slice(startLine).join("\n");
								}

								// Apply truncation (respects both line and byte limits)
								const truncation = truncateHead(selectedContent);

								let outputText: string;

								if (truncation.firstLineExceedsLimit) {
									// First line at offset exceeds 30KB - tell model to use bash
									const firstLineSize = formatSize(Buffer.byteLength(allLines[startLine], "utf-8"));
									outputText = `[Line ${startLineDisplay} is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${startLineDisplay}p' ${path} | head -c ${DEFAULT_MAX_BYTES}]`;
									details = { truncation };
								} else if (truncation.truncated) {
									// Truncation occurred - build actionable notice
									const endLineDisplay = startLineDisplay + truncation.outputLines - 1;
									const nextOffset = endLineDisplay + 1;

									outputText = truncation.content;

									if (truncation.truncatedBy === "lines") {
										outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines}. Use offset=${nextOffset} to continue]`;
									} else {
										outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Use offset=${nextOffset} to continue]`;
									}
									details = { truncation };
								} else if (userLimitedLines !== undefined && startLine + userLimitedLines < allLines.length) {
									// User specified limit, there's more content, but no truncation
									const remaining = allLines.length - (startLine + userLimitedLines);
									const nextOffset = startLine + userLimitedLines + 1;

									outputText = truncation.content;
									outputText += `\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue]`;
								} else {
									// No truncation, no user limit exceeded
									outputText = truncation.content;
								}

								content = [{ type: "text", content: outputText }];
							}

							// Check if aborted after reading
							if (aborted) {
								return;
							}

							// Clean up abort handler
							if (signal) {
								signal.removeEventListener("abort", onAbort);
							}

							// Check if content matches a previous read of the same file
							const previousContent = findPreviousRead(context, absolutePath, offset, limit, cwd);
							if (previousContent !== null && contentEquals(previousContent, content)) {
								resolve({
									content: [{ type: "text", content: "[File unchanged since last read. Use previous content.]" }],
									details: undefined,
								});
								return;
							}

							resolve({ content, details });
						} catch (error: any) {
							// Clean up abort handler
							if (signal) {
								signal.removeEventListener("abort", onAbort);
							}

							if (!aborted) {
								reject(error);
							}
						}
					})();
				},
			);
		},
	};
}

/** Default read tool using process.cwd() - for backwards compatibility */
export const readTool = createReadTool(process.cwd());
