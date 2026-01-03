import { loadResultTrace } from "./utils.js"

interface QuantitativeAnalysis {

}

/**
* Perform quantitative analysis
*/
export const performQuantitativeAnalysis = async (resultDir: string, taskName: string) => {
    const trace = loadResultTrace(resultDir);

    if(!trace.messages) return undefined;

    const assistantMessages = trace.messages.filter(message => message.role === 'assistant');
    const toolResultMessages = trace.messages.filter(message => message.role === 'toolResult');

    // cumm tokens variables
    let cummInputTokens = 0;
    let cummOutputTokens = 0;
    let cummInputCost = 0;
    let cummOutputCost = 0;
    let totalCost = 0;
    // user and tool tokens variables
    let userTokenCount = 0;
    let toolTokesCount = 0;
    // context (input to assistant) variables
    let peakContext = 0;
    let finalContext = 0;
    let avgContext = 0;
    let contextGrowthCurve: number[] = [];
    // tool usage variables
    const toolCounts: Record<string, number> = {};
    const toolErrors: Record<string, number> = {};
    let totalToolCalls = 0;
    let firstTool = null;
    let lastTool = null;
    const sequences2: Record<string, number> = {};
    const sequences3: Record<string, number> = {};
    let repeatsType = 0;
    const transitionCounts: Record<string, Record<string, number>> = {}; // from -> to -> count

    assistantMessages.map((message, index) => {
        if(index === 0){
            userTokenCount = message.usage.input;
            peakContext = message.usage.input
        }
        cummInputTokens += message.usage.input + message.usage.cacheRead;
        cummOutputTokens += message.usage.output + message.usage.cacheWrite;
        cummInputCost += message.usage.cost.input + message.usage.cost.cacheRead;
        cummOutputCost += message.usage.cost.output + message.usage.cost.cacheWrite;
        totalCost += message.usage.cost.total;
        if(peakContext < (message.usage.input + message.usage.cacheRead)){
            peakContext = message.usage.input + message.usage.cacheRead
        }
        avgContext = (avgContext*index + message.usage.cacheRead + message.usage.input)/(index + 1)
        contextGrowthCurve.push((message.usage.cacheRead + message.usage.input))
        if(index === assistantMessages.length - 1){
            toolTokesCount = message.usage.totalTokens - userTokenCount - cummOutputTokens
            finalContext = message.usage.cacheRead + message.usage.input
        }
    })

    toolResultMessages.map((message, index) => {
        const id = message.toolCallId;
        const toolName = message.toolName;
        const isError = message.isError;
        totalToolCalls++ ;

        if(index === 0){
            firstTool = toolName
        }
        
        // Counts
        toolCounts[toolName] = (toolCounts[toolName] || 0) + 1
        if(isError){
            toolErrors[toolName] = (toolErrors[toolName] || 0) + 1;
        }

        // Transitions (for Matrix)
        if(index < toolResultMessages.length - 1){
            const next = toolResultMessages[index+1];
            if (!transitionCounts[toolName]) transitionCounts[toolName] = {};
            transitionCounts[toolName][next.toolName] = (transitionCounts[toolName][next.toolName] || 0) + 1;

            // Repeats Type
            if (toolName === next.toolName) {
                repeatsType++;
            }

            // Seq 2
            const seq2 = `${toolName} -> ${next.toolName}`;
            sequences2[seq2] = (sequences2[seq2] || 0) + 1;

            // Seq 3
            if (index < toolResultMessages.length - 2) {
                const next2 = toolResultMessages[index+2];
                const seq3 = `${toolName} -> ${next.toolName} -> ${next2.toolName}`;
                sequences3[seq3] = (sequences3[seq3] || 0) + 1;
            }

        }

        if(index === toolResultMessages.length - 1){
            lastTool = toolName
        }
    })

    const result = {
        cost: {
            cummInputCost,
            cummOutputCost,
            cummInputTokens,
            cummOutputTokens,
            totalCost,
            userTokenCount,
            toolTokesCount
        },
        context: {
            peakContext,
            finalContext,
            avgContext,
            contextGrowthCurve
        },
        tools: {
            toolCounts,
            toolErrors,
            totalToolCalls,
            firstTool,
            lastTool,
            sequences2,
            sequences3,
            transitionCounts
        }
    }

}
