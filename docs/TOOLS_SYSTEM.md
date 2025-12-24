# Tools System Implementation

The Tools System is responsible for defining, executing, and managing the interactions between the LLM and the file system/shell.

## Tool Interface
All tools conform to the `AgentTool` interface from `@ank1015/providers`.
- **Definition**: Uses `TypeBox` schema validation to strictly define inputs.
- **Execution**: Async functions that return `content` (text/image) and `isError` status.

## Core Tools

### 1. File Operations (`read.ts`, `write.ts`, `edit.ts`)
- **Read**:
  - Supports both text and binary (image) files.
  - **Truncation**: automatically truncates files exceeding `DEFAULT_MAX_LINES` or `DEFAULT_MAX_BYTES`.
  - **Offsets**: Supports `offset` and `limit` parameters for reading large files in chunks.
- **Edit**:
  - **Exact Match**: Uses exact string matching (`indexOf`) to locate the block to replace.
  - **Uniqueness Check**: Rejects edits if the target text appears multiple times to prevent ambiguity.
  - **Diff Generation**: Returns a unified diff of the change for user verification.
- **Write**:
  - Auto-creates parent directories using `mkdir -p`.
  - Overwrites existing files entirely.

### 2. Search & Discovery (`find.ts`, `grep.ts`, `ls.ts`)
- **Integration**: Wraps high-performance Rust tools (`fd` and `ripgrep`).
- **Auto-Provisioning**: The `tools-manager.ts` utility checks for these binaries at runtime and downloads them if missing.
- **Truncation**: All search tools implement hard limits on result counts and byte size to prevent context overflow.

### 3. Shell Execution (`bash.ts`)
- **Process Management**: Spawns detached processes to prevent blocking the agent loop.
- **Output Management**:
  - buffers output in chunks.
  - **Tail Truncation**: Keeps the *last* N lines/bytes to ensure the most relevant output (e.g., error messages at the end of a build) is retained.
  - **Temp Files**: If output is truncated, the full log is written to a temporary file, and the path is returned to the model.

## Truncation Logic (`truncate.ts`)
A centralized truncation system ensures no tool call crashes the context window.
- **Dual Limits**: Checks both Line Count and Byte Count.
- **Head vs. Tail**: 
  - `truncateHead`: Used for file reading (shows start of file).
  - `truncateTail`: Used for logs/bash (shows end of output).
- **Feedback**: Truncated outputs include actionable hints (e.g., "Showing lines 1-100... use offset=101 to see more").
