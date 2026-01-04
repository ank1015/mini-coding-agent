import type { Message, BaseAssistantMessage, ToolResultMessage, Api, AssistantToolCall } from "@ank1015/providers";
import { loadResultTrace } from "./utils.js";

// ============================================================================
// Type Definitions
// ============================================================================

export interface CostMetrics {
    cumulativeInputTokens: number;
    cumulativeOutputTokens: number;
    cumulativeCacheReadTokens: number;
    cumulativeCacheWriteTokens: number;
    cumulativeInputCost: number;
    cumulativeOutputCost: number;
    totalCost: number;
    // Derived
    avgCostPerTurn: number;
    costPerToolCall: number;
    // Token breakdown
    initialContextTokens: number;  // First turn input (system + user)
    finalContextTokens: number;    // Last turn input
    contextGrowth: number;         // finalContext - initialContext
}

export interface ContextMetrics {
    peakContext: number;
    finalContext: number;
    avgContext: number;
    contextGrowthCurve: number[];
    // Cache efficiency
    cacheHitRate: number;          // cacheRead / (cacheRead + freshInput)
    cacheUtilizationCurve: number[]; // Per-turn cache ratio
}

export interface ToolMetrics {
    toolCounts: Record<string, number>;
    toolErrors: Record<string, number>;
    totalToolCalls: number;
    totalToolErrors: number;
    firstTool: string | null;
    lastTool: string | null;
    // Sequences
    sequences2: Record<string, number>;
    sequences3: Record<string, number>;
    consecutiveRepeats: number;
    // Transition matrix
    transitionCounts: Record<string, Record<string, number>>;
    // Derived
    errorRate: number;
    avgToolCallsPerTurn: number;
    toolCallsPerTurn: number[];
}

export interface ErrorMetrics {
    totalErrors: number;
    errorRate: number;
    errorsByTool: Record<string, number>;
    errorRecoveryPatterns: Record<string, string[]>;  // tool that errored -> what was tried next
    maxConsecutiveErrors: number;
    errorsPerTurn: number[];
}

export interface EfficiencyMetrics {
    // Read-before-edit compliance
    totalEdits: number;
    editsWithPriorRead: number;
    readBeforeEditRate: number;
    // Write patterns
    totalWrites: number;
    writesWithPriorRead: number;
    readBeforeWriteRate: number;
    // Search patterns
    grepBeforeReadCount: number;
    findBeforeReadCount: number;
    // Exploration vs execution
    explorationCalls: number;      // read, grep, find, ls
    executionCalls: number;        // bash, edit, write
    explorationRatio: number;
}

export interface PatternMetrics {
    // File access patterns
    uniqueFilesRead: string[];
    uniqueFilesWritten: string[];
    uniqueFilesEdited: string[];
    totalFilesAccessed: number;
    // File operations
    fileAccessSequence: Array<{ file: string; operation: string }>;
    // Bash usage
    bashCommands: string[];
    uniqueBashCommands: number;
}

export interface TurnMetrics {
    totalTurns: number;
    avgOutputTokensPerTurn: number;
    avgInputTokensPerTurn: number;
    outputTokensPerTurn: number[];
    inputTokensPerTurn: number[];
    toolCallsPerTurn: number[];
    turnDetails: TurnDetail[];
}

export interface TurnDetail {
    turnIndex: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    toolCalls: string[];
    hadError: boolean;
    duration: number;
    stopReason: string;
}

export interface QuantitativeResult {
    taskName: string;
    cost: CostMetrics;
    context: ContextMetrics;
    tools: ToolMetrics;
    errors: ErrorMetrics;
    efficiency: EfficiencyMetrics;
    patterns: PatternMetrics;
    turns: TurnMetrics;
}

// ============================================================================
// Helper Functions
// ============================================================================

function getAssistantMessages(messages: Message[]): BaseAssistantMessage<Api>[] {
    return messages.filter((m): m is BaseAssistantMessage<Api> => m.role === 'assistant');
}

function getToolResultMessages(messages: Message[]): ToolResultMessage[] {
    return messages.filter((m): m is ToolResultMessage => m.role === 'toolResult');
}

function extractToolCallsFromAssistant(message: BaseAssistantMessage<Api>): AssistantToolCall[] {
    return message.content.filter((c): c is AssistantToolCall => c.type === 'toolCall');
}

// ============================================================================
// Analysis Functions
// ============================================================================

function analyzeCosts(assistantMessages: BaseAssistantMessage<Api>[], totalToolCalls: number): CostMetrics {
    let cumulativeInputTokens = 0;
    let cumulativeOutputTokens = 0;
    let cumulativeCacheReadTokens = 0;
    let cumulativeCacheWriteTokens = 0;
    let cumulativeInputCost = 0;
    let cumulativeOutputCost = 0;
    let totalCost = 0;
    let initialContextTokens = 0;
    let finalContextTokens = 0;

    assistantMessages.forEach((message, index) => {
        const usage = message.usage;

        cumulativeInputTokens += usage.input;
        cumulativeOutputTokens += usage.output;
        cumulativeCacheReadTokens += usage.cacheRead;
        cumulativeCacheWriteTokens += usage.cacheWrite;
        cumulativeInputCost += usage.cost.input + usage.cost.cacheRead;
        cumulativeOutputCost += usage.cost.output + usage.cost.cacheWrite;
        totalCost += usage.cost.total;

        if (index === 0) {
            initialContextTokens = usage.input + usage.cacheRead;
        }
        if (index === assistantMessages.length - 1) {
            finalContextTokens = usage.input + usage.cacheRead;
        }
    });

    const turnCount = assistantMessages.length;

    return {
        cumulativeInputTokens,
        cumulativeOutputTokens,
        cumulativeCacheReadTokens,
        cumulativeCacheWriteTokens,
        cumulativeInputCost,
        cumulativeOutputCost,
        totalCost,
        avgCostPerTurn: turnCount > 0 ? totalCost / turnCount : 0,
        costPerToolCall: totalToolCalls > 0 ? totalCost / totalToolCalls : 0,
        initialContextTokens,
        finalContextTokens,
        contextGrowth: finalContextTokens - initialContextTokens,
    };
}

function analyzeContext(assistantMessages: BaseAssistantMessage<Api>[]): ContextMetrics {
    let peakContext = 0;
    let totalContext = 0;
    const contextGrowthCurve: number[] = [];
    const cacheUtilizationCurve: number[] = [];
    let totalCacheRead = 0;
    let totalFreshInput = 0;

    assistantMessages.forEach((message) => {
        const usage = message.usage;
        const contextSize = usage.input + usage.cacheRead;

        contextGrowthCurve.push(contextSize);
        totalContext += contextSize;

        if (contextSize > peakContext) {
            peakContext = contextSize;
        }

        // Cache utilization for this turn
        const turnTotal = usage.input + usage.cacheRead;
        const cacheRatio = turnTotal > 0 ? usage.cacheRead / turnTotal : 0;
        cacheUtilizationCurve.push(cacheRatio);

        totalCacheRead += usage.cacheRead;
        totalFreshInput += usage.input;
    });

    const turnCount = assistantMessages.length;
    const totalInputActivity = totalCacheRead + totalFreshInput;

    return {
        peakContext,
        finalContext: contextGrowthCurve[contextGrowthCurve.length - 1] || 0,
        avgContext: turnCount > 0 ? totalContext / turnCount : 0,
        contextGrowthCurve,
        cacheHitRate: totalInputActivity > 0 ? totalCacheRead / totalInputActivity : 0,
        cacheUtilizationCurve,
    };
}

function analyzeToolUsage(
    toolResultMessages: ToolResultMessage[],
    assistantMessages: BaseAssistantMessage<Api>[]
): ToolMetrics {
    const toolCounts: Record<string, number> = {};
    const toolErrors: Record<string, number> = {};
    let totalToolCalls = 0;
    let totalToolErrors = 0;
    let firstTool: string | null = null;
    let lastTool: string | null = null;
    let consecutiveRepeats = 0;
    const sequences2: Record<string, number> = {};
    const sequences3: Record<string, number> = {};
    const transitionCounts: Record<string, Record<string, number>> = {};

    toolResultMessages.forEach((message, index) => {
        const toolName = message.toolName;
        totalToolCalls++;

        if (index === 0) {
            firstTool = toolName;
        }

        // Counts
        toolCounts[toolName] = (toolCounts[toolName] || 0) + 1;

        if (message.isError) {
            toolErrors[toolName] = (toolErrors[toolName] || 0) + 1;
            totalToolErrors++;
        }

        // Transitions
        if (index < toolResultMessages.length - 1) {
            const next = toolResultMessages[index + 1];

            // Transition matrix
            if (!transitionCounts[toolName]) transitionCounts[toolName] = {};
            transitionCounts[toolName][next.toolName] = (transitionCounts[toolName][next.toolName] || 0) + 1;

            // Consecutive repeats
            if (toolName === next.toolName) {
                consecutiveRepeats++;
            }

            // 2-gram sequences
            const seq2 = `${toolName} -> ${next.toolName}`;
            sequences2[seq2] = (sequences2[seq2] || 0) + 1;

            // 3-gram sequences
            if (index < toolResultMessages.length - 2) {
                const next2 = toolResultMessages[index + 2];
                const seq3 = `${toolName} -> ${next.toolName} -> ${next2.toolName}`;
                sequences3[seq3] = (sequences3[seq3] || 0) + 1;
            }
        }

        if (index === toolResultMessages.length - 1) {
            lastTool = toolName;
        }
    });

    // Calculate tool calls per turn
    const toolCallsPerTurn: number[] = assistantMessages.map(msg => {
        return extractToolCallsFromAssistant(msg).length;
    });

    const turnCount = assistantMessages.length;

    return {
        toolCounts,
        toolErrors,
        totalToolCalls,
        totalToolErrors,
        firstTool,
        lastTool,
        sequences2,
        sequences3,
        consecutiveRepeats,
        transitionCounts,
        errorRate: totalToolCalls > 0 ? totalToolErrors / totalToolCalls : 0,
        avgToolCallsPerTurn: turnCount > 0 ? totalToolCalls / turnCount : 0,
        toolCallsPerTurn,
    };
}

function analyzeErrors(toolResultMessages: ToolResultMessage[]): ErrorMetrics {
    const errorsByTool: Record<string, number> = {};
    const errorRecoveryPatterns: Record<string, string[]> = {};
    const errorsPerTurn: number[] = [];
    let totalErrors = 0;
    let maxConsecutiveErrors = 0;
    let currentConsecutiveErrors = 0;

    toolResultMessages.forEach((message, index) => {
        if (message.isError) {
            totalErrors++;
            currentConsecutiveErrors++;

            errorsByTool[message.toolName] = (errorsByTool[message.toolName] || 0) + 1;

            // Track what tool was tried after this error
            if (index < toolResultMessages.length - 1) {
                const nextTool = toolResultMessages[index + 1].toolName;
                if (!errorRecoveryPatterns[message.toolName]) {
                    errorRecoveryPatterns[message.toolName] = [];
                }
                errorRecoveryPatterns[message.toolName].push(nextTool);
            }

            if (currentConsecutiveErrors > maxConsecutiveErrors) {
                maxConsecutiveErrors = currentConsecutiveErrors;
            }
        } else {
            currentConsecutiveErrors = 0;
        }
    });

    return {
        totalErrors,
        errorRate: toolResultMessages.length > 0 ? totalErrors / toolResultMessages.length : 0,
        errorsByTool,
        errorRecoveryPatterns,
        maxConsecutiveErrors,
        errorsPerTurn,  // Would need turn correlation to populate
    };
}

function analyzeEfficiency(
    toolResultMessages: ToolResultMessage[],
    assistantMessages: BaseAssistantMessage<Api>[]
): EfficiencyMetrics {
    // Track file access for read-before-edit/write analysis
    const recentReads = new Set<string>();
    let totalEdits = 0;
    let editsWithPriorRead = 0;
    let totalWrites = 0;
    let writesWithPriorRead = 0;
    let grepBeforeReadCount = 0;
    let findBeforeReadCount = 0;
    let explorationCalls = 0;
    let executionCalls = 0;

    // We need to correlate tool results with tool calls to get file paths
    // Build a map of toolCallId -> tool call args
    const toolCallArgs = new Map<string, Record<string, any>>();

    assistantMessages.forEach(msg => {
        const toolCalls = extractToolCallsFromAssistant(msg);
        toolCalls.forEach(tc => {
            toolCallArgs.set(tc.toolCallId, tc.arguments || {});
        });
    });

    // Track previous tool for grep->read and find->read patterns
    let previousTool: string | null = null;

    toolResultMessages.forEach((message) => {
        const toolName = message.toolName;
        const args = toolCallArgs.get(message.toolCallId) || {};
        const filePath = args.path || args.file_path || args.filePath || args.file || null;

        // Categorize tools
        const explorationTools = ['read', 'grep', 'find', 'ls'];
        const executionTools = ['bash', 'edit', 'write'];

        if (explorationTools.includes(toolName)) {
            explorationCalls++;
        }
        if (executionTools.includes(toolName)) {
            executionCalls++;
        }

        // Track reads for read-before-edit/write
        if (toolName === 'read' && filePath && !message.isError) {
            recentReads.add(filePath);

            // Check grep->read or find->read pattern
            if (previousTool === 'grep') {
                grepBeforeReadCount++;
            }
            if (previousTool === 'find') {
                findBeforeReadCount++;
            }
        }

        // Check edit compliance
        if (toolName === 'edit' && filePath) {
            totalEdits++;
            if (recentReads.has(filePath)) {
                editsWithPriorRead++;
            }
        }

        // Check write compliance
        if (toolName === 'write' && filePath) {
            totalWrites++;
            if (recentReads.has(filePath)) {
                writesWithPriorRead++;
            }
        }

        previousTool = toolName;
    });

    const totalCalls = explorationCalls + executionCalls;

    return {
        totalEdits,
        editsWithPriorRead,
        readBeforeEditRate: totalEdits > 0 ? editsWithPriorRead / totalEdits : 1,
        totalWrites,
        writesWithPriorRead,
        readBeforeWriteRate: totalWrites > 0 ? writesWithPriorRead / totalWrites : 1,
        grepBeforeReadCount,
        findBeforeReadCount,
        explorationCalls,
        executionCalls,
        explorationRatio: totalCalls > 0 ? explorationCalls / totalCalls : 0,
    };
}

function analyzePatterns(
    toolResultMessages: ToolResultMessage[],
    assistantMessages: BaseAssistantMessage<Api>[]
): PatternMetrics {
    const filesRead = new Set<string>();
    const filesWritten = new Set<string>();
    const filesEdited = new Set<string>();
    const fileAccessSequence: Array<{ file: string; operation: string }> = [];
    const bashCommands: string[] = [];
    const bashCommandSet = new Set<string>();

    // Build toolCallId -> args map
    const toolCallArgs = new Map<string, Record<string, any>>();
    assistantMessages.forEach(msg => {
        const toolCalls = extractToolCallsFromAssistant(msg);
        toolCalls.forEach(tc => {
            toolCallArgs.set(tc.toolCallId, tc.arguments || {});
        });
    });

    toolResultMessages.forEach((message) => {
        const toolName = message.toolName;
        const args = toolCallArgs.get(message.toolCallId) || {};
        const filePath = args.path || args.file_path || args.filePath || args.file || null;

        if (filePath && !message.isError) {
            if (toolName === 'read') {
                filesRead.add(filePath);
                fileAccessSequence.push({ file: filePath, operation: 'read' });
            }
            if (toolName === 'write') {
                filesWritten.add(filePath);
                fileAccessSequence.push({ file: filePath, operation: 'write' });
            }
            if (toolName === 'edit') {
                filesEdited.add(filePath);
                fileAccessSequence.push({ file: filePath, operation: 'edit' });
            }
        }

        // Track bash commands
        if (toolName === 'bash') {
            const command = args.command || args.cmd || null;
            if (command) {
                bashCommands.push(command);
                bashCommandSet.add(command);
            }
        }
    });

    const allFiles = new Set([...filesRead, ...filesWritten, ...filesEdited]);

    return {
        uniqueFilesRead: Array.from(filesRead),
        uniqueFilesWritten: Array.from(filesWritten),
        uniqueFilesEdited: Array.from(filesEdited),
        totalFilesAccessed: allFiles.size,
        fileAccessSequence,
        bashCommands,
        uniqueBashCommands: bashCommandSet.size,
    };
}

function analyzeTurns(assistantMessages: BaseAssistantMessage<Api>[]): TurnMetrics {
    const outputTokensPerTurn: number[] = [];
    const inputTokensPerTurn: number[] = [];
    const toolCallsPerTurn: number[] = [];
    const turnDetails: TurnDetail[] = [];
    let totalOutputTokens = 0;
    let totalInputTokens = 0;

    assistantMessages.forEach((message, index) => {
        const usage = message.usage;
        const toolCalls = extractToolCallsFromAssistant(message);
        const toolNames = toolCalls.map(tc => tc.name);

        outputTokensPerTurn.push(usage.output);
        inputTokensPerTurn.push(usage.input + usage.cacheRead);
        toolCallsPerTurn.push(toolCalls.length);

        totalOutputTokens += usage.output;
        totalInputTokens += usage.input + usage.cacheRead;

        // Check if any tool call in this turn resulted in error
        // Note: We can't directly correlate without tool results, so we'll mark as false for now
        // A more complete implementation would correlate with tool results

        turnDetails.push({
            turnIndex: index,
            inputTokens: usage.input + usage.cacheRead,
            outputTokens: usage.output,
            cacheReadTokens: usage.cacheRead,
            toolCalls: toolNames,
            hadError: false,  // Would need correlation with tool results
            duration: message.duration,
            stopReason: message.stopReason,
        });
    });

    const turnCount = assistantMessages.length;

    return {
        totalTurns: turnCount,
        avgOutputTokensPerTurn: turnCount > 0 ? totalOutputTokens / turnCount : 0,
        avgInputTokensPerTurn: turnCount > 0 ? totalInputTokens / turnCount : 0,
        outputTokensPerTurn,
        inputTokensPerTurn,
        toolCallsPerTurn,
        turnDetails,
    };
}

// ============================================================================
// Empty Result Factory
// ============================================================================

function createEmptyResult(taskName: string): QuantitativeResult {
    return {
        taskName,
        cost: {
            cumulativeInputTokens: 0,
            cumulativeOutputTokens: 0,
            cumulativeCacheReadTokens: 0,
            cumulativeCacheWriteTokens: 0,
            cumulativeInputCost: 0,
            cumulativeOutputCost: 0,
            totalCost: 0,
            avgCostPerTurn: 0,
            costPerToolCall: 0,
            initialContextTokens: 0,
            finalContextTokens: 0,
            contextGrowth: 0,
        },
        context: {
            peakContext: 0,
            finalContext: 0,
            avgContext: 0,
            contextGrowthCurve: [],
            cacheHitRate: 0,
            cacheUtilizationCurve: [],
        },
        tools: {
            toolCounts: {},
            toolErrors: {},
            totalToolCalls: 0,
            totalToolErrors: 0,
            firstTool: null,
            lastTool: null,
            sequences2: {},
            sequences3: {},
            consecutiveRepeats: 0,
            transitionCounts: {},
            errorRate: 0,
            avgToolCallsPerTurn: 0,
            toolCallsPerTurn: [],
        },
        errors: {
            totalErrors: 0,
            errorRate: 0,
            errorsByTool: {},
            errorRecoveryPatterns: {},
            maxConsecutiveErrors: 0,
            errorsPerTurn: [],
        },
        efficiency: {
            totalEdits: 0,
            editsWithPriorRead: 0,
            readBeforeEditRate: 1,
            totalWrites: 0,
            writesWithPriorRead: 0,
            readBeforeWriteRate: 1,
            grepBeforeReadCount: 0,
            findBeforeReadCount: 0,
            explorationCalls: 0,
            executionCalls: 0,
            explorationRatio: 0,
        },
        patterns: {
            uniqueFilesRead: [],
            uniqueFilesWritten: [],
            uniqueFilesEdited: [],
            totalFilesAccessed: 0,
            fileAccessSequence: [],
            bashCommands: [],
            uniqueBashCommands: 0,
        },
        turns: {
            totalTurns: 0,
            avgOutputTokensPerTurn: 0,
            avgInputTokensPerTurn: 0,
            outputTokensPerTurn: [],
            inputTokensPerTurn: [],
            toolCallsPerTurn: [],
            turnDetails: [],
        },
    };
}

// ============================================================================
// Main Analysis Function
// ============================================================================

/**
 * Perform comprehensive quantitative analysis on an evaluation result.
 *
 * @param resultDir - Directory containing the evaluation results
 * @param taskName - Name of the task being analyzed
 * @returns QuantitativeResult with all metrics, or empty result if no messages
 */
export const performQuantitativeAnalysis = async (
    resultDir: string,
    taskName: string
): Promise<QuantitativeResult> => {
    const trace = loadResultTrace(resultDir);

    if (!trace.messages || trace.messages.length === 0) {
        return createEmptyResult(taskName);
    }

    const assistantMessages = getAssistantMessages(trace.messages);
    const toolResultMessages = getToolResultMessages(trace.messages);

    // Run all analyses
    const toolMetrics = analyzeToolUsage(toolResultMessages, assistantMessages);
    const costMetrics = analyzeCosts(assistantMessages, toolMetrics.totalToolCalls);
    const contextMetrics = analyzeContext(assistantMessages);
    const errorMetrics = analyzeErrors(toolResultMessages);
    const efficiencyMetrics = analyzeEfficiency(toolResultMessages, assistantMessages);
    const patternMetrics = analyzePatterns(toolResultMessages, assistantMessages);
    const turnMetrics = analyzeTurns(assistantMessages);

    return {
        taskName,
        cost: costMetrics,
        context: contextMetrics,
        tools: toolMetrics,
        errors: errorMetrics,
        efficiency: efficiencyMetrics,
        patterns: patternMetrics,
        turns: turnMetrics,
    };
};
