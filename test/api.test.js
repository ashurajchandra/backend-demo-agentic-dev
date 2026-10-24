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
    const json = await response.json();
    assert.equal(json.error.code, "VALIDATION_ERROR");
    assert.equal(json.error.message, "Invalid request");
    assert.equal(json.error.issues[0].path, "title");
  }
  assert.deepEqual(await (await fetch(`${base}/todos`)).json(), []);
});

test("the sandbox has no route to the internet", async () => {
  const outcome = await fetch("https://example.com", { signal: AbortSignal.timeout(3000) }).then(() => "reached", () => "blocked");
  assert.equal(outcome, "blocked");
});

test("GET /todos query parameters boundary and type cases", async () => {
  // Populate database with 3 todos
  await pool.query("insert into todos (title, done) values ('todo 1', false), ('todo 2', true), ('todo 3', false)");

  // 1. limit & offset defaults
  const listDefault = await (await fetch(`${base}/todos`)).json();
  assert.equal(listDefault.length, 3);
  assert.equal(listDefault[0].title, "todo 1");

  // 2. done filter
  const listDoneTrue = await (await fetch(`${base}/todos?done=true`)).json();
  assert.equal(listDoneTrue.length, 1);
  assert.equal(listDoneTrue[0].title, "todo 2");

  const listDoneFalse = await (await fetch(`${base}/todos?done=false`)).json();
  assert.equal(listDoneFalse.length, 2);
  assert.equal(listDoneFalse[0].title, "todo 1");

  // 3. invalid done value
  const resDoneInvalid = await fetch(`${base}/todos?done=yes`);
  assert.equal(resDoneInvalid.status, 400);
  const errDone = await resDoneInvalid.json();
  assert.equal(errDone.error.issues[0].path, "done");

  // 4. limit boundary cases
  const resLimitMin = await fetch(`${base}/todos?limit=1`);
  assert.equal(resLimitMin.status, 200);
  assert.equal((await resLimitMin.json()).length, 1);

  const resLimitMax = await fetch(`${base}/todos?limit=100`);
  assert.equal(resLimitMax.status, 200);

  const resLimitTooLow = await fetch(`${base}/todos?limit=0`);
  assert.equal(resLimitTooLow.status, 400);

  const resLimitTooHigh = await fetch(`${base}/todos?limit=101`);
  assert.equal(resLimitTooHigh.status, 400);

  const resLimitInvalid = await fetch(`${base}/todos?limit=abc`);
  assert.equal(resLimitInvalid.status, 400);

  // 5. offset boundary cases
  const resOffsetMin = await fetch(`${base}/todos?offset=0`);
  assert.equal(resOffsetMin.status, 200);

  const resOffsetTooLow = await fetch(`${base}/todos?offset=-1`);
  assert.equal(resOffsetTooLow.status, 400);

  const resOffsetDecimal = await fetch(`${base}/todos?offset=1.5`);
  assert.equal(resOffsetDecimal.status, 400);
});

test("GET /todos/:id validation and return scenarios", async () => {
  // Create a todo
  await pool.query("insert into todos (title) values ('test todo')");
  
  // 1. Valid and existing ID
  const resValid = await fetch(`${base}/todos/1`);
  assert.equal(resValid.status, 200);
  const todo = await resValid.json();
  assert.equal(todo.title, "test todo");

  // 2. Valid but non-existing ID
  const resNotFound = await fetch(`${base}/todos/999`);
  assert.equal(resNotFound.status, 404);

  // 3. Invalid IDs (positive whole number validation)
  const invalidIds = ["abc", "0", "-1", "1.5", "12abc"];
  for (const id of invalidIds) {
    const resInvalid = await fetch(`${base}/todos/${id}`);
    assert.equal(resInvalid.status, 400);
    const json = await resInvalid.json();
    assert.equal(json.error.code, "VALIDATION_ERROR");
    assert.equal(json.error.issues[0].path, "id");
  }
});

test("multiple simultaneous validation errors in response structure", async () => {
  const res = await fetch(`${base}/todos?limit=0&offset=-2&done=maybe`);
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error.code, "VALIDATION_ERROR");
  assert.equal(json.error.message, "Invalid request");
  
  const issues = json.error.issues;
  assert.equal(issues.length, 3);
  
  const paths = issues.map((i) => i.path);
  assert.ok(paths.includes("done"));
  assert.ok(paths.includes("limit"));
  assert.ok(paths.includes("offset"));
});
