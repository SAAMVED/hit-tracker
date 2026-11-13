import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";

interface Props {
  floor: number;
}

export default function Viewport({ floor }: Props) {
  return (
    <div className="w-full h-full relative">
      {/* Floor label overlay */}
      <div className="absolute top-3 left-3 z-10 bg-nsg-surface/80 border border-nsg-border rounded px-3 py-1 text-xs text-nsg-accent uppercase tracking-widest pointer-events-none">
        {floorLabel(floor)} — 3D View
      </div>

      <Canvas
        camera={{ position: [20, 20, 20], fov: 50 }}
        style={{ background: "#0a0e1a" }}
      >
        {/* Lighting */}
        <ambientLight intensity={0.4} />
        <directionalLight position={[10, 20, 10]} intensity={0.8} />

        {/* Floor grid placeholder */}
        <Grid
          args={[40, 40]}
          cellSize={1}
          cellThickness={0.5}
          cellColor="#1f2937"
          sectionSize={5}
          sectionThickness={1}
          sectionColor="#374151"
          fadeDistance={60}
          fadeStrength={1}
          position={[0, 0, 0]}
        />

        {/* Building outline placeholder box */}
        <mesh position={[0, 1, 0]}>
          <boxGeometry args={[20, 2, 15]} />
          <meshStandardMaterial color="#1f2937" wireframe />
        </mesh>

        <OrbitControls makeDefault />
      </Canvas>
    </div>
  );
}

function floorLabel(floor: number): string {
  if (floor === 0) return "Ground Floor";
  if (floor < 0) return `Basement ${Math.abs(floor)}`;
  return `Floor ${floor}`;
}
