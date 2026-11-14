import { useEffect, useState } from "react";
import { http, plural } from "@/lib/api";
import { Loader } from "@/components/ProtectedRoute";

const MEDAL = ["text-mb-orange", "text-slate-200", "text-[#cd7f32]"];

export const GuildBoard = () => {
  const [d, setD] = useState(null);
  useEffect(() => {
    http.get("/leaderboards/guilds").then((r) => setD(r.data));
  }, []);
  if (!d) return <Loader />;
  return (
    <div data-testid="guild-leaderboard" className="panel !p-0 overflow-hidden">
      <div className="border-b border-white/10 px-5 py-2 text-xs text-slate-500">Total of every guild member's logged results since {d.since}. Members in several guilds count for each.</div>
      {d.rows.map((g, i) => (
        <div key={g.id} data-testid={`guild-leaderboard-row-${i + 1}`} className="flex flex-wrap items-center gap-4 border-b border-white/5 px-5 py-3">
          <span className={`w-8 font-display text-2xl font-black ${MEDAL[i] || "text-slate-500"}`}>{i + 1}</span>
          <span className="rounded bg-[var(--mb-blue)]/15 px-2 py-0.5 font-mono-x text-xs text-mb-blue">{g.tag}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{g.name}</div>
            <div className="text-xs text-slate-500">{plural(g.members, "member")} · {plural(g.games, "play")} · {plural(g.wins, "win")} · {(g.playtime_min / 60).toFixed(1)}h{g.top_player ? ` · top: ${g.top_player}` : ""}</div>
          </div>
          <span className="font-mono-x text-lg text-white">{g.total_score.toLocaleString()}</span>
        </div>
      ))}
      {!d.rows.length && <div className="py-12 text-center text-slate-500">No guilds yet.</div>}
    </div>
  );
};
