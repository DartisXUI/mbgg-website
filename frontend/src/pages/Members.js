import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BadgeCheck, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { http } from "@/lib/api";
import { Loader } from "@/components/ProtectedRoute";

export default function Members() {
  const [list, setList] = useState(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    http.get("/members").then((r) => setList(r.data));
  }, []);
  if (!list) return <Loader />;
  const shown = list.filter((m) => m.name?.toLowerCase().includes(q.toLowerCase()));
  return (
    <div data-testid="members-page" className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex-1">
          <div className="eyebrow">{list.length} members</div>
          <h1 className="font-display text-4xl font-black uppercase sm:text-5xl">Members & collections</h1>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-500" />
          <Input data-testid="members-search-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a member" className="h-11 bg-[#121826] pl-9" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((m, i) => (
          <Link key={m.user_id} to={`/u/${m.user_id}`} data-testid={`member-card-${m.user_id}`}
            className={`panel ${["panel-red", "panel-blue", "panel-orange"][i % 3]} flex items-center gap-3 transition-transform hover:-translate-y-0.5`}>
            <img src={m.picture || "/brand/round.png"} alt="" className="h-12 w-12 rounded-full object-cover" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 truncate font-display text-xl font-bold uppercase">
                {m.name} {m.is_subscriber && <BadgeCheck className="h-4 w-4 shrink-0 text-mb-orange" />}
              </div>
              <div className="text-xs text-slate-400">{m.collection_count} games in collection{m.role !== "member" ? ` · ${m.role}` : ""}</div>
              {(m.player_tag || m.guilds.length > 0) && (
                <div data-testid={`member-ids-${m.user_id}`} className="mt-1 flex flex-wrap gap-1 text-[11px]">
                  {m.player_tag && <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono-x">Player ID: {m.player_tag}</span>}
                  {m.guilds.map((g) => <span key={g.id} title={g.name} className="rounded bg-[var(--mb-blue)]/15 px-1.5 py-0.5 font-mono-x text-mb-blue">Guild: {g.tag}</span>)}
                </div>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
