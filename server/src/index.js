import "dotenv/config";
import { createApp } from "./app.js";
import { createDatabase, seedUsers } from "./db.js";
import { createWebSocketGateway } from "./gateway.js";
import { createServer } from "http";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

const db = createDatabase();
seedUsers(db);

const app = createApp(db);
const httpServer = createServer(app);
createWebSocketGateway(httpServer, db);

httpServer.listen(PORT, () => {
  console.log(`[server] HIT-Tracker server listening on port ${PORT}`);
  console.log(`[server] Health: http://localhost:${PORT}/api/health`);
});

export { db };
