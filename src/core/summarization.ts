import { Api, complete, generateUUID, getModel, Message, Model, OptionsForApi } from "@ank1015/providers";

const BRANCH_SUMMARY_PROMPT = `Create a structured summary of this conversation branch for context when returning later.

Use this EXACT format:

## Goal
[What was the user trying to accomplish in this branch?]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Work that was started but not finished]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [What should happen next to continue this work]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;


const NODE_SUMMARIZATION_PROMPT = `The messages above are part of a conversation to summarize. Create a structured context checkpoint summary of the above messages.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the messages covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

export const summarizeNodes = async (nodeMessages: Message[], model: Model<Api>, providerOptions: OptionsForApi<Api>): Promise<string> => {

    const context: Message[] = [...nodeMessages, {role: 'user', timestamp: Date.now(), id: generateUUID(), content: [{type: 'text', content: NODE_SUMMARIZATION_PROMPT}]}]
    const response = await complete(model, {messages: context}, providerOptions);

    const responseContent = response.content.filter(c =>  c.type === 'response');
    const responseText = responseContent.map(c => c.content.filter(p => p.type === 'text').map(r => r.content).join('\n')).join('\n');

    return responseText
}

export const summarizeBranch = async (branchMessages: Message[], model: Model<Api>, providerOptions: OptionsForApi<Api>): Promise<string> => {
    const context: Message[] = [...branchMessages, {role: 'user', timestamp: Date.now(), id: generateUUID(), content: [{type: 'text', content: BRANCH_SUMMARY_PROMPT}]}]
    const response = await complete(model, {messages: context}, providerOptions);

    const responseContent = response.content.filter(c =>  c.type === 'response');
    const responseText = responseContent.map(c => c.content.filter(p => p.type === 'text').map(r => r.content).join('\n')).join('\n');

    return responseText
}