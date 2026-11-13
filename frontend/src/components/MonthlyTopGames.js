import { useEffect, useState } from "react";
import { Flame } from "lucide-react";
import { http, plural } from "@/lib/api";

const monthName = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString("en-AU", { month: "long", year: "numeric" });

export const MonthlyTopGames = () => {
  const [months, setMonths] = useState(null);
  useEffect(() => {
    http.get("/stats/monthly").then((r) => setMonths(r.data));
  }, []);
  if (!months) return null;
  return (
    <section data-testid="monthly-top-games" className="space-y-3">
      <div>
        <div className="eyebrow">From members' logs · last 12 months</div>
        <h2 className="font-display text-3xl font-extrabold uppercase">Most played each month</h2>
      </div>
      {!months.length && <p className="panel text-center text-slate-500">No games logged yet.</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {months.map((m, i) => (
          <div key={m.month} data-testid={`monthly-card-${m.month}`} className={`panel ${["panel-red", "panel-blue", "panel-orange"][i % 3]}`}>
            <div className="flex items-baseline justify-between">
              <h3 className="font-display text-2xl font-bold uppercase">{monthName(m.month)}</h3>
              <span className="text-xs text-slate-400">{plural(m.total_plays, "play")} · {plural(m.distinct_games, "game")}</span>
            </div>
            <ol className="mt-3 space-y-2">
              {m.top.map((g, j) => (
                <li key={g.title} className="flex items-center gap-3">
                  <span className={`w-6 font-display text-xl font-black ${j === 0 ? "text-mb-orange" : "text-slate-500"}`}>{j + 1}</span>
                  {j === 0 && <Flame className="h-4 w-4 text-mb-orange" />}
                  <span className="flex-1 truncate font-semibold">{g.title}</span>
                  <span className="font-mono-x text-xs text-slate-400">{plural(g.plays, "play")} · {plural(g.players, "player")}</span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
};
