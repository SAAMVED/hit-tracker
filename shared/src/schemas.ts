import { z } from "zod";

// ─── Floor Labels ─────────────────────────────────────────────────────────────

export const FloorLabelSchema = z.enum(["B2", "B1", "G", "1", "2", "3", "4", "5"]);
export type FloorLabel = z.infer<typeof FloorLabelSchema>;

// ─── Telemetry Packet ────────────────────────────────────────────────────────

/**
 * Raw telemetry packet emitted by each soldier's device at 1 Hz.
 * Transmitted over WebSocket and stored in SQLite.
 */
export const TelemetryPacketSchema = z.object({
  /** Unique soldier identifier, e.g. "A1" */
  soldierId: z.string().min(1).max(16),
  /** Team the soldier belongs to */
  teamId: z.string().min(1).max(32),
  /** Monotonically increasing sequence number per soldier */
  seq: z.number().int().nonnegative(),
  /** Unix epoch milliseconds (device clock) */
  timestamp: z.number().int().positive(),
  /** X coordinate in metres relative to building origin */
  x: z.number().finite(),
  /** Y coordinate in metres relative to building origin */
  y: z.number().finite(),
  /** Barometric pressure in hectopascals – used for floor estimation */
  pressureHpa: z.number().positive().max(1100),
  /** Battery percentage 0–100 */
  batteryPct: z.number().int().min(0).max(100),
  /** Signal strength in dBm (negative) */
  signal: z.number().min(-130).max(0),
  /** Estimated floor label assigned by server / barometric estimation */
  estimatedFloor: FloorLabelSchema.optional(),
});

export type TelemetryPacket = z.infer<typeof TelemetryPacketSchema>;

// ─── Soldier ─────────────────────────────────────────────────────────────────

export const SoldierStatusSchema = z.enum(["active", "inactive", "casualty", "unknown"]);
export type SoldierStatus = z.infer<typeof SoldierStatusSchema>;

export const SoldierSchema = z.object({
  id: z.string().min(1).max(16),
  name: z.string().min(1).max(64),
  teamId: z.string().min(1).max(32),
  rank: z.string().optional(),
  status: SoldierStatusSchema.default("unknown"),
  /** Estimated floor number (0 = ground, negative = basement) */
  floor: z.number().int().default(0),
  /** Estimated floor label ("B2", "B1", "G", "1".."5") */
  floorLabel: FloorLabelSchema.optional(),
  /** Latest telemetry packet received */
  lastPacket: TelemetryPacketSchema.optional(),
  /** Server-side timestamp of last packet (ms since epoch) */
  lastSeenAt: z.number().int().positive().optional(),
});

export type Soldier = z.infer<typeof SoldierSchema>;

// ─── Team ────────────────────────────────────────────────────────────────────

export const TeamIdSchema = z.enum(["Alpha", "Bravo", "Charlie", "Delta"]);
export type TeamId = z.infer<typeof TeamIdSchema>;

export const TeamSchema = z.object({
  id: TeamIdSchema,
  name: z.string().min(1).max(64),
  /** CSS/Tailwind-safe colour token */
  colour: z.string(),
  soldierIds: z.array(z.string()),
  /** Team leader soldier ID */
  leaderId: z.string().optional(),
});

export type Team = z.infer<typeof TeamSchema>;

// ─── Alert ───────────────────────────────────────────────────────────────────

export const AlertSeveritySchema = z.enum(["info", "warning", "critical"]);
export type AlertSeverity = z.infer<typeof AlertSeveritySchema>;

export const AlertTypeSchema = z.enum([
  "battery_low",
  "signal_lost",
  "man_down",
  "out_of_bounds",
  "custom",
]);
export type AlertType = z.infer<typeof AlertTypeSchema>;

export const AlertSchema = z.object({
  id: z.string().uuid(),
  type: AlertTypeSchema,
  severity: AlertSeveritySchema,
  soldierId: z.string().min(1).max(16),
  teamId: z.string().min(1).max(32),
  message: z.string().max(256),
  timestamp: z.number().int().positive(),
  acknowledged: z.boolean().default(false),
  acknowledgedBy: z.string().optional(),
  acknowledgedAt: z.number().int().positive().optional(),
});

export type Alert = z.infer<typeof AlertSchema>;

// ─── WebSocket Messages ───────────────────────────────────────────────────────

/** Message sent from simulator / device → server */
export const IngestMessageSchema = z.object({
  type: z.literal("telemetry"),
  payload: TelemetryPacketSchema,
});
export type IngestMessage = z.infer<typeof IngestMessageSchema>;

/** Message sent from server → dashboard clients */
export const DashboardMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("telemetry"), payload: TelemetryPacketSchema }),
  z.object({ type: z.literal("alert"), payload: AlertSchema }),
  z.object({
    type: z.literal("soldier_update"),
    payload: SoldierSchema,
  }),
  z.object({
    type: z.literal("ping"),
    payload: z.object({ serverTime: z.number() }),
  }),
]);
export type DashboardMessage = z.infer<typeof DashboardMessageSchema>;

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const UserRoleSchema = z.enum(["commander", "viewer"]);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const LoginRequestSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const LoginResponseSchema = z.object({
  token: z.string(),
  role: UserRoleSchema,
  expiresAt: z.number().int().positive(),
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

// ─── Floor Estimation ────────────────────────────────────────────────────────

/** Sea-level standard pressure in hPa */
export const SEA_LEVEL_HPA = 1013.25;

/** Metres per hPa (approximate at standard atmosphere, low altitude) */
export const METRES_PER_HPA = 8.3;

/** Height of one building floor in metres (configurable, default: 3.5 m) */
export const FLOOR_HEIGHT_M = 3.5;
