import { upsertPositionAndCreateLot } from "@/lib/position-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: strategyId } = await params;
  const body = await request.json();
  const { symbol, shares, costPrice, lotDate, notes } = body as {
    symbol?: string;
    shares?: number;
    costPrice?: string;
    lotDate?: string;
    notes?: string;
  };

  if (!symbol || shares == null || !costPrice || !lotDate) {
    return Response.json(
      { error: "symbol, shares, costPrice, and lotDate are required" },
      { status: 400 }
    );
  }

  try {
    const result = await upsertPositionAndCreateLot(
      strategyId,
      symbol,
      shares,
      costPrice,
      lotDate,
      notes
    );
    return Response.json(result, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
