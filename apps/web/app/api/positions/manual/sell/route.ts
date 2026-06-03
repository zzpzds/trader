export const dynamic = "force-dynamic";
import { recordSell } from "@/lib/position-service";

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { symbol, shares, price, sellDate, notes } = body ?? {};

  if (typeof symbol !== "string" || symbol.trim() === "") {
    return Response.json({ error: "symbol required" }, { status: 400 });
  }
  if (typeof shares !== "number" || !(shares > 0)) {
    return Response.json({ error: "shares must be > 0" }, { status: 400 });
  }
  if (typeof price !== "string" || !(parseFloat(price) > 0)) {
    return Response.json({ error: "price must be > 0" }, { status: 400 });
  }
  const today = new Date().toISOString().slice(0, 10);
  if (typeof sellDate !== "string" || sellDate > today) {
    return Response.json({ error: "sellDate must be on or before today" }, { status: 400 });
  }

  const trimmedSymbol = symbol.trim().toUpperCase();
  const result = await recordSell(
    null,
    trimmedSymbol,
    shares,
    price,
    sellDate,
    typeof notes === "string" && notes.trim() !== "" ? notes.trim() : undefined
  );

  if (result.error) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ positionId: result.positionId, lotId: result.lot!.id }, { status: 201 });
}
