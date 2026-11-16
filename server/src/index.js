import "dotenv/config";
import { createApp } from "./app.js";
import { createDatabase, initializeDatabase, seedUsers } from "./db.js";
import { createWebSocketGateway } from "./gateway.js";
import { createServer } from "http";
import { restoreCalibration } from "./calibration-state.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

const db = createDatabase();
let httpServer;
let gateway;

try {
  await initializeDatabase(db);
  await seedUsers(db);
  await restoreCalibration(db);
  const app = createApp(db);
  httpServer = createServer(app);
  gateway = await createWebSocketGateway(httpServer, db);
  await new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(PORT, resolve);
  });
  console.log(`[server] HIT-Tracker server listening on port ${PORT}`);
  console.log(`[server] Health: http://localhost:${PORT}/api/health`);
} catch (error) {
  console.error("[server] Startup failed; PostgreSQL initialization is required:", error.message);
  gateway?.close();
  if (httpServer?.listening) await new Promise((resolve) => httpServer.close(resolve));
  await db.end();
  process.exitCode = 1;
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} received; closing connections`);
  gateway?.close();
  if (httpServer?.listening) await new Promise((resolve) => httpServer.close(resolve));
  await db.end();
}
process.once("SIGINT", () => void shutdown("SIGINT").catch((error) => console.error("[server] Shutdown failed:", error)));
process.once("SIGTERM", () => void shutdown("SIGTERM").catch((error) => console.error("[server] Shutdown failed:", error)));

export { db };
