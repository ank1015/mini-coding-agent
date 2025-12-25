# Changelog

## 0.0.12

### Features
- **Model Switching**: Added `/model` command to switch models mid-session. Automatically updates in-place or branches to a new session if the provider API changes (e.g., OpenAI to Anthropic).
- **Session Cloning**: Added `/clone` command to instantly duplicate the current session into a new file and switch to it.
- **Thinking Control**: Added `/thinking` command to toggle reasoning effort (High/Low) for supported models (OpenAI o-series, Google Gemini 2.0).
- **UI Enhancements**: 
  - Added visual selector for available models.
  - Added selector for thinking levels.
  - Updated footer to display current thinking level next to the model name.

## 0.0.11

### Features
- **Session Branching**: Introduced the ability to branch sessions, allowing users to explore different paths without affecting the main session history.
- **Interactive Mode Updates**: Integrated branching capabilities directly into the interactive TUI.

### Fixes
- **Session Switching**: Resolved cache consistency issues when switching between sessions.
- **TUI Stability**: Fixed issues related to screen clearing and rendering in the terminal interface.

### Technical
- Updated `SessionManager` and `AgentSession` to support branching logic.
- Added comprehensive unit tests for session branching functionality.

## 0.0.1

### Core Features
- **Interactive Terminal Interface**: A rich, interactive TUI for seamless communication with the coding agent.
- **Session Management**: Capabilities to save, list, resume, and switch between coding sessions to pick up exactly where you left off.
- **Smart Context**: Maintained context of likely project files and conversation history for coherent multi-turn tasks.

### Tools & Capabilities
- **File Operations**: Robust tools to `read` files (with large file handling), `write` new files, and intelligently `edit` existing code with precise text replacement.
- **Project Navigation**: Built-in `ls` for directory listing, `find` for file search (respecting `.gitignore`), and `grep` for powerful regex content searching.
- **Shell Integration**: Ability to execute system `bash` commands directly to run builds, tests, or system utilities.
- **Intelligent Truncation**: Automatic handling of large tool outputs to preserve context window space while keeping relevant information.
- **Auto-Provisioning**: Automatically verifies and installs high-performance dependencies (`fd`, `ripgrep`) if they are missing.

### User Interface
- **Customizable Themes**: Full theming support including Dark, Light, and Custom JSON themes.
- **Syntax Highlighting**: Real-time syntax highlighting for code blocks and file content reading.
- **Rich Visuals**: Inline diff views for edits, image preview support (in compatible terminals), and collapsible tool output sections used to reduce clutter.
- **Status & Metrics**: Real-time footer display showing token usage, estimated costs, current git branch, and context window utilization.
- **Thinking Process**: Visibility into the agent's "thinking" blocks (on supported models) to understand its reasoning path.

### CLI Features
- **Slash Commands**: Quick access to actions via `/clear`, `/queue`, `/resume`, `/hotkeys`, `/show-images` and more.
- **Autocomplete**: Intelligent autocomplete for slash commands and file paths within the chat input.
- **Keyboard Shortcuts**: Efficient navigation and control keys (e.g., `Ctrl+C` to interrupt, `Ctrl+O` to expand/collapse tool outputs, `Ctrl+G` for external editor).
