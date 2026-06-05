export interface MemoryListParams {
  q?: string;
  strategyId?: string;
  symbol?: string;
  kind?: "note" | "idea" | "lesson" | "context";
  pinned?: boolean;
  limit?: number;
}

export interface MemoryListQuery {
  searchMode: "none" | "like" | "trgm";
  likePattern?: string;
  trgmQuery?: string;
  trgmThreshold: number;
  filters: {
    strategyId?: string;
    symbol?: string;
    kind?: string;
    pinned?: boolean;
  };
  limit: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const TRGM_THRESHOLD = 0.1;

export function buildMemoryListQuery(params: MemoryListParams): MemoryListQuery {
  const limitRaw = params.limit ?? DEFAULT_LIMIT;
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limitRaw)));

  const q = params.q?.trim() ?? "";
  let searchMode: MemoryListQuery["searchMode"] = "none";
  let likePattern: string | undefined;
  let trgmQuery: string | undefined;

  if (q.length === 0) {
    searchMode = "none";
  } else if (q.length < 2) {
    searchMode = "like";
    likePattern = `%${q}%`;
  } else {
    searchMode = "trgm";
    trgmQuery = q;
  }

  return {
    searchMode,
    likePattern,
    trgmQuery,
    trgmThreshold: TRGM_THRESHOLD,
    filters: {
      strategyId: params.strategyId,
      symbol: params.symbol,
      kind: params.kind,
      pinned: params.pinned,
    },
    limit,
  };
}
