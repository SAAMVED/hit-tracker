import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { test } from "node:test";
import { loginHandler, verifyToken } from "../src/auth.js";

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
