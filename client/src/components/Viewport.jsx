import { useMemo, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, useGLTF, Html } from "@react-three/drei";
import * as THREE from "three";
import { floorLabelToNumber } from "@hit-tracker/shared";

const TEAM_COLORS = {
  Alpha: "#ef4444",   // Red
  Bravo: "#3b82f6",   // Blue
  Charlie: "#eab308", // Yellow
  Delta: "#a855f7",   // Purple
};

/**
 * Procedural Building model renderer with Ghost, Cutaway, and Isolated modes.
 */
function BuildingModel({
  activeFloor,
  floorMode,
  calibration = {
    translation: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  },
}) {
  const { scene } = useGLTF("/models/sample-building.glb");
  const clonedScene = useMemo(() => scene.clone(true), [scene]);

  useEffect(() => {
    clonedScene.traverse((obj) => {
      // Find floor membership from node name (e.g. Floor_B2, Floor_G, Floor_1..5)
      let current = obj;
      let nodeFloor = null;

      while (current && current !== clonedScene) {
        const match = current.name.match(/Floor_(B2|B1|G|[1-5])/);
        if (match) {
          nodeFloor = floorLabelToNumber(match[1]);
          break;
        }
        current = current.parent;
      }

      if (nodeFloor !== null) {
        if (floorMode === "isolated") {
          obj.visible = nodeFloor === activeFloor;
        } else if (floorMode === "cutaway") {
          obj.visible = nodeFloor <= activeFloor;
        } else if (floorMode === "ghost") {
          obj.visible = true;
          if (obj instanceof THREE.Mesh) {
            const isTarget = nodeFloor === activeFloor;
            if (Array.isArray(obj.material)) {
              obj.material.forEach((m) => configureMaterial(m, isTarget));
            } else if (obj.material) {
              configureMaterial(obj.material, isTarget);
            }
          }
        }
      }
    });
  }, [clonedScene, activeFloor, floorMode]);

  const pos = [
    calibration?.translation?.x ?? 0,
    calibration?.translation?.y ?? 0,
    calibration?.translation?.z ?? 0,
  ];
  const rot = [
    ((calibration?.rotation?.x ?? 0) * Math.PI) / 180,
    ((calibration?.rotation?.y ?? 0) * Math.PI) / 180,
    ((calibration?.rotation?.z ?? 0) * Math.PI) / 180,
  ];
  const sca = [
    calibration?.scale?.x ?? 1,
    calibration?.scale?.y ?? 1,
    calibration?.scale?.z ?? 1,
  ];

  return (
    <group position={pos} rotation={rot} scale={sca}>
      <primitive object={clonedScene} />
    </group>
  );
}

function configureMaterial(material, isTarget) {
  material.transparent = true;
  material.depthWrite = isTarget;
  material.opacity = isTarget ? 0.95 : 0.12;
}

/**
 * 3D Soldier marker with team color and floating tactical callsign
 */
function SoldierMarker({
  soldier,
  activeFloor,
  floorMode,
  isSelected,
  isManDown,
}) {
  const soldierFloorNum = floorLabelToNumber(soldier.estimatedFloor);

  // Check visibility according to floor mode
  let isVisible = true;
  if (floorMode === "isolated") {
    isVisible = soldierFloorNum === activeFloor;
  } else if (floorMode === "cutaway") {
    isVisible = soldierFloorNum <= activeFloor;
  }

  const teamColor = isManDown ? "#ef4444" : TEAM_COLORS[soldier.teamId] ?? "#10b981";
  const pos = [
    soldier.x,
    soldier.altitude + 0.4,
    soldier.y,
  ];

  if (!isVisible) return null;

  return (
    <group position={pos}>
      {/* Unit base marker pin */}
      <mesh position={[0, 0.4, 0]}>
        <cylinderGeometry args={[0.3, 0.1, 0.8, 16]} />
        <meshStandardMaterial
          color={isManDown ? "#ff0000" : teamColor}
          emissive={isManDown ? "#ff0000" : teamColor}
          emissiveIntensity={isManDown ? 1.5 : isSelected ? 0.8 : 0.3}
          roughness={0.2}
        />
      </mesh>

      {/* Pulsing ring on floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <ringGeometry args={[0.35, isManDown ? 0.75 : 0.5, 24]} />
        <meshBasicMaterial
          color={isManDown ? "#ef4444" : teamColor}
          transparent
          opacity={isManDown ? 0.95 : isSelected ? 0.9 : 0.6}
        />
      </mesh>

      {/* Secondary outer pulsing alarm ring for MAN DOWN */}
      {isManDown && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
          <ringGeometry args={[0.8, 1.25, 32]} />
          <meshBasicMaterial
            color="#ff0000"
            transparent
            opacity={0.8}
          />
        </mesh>
      )}

      {/* Floating Tactical Label */}
      <Html position={[0, 1.2, 0]} center distanceFactor={15}>
        <div
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-mono font-bold whitespace-nowrap shadow-md pointer-events-none ${
            isManDown
              ? "bg-red-950/95 border-red-500 text-red-200 ring-2 ring-red-500 animate-pulse"
              : "bg-black/80 border-white/30 text-white"
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${isManDown ? "bg-red-500 animate-ping" : ""}`}
            style={{ backgroundColor: teamColor }}
          />
          <span>{soldier.soldierId}</span>
          {isManDown ? (
            <span className="bg-red-600 text-white px-1 rounded text-[8px] tracking-wider uppercase font-extrabold animate-pulse">
              MAN DOWN
            </span>
          ) : (
            <span className="text-emerald-400 text-[9px]">
              [{soldier.estimatedFloor}]
            </span>
          )}
        </div>
      </Html>
    </group>
  );
}

/**
 * 3D Movement Breadcrumb Trails
 */
function MovementTrail({
  points,
  color,
}) {
  const lineObject = useMemo(() => {
    if (points.length < 2) return null;
    const geom = new THREE.BufferGeometry();
    const flatPoints = [];
    for (const p of points) {
      flatPoints.push(p[0], p[1] + 0.1, p[2]);
    }
    geom.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(flatPoints, 3)
    );
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.65,
      linewidth: 2,
    });
    return new THREE.Line(geom, mat);
  }, [points, color]);

  if (!lineObject) return null;

  return <primitive object={lineObject} />;
}

export default function Viewport({
  floor,
  floorMode,
  onFloorModeChange,
  soldiers,
  trails,
  selectedSoldierId,
  calibration,
  alerts = [],
}) {
  const soldiersList = useMemo(() => Object.values(soldiers), [soldiers]);

  // Set of soldiers who currently have an active MAN DOWN alert
  const manDownSoldierIds = useMemo(() => {
    const set = new Set();
    for (const a of alerts) {
      if (a.type === "man_down" && !a.acknowledged) {
        set.add(a.soldierId);
      }
    }
    return set;
  }, [alerts]);

  return (
    <div className="w-full h-full relative select-none">
      {/* Top Left Overlay: Floor & Controls */}
      <div className="absolute top-3 left-3 z-10 flex flex-col gap-2">
        <div className="bg-nsg-surface/90 border border-nsg-border rounded px-3 py-1.5 text-xs text-nsg-accent uppercase tracking-widest font-bold backdrop-blur-sm">
          {floorTitle(floor)} — 3D Tactical View
        </div>

        {/* Floor Modes Selector */}
        <div className="flex items-center gap-1 bg-nsg-surface/90 border border-nsg-border rounded p-1 text-[11px] backdrop-blur-sm">
          <span className="text-gray-500 text-[10px] uppercase font-bold px-1.5">
            Mode:
          </span>
          {["ghost", "cutaway", "isolated"].map((mode) => (
            <button
              key={mode}
              onClick={() => onFloorModeChange(mode)}
              className={`px-2 py-0.5 rounded capitalize font-medium transition-colors ${
                floorMode === mode
                  ? "bg-nsg-accent text-nsg-dark font-bold"
                  : "text-gray-400 hover:text-white hover:bg-nsg-border/50"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Top Right: Legend */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-3 bg-nsg-surface/80 border border-nsg-border rounded px-3 py-1.5 text-[10px] backdrop-blur-sm">
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-red-500" />
          <span className="text-gray-300">Alpha</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-blue-500" />
          <span className="text-gray-300">Bravo</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-yellow-500" />
          <span className="text-gray-300">Charlie</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-purple-500" />
          <span className="text-gray-300">Delta</span>
        </div>
      </div>

      {/* 3D Canvas */}
      <Canvas
        camera={{ position: [15, 25, 40], fov: 45 }}
        style={{ background: "#0a0e1a" }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[20, 35, 20]} intensity={0.9} />
        <directionalLight position={[-15, 20, -10]} intensity={0.4} />

        {/* Tactical Grid */}
        <Grid
          args={[60, 60]}
          cellSize={1}
          cellThickness={0.5}
          cellColor="#1f2937"
          sectionSize={5}
          sectionThickness={1}
          sectionColor="#374151"
          fadeDistance={70}
          fadeStrength={1}
          position={[15, -7.2, 10]}
        />

        {/* Procedural Building Model with Calibration */}
        <BuildingModel
          activeFloor={floor}
          floorMode={floorMode}
          calibration={calibration}
        />

        {/* 3D Movement Trails */}
        {soldiersList.map((s) => {
          const sFloorNum = floorLabelToNumber(s.estimatedFloor);
          if (floorMode === "isolated" && sFloorNum !== floor) return null;
          if (floorMode === "cutaway" && sFloorNum > floor) return null;

          const trail = trails[s.soldierId];
          if (!trail || trail.length < 2) return null;
          return (
            <MovementTrail
              key={`trail-${s.soldierId}`}
              points={trail}
              color={TEAM_COLORS[s.teamId] ?? "#10b981"}
            />
          );
        })}

        {/* 3D Soldier Markers */}
        {soldiersList.map((s) => (
          <SoldierMarker
            key={s.soldierId}
            soldier={s}
            activeFloor={floor}
            floorMode={floorMode}
            isSelected={selectedSoldierId === s.soldierId}
            isManDown={manDownSoldierIds.has(s.soldierId)}
          />
        ))}

        <OrbitControls
          makeDefault
          target={[15, 8, 10]} // Center of the 30x20 building
          maxPolarAngle={Math.PI / 2 + 0.05}
          minDistance={5}
          maxDistance={80}
        />
      </Canvas>
    </div>
  );
}

function floorTitle(floor) {
  if (floor === 0) return "Ground Floor (G)";
  if (floor < 0) return `Basement Level ${Math.abs(floor)} (B${Math.abs(floor)})`;
  return `Floor ${floor}`;
}
