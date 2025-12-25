import { Api, GoogleProviderOptions, GoogleThinkingLevel, OpenAIProviderOptions, OptionsForApi } from "@ank1015/providers"

export function getDefaultProviderOption(api: Api): OptionsForApi<Api>{
    if(api === 'openai'){
        const defaultOpenAiProviderOptions: OpenAIProviderOptions = {
            reasoning: {
                effort: 'low',
                summary: 'auto'
            }
        }
        return defaultOpenAiProviderOptions;
    }
    if(api === 'google'){
        const defaultGoogleProviderOptions: GoogleProviderOptions = {
            thinkingConfig: {
                includeThoughts: true,
                thinkingLevel: GoogleThinkingLevel.LOW
            }
        }
        return defaultGoogleProviderOptions
    }
    return {}
}