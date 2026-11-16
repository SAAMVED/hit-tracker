import pg from "pg";

const { Pool } = pg;

export async function createIsolatedTestSchema(prefix, setupSql) {
  const configuredUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!configuredUrl) {
    throw new Error("Configure TEST_DATABASE_URL or DATABASE_URL for PostgreSQL integration tests.");
  }

  const parsedUrl = new URL(configuredUrl);
  if (!process.env.TEST_DATABASE_URL) parsedUrl.pathname = "/hit_tracker_test";
  if (decodeURIComponent(parsedUrl.pathname.slice(1)) !== "hit_tracker_test") {
    throw new Error("PostgreSQL integration tests are restricted to hit_tracker_test.");
  }

  const schema = `${prefix}_${process.pid}_${Date.now()}`;
  const adminPool = new Pool({ connectionString: parsedUrl.toString() });
  let testPool;
  try {
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    testPool = new Pool({ connectionString: parsedUrl.toString(), options: `-c search_path=${schema}` });
    await testPool.query(setupSql);
  } catch (error) {
    await testPool?.end();
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await adminPool.end();
    throw error;
  }

  return {
    pool: testPool,
    async close() {
      await testPool.end();
      await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await adminPool.end();
    },
  };
}
