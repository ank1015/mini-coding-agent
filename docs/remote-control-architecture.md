# Remote Control Architecture

This document describes how to control the Mini Coding Agent remotely from any messaging platform, application, or device.

## Overview

The agent runs on your local machine (with access to your filesystem) while you control it from anywhere - your phone, a chat app, a web interface, or any other client.

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│     Client      │         │      Bot /      │         │     Agent       │
│  (Phone, Web,   │◀───────▶│     Bridge      │◀───────▶│   (RPC Mode)    │
│   Chat App)     │         │                 │         │                 │
└─────────────────┘         └─────────────────┘         └─────────────────┘
     Any device              Runs on your machine        Runs on your machine
                             Connects to platform        Accesses local files
```

## Core Components

### 1. Agent (RPC Mode)

The agent runs as a subprocess in RPC mode, communicating via JSON over stdin/stdout.

```bash
mini --mode rpc
```

**Capabilities:**
- Executes prompts and streams responses
- Manages sessions (create, continue, switch, branch)
- Accesses local filesystem via tools
- Persists conversation history

### 2. RpcClient

A programmatic client that spawns and communicates with the agent.

```typescript
import { RpcClient } from "@ank1015/mini-coding-agent";

const client = new RpcClient({
  cliPath: "/path/to/dist/cli.js",
  cwd: "/path/to/working/directory",
  args: ["--continue"],  // Continue last session
});

await client.start();
await client.prompt("What files are in src/?");
await client.waitForIdle();
await client.stop();
```

### 3. Bot / Bridge

Your custom integration that:
- Connects to the external platform (Discord, Slack, Telegram, HTTP API, etc.)
- Receives messages from users
- Routes them to the agent via RpcClient
- Sends responses back to users

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                            Your Machine                                  │
│                                                                          │
│  ┌─────────────────────────────────┐    ┌──────────────────────────────┐ │
│  │           Bot / Bridge          │    │        Agent Process         │ │
│  │                                 │    │        (mini --mode rpc)     │ │
│  │  ┌───────────────────────────┐  │    │                              │ │
│  │  │   Platform Connection     │  │    │  ┌────────────────────────┐  │ │
│  │  │   (Discord, Slack, HTTP)  │  │    │  │    Session Manager     │  │ │
│  │  └───────────────────────────┘  │    │  │    - Message history   │  │ │
│  │              │                  │    │  │    - Branching         │  │ │
│  │              ▼                  │    │  │    - Persistence       │  │ │
│  │  ┌───────────────────────────┐  │    │  └────────────────────────┘  │ │
│  │  │   Message Router          │  │    │              │               │ │
│  │  │   - User → Agent          │  │    │              ▼               │ │
│  │  │   - Agent → User          │  │    │  ┌────────────────────────┐  │ │
│  │  └───────────────────────────┘  │    │  │    LLM Integration     │  │ │
│  │              │                  │    │  │    - Streaming         │  │ │
│  │              ▼                  │    │  │    - Tool execution    │  │ │
│  │  ┌───────────────────────────┐  │    │  └────────────────────────┘  │ │
│  │  │      RpcClient            │  │    │              │               │ │
│  │  │                           │──-────▶    stdin     │               │ │
│  │  │                           │◀─┼────│    stdout    │               │ │
│  │  └───────────────────────────┘  │    │              ▼               │ │
│  │                                 │    │  ┌────────────────────────┐  │ │
│  │                                 │    │  │    Tools               │  │ │
│  │                                 │    │  │    - Read/Write files  │  │ │
│  │                                 │    │  │    - Run commands      │  │ │
│  │                                 │    │  │    - Search code       │  │ │
│  │                                 │    │  └────────────────────────┘  │ │
│  └─────────────────────────────────┘    └──────────────────────────────┘ │
│              │                                                           │
│              │ Outbound connection (encrypted)                           │
└──────────────│───────────────────────────────────────────────────────────┘
               ▼
    ┌─────────────────────┐
    │  External Platform  │
    │  (Discord, Slack,   │
    │   Telegram, etc.)   │
    └─────────────────────┘
               ▲
               │
    ┌──────────┴──────────┐
    │    Your Device      │
    │  (Phone, Tablet,    │
    │   Another Computer) │
    └─────────────────────┘
```

---

## RPC Protocol

### Communication Flow

```
Bot                          Agent (RPC Mode)
 │                                 │
 │  {"type": "prompt",             │
 │   "message": "Hello"}           │
 │────────────────────────────────▶│
 │                                 │
 │  {"type": "response",           │
 │   "command": "prompt",          │
 │   "success": true}              │
 │◀────────────────────────────────│
 │                                 │
 │  {"type": "agent_start"}        │
 │◀────────────────────────────────│
 │                                 │
 │  {"type": "message_start", ...} │
 │◀────────────────────────────────│
 │                                 │
 │  {"type": "message_update",...} │
 │◀────────────────────────────────│ (streaming)
 │                                 │
 │  {"type": "message_end", ...}   │
 │◀────────────────────────────────│
 │                                 │
 │  {"type": "agent_end"}          │
 │◀────────────────────────────────│
 │                                 │
```

### Command Types

| Command | Description |
|---------|-------------|
| `prompt` | Send a message to the agent |
| `queue_message` | Queue a message while agent is busy |
| `abort` | Cancel current operation |
| `reset` | Clear context, start fresh session |
| `get_state` | Get current session state |
| `get_messages` | Get all messages in session |
| `set_model` | Change the AI model |
| `get_available_models` | List available models |
| `switch_session` | Switch to different session file |
| `list_sessions` | List all sessions for working directory |
| `create_branch` | Create a conversation branch |
| `switch_branch` | Switch to different branch |
| `list_branches` | List all branches |
| `compact` | Compress conversation history |
| `export_html` | Export session to HTML |

See `src/modes/rpc/rpc-types.ts` for full type definitions.

---

## Building an Integration

### Step 1: Set Up RpcClient

```typescript
import { RpcClient } from "@ank1015/mini-coding-agent";

class AgentManager {
  private clients = new Map<string, RpcClient>();

  async getClient(workingDir: string, sessionId?: string): Promise<RpcClient> {
    const key = `${workingDir}:${sessionId || "default"}`;

    if (this.clients.has(key)) {
      return this.clients.get(key)!;
    }

    const args = sessionId
      ? ["--session", sessionId]
      : ["--continue"];

    const client = new RpcClient({
      cliPath: process.env.AGENT_CLI_PATH,
      cwd: workingDir,
      args,
    });

    await client.start();
    this.clients.set(key, client);
    return client;
  }

  async stopAll(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.stop();
    }
    this.clients.clear();
  }
}
```

### Step 2: Handle Incoming Messages

```typescript
async function handleUserMessage(
  userId: string,
  message: string,
  workingDir: string,
  sendResponse: (text: string) => Promise<void>
): Promise<void> {
  const agent = await agentManager.getClient(workingDir);

  // Collect response text
  let responseText = "";

  const unsubscribe = agent.onEvent((event) => {
    if (event.type === "message_end" && event.message.role === "assistant") {
      responseText = extractText(event.message);
    }
  });

  try {
    await agent.prompt(message);
    await agent.waitForIdle();
    await sendResponse(responseText);
  } finally {
    unsubscribe();
  }
}
```

### Step 3: Handle Streaming (Optional)

For real-time updates as the agent responds:

```typescript
async function handleUserMessageWithStreaming(
  message: string,
  workingDir: string,
  onChunk: (text: string) => void,
  onComplete: () => void
): Promise<void> {
  const agent = await agentManager.getClient(workingDir);

  const unsubscribe = agent.onEvent((event) => {
    if (event.type === "message_update") {
      const text = extractPartialText(event.message);
      onChunk(text);
    }
    if (event.type === "agent_end") {
      onComplete();
    }
  });

  try {
    await agent.prompt(message);
    await agent.waitForIdle();
  } finally {
    unsubscribe();
  }
}
```

### Step 4: Connect to Your Platform

```typescript
// Example: Generic message handler
interface MessagePlatform {
  onMessage(handler: (msg: IncomingMessage) => void): void;
  sendMessage(channelId: string, text: string): Promise<void>;
}

function connectPlatform(platform: MessagePlatform) {
  const agentManager = new AgentManager();

  platform.onMessage(async (msg) => {
    // Parse command (e.g., "!agent What is in src/")
    if (!msg.text.startsWith("!agent")) return;

    const prompt = msg.text.slice(7).trim();
    const workingDir = getUserWorkingDir(msg.userId);

    await handleUserMessage(
      msg.userId,
      prompt,
      workingDir,
      (response) => platform.sendMessage(msg.channelId, response)
    );
  });
}
```

---

## Session Management

### Working Directory Mapping

Map users/channels to working directories:

```typescript
const userProjects = new Map<string, string>();

// Set project for user
userProjects.set("user123", "/Users/me/projects/my-app");

// Commands to change project
if (message.startsWith("!project ")) {
  const path = message.slice(9).trim();
  userProjects.set(userId, path);
  return "Project set to: " + path;
}
```

### Session Continuity

```typescript
// Continue last session (default)
const client = new RpcClient({
  cwd: workingDir,
  args: ["--continue"],
});

// Start fresh session
const client = new RpcClient({
  cwd: workingDir,
  // no --continue flag
});

// Use specific session
const client = new RpcClient({
  cwd: workingDir,
  args: ["--session", "/path/to/session.jsonl"],
});

// List and switch sessions
const sessions = await client.listSessions();
await client.switchSession(sessions[0].file);
```

### Branching

Create conversation branches to explore alternatives:

```typescript
// Create branch from current point
await client.createBranch("experiment-1");

// Create branch from specific message
await client.createBranch("try-different-approach", messageNodeId);

// Switch between branches
await client.switchBranch("main");
await client.switchBranch("experiment-1");

// List branches
const branches = await client.listBranches();
```

---

## Security Considerations

### What's Protected

1. **Encrypted Communication**: Platform connections use TLS/WSS
2. **Outbound Only**: No ports opened on your machine
3. **Local Execution**: Agent runs locally, files never leave your machine

### Best Practices

1. **Protect Bot Tokens**: Store securely, never commit to git
2. **Restrict Users**: Validate who can send commands
3. **Limit Directories**: Restrict which directories the agent can access
4. **Audit Commands**: Log all commands for review

```typescript
// Example: User allowlist
const ALLOWED_USERS = new Set(["user123", "user456"]);

platform.onMessage(async (msg) => {
  if (!ALLOWED_USERS.has(msg.userId)) {
    return; // Ignore unauthorized users
  }
  // ... handle message
});
```

```typescript
// Example: Directory allowlist
const ALLOWED_DIRS = [
  "/Users/me/projects",
  "/Users/me/work",
];

function isAllowedDir(dir: string): boolean {
  return ALLOWED_DIRS.some(allowed => dir.startsWith(allowed));
}
```

---

## Platform-Specific Notes

### Discord
- Use `discord.js` library
- Bot connects via WebSocket (outbound)
- Supports message chunking for long responses (2000 char limit)

### Slack
- Use `@slack/bolt` library
- Enable **Socket Mode** for outbound-only connection
- Supports threading for organized conversations

### Telegram
- Use `telegraf` or `node-telegram-bot-api`
- Supports long polling (outbound) or webhooks
- Good for mobile-first usage

### HTTP API
- Build a simple REST or WebSocket server
- Useful for custom web interfaces
- Consider authentication (JWT, API keys)

---

## Example: Minimal Bot Template

```typescript
// bot.ts
import { RpcClient } from "@ank1015/mini-coding-agent";

interface BotConfig {
  cliPath: string;
  defaultWorkingDir: string;
}

export class AgentBot {
  private client: RpcClient | null = null;
  private config: BotConfig;

  constructor(config: BotConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    this.client = new RpcClient({
      cliPath: this.config.cliPath,
      cwd: this.config.defaultWorkingDir,
      args: ["--continue"],
    });
    await this.client.start();
  }

  async stop(): Promise<void> {
    await this.client?.stop();
    this.client = null;
  }

  async chat(message: string): Promise<string> {
    if (!this.client) throw new Error("Bot not started");

    await this.client.prompt(message);
    await this.client.waitForIdle();

    const messages = await this.client.getMessages();
    const last = messages.filter(m => m.role === "assistant").pop();

    return last ? this.extractText(last) : "No response";
  }

  async getState() {
    return this.client?.getState();
  }

  async switchProject(dir: string): Promise<void> {
    await this.stop();
    this.config.defaultWorkingDir = dir;
    await this.start();
  }

  private extractText(message: any): string {
    // Extract text content from assistant message
    for (const block of message.content) {
      if (block.type === "response") {
        for (const item of block.content) {
          if (item.type === "text") {
            return item.content;
          }
        }
      }
    }
    return "";
  }
}

// Usage
const bot = new AgentBot({
  cliPath: "/path/to/dist/cli.js",
  defaultWorkingDir: "/path/to/project",
});

await bot.start();
const response = await bot.chat("What files are in src/?");
console.log(response);
await bot.stop();
```

---

## Next Steps

1. Choose your platform (Discord, Slack, Telegram, custom HTTP)
2. Set up the bot connection to that platform
3. Use `RpcClient` to communicate with the agent
4. Map users/channels to working directories
5. Handle responses and send back to users

For platform-specific implementations, see:
- `src/modes/bots/discord-bot.ts` (coming soon)
- `src/modes/bots/slack-bot.ts` (coming soon)
