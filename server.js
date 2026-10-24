import pg from "pg";
import { createApp } from "./app.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const port = Number(process.env.PORT) || 3000;
createApp(pool).listen(port, () => console.log(`API on http://localhost:${port}`));
