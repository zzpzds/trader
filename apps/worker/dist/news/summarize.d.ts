import Anthropic from "@anthropic-ai/sdk";
import type { TavilyArticle } from "./tavily-fetch.js";
export declare function summarizeNews(strategyName: string, strategyContent: string, articles: TavilyArticle[], client?: Anthropic): Promise<string>;
