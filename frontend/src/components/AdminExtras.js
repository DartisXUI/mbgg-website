import { useCallback, useEffect, useState } from "react";
import { Check, Gift, Users } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { http, errMsg, adelaideToday, plural } from "@/lib/api";

const ord = (n) => `${n}${["th", "st", "nd", "rd"][(n % 100 >> 3) ^ 1 && n % 10] || "th"}`;
const fmt = (d) => new Date(`${d}T00:00:00`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

export const SessionSummary = () => {
  const [date, setDate] = useState(adelaideToday());
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    http.get("/admin/sessions", { params: { date } }).then((r) => { setData(r.data); setFailed(false); }).catch((e) => { setFailed(true); toast.error(errMsg(e)); });
  }, [date]);
  if (failed && !data) return <p data-testid="session-summary-error" className="panel text-center text-mb-red">Couldn't load the session summary. Try again.</p>;
  if (!data) return null;
  const stats = [["Checked in", data.attendees], ["Players who logged", data.loggers], ["Results logged", data.logs], ["Games played", data.games.length]];
  return (
    <div data-testid="session-summary" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input data-testid="session-date-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11 w-48 bg-[#121826]" />
        {data.recent_dates.slice(0, 6).map((d) => (
          <button key={d} data-testid={`session-date-chip-${d}`} onClick={() => setDate(d)} className={`rounded-full border px-3 py-1.5 text-xs ${d === date ? "border-[var(--mb-orange)] text-mb-orange" : "border-white/15 text-slate-300"}`}>{d}</button>
        ))}
      </div>
      <h3 className="font-display text-2xl font-bold uppercase">{fmt(data.date)}</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(([k, v]) => (
          <div key={k} className="panel !p-4"><div className="eyebrow">{k}</div><div data-testid={`session-stat-${k.toLowerCase().replace(/\s+/g, "-")}`} className="font-display text-3xl font-black">{v}</div></div>
        ))}
      </div>
      {!data.games.length && <p className="panel text-center text-slate-500">No games logged for this session yet.</p>}
      {data.games.map((g, i) => (
        <div key={g.title} data-testid={`session-game-${i}`} className={`panel ${["panel-red", "panel-blue", "panel-orange"][i % 3]}`}>
          <div className="flex flex-wrap items-baseline gap-2">
            <h4 className="flex-1 font-display text-2xl font-bold uppercase">{g.title}</h4>
            <span className="text-xs text-slate-400">{g.genre} · {plural(g.plays, "result")} · {plural(g.players, "player")} · {g.minutes} min</span>
          </div>
          <div className="mt-3 divide-y divide-white/5">
            {g.entries.map((e) => (
              <div key={e.id} className="flex items-center gap-3 py-2 text-sm">
                <span className={`w-10 font-display text-lg font-black ${e.placement === 1 ? "text-mb-orange" : "text-slate-400"}`}>{ord(e.placement)}</span>
                <span className="flex-1 font-semibold">{e.name} <span className="text-xs font-normal text-slate-500">({e.player_id})</span></span>
                <span className="hidden text-xs text-slate-500 sm:inline">{e.player_count}p · {e.playtime_min}m</span>
                <span className="font-mono-x">{e.score}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

const AddPrize = ({ users, onAdded }) => {
  const [f, setF] = useState({ user_id: "", prize: "", event: "", won_at: adelaideToday() });
  const add = async (e) => {
    e.preventDefault();
    if (!f.user_id) return toast.error("Pick the winner");
    try {
      await http.post("/admin/prizes", f);
      toast.success("Prize recorded and held for 3 months");
      setF({ ...f, prize: "", user_id: "" });
      onAdded();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  return (
    <form onSubmit={add} className="panel panel-orange grid gap-3 sm:grid-cols-2">
      <Select value={f.user_id} onValueChange={(v) => setF({ ...f, user_id: v })}>
        <SelectTrigger data-testid="prize-winner-select" className="h-11 bg-[#0B0F19]"><SelectValue placeholder="Winner" /></SelectTrigger>
        <SelectContent>{users.map((u) => <SelectItem key={u.user_id} value={u.user_id}>{u.name}</SelectItem>)}</SelectContent>
      </Select>
      <Input data-testid="prize-name-input" required value={f.prize} onChange={(e) => setF({ ...f, prize: e.target.value })} placeholder="Prize" className="h-11 bg-[#0B0F19]" />
      <Input data-testid="prize-event-input" value={f.event} onChange={(e) => setF({ ...f, event: e.target.value })} placeholder="Raffle / event (optional)" className="h-11 bg-[#0B0F19]" />
      <Input data-testid="prize-date-input" type="date" required value={f.won_at} onChange={(e) => setF({ ...f, won_at: e.target.value })} className="h-11 bg-[#0B0F19]" />
      <button data-testid="prize-add-button" className="btn-orange sm:col-span-2"><Gift className="h-4 w-4" /> Record prize win</button>
    </form>
  );
};

export const PrizeTracker = () => {
  const [list, setList] = useState([]);
  const [users, setUsers] = useState([]);
  const today = adelaideToday();
  const load = useCallback(() => http.get("/admin/prizes").then((r) => setList(r.data)).catch((e) => toast.error(errMsg(e))), []);
  useEffect(() => {
    load();
    http.get("/admin/users").then((r) => setUsers(r.data)).catch((e) => toast.error(errMsg(e)));
  }, [load]);
  const collect = async (id) => {
    await http.post(`/admin/prizes/${id}/collected`).catch((e) => toast.error(errMsg(e)));
    load();
  };
  return (
    <div className="space-y-4">
      <AddPrize users={users} onAdded={load} />
      <div className="panel !p-0">
        {list.map((p) => {
          const expired = !p.collected && p.collect_by < today;
          return (
            <div key={p.id} data-testid={`prize-row-${p.id}`} className="flex flex-wrap items-center gap-3 border-b border-white/5 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{p.prize} <span className="text-slate-400">→ {p.user_name}</span></div>
                <div className="text-xs text-slate-500">{p.event ? `${p.event} · ` : ""}won {p.won_at}</div>
              </div>
              <span className={`text-xs ${p.collected ? "text-emerald-400" : expired ? "text-mb-red" : "text-mb-orange"}`}>
                {p.collected ? `Collected · ${p.handed_over_by}` : expired ? `Expired ${p.collect_by}` : `Collect by ${p.collect_by}`}
              </span>
              {!p.collected && <button data-testid={`prize-collected-button-${p.id}`} onClick={() => collect(p.id)} className="btn-ghost !min-h-[38px]"><Check className="h-4 w-4" /> Collected</button>}
            </div>
          );
        })}
        {!list.length && <p className="py-10 text-center text-slate-500">No prizes recorded yet.</p>}
      </div>
    </div>
  );
};

export const GrantMembershipButton = ({ u, onDone }) => {
  const [busy, setBusy] = useState(false);
  const grant = async () => {
    if (busy || !window.confirm(`Record $120 cash and give ${u.name} a year's membership${u.is_subscriber ? " (adds a year to their current one)" : ""}?`)) return;
    setBusy(true);
    try {
      await http.post(`/admin/users/${u.user_id}/grant-membership`);
      toast.success(`${u.name} now has a year's membership`);
      await onDone();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button data-testid={`admin-grant-membership-button-${u.user_id}`} disabled={busy} onClick={grant} className="btn-blue !min-h-[38px] !px-4 text-sm">
      <Users className="h-4 w-4" /> Paid cash · {u.is_subscriber ? "+1 year" : "give year"}
    </button>
  );
};
