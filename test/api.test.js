import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createApp } from "../app.js";

let pool;
let server;
let base;

before(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  server = createApp(pool).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await pool.end();
});
beforeEach(() => pool.query("truncate todos restart identity"));

test("creates a todo and lists it", async () => {
  const created = await fetch(`${base}/todos`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "  buy milk " }) });
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), { id: 1, title: "buy milk", done: false });
  const list = await (await fetch(`${base}/todos`)).json();
  assert.deepEqual(list.map((t) => t.title), ["buy milk"]);
});

test("rejects an empty or oversized title", async () => {
  for (const title of ["", "   ", "x".repeat(141), 7]) {
    const response = await fetch(`${base}/todos`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) });
    assert.equal(response.status, 400, JSON.stringify(title));
  }
  assert.deepEqual(await (await fetch(`${base}/todos`)).json(), []);
});

test("the sandbox has no route to the internet", async () => {
  const outcome = await fetch("https://example.com", { signal: AbortSignal.timeout(3000) }).then(() => "reached", () => "blocked");
  assert.equal(outcome, "blocked");
});
