import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[ensure-pg-extensions] DATABASE_URL not set");
    process.exit(1);
  }
  const sql = postgres(url, { max: 1 });
  try {
    await sql.unsafe("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    await sql.unsafe(
      `CREATE INDEX IF NOT EXISTS memories_title_trgm_idx
       ON memories USING gin (title gin_trgm_ops)`
    );
    await sql.unsafe(
      `CREATE INDEX IF NOT EXISTS memories_content_trgm_idx
       ON memories USING gin (content gin_trgm_ops)`
    );
    console.log("[ensure-pg-extensions] pg_trgm + GIN indexes ready");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("[ensure-pg-extensions]", err);
  process.exit(1);
});
