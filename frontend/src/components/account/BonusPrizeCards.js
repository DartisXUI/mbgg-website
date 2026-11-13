import { Link } from "react-router-dom";
import { Gift, PackageCheck, Star } from "lucide-react";
import { Progress } from "@/components/ui/progress";

const fmt = (d) => new Date(`${d}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });

export const BonusCard = ({ data }) => {
  const { current: c, awarded, entries } = data.bonus;
  const pct = c.sessions ? Math.round((c.logged_sessions / c.sessions) * 100) : 0;
  return (
    <div data-testid="bonus-card" className="panel panel-blue">
      <div className="eyebrow text-mb-blue">Log-every-session bonus · {c.label}</div>
      <h3 className="mt-2 flex items-center gap-2 font-display text-2xl font-extrabold uppercase"><Star className="h-6 w-6 text-mb-blue" /> {entries} free raffle entries</h3>
      <p className="mt-1 text-sm text-slate-400">Check in digitally and log at least one game for every session you attend between {fmt(c.start)} and {fmt(c.end)}. Entries are added when the block ends{c.period === 5 ? ` (Nov–Dec entries go into the ${c.raffle_year} raffle)` : ""}.</p>
      <div className="mt-4 flex justify-between text-sm">
        <span data-testid="bonus-progress">{c.logged_sessions} of {c.sessions} sessions logged</span>
        <span data-testid="bonus-status" className={c.qualifies ? "text-emerald-400" : "text-slate-400"}>{c.qualifies ? "On track" : c.sessions ? "Missing logs" : "No check-ins yet"}</span>
      </div>
      <Progress value={pct} className="mt-2 h-2 bg-white/10 [&>div]:bg-[var(--mb-blue)]" />
      {c.missing_dates.length > 0 && (
        <div data-testid="bonus-missing" className="mt-3 text-xs text-mb-orange">
          Log a game for: {c.missing_dates.map(fmt).join(", ")} · <Link to="/games" className="underline">Game log</Link>
        </div>
      )}
      {awarded.length > 0 && (
        <div data-testid="bonus-awarded" className="mt-4 flex flex-wrap gap-2">
          {awarded.map((a) => <span key={a.id} className="rounded-full bg-[var(--mb-blue)]/15 px-3 py-1 text-xs text-mb-blue">{a.label}: +{a.entries} entries</span>)}
        </div>
      )}
    </div>
  );
};

export const PrizesCard = ({ data }) => {
  if (!data.prizes.length) return null;
  return (
    <div data-testid="prizes-card" className="panel panel-orange">
      <div className="eyebrow text-mb-orange">Held for you</div>
      <h3 className="mt-2 flex items-center gap-2 font-display text-2xl font-extrabold uppercase"><Gift className="h-6 w-6 text-mb-orange" /> My prizes</h3>
      <ul className="mt-4 space-y-3">
        {data.prizes.map((p) => {
          const expired = !p.collected && p.collect_by < data.today_date;
          return (
            <li key={p.id} data-testid={`my-prize-${p.id}`} className="flex items-start gap-3 rounded-lg border border-white/10 bg-[#0B0F19]/60 p-3">
              {p.collected ? <PackageCheck className="mt-0.5 h-5 w-5 text-emerald-400" /> : <Gift className="mt-0.5 h-5 w-5 text-mb-orange" />}
              <div className="flex-1">
                <div className="font-semibold">{p.prize}</div>
                <div className="text-xs text-slate-400">{p.event ? `${p.event} · ` : ""}won {fmt(p.won_at)}</div>
              </div>
              <div data-testid={`my-prize-status-${p.id}`} className={`text-right text-xs ${p.collected ? "text-emerald-400" : expired ? "text-mb-red" : "text-mb-orange"}`}>
                {p.collected ? "Collected" : expired ? `Expired ${fmt(p.collect_by)}` : <>Collect by<br /><span className="font-semibold">{fmt(p.collect_by)}</span></>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
