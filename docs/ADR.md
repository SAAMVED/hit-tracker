# Architecture Decision Records

## ADR-001: Offline-First with SQLite

**Status:** Accepted  
**Date:** 2024-11-14

### Context
HIT-Tracker is deployed in forward operating environments with no internet access. The system must operate completely offline.

### Decision
- SQLite (via better-sqlite3) for all persistence – no external DB needed.
- WebSocket (ws) for real-time telemetry – no MQTT broker.
- JWT (jsonwebtoken + bcryptjs) for auth stored locally.
- All npm packages bundled at install time, no CDN references.

### Consequences
- Simple deployment: single Node process + SQLite file.
- No horizontal scaling (acceptable for single-ICP use case).

---

## ADR-002: Monorepo with npm Workspaces

**Status:** Accepted

### Decision
npm workspaces with four packages: `shared`, `server`, `client`, `simulator`.

- `shared` holds all Zod schemas and pure business logic (barometric estimation).  
- Server and client import from `shared` directly (TypeScript path resolution).  
- Simulator is a standalone Node process.

---

## ADR-003: Barometric Floor Estimation

**Status:** Accepted

### Decision
Floor is estimated from barometric pressure using the hypsometric approximation:

```
Δh ≈ 8.3 m/hPa × (P_ground − P_measured)
floor = round(Δh / 3.0 m)
```

A reference pressure reading must be taken at the building's ground floor before operation.
