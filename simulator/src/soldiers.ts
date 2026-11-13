/**
 * Soldier definitions – 16 soldiers in 4 teams of 4.
 * Each soldier has a starting position and floor assignment.
 */

import type { TeamId } from "@hit-tracker/shared";

export interface SoldierDef {
  id: string;
  name: string;
  teamId: TeamId;
  /** Starting X position (metres) */
  startX: number;
  /** Starting Y position (metres) */
  startY: number;
  /** Starting floor (0 = ground, negative = basement) */
  startFloor: number;
}

export const SOLDIERS: SoldierDef[] = [
  // ── Alpha Team ─────────────────────────────────────────────────────────────
  { id: "A1", name: "Naik Arjun Singh",      teamId: "Alpha", startX:  2, startY:  2, startFloor: 1  },
  { id: "A2", name: "Sepoy Rahul Yadav",     teamId: "Alpha", startX:  3, startY:  3, startFloor: 1  },
  { id: "A3", name: "Sepoy Vikram Mehra",    teamId: "Alpha", startX:  4, startY:  2, startFloor: 1  },
  { id: "A4", name: "Sepoy Deepak Nair",     teamId: "Alpha", startX:  5, startY:  3, startFloor: 1  },

  // ── Bravo Team ─────────────────────────────────────────────────────────────
  { id: "B1", name: "Havildar Rajan Kumar",  teamId: "Bravo", startX: 10, startY:  2, startFloor: 0  },
  { id: "B2", name: "Sepoy Suresh Patel",    teamId: "Bravo", startX: 11, startY:  3, startFloor: 0  },
  { id: "B3", name: "Sepoy Arun Sharma",     teamId: "Bravo", startX: 12, startY:  2, startFloor: 0  },
  { id: "B4", name: "Sepoy Kiran Joshi",     teamId: "Bravo", startX: 13, startY:  3, startFloor: 0  },

  // ── Charlie Team ───────────────────────────────────────────────────────────
  { id: "C1", name: "Naik Pradeep Reddy",    teamId: "Charlie", startX:  2, startY: 10, startFloor: 2  },
  { id: "C2", name: "Sepoy Ashok Verma",     teamId: "Charlie", startX:  3, startY: 11, startFloor: 2  },
  { id: "C3", name: "Sepoy Rajesh Gupta",    teamId: "Charlie", startX:  4, startY: 10, startFloor: 2  },
  { id: "C4", name: "Sepoy Mohan Das",       teamId: "Charlie", startX:  5, startY: 11, startFloor: 2  },

  // ── Delta Team ─────────────────────────────────────────────────────────────
  { id: "D1", name: "Havildar Sunil Tiwari", teamId: "Delta", startX: 10, startY: 10, startFloor: -1 },
  { id: "D2", name: "Sepoy Ramesh Pillai",   teamId: "Delta", startX: 11, startY: 11, startFloor: -1 },
  { id: "D3", name: "Sepoy Ganesh Iyer",     teamId: "Delta", startX: 12, startY: 10, startFloor: -1 },
  { id: "D4", name: "Sepoy Vinod Chandra",   teamId: "Delta", startX: 13, startY: 11, startFloor: -1 },
];
