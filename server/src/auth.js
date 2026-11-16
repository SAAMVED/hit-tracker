import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { LoginRequestSchema, LoginResponseSchema } from "@hit-tracker/shared";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev_secret";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? "8h";

export async function loginHandler(req, res, db) {
  const parsed = LoginRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  const { username, password } = parsed.data;

  const { rows: [user] } = await db.query("SELECT * FROM users WHERE username = $1", [username]);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const expiresAt = Date.now() + parseDurationMs(JWT_EXPIRES_IN);
  const token = jwt.sign(
    { sub: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  const response = LoginResponseSchema.parse({ token, role: user.role, expiresAt });
  res.json(response);
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/** Parse duration strings like "8h", "30m", "3600s" to milliseconds. */
function parseDurationMs(duration) {
  const num = parseInt(duration, 10);
  if (duration.endsWith("h")) return num * 3_600_000;
  if (duration.endsWith("m")) return num * 60_000;
  if (duration.endsWith("s")) return num * 1_000;
  return num;
}
