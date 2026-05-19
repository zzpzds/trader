export const dynamic = "force-dynamic";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { strategies } from "@trader/db";

export async function GET() {
  const rows = await db.query.strategies.findMany({
    orderBy: (s, { desc }) => [desc(s.createdAt)],
  });
  return Response.json(rows);
}

export async function POST(request: Request) {
  const body = await request.json();
  const { name, symbols, content, script } = body as {
    name?: string;
    symbols?: string[];
    content?: string;
    script?: string;
  };

  if (!name || !content || !script) {
    return Response.json(
      { error: "name, content, and script are required" },
      { status: 400 }
    );
  }

  const [row] = await db
    .insert(strategies)
    .values({ name, symbols: symbols ?? [], content, script })
    .returning();

  return Response.json(row, { status: 201 });
}
