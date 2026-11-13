import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { http, plural } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Loader } from "@/components/ProtectedRoute";
import { HonorNote } from "@/components/SubscriberGate";
import { MonthlyTopGames } from "@/components/MonthlyTopGames";

const METRICS = [
  { key: "total_score", label: "Total score", fmt: (r) => r.total_score.toLocaleString(), sort: (a, b) => b.total_score - a.total_score },
  { key: "wins", label: "Wins (1st place)", fmt: (r) => r.wins, sort: (a, b) => b.wins - a.wins || a.avg_placement - b.avg_placement },
  { key: "avg_placement", label: "Avg placement", fmt: (r) => r.avg_placement.toFixed(2), sort: (a, b) => a.avg_placement - b.avg_placement || b.games - a.games },
  { key: "podiums", label: "Podiums (top 3)", fmt: (r) => r.podiums, sort: (a, b) => b.podiums - a.podiums },
  { key: "win_rate", label: "Win rate", fmt: (r) => `${r.win_rate}%`, sort: (a, b) => b.win_rate - a.win_rate || b.games - a.games, min: 3 },
  { key: "playtime_min", label: "Playtime", fmt: (r) => `${(r.playtime_min / 60).toFixed(1)}h`, sort: (a, b) => b.playtime_min - a.playtime_min },
  { key: "games", label: "Most played", fmt: (r) => plural(r.games, "play"), sort: (a, b) => b.games - a.games },
];
const MEDAL = ["text-mb-orange", "text-slate-200", "text-[#cd7f32]"];

const Board = ({ rows, metric, me }) => {
  const m = METRICS.find((x) => x.key === metric);
  const list = rows.filter((r) => !m.min || r.games >= m.min).sort(m.sort);
  return (
    <div data-testid={`leaderboard-${metric}`} className="panel !p-0 overflow-hidden">
      {m.min && <div className="border-b border-white/10 px-5 py-2 text-xs text-slate-500">Minimum {m.min} plays to qualify</div>}
      {list.map((r, i) => (
        <Link to={`/u/${r.user_id}`} key={r.user_id} data-testid={`leaderboard-row-${i + 1}`}
          className={`flex items-center gap-4 border-b border-white/5 px-5 py-3 transition-colors hover:bg-white/[0.04] ${r.user_id === me ? "bg-[var(--mb-blue)]/[0.07]" : ""}`}>
          <span className={`w-8 font-display text-2xl font-black ${MEDAL[i] || "text-slate-500"}`}>{i + 1}</span>
          <img src={r.picture || "/brand/round.png"} alt="" className="h-9 w-9 rounded-full object-cover" />
          <span className="flex-1 truncate font-semibold">{r.name}</span>
          <span className="hidden text-xs text-slate-500 sm:inline">{plural(r.games, "play")} · {plural(r.wins, "win")}</span>
          <span className="font-mono-x text-lg text-white">{m.fmt(r)}</span>
        </Link>
      ))}
      {!list.length && <div className="py-12 text-center text-slate-500">No results yet. Log a game to get on the board!</div>}
    </div>
  );
};

export default function Leaderboards() {
  const { user } = useAuth();
  const [game, setGame] = useState("all");
  const [metric, setMetric] = useState("total_score");
  const [data, setData] = useState(null);
  useEffect(() => {
    http.get("/leaderboards", { params: game === "all" ? {} : { game } }).then((r) => setData(r.data));
  }, [game]);
  if (!data) return <Loader />;
  return (
    <div data-testid="leaderboards-page" className="space-y-6">
      <div>
        <div className="eyebrow">Rolling 365 days · since {data.since}</div>
        <h1 className="font-display text-4xl font-black uppercase sm:text-5xl split-title"><span className="r">Leader</span><span className="b">boards</span></h1>
      </div>
      <HonorNote />
      <div>
        <div className="eyebrow mb-2">Game</div>
        <Tabs value={game} onValueChange={setGame}>
          <TabsList className="h-auto flex-wrap justify-start gap-1 bg-[#121826] p-1">
            <TabsTrigger value="all" data-testid="leaderboard-game-tab-all">All games</TabsTrigger>
            {data.games.map((g) => <TabsTrigger key={g.key} value={g.key} data-testid={`leaderboard-game-tab-${g.key.replace(/[^a-z0-9]+/g, "-")}`}>{g.title}</TabsTrigger>)}
          </TabsList>
        </Tabs>
      </div>
      <div>
        <div className="eyebrow mb-2">Ranked by</div>
        <Tabs value={metric} onValueChange={setMetric}>
          <TabsList className="h-auto flex-wrap justify-start gap-1 bg-[#121826] p-1">
            {METRICS.map((m) => <TabsTrigger key={m.key} value={m.key} data-testid={`leaderboard-metric-tab-${m.key}`}>{m.label}</TabsTrigger>)}
          </TabsList>
        </Tabs>
      </div>
      <Board rows={data.rows} metric={metric} me={user.user_id} />
      <MonthlyTopGames />
    </div>
  );
}
