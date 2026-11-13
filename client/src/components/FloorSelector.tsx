interface Props {
  floors: number[];
  activeFloor: number;
  onSelect: (floor: number) => void;
}

export default function FloorSelector({ floors, activeFloor, onSelect }: Props) {
  return (
    <>
      {floors.map((floor) => (
        <button
          key={floor}
          onClick={() => onSelect(floor)}
          title={floorLabel(floor)}
          className={`w-10 h-10 rounded text-xs font-bold border transition-colors ${
            activeFloor === floor
              ? "bg-nsg-accent text-nsg-dark border-nsg-accent"
              : "bg-transparent text-gray-400 border-nsg-border hover:border-nsg-accent hover:text-nsg-accent"
          }`}
        >
          {floorLabel(floor)}
        </button>
      ))}
    </>
  );
}

function floorLabel(floor: number): string {
  if (floor === 0) return "G";
  if (floor < 0) return `B${Math.abs(floor)}`;
  return `F${floor}`;
}
