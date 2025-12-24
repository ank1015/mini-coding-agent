# Changelog

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
