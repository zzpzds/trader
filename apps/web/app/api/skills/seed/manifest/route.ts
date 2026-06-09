export const dynamic = "force-dynamic";

import { getSeedManifest } from "@/lib/skills";

export async function GET() {
  try {
    const manifest = await getSeedManifest();
    return Response.json(manifest);
  } catch (err) {
    console.error("[/api/skills/seed/manifest] failed:", err);
    return Response.json(
      { error: "seed manifest unavailable" },
      { status: 500 }
    );
  }
}
