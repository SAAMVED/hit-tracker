import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import type { Database } from "better-sqlite3";
import { LoginRequestSchema, LoginResponseSchema } from "@hit-tracker/shared";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev_secret";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? "8h";

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: "commander" | "viewer";
}

export function loginHandler(req: Request, res: Response, db: Database): void {
  const parsed = LoginRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  const { username, password } = parsed.data;

  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as
    | UserRow
    | undefined;

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const expiresAt = Date.now() + parseDurationMs(JWT_EXPIRES_IN);
  // Cast expiresIn to `any` to satisfy the jsonwebtoken overload – it accepts
  // string values like "8h" at runtime even though the types are strict.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const token = jwt.sign(
    { sub: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN as unknown as number }
  );

  const response = LoginResponseSchema.parse({ token, role: user.role, expiresAt });
  res.json(response);
}

export function verifyToken(token: string): { sub: string; role: string } {
  return jwt.verify(token, JWT_SECRET) as { sub: string; role: string };
}

/** Parse duration strings like "8h", "30m", "3600s" to milliseconds. */
function parseDurationMs(duration: string): number {
  const num = parseInt(duration, 10);
  if (duration.endsWith("h")) return num * 3_600_000;
  if (duration.endsWith("m")) return num * 60_000;
  if (duration.endsWith("s")) return num * 1_000;
  return num;
}
