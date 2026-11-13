interface Props {
  floors: number[];
  activeFloor: number;
  onSelect: (floor: number) => void;
  unitCounts?: Record<number, number>;
}

export default function FloorSelector({
  floors,
  activeFloor,
  onSelect,
  unitCounts = {},
}: Props) {
  return (
    <div className="flex flex-col items-center gap-2 w-full px-1">
      <div className="text-[10px] text-gray-500 uppercase tracking-widest text-center font-bold mb-1">
        Floor
      </div>
      {floors.map((floor) => {
        const count = unitCounts[floor] ?? 0;
        const isActive = activeFloor === floor;

        return (
          <button
            key={floor}
            onClick={() => onSelect(floor)}
            title={`${floorTitle(floor)}: ${count} unit${count === 1 ? "" : "s"}`}
            className={`w-12 h-11 rounded flex flex-col items-center justify-center border transition-all ${
              isActive
                ? "bg-nsg-accent text-nsg-dark border-nsg-accent shadow-md shadow-emerald-900/40"
                : "bg-nsg-dark/60 text-gray-400 border-nsg-border hover:border-nsg-accent hover:text-nsg-accent"
            }`}
          >
            <span className="text-xs font-bold leading-none">{floorLabel(floor)}</span>
            <span
              className={`text-[9px] mt-0.5 px-1 rounded-full font-mono font-bold leading-none ${
                count > 0
                  ? isActive
                    ? "bg-nsg-dark text-nsg-accent"
                    : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                  : "opacity-40 text-gray-500"
              }`}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function floorLabel(floor: number): string {
  if (floor === 0) return "G";
  if (floor < 0) return `B${Math.abs(floor)}`;
  return `${floor}`;
}

function floorTitle(floor: number): string {
  if (floor === 0) return "Ground Floor";
  if (floor < 0) return `Basement ${Math.abs(floor)}`;
  return `Floor ${floor}`;
}
