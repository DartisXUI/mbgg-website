import { useState } from "react";
import { CalendarCheck, Shield } from "lucide-react";
import { toast } from "sonner";
import { http, errMsg } from "@/lib/api";

export const GuildCheckInCard = ({ data, reload }) => {
  const [busy, setBusy] = useState("");
  if (!data.guilds.length) return null;
  const go = async (g) => {
    setBusy(g.id);
    try {
      await http.post("/checkin/guild", { guild_id: g.id });
      toast.success(`Checked in to the ${g.name} meet-up`);
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy("");
    }
  };
  return (
    <div data-testid="guild-checkin-card" className="panel panel-blue">
      <div className="eyebrow text-mb-blue">Guild IRL meet-ups · free</div>
      <h3 className="mt-2 flex items-center gap-2 font-display text-2xl font-extrabold uppercase"><Shield className="h-6 w-6 text-mb-blue" /> My guilds</h3>
      <p className="mt-1 text-sm text-slate-400">Check in when you attend one of your guild's meet-ups, then log the games you played as "Played at an IRL meetup". Guild meet-ups count toward the 2-month raffle bonus too.</p>
      <ul className="mt-4 space-y-2">
        {data.guilds.map((g) => {
          const done = data.guild_checkins_today.includes(g.id);
          return (
            <li key={g.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-[#0B0F19]/60 px-3 py-2">
              <span className="rounded bg-[var(--mb-blue)]/15 px-2 py-0.5 font-mono-x text-xs text-mb-blue">{g.tag}</span>
              <span className="flex-1 font-semibold">{g.name}</span>
              {done ? (
                <span data-testid={`guild-checkin-done-${g.id}`} className="flex items-center gap-1 text-sm text-emerald-400"><CalendarCheck className="h-4 w-4" /> Checked in</span>
              ) : (
                <button data-testid={`guild-checkin-button-${g.id}`} disabled={busy === g.id} onClick={() => go(g)} className="btn-blue !min-h-[38px] !px-4 text-sm">Check in free</button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};
