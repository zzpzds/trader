import { parseStrategyScript } from "@/lib/parse-strategy";

export async function POST(request: Request) {
  const body = await request.json();
  const { script } = body as { script?: string };

  if (!script?.trim()) {
    return Response.json(
      { error: "script is required" },
      { status: 400 }
    );
  }

  try {
    const result = await parseStrategyScript(script);
    return Response.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
