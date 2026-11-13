# HIT-Tracker

**Offline-first 3D indoor tracking dashboard for the National Security Guard (NSG)**

A Task Force Commander at the Integrated Command Post (ICP) tracks House Intervention Teams (HITs) inside multi-floor buildings and basements on a live 3D building model.

## Architecture

```
monorepo (npm workspaces)
├── shared/      – Zod schemas, TypeScript types, barometric estimation, Vitest tests
├── server/      – Node 20 + Express + SQLite + WebSocket gateway + JWT auth
├── client/      – React + Vite + Tailwind + @react-three/fiber + drei
├── simulator/   – 16-soldier, 4-team telemetry simulator (1 Hz)
└── docs/        – Architecture notes and ADRs
```

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your secrets

# 3. Start everything (server + client dev + simulator)
npm start

# 4. Open dashboard
# http://localhost:5173
```

## NPM Scripts

| Script | Description |
|---|---|
| `npm run build` | Build all workspaces |
| `npm test` | Run Vitest tests in shared/ |
| `npm run typecheck` | TypeScript check across all workspaces |
| `npm start` | Start server + client dev + simulator concurrently |
| `npm run start:prod` | Start server in production mode |
| `npm run generate:models` | Generate 3D model assets (placeholder) |

## Roles

| Role | Capabilities |
|---|---|
| `commander` | Full control – pan/zoom map, acknowledge alerts, assign teams |
| `viewer` | Read-only live view |

## Telemetry Packet

Each soldier's device sends a JSON packet at 1 Hz over WebSocket:

```json
{
  "soldierId": "A1",
  "teamId": "Alpha",
  "seq": 42,
  "timestamp": 1700000000000,
  "x": 12.5,
  "y": 8.3,
  "pressureHpa": 1013.25,
  "batteryPct": 87,
  "signal": -72
}
```

## Environment Variables

See `.env.example` for all required variables.

## Offline First

HIT-Tracker is designed for forward operating environments with no internet access:
- No CDNs – all assets served locally
- No cloud services – SQLite for persistence
- WebSocket for real-time telemetry
- JWT for authentication

## License

Restricted – National Security Guard use only.
