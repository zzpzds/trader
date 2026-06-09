export const dynamic = "force-dynamic";

import {
  ConflictError,
  NotFoundError,
  ValidationError,
  importSeedSkill,
  type SeedImportMode,
} from "@/lib/skills";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const name = typeof body.name === "string" ? body.name : null;
  const mode = body.mode;

  if (!name || name.trim().length === 0) {
    return Response.json({ error: "name is required" }, { status: 400 });
  }
  if (mode !== "create" && mode !== "overwrite-seed" && mode !== "duplicate") {
    return Response.json(
      { error: "mode must be create | overwrite-seed | duplicate" },
      { status: 400 }
    );
  }

  try {
    const row = await importSeedSkill({ name, mode: mode as SeedImportMode });
    return Response.json(row, {
      status: mode === "overwrite-seed" ? 200 : 201,
    });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof ConflictError) {
      return Response.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof ValidationError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("[/api/skills/seed/import] failed:", err);
    throw err;
  }
}
