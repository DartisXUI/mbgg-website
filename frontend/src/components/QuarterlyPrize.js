import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Award } from "lucide-react";
import { http } from "@/lib/api";

const fmt = (d) => new Date(`${d}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });

export const QuarterlyPrize = () => {
  const [d, setD] = useState(null);
  useEffect(() => {
    http.get("/leaderboards/quarterly").then((r) => setD(r.data)).catch(() => {});
  }, []);
  if (!d) return null;
  return (
    <section data-testid="quarterly-prize" className="panel panel-orange">
      <div className="eyebrow text-mb-orange">Q{d.quarter} {d.year} · ends {fmt(d.ends)}</div>
      <h2 className="mt-2 flex items-center gap-2 font-display text-3xl font-extrabold uppercase"><Award className="h-7 w-7 text-mb-orange" /> Subscriber score prize</h2>
      <p className="mt-1 text-sm text-slate-400">At the end of March, June, September and December, the subscriber with the highest total score since 1 January wins a free prize. Winners are confirmed a week after the quarter ends so late game logs still count.</p>
      <ol className="mt-4 space-y-1">
        {d.standings.slice(0, 5).map((s, i) => (
          <li key={s.user_id} data-testid={`quarterly-standing-${i + 1}`}>
            <Link to={`/u/${s.user_id}`} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/[0.04]">
              <span className={`w-6 font-display text-xl font-black ${i === 0 ? "text-mb-orange" : "text-slate-500"}`}>{i + 1}</span>
              <span className="flex-1 truncate font-semibold">{s.name}</span>
              <span className="font-mono-x">{s.total_score.toLocaleString()}</span>
            </Link>
          </li>
        ))}
        {!d.standings.length && <li className="text-sm text-slate-500">No subscriber scores logged yet this year.</li>}
      </ol>
      {d.winners.length > 0 && (
        <div data-testid="quarterly-winners" className="mt-4 flex flex-wrap gap-2">
          {d.winners.map((w) => <span key={w.id} className="rounded-full bg-[var(--mb-orange)]/15 px-3 py-1 text-xs text-mb-orange">{w.label}: {w.winner_name} · {w.total_score.toLocaleString()}</span>)}
        </div>
      )}
    </section>
  );
};
