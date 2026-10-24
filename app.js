import express from "express";
import { createTodoSchema, listQuerySchema, idSchema } from "./schemas.js";

function formatValidationError(zodError) {
  const issues = zodError.issues.map((issue) => {
    const fieldName = issue.path.length > 0 ? issue.path.map(p => String(p)).join(".") : "id";
    return {
      path: fieldName,
      message: issue.message
    };
  });
  return {
    error: {
      code: "VALIDATION_ERROR",
      message: "Invalid request",
      issues
    }
  };
}

// The API. The database pool is passed in, so tests (and the server) decide where it points.
export function createApp(pool) {
  const app = express();
  app.use(express.json({ limit: "10kb" }));

  app.get("/health", (_request, response) => response.json({ ok: true }));

  app.get("/todos", async (request, response) => {
    const result = listQuerySchema.safeParse(request.query);
    if (!result.success) {
      return response.status(400).json(formatValidationError(result.error));
    }
    const { done, limit, offset } = result.data;

    let queryText = "select id, title, done from todos";
    const queryParams = [];

    if (done !== undefined) {
      queryText += " where done = $1";
      queryParams.push(done);
    }

    queryText += ` order by id limit $${queryParams.length + 1} offset $${queryParams.length + 2}`;
    queryParams.push(limit, offset);

    const { rows } = await pool.query(queryText, queryParams);
    response.json(rows);
  });

  app.get("/todos/:id", async (request, response) => {
    const idResult = idSchema.safeParse(request.params.id);
    if (!idResult.success) {
      return response.status(400).json(formatValidationError(idResult.error));
    }

    const id = parseInt(request.params.id, 10);
    const { rows } = await pool.query("select id, title, done from todos where id = $1", [id]);
    if (rows.length === 0) {
      return response.status(404).json({ error: "Todo not found" });
    }
    response.status(200).json(rows[0]);
  });

  app.post("/todos", async (request, response) => {
    const result = createTodoSchema.safeParse(request.body);
    if (!result.success) {
      return response.status(400).json(formatValidationError(result.error));
    }
    const { title } = result.data;
    const { rows } = await pool.query("insert into todos (title) values ($1) returning id, title, done", [title]);
    response.status(201).json(rows[0]);
  });

  return app;
}
