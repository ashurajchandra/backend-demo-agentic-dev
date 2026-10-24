# Todo API

A small Express API backed by Postgres.

- `GET /health` returns `{ ok: true }`.
- `GET /todos` lists the todos, oldest first.
- `POST /todos` with `{ "title": "..." }` creates one (title 1 to 140 characters, trimmed) and returns it with status 201.

Files: `app.js` (the routes, given a database pool), `server.js` (starts the server), `migrate.js` (creates the `todos` table), `test/` (tests that use the database).

Run the tests with `npm test` (they need `DATABASE_URL`); create the table with `npm run db:migrate`.
