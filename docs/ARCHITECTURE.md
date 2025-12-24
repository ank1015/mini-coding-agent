# System Architecture

## Overview
The `mini-coding-agent` is a modular, Terminal User Interface (TUI) based AI coding assistant. It is built using a layered architecture that separates the core logic, user interface, and external integrations.

## Directory Structure

```
src/
├── core/           # Business logic and public SDK
│   ├── tools/      # Tool implementations and definitions
│   ├── agent-session.ts  # Session state management
│   └── sdk.ts      # Public API entry point
├── modes/          # UI Modes (currently Interactive TUI)
│   ├── components/ # Reusable TUI components
│   └── theme/      # Theming system
├── cli/            # Command Line Interface entry points
└── utils/          # Shared utilities (shell, tools downloader, etc.)
```

## Layers

### 1. Core Layer (`src/core`)
The Core layer is the heart of the agent. It is designed to be usable programmatically via the SDK, independent of the UI.
- **AgentSession**: Manages the lifecycle of a conversation, including state transitions, message history, and event emission.
- **Tools System**: Defines the standard interface for tools (`read`, `write`, `bash`, etc.) and handles their execution.
- **Settings & Config**: Manages user preferences and environment configuration.

### 2. Interface Layer (`src/modes`)
This layer implements the user interaction logic.
- **InteractiveMode**: The primary mode of operation. It initializes the TUI, subscriptions to agent events, and handles user input.
- **TUI Framework**: Built on top of `@ank1015/agents-tui`, utilizing a component-based rendering architecture (Container, Box, Text, etc.).
- **Event-Driven**: The UI reacts to events emitted by the `AgentSession` (e.g., `message_start`, `tool_execution_update`) to update the display in real-time.

### 3. CLI Layer (`src/cli`)
Handles the application entry point.
- Parses command-line arguments.
- Handles session resumption and selection logic.
- bootstraps the `InteractiveMode` with the configured `AgentSession`.

### 4. Utility Layer (`src/utils`)
Provides low-level support functions.
- **Tools Manager**: Automatically checks for, downloads, and configures external binaries (`fd`, `ripgrep`).
- **Shell Utils**: Cross-platform shell execution and path resolution.

## Key Design Principles
- **Modularity**: Components are loosely coupled. The TUI can be swapped for a different interface (e.g., a standard CLI or web server) using the Core SDK.
- **Zero-Config**: The system auto-discovers capabilities (git root, available tools) and auto-provisions necessary dependencies.
- **Robustness**: Extensive handling of edge cases in file I/O, tool execution timeouts, and large output truncation.
