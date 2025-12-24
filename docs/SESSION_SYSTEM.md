# Session & State Implementation

The Session System manages the persistent state of the agent, allowing for long-running conversations that survive process restarts.

## Components

### 1. Session Manager (`core/session-manager.ts`)
- **Storage**: Sessions are stored as JSON files in `~/.mini/agent/sessions/`.
- **Structure**:
  ```typescript
  interface SavedSession {
      id: string;
      messages: Message[]; // Full conversation history
      model: { api: string, modelId: string };
      createdAt: number;
      updatedAt: number;
  }
  ```
- **Discovery**: efficient listing of sessions used by the resume picker, sorting by modification date.

### 2. Agent Session (`core/agent-session.ts`)
- **Runtime State**: Wraps the raw `Conversation` object and adds environment context.
- **Event Bus**: Extends an event emitter to broadcast lifecycle events:
  - `agent_start` / `agent_end`
  - `message_start` / `message_update` / `message_end`
  - `tool_execution_start` / `tool_execution_end`
- **Output Management**:
  - Handles `HTML` export of session history.
  - Queuing mechanism for user messages when the agent is busy.

### 3. Settings Manager (`core/settings-manager.ts`)
- **Persistence**: Reads/Writes `~/.mini/agent/settings.json`.
- **Configuration**:
  - Default Model/Provider api keys.
  - Shell preferences (e.g., forcing a specific `bash` path).
  - UI preferences (e.g., queue mode behaviors).

## State Flow
1. **Selection**: CLI or TUI selects a session UUID.
2. **Hydration**: `SessionManager` reads the JSON, checking for corruption.
3. **Restoration**: The `AgentSession` is instantiated, and previous messages are loaded into the context window.
4. **Execution**: New messages append to this in-memory state and are periodically flushed to disk by the `SessionManager`.
