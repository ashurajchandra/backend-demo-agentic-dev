import express from "express";
import pg from "pg";

// Parse bigints (INT8) to Javascript numbers
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => parseInt(value, 10));

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export function createApp(pool) {
  const app = express();
  app.use(express.json({ limit: "10kb" }));

  app.get("/health", (_request, response) => response.json({ ok: true }));

  // Helper to validate and get ID
  const validateId = (idStr) => {
    if (!/^[1-9]\d*$/.test(idStr)) {
      return null;
    }
    return parseInt(idStr, 10);
  };

  // POST /todos
  app.post("/todos", asyncHandler(async (request, response) => {
    const titleVal = request.body?.title;
    if (typeof titleVal !== "string") {
      return response.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Title must be a string."
        }
      });
    }
    const title = titleVal.trim();
    if (title.length < 1 || title.length > 140) {
      return response.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Title must be between 1 and 140 characters."
        }
      });
    }

    const { rows } = await pool.query(
      "INSERT INTO todos (title) VALUES ($1) RETURNING id, title, done, created_at, updated_at, completed_at",
      [title]
    );
    response.status(201).json(rows[0]);
  }));

  // GET /todos
  app.get("/todos", asyncHandler(async (request, response) => {
    let limit = 20;
    if (request.query.limit !== undefined) {
      const parsed = parseInt(request.query.limit, 10);
      if (!isNaN(parsed)) {
        limit = Math.min(100, Math.max(1, parsed));
      }
    }

    let offset = 0;
    if (request.query.offset !== undefined) {
      const parsed = parseInt(request.query.offset, 10);
      if (!isNaN(parsed)) {
        offset = Math.max(0, parsed);
      }
    }

    const doneParam = request.query.done;
    const conditions = [];
    const queryParams = [];
    let paramIdx = 1;

    if (doneParam === "true" || doneParam === "false") {
      conditions.push(`done = $${paramIdx++}`);
      queryParams.push(doneParam === "true");
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    
    // Get total
    const countQuery = `SELECT COUNT(*)::int as total FROM todos ${whereClause}`;
    const { rows: countRows } = await pool.query(countQuery, queryParams);
    const total = countRows[0]?.total || 0;

    // Get items
    const selectParams = [...queryParams];
    const itemsQuery = `
      SELECT id, title, done, created_at, updated_at, completed_at
      FROM todos
      ${whereClause}
      ORDER BY created_at ASC, id ASC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `;
    selectParams.push(limit, offset);
    const { rows: items } = await pool.query(itemsQuery, selectParams);

    response.json({ items, total });
  }));

  // GET /todos/:id
  app.get("/todos/:id", asyncHandler(async (request, response) => {
    const id = validateId(request.params.id);
    if (id === null) {
      return response.status(400).json({
        error: {
          code: "INVALID_ID",
          message: "ID must be a positive integer."
        }
      });
    }

    const { rows } = await pool.query(
      "SELECT id, title, done, created_at, updated_at, completed_at FROM todos WHERE id = $1",
      [id]
    );

    if (rows.length === 0) {
      return response.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: `Todo with ID ${id} not found.`
        }
      });
    }

    response.json(rows[0]);
  }));

  // PATCH /todos/:id
  app.patch("/todos/:id", asyncHandler(async (request, response) => {
    const id = validateId(request.params.id);
    if (id === null) {
      return response.status(400).json({
        error: {
          code: "INVALID_ID",
          message: "ID must be a positive integer."
        }
      });
    }

    const { title, done } = request.body || {};

    if (title !== undefined) {
      if (typeof title !== "string") {
        return response.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "Title must be a string."
          }
        });
      }
      const trimmedTitle = title.trim();
      if (trimmedTitle.length < 1 || trimmedTitle.length > 140) {
        return response.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "Title must be between 1 and 140 characters."
          }
        });
      }
    }

    if (done !== undefined) {
      if (typeof done !== "boolean") {
        return response.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "Done must be a boolean."
          }
        });
      }
    }

    // Verify existence first
    const checkRes = await pool.query("SELECT id FROM todos WHERE id = $1", [id]);
    if (checkRes.rows.length === 0) {
      return response.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: `Todo with ID ${id} not found.`
        }
      });
    }

    const updates = [];
    const values = [];
    let valIdx = 1;

    if (title !== undefined) {
      updates.push(`title = $${valIdx++}`);
      values.push(title.trim());
    }

    if (done !== undefined) {
      updates.push(`done = $${valIdx++}`);
      values.push(done);
      updates.push(`completed_at = $${valIdx++}`);
      values.push(done ? new Date() : null);
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);

    values.push(id);
    const query = `
      UPDATE todos
      SET ${updates.join(", ")}
      WHERE id = $${valIdx}
      RETURNING id, title, done, created_at, updated_at, completed_at
    `;

    const { rows } = await pool.query(query, values);
    response.json(rows[0]);
  }));

  // DELETE /todos/:id
  app.delete("/todos/:id", asyncHandler(async (request, response) => {
    const id = validateId(request.params.id);
    if (id === null) {
      return response.status(400).json({
        error: {
          code: "INVALID_ID",
          message: "ID must be a positive integer."
        }
      });
    }

    const { rows } = await pool.query("DELETE FROM todos WHERE id = $1 RETURNING id", [id]);
    if (rows.length === 0) {
      return response.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: `Todo with ID ${id} not found.`
        }
      });
    }

    response.status(204).end();
  }));

  // Global Error Handler
  app.use((err, _req, res, _next) => {
    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal Server Error"
      }
    });
  });

  return app;
}
