import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query(`create table if not exists todos (id serial primary key, title text not null, done boolean not null default false)`);
await client.end();
console.log("migrated");
