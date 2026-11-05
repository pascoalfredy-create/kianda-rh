export type CopilotModule = 'hr' | 'modeling' | 'valuation';
export interface CopilotGuide { id: string; title: string; tags: string[]; text: string; sources: { title: string; url: string }[]; screen: string }
export interface CopilotSetup { module: CopilotModule; name: string; aiReady: boolean; canAsk: boolean; knowledgeVersion: string; guides: CopilotGuide[]; entities: { id: string; name: string; revision: number }[] }
export interface CopilotContext { revision: number; unit: string; figures: Record<string, number | boolean | null | number[]>; notes: string[] }
export interface CopilotAnswer { mode: 'ai'; answer: string; sources: { title: string; url: string }[]; usedContext: boolean; knowledgeVersion: string }
export const COPILOT_MODULE_LABEL: Record<CopilotModule, string> = { hr: 'Kianda RH', modeling: 'Kianda Integra', valuation: 'Kianda Valora' };
