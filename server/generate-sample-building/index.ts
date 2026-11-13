/**
 * Procedural Sample Building Generator for HIT-Tracker
 *
 * Generates an 8-level military/tactical building (B2, B1, G, 1-5)
 * with stairwells, interior rooms, corridors, and exterior walls.
 * Uses @gltf-transform/core to output a pure binary GLB (no browser APIs).
 *
 * Output: server/samples/sample-building.glb (and synced to client/public/models/)
 */

import { Document, NodeIO, Accessor } from "@gltf-transform/core";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Building Dimensions ─────────────────────────────────────────────────────

const BUILDING_WIDTH_X = 30; // metres (0 to 30)
const BUILDING_DEPTH_Z = 20; // metres (0 to 20)
const FLOOR_HEIGHT_Y = 3.5;  // metres per floor
const WALL_THICKNESS = 0.2;  // metres
const CEILING_HEIGHT = 3.2;  // wall height clearance

// Stairwell shaft bounding box
const STAIR_X_MIN = 13.5;
const STAIR_X_MAX = 16.5;
const STAIR_Z_MIN = 8.5;
const STAIR_Z_MAX = 11.5;

interface FloorDef {
  label: string;
  floorIndex: number; // -2..5
  name: string;
}

const FLOORS: FloorDef[] = [
  { label: "B2", floorIndex: -2, name: "Basement Level 2 (Secure Bunker)" },
  { label: "B1", floorIndex: -1, name: "Basement Level 1 (Armoury & Logistics)" },
  { label: "G",  floorIndex:  0, name: "Ground Floor (Entry & Lobby)" },
  { label: "1",  floorIndex:  1, name: "Floor 1 (Admin & Command)" },
  { label: "2",  floorIndex:  2, name: "Floor 2 (Operations Center)" },
  { label: "3",  floorIndex:  3, name: "Floor 3 (Communications Hub)" },
  { label: "4",  floorIndex:  4, name: "Floor 4 (Quarters & Briefing)" },
  { label: "5",  floorIndex:  5, name: "Floor 5 (Rooftop Access & Observ.)" },
];

// ─── Box Geometry Builder ─────────────────────────────────────────────────────

interface BoxSpec {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

interface MeshData {
  positions: number[];
  normals: number[];
  indices: number[];
}

function createMeshData(): MeshData {
  return { positions: [], normals: [], indices: [] };
}

function appendBox(mesh: MeshData, box: BoxSpec): void {
  const { minX, minY, minZ, maxX, maxY, maxZ } = box;
  const startIndex = mesh.positions.length / 3;

  // 24 vertices for 6 faces with distinct normals
  // prettier-ignore
  const v = [
    // Front (+Z)
    minX, minY, maxZ,   maxX, minY, maxZ,   maxX, maxY, maxZ,   minX, maxY, maxZ,
    // Back (-Z)
    maxX, minY, minZ,   minX, minY, minZ,   minX, maxY, minZ,   maxX, maxY, minZ,
    // Top (+Y)
    minX, maxY, maxZ,   maxX, maxY, maxZ,   maxX, maxY, minZ,   minX, maxY, minZ,
    // Bottom (-Y)
    minX, minY, minZ,   maxX, minY, minZ,   maxX, minY, maxZ,   minX, minY, maxZ,
    // Right (+X)
    maxX, minY, maxZ,   maxX, minY, minZ,   maxX, maxY, minZ,   maxX, maxY, maxZ,
    // Left (-X)
    minX, minY, minZ,   minX, minY, maxZ,   minX, maxY, maxZ,   minX, maxY, minZ,
  ];

  // prettier-ignore
  const n = [
    // Front (+Z)
    0, 0, 1,   0, 0, 1,   0, 0, 1,   0, 0, 1,
    // Back (-Z)
    0, 0, -1,  0, 0, -1,  0, 0, -1,  0, 0, -1,
    // Top (+Y)
    0, 1, 0,   0, 1, 0,   0, 1, 0,   0, 1, 0,
    // Bottom (-Y)
    0, -1, 0,  0, -1, 0,  0, -1, 0,  0, -1, 0,
    // Right (+X)
    1, 0, 0,   1, 0, 0,   1, 0, 0,   1, 0, 0,
    // Left (-X)
    -1, 0, 0,  -1, 0, 0,  -1, 0, 0,  -1, 0, 0,
  ];

  mesh.positions.push(...v);
  mesh.normals.push(...n);

  for (let face = 0; face < 6; face++) {
    const base = startIndex + face * 4;
    mesh.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

// ─── Build Floors ─────────────────────────────────────────────────────────────

export async function generateSampleBuilding(): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene("BuildingScene");

  // Materials
  const floorMaterial = doc
    .createMaterial("FloorMat")
    .setBaseColorFactor([0.13, 0.16, 0.22, 1.0]) // Dark tactical slate
    .setRoughnessFactor(0.8)
    .setMetallicFactor(0.1);

  const wallMaterial = doc
    .createMaterial("WallMat")
    .setBaseColorFactor([0.22, 0.28, 0.36, 1.0]) // Muted blue-grey concrete
    .setRoughnessFactor(0.9)
    .setMetallicFactor(0.0);

  const stairMaterial = doc
    .createMaterial("StairMat")
    .setBaseColorFactor([0.15, 0.55, 0.45, 1.0]) // Tactical green accent
    .setRoughnessFactor(0.5)
    .setMetallicFactor(0.3);

  for (const floor of FLOORS) {
    const floorY = floor.floorIndex * FLOOR_HEIGHT_Y;
    const floorMesh = doc.createMesh(`Mesh_Floor_${floor.label}`);

    const floorSlabData = createMeshData();
    const wallsData = createMeshData();
    const stairsData = createMeshData();

    // 1. Floor Slab (with stairwell cutout on upper floors)
    const isLowest = floor.floorIndex === -2;
    if (isLowest) {
      appendBox(floorSlabData, {
        minX: 0,
        minY: floorY - 0.2,
        minZ: 0,
        maxX: BUILDING_WIDTH_X,
        maxY: floorY,
        maxZ: BUILDING_DEPTH_Z,
      });
    } else {
      // 4 sub-slabs surrounding central stairwell
      appendBox(floorSlabData, {
        minX: 0,
        minY: floorY - 0.2,
        minZ: 0,
        maxX: STAIR_X_MIN,
        maxY: floorY,
        maxZ: BUILDING_DEPTH_Z,
      });
      appendBox(floorSlabData, {
        minX: STAIR_X_MAX,
        minY: floorY - 0.2,
        minZ: 0,
        maxX: BUILDING_WIDTH_X,
        maxY: floorY,
        maxZ: BUILDING_DEPTH_Z,
      });
      appendBox(floorSlabData, {
        minX: STAIR_X_MIN,
        minY: floorY - 0.2,
        minZ: 0,
        maxX: STAIR_X_MAX,
        maxY: floorY,
        maxZ: STAIR_Z_MIN,
      });
      appendBox(floorSlabData, {
        minX: STAIR_X_MIN,
        minY: floorY - 0.2,
        minZ: STAIR_Z_MAX,
        maxX: STAIR_X_MAX,
        maxY: floorY,
        maxZ: BUILDING_DEPTH_Z,
      });
    }

    // 2. Exterior Perimeter Walls
    const wallY = floorY;
    const wallTop = floorY + CEILING_HEIGHT;

    // South wall (front)
    appendBox(wallsData, {
      minX: 0,
      minY: wallY,
      minZ: 0,
      maxX: BUILDING_WIDTH_X,
      maxY: wallTop,
      maxZ: WALL_THICKNESS,
    });
    // North wall (back)
    appendBox(wallsData, {
      minX: 0,
      minY: wallY,
      minZ: BUILDING_DEPTH_Z - WALL_THICKNESS,
      maxX: BUILDING_WIDTH_X,
      maxY: wallTop,
      maxZ: BUILDING_DEPTH_Z,
    });
    // West wall (left)
    appendBox(wallsData, {
      minX: 0,
      minY: wallY,
      minZ: WALL_THICKNESS,
      maxX: WALL_THICKNESS,
      maxY: wallTop,
      maxZ: BUILDING_DEPTH_Z - WALL_THICKNESS,
    });
    // East wall (right)
    appendBox(wallsData, {
      minX: BUILDING_WIDTH_X - WALL_THICKNESS,
      minY: wallY,
      minZ: WALL_THICKNESS,
      maxX: BUILDING_WIDTH_X,
      maxY: wallTop,
      maxZ: BUILDING_DEPTH_Z - WALL_THICKNESS,
    });

    // 3. Interior Walls: Central corridor at Z in [9, 11]
    // Corridor south wall (z: 8.8 to 9.0) with door openings
    appendBox(wallsData, {
      minX: 0,
      minY: wallY,
      minZ: 9.0 - WALL_THICKNESS,
      maxX: 5.0,
      maxY: wallTop,
      maxZ: 9.0,
    });
    appendBox(wallsData, {
      minX: 6.5,
      minY: wallY,
      minZ: 9.0 - WALL_THICKNESS,
      maxX: STAIR_X_MIN,
      maxY: wallTop,
      maxZ: 9.0,
    });
    appendBox(wallsData, {
      minX: STAIR_X_MAX,
      minY: wallY,
      minZ: 9.0 - WALL_THICKNESS,
      maxX: 23.5,
      maxY: wallTop,
      maxZ: 9.0,
    });
    appendBox(wallsData, {
      minX: 25.0,
      minY: wallY,
      minZ: 9.0 - WALL_THICKNESS,
      maxX: BUILDING_WIDTH_X,
      maxY: wallTop,
      maxZ: 9.0,
    });

    // Corridor north wall (z: 11.0 to 11.2) with door openings
    appendBox(wallsData, {
      minX: 0,
      minY: wallY,
      minZ: 11.0,
      maxX: 5.0,
      maxY: wallTop,
      maxZ: 11.0 + WALL_THICKNESS,
    });
    appendBox(wallsData, {
      minX: 6.5,
      minY: wallY,
      minZ: 11.0,
      maxX: STAIR_X_MIN,
      maxY: wallTop,
      maxZ: 11.0 + WALL_THICKNESS,
    });
    appendBox(wallsData, {
      minX: STAIR_X_MAX,
      minY: wallY,
      minZ: 11.0,
      maxX: 23.5,
      maxY: wallTop,
      maxZ: 11.0 + WALL_THICKNESS,
    });
    appendBox(wallsData, {
      minX: 25.0,
      minY: wallY,
      minZ: 11.0,
      maxX: BUILDING_WIDTH_X,
      maxY: wallTop,
      maxZ: 11.0 + WALL_THICKNESS,
    });

    // Room dividing walls (East-West room dividers)
    const roomDividersX = [7.5, 22.5];
    for (const rx of roomDividersX) {
      // South wing divider (z from 0 to 9)
      appendBox(wallsData, {
        minX: rx - WALL_THICKNESS / 2,
        minY: wallY,
        minZ: 0,
        maxX: rx + WALL_THICKNESS / 2,
        maxY: wallTop,
        maxZ: 9.0,
      });
      // North wing divider (z from 11 to 20)
      appendBox(wallsData, {
        minX: rx - WALL_THICKNESS / 2,
        minY: wallY,
        minZ: 11.0,
        maxX: rx + WALL_THICKNESS / 2,
        maxY: wallTop,
        maxZ: BUILDING_DEPTH_Z,
      });
    }

    // 4. Stairwell: Shaft Enclosure and Steps
    // Side walls for stairwell
    appendBox(wallsData, {
      minX: STAIR_X_MIN - WALL_THICKNESS,
      minY: wallY,
      minZ: STAIR_Z_MIN,
      maxX: STAIR_X_MIN,
      maxY: wallTop,
      maxZ: STAIR_Z_MAX,
    });
    appendBox(wallsData, {
      minX: STAIR_X_MAX,
      minY: wallY,
      minZ: STAIR_Z_MIN,
      maxX: STAIR_X_MAX + WALL_THICKNESS,
      maxY: wallTop,
      maxZ: STAIR_Z_MAX,
    });

    // Staircase steps leading from floorY to floorY + FLOOR_HEIGHT_Y
    if (floor.floorIndex < 5) {
      const numSteps = 7;
      const stepWidth = STAIR_X_MAX - STAIR_X_MIN - 0.4;
      const stepHeight = FLOOR_HEIGHT_Y / numSteps;
      const stepDepth = (STAIR_Z_MAX - STAIR_Z_MIN - 0.4) / numSteps;

      for (let s = 0; s < numSteps; s++) {
        appendBox(stairsData, {
          minX: STAIR_X_MIN + 0.2,
          minY: floorY + s * stepHeight,
          minZ: STAIR_Z_MIN + 0.2 + s * stepDepth,
          maxX: STAIR_X_MIN + 0.2 + stepWidth,
          maxY: floorY + (s + 1) * stepHeight,
          maxZ: STAIR_Z_MIN + 0.2 + (s + 1) * stepDepth,
        });
      }
    }

    // Attach primitives to floorMesh
    attachPrimitive(doc, buffer, floorMesh, floorSlabData, floorMaterial);
    attachPrimitive(doc, buffer, floorMesh, wallsData, wallMaterial);
    if (stairsData.positions.length > 0) {
      attachPrimitive(doc, buffer, floorMesh, stairsData, stairMaterial);
    }

    // Create Floor Node with standard naming Floor_<LABEL>
    const floorNode = doc.createNode(`Floor_${floor.label}`).setMesh(floorMesh);
    scene.addChild(floorNode);
  }

  const io = new NodeIO();
  return io.writeBinary(doc);
}

function attachPrimitive(
  doc: Document,
  buffer: ReturnType<Document["createBuffer"]>,
  mesh: ReturnType<Document["createMesh"]>,
  data: MeshData,
  material: ReturnType<Document["createMaterial"]>
): void {
  if (data.positions.length === 0) return;

  const posAccessor = doc
    .createAccessor()
    .setBuffer(buffer)
    .setType(Accessor.Type.VEC3)
    .setArray(new Float32Array(data.positions));

  const normAccessor = doc
    .createAccessor()
    .setBuffer(buffer)
    .setType(Accessor.Type.VEC3)
    .setArray(new Float32Array(data.normals));

  const idxAccessor = doc
    .createAccessor()
    .setBuffer(buffer)
    .setType(Accessor.Type.SCALAR)
    .setArray(new Uint32Array(data.indices));

  const prim = doc
    .createPrimitive()
    .setIndices(idxAccessor)
    .setAttribute("POSITION", posAccessor)
    .setAttribute("NORMAL", normAccessor)
    .setMaterial(material);

  mesh.addPrimitive(prim);
}

// ─── Direct Execution ────────────────────────────────────────────────────────

async function main() {
  console.log("[generator] Generating procedural sample building (8 levels)...");
  const glbBytes = await generateSampleBuilding();

  const outDir = path.resolve(__dirname, "../samples");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "sample-building.glb");
  fs.writeFileSync(outPath, Buffer.from(glbBytes));
  console.log(`[generator] Wrote server sample: ${outPath} (${(glbBytes.byteLength / 1024).toFixed(1)} KB)`);

  // Also copy to client/public/models/ so Vite can serve it offline without proxy latency
  const clientDir = path.resolve(__dirname, "../../client/public/models");
  fs.mkdirSync(clientDir, { recursive: true });
  const clientPath = path.join(clientDir, "sample-building.glb");
  fs.writeFileSync(clientPath, Buffer.from(glbBytes));
  console.log(`[generator] Wrote client static asset: ${clientPath}`);
}

if (process.argv[1] && process.argv[1].endsWith("index.ts")) {
  main().catch((err) => {
    console.error("[generator] Error:", err);
    process.exit(1);
  });
}
