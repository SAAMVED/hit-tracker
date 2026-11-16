import "dotenv/config";
import { createDatabase, runMigrations } from "../src/db.js";

const pool = createDatabase();
try {
  await runMigrations(pool);
  console.log("PostgreSQL migrations applied successfully.");
} catch (error) {
  console.error("PostgreSQL migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
