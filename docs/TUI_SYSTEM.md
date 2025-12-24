# TUI System Implementation

The Terminal User Interface is built on a custom component framework that handles rendering, event propagation, and screen updates.

## Architecture

### 1. The Rendering Loop
- **TUI Class**: The central controller (`src/modes/interactive.ts` -> `this.ui`).
- **Render Request**: Changes trigger `ui.requestRender()`, which coalesces updates to avoid flickering.
- **Terminal Output**: Renders an array of strings to the `ProcessTerminal` (stdout).

### 2. Component Hierarchy
All UI elements implement the `Component` interface:
```typescript
interface Component {
    render(width: number): string[];
    invalidate(): void;
    // Optional event handlers: onInput, onFocus, etc.
}
```

### 3. Key Components
- **CustomEditor**:
  - Extends base input behavior with specific key bindings (`Ctrl+C`, `Escape`).
  - Supports autocomplete integration via `CombinedAutocompleteProvider`.
- **AssistantMessageComponent**:
  - Dynamically renders streaming content.
  - Handles distinct content blocks: `Text`, `Thinking` (chain of thought), and `ToolCalls`.
- **ToolExecutionComponent**:
  - Complex state machine: Pending -> Partial Update -> Complete/Error.
  - Supports collapsible output (expandable via `Ctrl+O`).
  - Renders rich content like Images (base64) and Syntax-highlighted code.
- **FooterComponent**:
  - Real-time status bar showing:
    - Current Working Directory (with git branch).
    - Session Token Usage (Input/Output/Cache).
    - Context Window Utilization %.
  - Uses file watchers (`fs.watch`) on `.git/HEAD` for live branch updates.

## Theme System (`src/modes/theme`)
- **JSON Based**: Themes are defined in strict JSON schemas (`theme-schema.json`).
- **Hot Reloading**: The `ThemeManager` watches custom theme files and triggers live repaints on change.
- **Resolution**:
  - **Variables**: Supports standard CSS-like variables in the `vars` block.
  - **Fallbacks**: Gracefully handles missing colors or invalid schemas by reverting to default Dark mode.
  - **Color Mode**: Auto-detects `TrueColor` vs `256-Color` support and downsamples RGB values if necessary.
