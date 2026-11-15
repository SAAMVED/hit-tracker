import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import { after, before, test } from "node:test";
import { loginHandler, verifyToken } from "../src/auth.js";
import { seedUsers } from "../src/db.js";

const TEST_COMMANDER_PASSWORD = "test-commander-password";
const TEST_VIEWER_PASSWORD = "test-viewer-password";
let db;

before(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('commander', 'viewer')),
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
  `);

  const originalCommanderPassword = process.env.COMMANDER_PASSWORD;
  const originalViewerPassword = process.env.VIEWER_PASSWORD;
  process.env.COMMANDER_PASSWORD = TEST_COMMANDER_PASSWORD;
  process.env.VIEWER_PASSWORD = TEST_VIEWER_PASSWORD;
  try {
    seedUsers(db);
  } finally {
    if (originalCommanderPassword === undefined) delete process.env.COMMANDER_PASSWORD;
    else process.env.COMMANDER_PASSWORD = originalCommanderPassword;
    if (originalViewerPassword === undefined) delete process.env.VIEWER_PASSWORD;
    else process.env.VIEWER_PASSWORD = originalViewerPassword;
  }
});

after(() => db.close());

function invokeLogin(body) {
  const response = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };

  loginHandler({ body }, response, db);
  return response;
}

test("accepts the seeded Commander credentials and returns a Commander token", () => {
  const storedUser = db.prepare("SELECT * FROM users WHERE username = ?").get("commander");
  assert.ok(storedUser);
  assert.notEqual(storedUser.password_hash, TEST_COMMANDER_PASSWORD);
  assert.equal(bcrypt.compareSync(TEST_COMMANDER_PASSWORD, storedUser.password_hash), true);

  const response = invokeLogin({ username: "commander", password: TEST_COMMANDER_PASSWORD });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.role, "commander");
  assert.ok(response.body.expiresAt > Date.now());
  assert.equal(verifyToken(response.body.token).role, "commander");
});

test("keeps backend-validated read-only personnel login available", () => {
  const response = invokeLogin({ username: "viewer", password: TEST_VIEWER_PASSWORD });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.role, "viewer");
  assert.equal(verifyToken(response.body.token).role, "viewer");
});

test("rejects an incorrect password", () => {
  const response = invokeLogin({ username: "commander", password: "incorrect-password" });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.body, { error: "Invalid credentials" });
});

test("rejects an invalid login request", () => {
  const response = invokeLogin({ username: "", password: "" });
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "Invalid request");
});
