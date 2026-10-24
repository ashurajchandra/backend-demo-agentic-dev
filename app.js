import express from "express";

// The API. The database pool is passed in, so tests (and the server) decide where it points.
export function createApp(pool) {
  const app = express();
  app.use(express.json({ limit: "10kb" }));

  app.get("/health", (_request, response) => response.json({ ok: true }));

  app.get("/todos", async (_request, response) => {
    const { rows } = await pool.query("select id, title, done from todos order by id");
    response.json(rows);
  });

  app.post("/todos", async (request, response) => {
    const title = typeof request.body?.title === "string" ? request.body.title.trim() : "";
    if (!title || title.length > 140) return response.status(400).json({ error: "A todo needs a title of 1 to 140 characters." });
    const { rows } = await pool.query("insert into todos (title) values ($1) returning id, title, done", [title]);
    response.status(201).json(rows[0]);
  });

  return app;
}
