export const dynamic = "force-dynamic";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { memories } from "@trader/db";
import { buildMemoryListQuery, type MemoryListParams } from "@/lib/memory-search";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params: MemoryListParams = {
    q: url.searchParams.get("q") ?? undefined,
    strategyId: url.searchParams.get("strategyId") ?? undefined,
    symbol: url.searchParams.get("symbol") ?? undefined,
    kind: (url.searchParams.get("kind") as MemoryListParams["kind"]) ?? undefined,
    pinned:
      url.searchParams.get("pinned") === "true"
        ? true
        : url.searchParams.get("pinned") === "false"
        ? false
        : undefined,
    limit: url.searchParams.get("limit")
      ? Number(url.searchParams.get("limit"))
      : undefined,
  };

  const q = buildMemoryListQuery(params);

  const wheres: any[] = [];
  if (q.filters.strategyId) wheres.push(sql`strategy_id = ${q.filters.strategyId}`);
  if (q.filters.symbol) wheres.push(sql`symbol = ${q.filters.symbol}`);
  if (q.filters.kind) wheres.push(sql`kind = ${q.filters.kind}`);
  if (q.filters.pinned !== undefined) wheres.push(sql`pinned = ${q.filters.pinned}`);

  let orderBy = sql`pinned DESC, updated_at DESC`;

  if (q.searchMode === "trgm") {
    wheres.push(
      sql`(similarity(title, ${q.trgmQuery!}) > ${q.trgmThreshold}
           OR similarity(content, ${q.trgmQuery!}) > ${q.trgmThreshold})`
    );
    orderBy = sql`GREATEST(similarity(title, ${q.trgmQuery!}), similarity(content, ${q.trgmQuery!})) DESC, updated_at DESC`;
  } else if (q.searchMode === "like") {
    wheres.push(
      sql`(title ILIKE ${q.likePattern!} OR content ILIKE ${q.likePattern!})`
    );
  }

  const whereClause = wheres.length
    ? sql.join([sql`WHERE`, sql.join(wheres, sql` AND `)], sql` `)
    : sql``;

  const rows = await db.execute(
    sql`SELECT id, title, content, kind, strategy_id AS "strategyId", symbol, tags, pinned,
               created_at AS "createdAt", updated_at AS "updatedAt"
        FROM memories
        ${whereClause}
        ORDER BY ${orderBy}
        LIMIT ${q.limit}`
  );

  return Response.json(rows);
}

const VALID_KINDS = new Set(["note", "idea", "lesson", "context"]);

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const {
    title,
    content,
    kind,
    strategyId,
    symbol,
    tags,
    pinned,
  } = body as {
    title?: string;
    content?: string;
    kind?: string;
    strategyId?: string | null;
    symbol?: string | null;
    tags?: string[];
    pinned?: boolean;
  };

  if (!title || typeof title !== "string") {
    return Response.json({ error: "title is required" }, { status: 400 });
  }
  if (!content || typeof content !== "string") {
    return Response.json({ error: "content is required" }, { status: 400 });
  }
  if (kind !== undefined && !VALID_KINDS.has(kind)) {
    return Response.json({ error: "invalid kind" }, { status: 400 });
  }

  const [row] = await db
    .insert(memories)
    .values({
      title,
      content,
      kind: (kind as "note" | "idea" | "lesson" | "context") ?? "note",
      strategyId: strategyId ?? null,
      symbol: symbol ?? null,
      tags: tags ?? [],
      pinned: pinned ?? false,
    })
    .returning();

  return Response.json(row, { status: 201 });
}
