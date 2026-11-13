// Static roster placeholder – will be replaced with live WebSocket data in a later task

const TEAMS = [
  { id: "Alpha", colour: "bg-red-500", soldiers: ["A1","A2","A3","A4"] },
  { id: "Bravo", colour: "bg-blue-500", soldiers: ["B1","B2","B3","B4"] },
  { id: "Charlie", colour: "bg-yellow-500", soldiers: ["C1","C2","C3","C4"] },
  { id: "Delta", colour: "bg-purple-500", soldiers: ["D1","D2","D3","D4"] },
];

interface Props {
  role: "commander" | "viewer";
}

export default function Roster({ role }: Props) {
  return (
    <div className="p-3 space-y-4">
      <div className="text-xs text-gray-500 uppercase tracking-widest border-b border-nsg-border pb-2">
        Force Roster
        {role === "commander" && (
          <span className="ml-2 text-nsg-accent">● CMD</span>
        )}
      </div>

      {TEAMS.map((team) => (
        <div key={team.id}>
          <div className="flex items-center gap-2 mb-2">
            <span className={`h-2 w-2 rounded-full ${team.colour}`} />
            <span className="text-xs font-bold text-gray-200 uppercase tracking-wider">
              {team.id}
            </span>
          </div>
          <ul className="space-y-1 ml-4">
            {team.soldiers.map((id) => (
              <li
                key={id}
                className="flex items-center justify-between text-xs text-gray-400 border border-nsg-border/50 rounded px-2 py-1"
              >
                <span>{id}</span>
                <span className="text-gray-600">—</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
