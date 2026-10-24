import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createApp } from "../app.js";

let pool;
let server;
let base;

async function runMigrations(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      run_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const migrationsDir = "migrations";
  const files = await readdir(migrationsDir);
  const sqlFiles = files.filter(f => f.endsWith(".sql")).sort();

  for (const file of sqlFiles) {
    const { rows } = await client.query("SELECT 1 FROM schema_migrations WHERE version = $1", [file]);
    if (rows.length > 0) {
      continue;
    }
    const sql = await readFile(join(migrationsDir, file), "utf8");
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
    await client.query("COMMIT");
  }
}

before(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  
  // Run migrations
  const client = await pool.connect();
  try {
    await runMigrations(client);
  } finally {
    client.release();
  }

  server = createApp(pool).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await pool.end();
});

beforeEach(() => pool.query("TRUNCATE todos RESTART IDENTITY"));

test("creates a todo and lists it", async () => {
  const created = await fetch(`${base}/todos`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "  buy milk " })
  });
  assert.equal(created.status, 201);
  const createdJson = await created.json();
  assert.equal(createdJson.id, 1);
  assert.equal(createdJson.title, "buy milk");
  assert.equal(createdJson.done, false);
  assert.ok(createdJson.created_at);
  assert.ok(createdJson.updated_at);
  assert.equal(createdJson.completed_at, null);

  const list = await (await fetch(`${base}/todos`)).json();
  assert.equal(list.total, 1);
  assert.deepEqual(list.items.map((t) => t.title), ["buy milk"]);
});

test("rejects an empty or oversized title", async () => {
  for (const title of ["", "   ", "x".repeat(141), 7]) {
    const response = await fetch(`${base}/todos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title })
    });
    assert.equal(response.status, 400, JSON.stringify(title));
    const body = await response.json();
    assert.equal(body.error.code, "VALIDATION_ERROR");
  }
  const res = await (await fetch(`${base}/todos`)).json();
  assert.deepEqual(res.items, []);
  assert.equal(res.total, 0);
});

test("the sandbox has no route to the internet", async () => {
  const outcome = await fetch("https://example.com", { signal: AbortSignal.timeout(3000) }).then(() => "reached", () => "blocked");
  assert.equal(outcome, "blocked");
});

test("migration idempotency", async () => {
  const client = await pool.connect();
  try {
    // Running again should not fail
    await runMigrations(client);
  } finally {
    client.release();
  }
});

test("id validation edge-cases", async () => {
  const invalidIds = ["12abc", "0", "-1", "1.5"];
  for (const id of invalidIds) {
    // GET
    const getRes = await fetch(`${base}/todos/${id}`);
    assert.equal(getRes.status, 400);
    const getBody = await getRes.json();
    assert.equal(getBody.error.code, "INVALID_ID");

    // PATCH
    const patchRes = await fetch(`${base}/todos/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "valid" })
    });
    assert.equal(patchRes.status, 400);
    const patchBody = await patchRes.json();
    assert.equal(patchBody.error.code, "INVALID_ID");

    // DELETE
    const deleteRes = await fetch(`${base}/todos/${id}`, { method: "DELETE" });
    assert.equal(deleteRes.status, 400);
    const deleteBody = await deleteRes.json();
    assert.equal(deleteBody.error.code, "INVALID_ID");
  }
});

test("404 handler for GET, PATCH, DELETE", async () => {
  // GET
  const getRes = await fetch(`${base}/todos/99999`);
  assert.equal(getRes.status, 404);
  const getBody = await getRes.json();
  assert.equal(getBody.error.code, "NOT_FOUND");

  // PATCH
  const patchRes = await fetch(`${base}/todos/99999`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "valid" })
  });
  assert.equal(patchRes.status, 404);
  const patchBody = await patchRes.json();
  assert.equal(patchBody.error.code, "NOT_FOUND");

  // DELETE
  const deleteRes = await fetch(`${base}/todos/99999`, { method: "DELETE" });
  assert.equal(deleteRes.status, 404);
  const deleteBody = await deleteRes.json();
  assert.equal(deleteBody.error.code, "NOT_FOUND");
});

test("pagination, filtering, and sorting order", async () => {
  // Insert 5 items
  const items = [];
  for (let i = 1; i <= 5; i++) {
    const res = await fetch(`${base}/todos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: `Todo ${i}` })
    });
    items.push(await res.json());
  }

  // Verify oldest-first sorting order (Todo 1 is first)
  const listAll = await (await fetch(`${base}/todos`)).json();
  assert.equal(listAll.total, 5);
  assert.deepEqual(listAll.items.map(t => t.title), ["Todo 1", "Todo 2", "Todo 3", "Todo 4", "Todo 5"]);

  // Test limit and offset pagination
  const paginated = await (await fetch(`${base}/todos?limit=2&offset=1`)).json();
  assert.equal(paginated.total, 5);
  assert.equal(paginated.items.length, 2);
  assert.deepEqual(paginated.items.map(t => t.title), ["Todo 2", "Todo 3"]);

  // Set Todo 2 and Todo 4 as done
  await fetch(`${base}/todos/2`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ done: true })
  });
  await fetch(`${base}/todos/4`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ done: true })
  });

  // Filter by done = true
  const listDone = await (await fetch(`${base}/todos?done=true`)).json();
  assert.equal(listDone.total, 2);
  assert.deepEqual(listDone.items.map(t => t.title), ["Todo 2", "Todo 4"]);

  // Filter by done = false
  const listPending = await (await fetch(`${base}/todos?done=false`)).json();
  assert.equal(listPending.total, 3);
  assert.deepEqual(listPending.items.map(t => t.title), ["Todo 1", "Todo 3", "Todo 5"]);
});

test("toggling completed_at in PATCH /todos/:id", async () => {
  const created = await (await fetch(`${base}/todos`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "check completion" })
  })).json();

  assert.equal(created.completed_at, null);

  // Set done to true
  const patchedTrue = await (await fetch(`${base}/todos/${created.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ done: true })
  })).json();

  assert.equal(patchedTrue.done, true);
  assert.ok(patchedTrue.completed_at);

  // Set done to false
  const patchedFalse = await (await fetch(`${base}/todos/${created.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ done: false })
  })).json();

  assert.equal(patchedFalse.done, false);
  assert.equal(patchedFalse.completed_at, null);
});
