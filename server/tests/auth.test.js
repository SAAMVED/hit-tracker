import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { test } from "node:test";
import { loginHandler, verifyToken } from "../src/auth.js";
import { createApp } from "../src/app.js";
import { createIsolatedTestSchema } from "./helpers/postgres.js";

const commanderHash = bcrypt.hashSync("test-commander-password", 4);
const viewerHash = bcrypt.hashSync("test-viewer-password", 4);
const users = new Map([
  ["commander", { username: "commander", password_hash: commanderHash, role: "commander" }],
  ["viewer", { username: "viewer", password_hash: viewerHash, role: "viewer" }],
]);

function invokeLogin(body) {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [users.get(params[0])].filter(Boolean) };
    },
  };
  const response = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  return loginHandler({ body }, response, db).then(() => ({ response, calls }));
}

test("validates Commander login through a parameterized PostgreSQL query", async () => {
  const { response, calls } = await invokeLogin({ username: "commander", password: "test-commander-password" });
  assert.notEqual(commanderHash, "test-commander-password");
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.role, "commander");
  assert.ok(response.body.expiresAt > Date.now());
  assert.equal(verifyToken(response.body.token).role, "commander");
  assert.deepEqual(calls[0].params, ["commander"]);
  assert.match(calls[0].sql, /username\s*=\s*\$1/);
});

test("keeps Viewer credentials backend validated", async () => {
  const { response } = await invokeLogin({ username: "viewer", password: "test-viewer-password" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.role, "viewer");
  assert.equal(verifyToken(response.body.token).role, "viewer");
});

test("rejects an incorrect password", async () => {
  const { response } = await invokeLogin({ username: "commander", password: "incorrect-password" });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.body, { error: "Invalid credentials" });
});

test("rejects an invalid login request", async () => {
  const { response, calls } = await invokeLogin({ username: "", password: "" });
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "Invalid request");
  assert.equal(calls.length, 0);
});

test("authenticates stored Commander and Viewer password hashes in PostgreSQL", async (t) => {
  const isolated = await createIsolatedTestSchema("auth_pg_test", `
    CREATE TABLE users (
      id BIGSERIAL PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('commander','viewer')), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  t.after(() => isolated.close());
  const db = isolated.pool;
  await db.query("INSERT INTO users(username,password_hash,role) VALUES($1,$2,$3),($4,$5,$6)", [
    "commander", bcrypt.hashSync("commander-secret", 4), "commander",
    "viewer", bcrypt.hashSync("viewer-secret", 4), "viewer",
  ]);
  const app = createApp(db);

  async function login(username, password) {
    const route = app._router.stack.find((layer) => layer.route?.path === "/api/login");
    assert.ok(route);
    const req = { body: { username, password } };
    return new Promise((resolve, reject) => {
      const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(body) { resolve({ statusCode: this.statusCode, body }); return this; },
      };
      Promise.resolve(route.route.stack[0].handle(req, res, reject)).catch(reject);
    });
  }

  for (const [username, password, role] of [
    ["commander", "commander-secret", "commander"],
    ["viewer", "viewer-secret", "viewer"],
  ]) {
    const response = await login(username, password);
    assert.equal(response.statusCode, 200);
    assert.equal(verifyToken(response.body.token).role, role);
  }
  assert.equal((await login("commander", "wrong-secret")).statusCode, 401);
  assert.equal((await login("unknown", "wrong-secret")).statusCode, 401);
});
