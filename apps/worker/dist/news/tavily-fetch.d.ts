export interface TavilyArticle {
    title: string;
    url: string;
    content: string;
}
export declare function tavilyFetch(query: string): Promise<TavilyArticle[]>;
