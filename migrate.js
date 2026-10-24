import pg from "pg";
import fs from "node:fs/promises";
import path from "node:path";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

// 1. Create schema_migrations table
await client.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    run_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

// 2. Read migration files
const migrationsDir = path.resolve("migrations");
const files = await fs.readdir(migrationsDir);
const sqlFiles = files.filter(f => f.endsWith(".sql")).sort();

for (const file of sqlFiles) {
  // Check if already executed
  const { rows } = await client.query("SELECT 1 FROM schema_migrations WHERE version = $1", [file]);
  if (rows.length > 0) {
    continue;
  }

  // Read SQL and execute in a transaction
  const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
    await client.query("COMMIT");
    console.log(`Executed migration: ${file}`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`Migration failed for ${file}:`, err);
    await client.end();
    process.exit(1);
  }
}

await client.end();
console.log("Migrations complete");
