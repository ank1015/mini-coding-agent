import type {
    Api,
    BaseAssistantMessage,
    Message,
    Model,
    OptionsForApi,
    ToolResultMessage,
    UserMessage,
    AssistantToolCall,
    TextContent,
    Content,
} from "@ank1015/providers";
import { complete, generateUUID } from "@ank1015/providers";
import { loadResultTrace } from "./utils.js";

// ============================================================================
// Type Definitions
// ============================================================================

export interface LLMJudgeConfig {
    model: Model<Api>;
    providerOptions: OptionsForApi<Api>;
}

export interface LLMJudgeResult {
    taskName: string;
    passed: boolean;
    analysis: string;
    model: string;
    tokenUsage: {
        input: number;
        output: number;
        total: number;
    };
}

// ============================================================================
// System Prompt
// ============================================================================

const SYSTEM_PROMPT = `You are an expert evaluator analyzing the behavior of an AI coding agent. Your task is to provide deep, actionable insights that can help improve the agent's performance.

## About the Coding Agent Being Evaluated

The coding agent is an AI assistant designed to help users with software engineering tasks. It operates in a terminal environment with access to the following tools:

- **read**: Read file contents (text files and images)
- **bash**: Execute bash commands in the terminal
- **edit**: Make surgical edits to files by finding exact text and replacing it
- **write**: Create or overwrite files
- **grep**: Search file contents for patterns (respects .gitignore)
- **find**: Find files by glob pattern (respects .gitignore)
- **ls**: List directory contents

## Your Evaluation Perspective

**Critical**: You must analyze from the agent's perspective. Consider:
- What information was visible to the agent at each step?
- What decisions did it make and why might it have made them?
- Where did its reasoning go right or wrong?

The reference solution script may use different approaches (e.g., bash commands, different languages). The agent's solution doesn't need to match exactly - it just needs to achieve the same outcome. Focus on whether the agent's approach was reasonable and effective.

## Analysis Guidelines

Be specific and actionable. Instead of saying "the agent made mistakes", identify:
- The exact step where things went wrong
- What the agent should have noticed or done differently
- What pattern of behavior led to the issue

Preserve exact file paths, error messages, and command outputs in your analysis when relevant.`;

// ============================================================================
// Prompts for Different Outcomes
// ============================================================================

const FAILED_TASK_PROMPT = `## Your Task

The coding agent **FAILED** this task. Analyze the conversation trace and provide insights.

Answer these questions in your analysis:

### 1. Task Understanding
- Did the agent correctly understand what was being asked?
- Did it identify all requirements and constraints?

### 2. Critical Failure Point
- At what specific point did the agent go off track?
- What was the first sign of trouble?
- Was there a "point of no return" where recovery became difficult?

### 3. Root Cause Analysis
Categorize the failure:
- **Reasoning Error**: Wrong approach or flawed logic
- **Execution Error**: Right approach but poor implementation
- **Knowledge Gap**: Lacked necessary knowledge or techniques
- **Tool Misuse**: Used tools incorrectly or inefficiently
- **Persistence Issue**: Gave up too early or got stuck in loops
- **Others**: Any other sources or errors like rate limits or any unexpected errors.

### 4. Missed Opportunities
- What information was available to the agent that it missed or misinterpreted?
- Were there error messages or outputs that should have guided it differently?
- What tools or approaches could have helped but weren't used?

### 5. Comparison with Reference Solution
- How does the reference solution approach differ from what the agent tried?
- What key insight or technique did the agent miss?

### 6. Recommendations
- What specific changes to the agent's behavior would have led to success?
- Are there patterns here that suggest system prompt or tool improvements?

Provide a thorough analysis that would help improve the agent's performance on similar tasks.`;


const PASSED_TASK_PROMPT = `## Your Task

The coding agent **PASSED** this task. Analyze the conversation trace for optimization opportunities and lessons learned.

Answer these questions in your analysis:

### 1. Solution Quality
- Was the approach sound and well-reasoned?
- Did the solution correctly address all requirements?

### 2. Efficiency Analysis
- Were there unnecessary steps or redundant tool calls?
- Did the agent explore too much before acting, or not enough?
- Could the same result have been achieved with fewer tokens/steps?

### 3. Path Analysis
- Did the agent take a direct path or a roundabout one?
- Were there any detours or false starts before finding the right approach?
- What caused any inefficiencies?

### 4. Tool Usage
- Were tools used appropriately and efficiently?
- Did the agent follow best practices (read before edit, etc.)?
- Were there better tool choices available?

### 5. Comparison with Reference Solution
- How does the agent's approach compare to the reference solution?
- Did the agent find a creative or alternative valid approach?
- Was the agent's approach more or less elegant?

### 6. Lessons Learned
- What did the agent do well that should be reinforced?
- What patterns emerged that could be optimized?
- Any suggestions for handling similar tasks more efficiently?

Provide insights that could help the agent perform even better on similar tasks.`;

// ============================================================================
// Trace Formatting
// ============================================================================

function formatMessageContent(content: Content): string {

    return content.map((block) => {
            if (block.type === "text") {
                return block.content;
            }
            if (block.type === "image") {
                return "[Image attachment]";
            }
            if (block.type === "file") {
                return `[File: ${block.filename}]`;
            }
            return "[Unknown content type]";
        })
        .join("\n");
}

function formatToolCall(toolCall: AssistantToolCall): string {
    const args = toolCall.arguments || {};
    const argsStr = Object.entries(args)
        .map(([key, value]) => {
            const valueStr = typeof value === "string"
                ? (value.length > 500 ? value.substring(0, 500) + "... [truncated]" : value)
                : JSON.stringify(value);
            return `  ${key}: ${valueStr}`;
        })
        .join("\n");

    return `**Tool Call: ${toolCall.name}**\n\`\`\`\n${argsStr}\n\`\`\``;
}

function formatAssistantMessage(message: BaseAssistantMessage<Api>, index: number): string {
    const parts: string[] = [];
    parts.push(`### Assistant Response #${index + 1}`);
    parts.push(`*Stop Reason: ${message.stopReason}`);

    for (const block of message.content) {
        if (block.type === "response") {
            const text = formatMessageContent(block.content);
            if (text.trim()) {
                parts.push(text);
            }
        } else if (block.type === "thinking") {
            parts.push(`<thinking>\n${block.thinkingText}\n</thinking>`);
        } else if (block.type === "toolCall") {
            parts.push(formatToolCall(block));
        }
    }

    if(message.errorMessage){
        parts.push(`**Error Received: ${message.errorMessage}`)
    }

    return parts.join("\n");
}

function formatToolResult(message: ToolResultMessage): string {
    const status = message.isError ? "ERROR" : "SUCCESS";
    const content = formatMessageContent(message.content);

    // Truncate very long tool results
    // const maxLength = 2000;
    // const truncatedContent = content.length > maxLength
    //     ? content.substring(0, maxLength) + "\n... [output truncated]"
    //     : content;

    let result = `**Tool Result: ${message.toolName}** [${status}]\n`;

    if (message.isError && message.error) {
        result += `Error: ${message.error.message}\n`;
    }

    result += `\`\`\`\n${content}\n\`\`\``;

    return result;
}

function formatUserMessage(message: UserMessage, isFirst: boolean): string {
    const content = formatMessageContent(message.content);
    const header = isFirst ? "### Task (User Request)" : "### User Message";
    return `${header}\n\n${content}`;
}

function formatTraceAsMarkdown(messages: Message[]): string {
    const parts: string[] = [];
    let assistantCount = 0;
    let isFirstUser = true;

    for (const message of messages) {
        if (message.role === "user") {
            parts.push(formatUserMessage(message as UserMessage, isFirstUser));
            isFirstUser = false;
        } else if (message.role === "assistant") {
            parts.push(formatAssistantMessage(message as BaseAssistantMessage<Api>, assistantCount));
            assistantCount++;
        } else if (message.role === "toolResult") {
            parts.push(formatToolResult(message as ToolResultMessage));
        }
        // Skip custom messages for now
    }

    return parts.join("\n\n---\n\n");
}

function formatTestResults(testResults: any[] | undefined): string {
    if (!testResults || testResults.length === 0) {
        return "No detailed test results available.";
    }

    const parts: string[] = [];

    for (const result of testResults) {
        if (result.results) {
            const summary = result.results.summary;
            if (summary) {
                parts.push(`**Test Summary**: ${summary.passed}/${summary.tests} passed, ${summary.failed} failed`);
            }

            if (result.results.tests) {
                const failedTests = result.results.tests.filter((t: any) => t.status === "failed");
                if (failedTests.length > 0) {
                    parts.push("\n**Failed Tests:**");
                    for (const test of failedTests.slice(0, 10)) { // Limit to first 10
                        parts.push(`- ${test.name}`);
                    }
                    if (failedTests.length > 10) {
                        parts.push(`... and ${failedTests.length - 10} more`);
                    }
                }
            }
        }
    }

    return parts.length > 0 ? parts.join("\n") : "No detailed test results available.";
}

// ============================================================================
// Main Analysis Function
// ============================================================================

function buildAnalysisContext(
    messages: Message[],
    solution: string | undefined,
    testResults: any[] | undefined,
    passed: boolean
): string {
    const parts: string[] = [];

    // Conversation trace
    parts.push("# Conversation Trace\n");
    parts.push(formatTraceAsMarkdown(messages));

    // Reference solution
    parts.push("\n\n# Reference Solution\n");
    if (solution) {
        parts.push("```bash\n" + solution + "\n```");
    } else {
        parts.push("*No reference solution available*");
    }

    // Test results summary
    parts.push("\n\n# Test Results\n");
    parts.push(formatTestResults(testResults));

    // Analysis prompt based on outcome
    parts.push("\n\n# Analysis Request\n");
    parts.push(passed ? PASSED_TASK_PROMPT : FAILED_TASK_PROMPT);

    return parts.join("\n");
}

function extractResponseText(response: BaseAssistantMessage<Api>): string {
    const textParts: string[] = [];

    for (const block of response.content) {
        if (block.type === "response") {
            const text = block.content
                .filter((c): c is TextContent => c.type === "text")
                .map((c) => c.content)
                .join("\n");
            if (text) textParts.push(text);
        }
    }

    return textParts.join("\n");
}

/**
 * Perform LLM-as-judge analysis on an evaluation result.
 *
 * @param resultDir - Directory containing the evaluation results
 * @param taskName - Name of the task being analyzed
 * @param config - LLM configuration (model and provider options)
 * @returns LLMJudgeResult with the analysis
 */
export async function performLLMJudgeAnalysis(
    resultDir: string,
    taskName: string,
    config: LLMJudgeConfig
): Promise<LLMJudgeResult> {
    const trace = loadResultTrace(resultDir);

    if (!trace.messages || trace.messages.length === 0) {
        return {
            taskName,
            passed: trace.isPass,
            analysis: "No conversation trace available for analysis.",
            model: config.model.id,
            tokenUsage: { input: 0, output: 0, total: 0 },
        };
    }

    // Build the analysis context
    const analysisContext = buildAnalysisContext(
        trace.messages,
        trace.solution,
        trace.testResults,
        trace.isPass
    );

    // Call the LLM
    const response = await complete(
        config.model,
        {
            systemPrompt: SYSTEM_PROMPT,
            messages: [
                {
                    role: "user",
                    id: generateUUID(),
                    timestamp: Date.now(),
                    content: [{ type: "text", content: analysisContext }],
                },
            ],
        },
        config.providerOptions
    );

    const analysis = extractResponseText(response);

    return {
        taskName,
        passed: trace.isPass,
        analysis,
        model: config.model.id,
        tokenUsage: {
            input: response.usage.input + response.usage.cacheRead,
            output: response.usage.output,
            total: response.usage.totalTokens,
        },
    };
}
