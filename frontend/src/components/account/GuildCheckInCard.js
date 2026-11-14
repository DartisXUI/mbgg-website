import { useState } from "react";
import { CalendarCheck, Coffee, Shield } from "lucide-react";
import { toast } from "sonner";
import { http, errMsg } from "@/lib/api";
import { KidPicker, under15 } from "@/components/account/CheckInPanel";

const Row = ({ tag, name, done, busy, onGo, testid }) => (
  <li className="flex items-center gap-3 rounded-lg border border-white/10 bg-[#0B0F19]/60 px-3 py-2">
    {tag}
    <span className="flex-1 font-semibold">{name}</span>
    {done ? (
      <span data-testid={`${testid}-done`} className="flex items-center gap-1 text-sm text-emerald-400"><CalendarCheck className="h-4 w-4" /> Checked in</span>
    ) : (
      <button data-testid={`${testid}-button`} disabled={busy} onClick={onGo} className="btn-blue !min-h-[38px] !px-4 text-sm">Check in free</button>
    )}
  </li>
);

export const GuildCheckInCard = ({ data, reload }) => {
  const [busy, setBusy] = useState("");
  const [picked, setPicked] = useState([]);
  const guests = (data.user.family || []).filter(under15);
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const go = async (key, url, body, msg) => {
    setBusy(key);
    try {
      await http.post(url, { ...body, family_ids: picked });
      toast.success(msg);
      setPicked([]);
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy("");
    }
  };
  const tagCls = "rounded bg-[var(--mb-blue)]/15 px-2 py-0.5 font-mono-x text-xs text-mb-blue";
  const allDone = !!data.casual_checkin_today && data.guilds.every((g) => data.guild_checkins_today.includes(g.id));
  return (
    <div data-testid="guild-checkin-card" className="panel panel-blue">
      <div className="eyebrow text-mb-blue">Other IRL meet-ups · free</div>
      <h3 className="mt-2 flex items-center gap-2 font-display text-2xl font-extrabold uppercase"><Shield className="h-6 w-6 text-mb-blue" /> Guild & casual meet-ups</h3>
      <p className="mt-1 text-sm text-slate-400">Check in free when you attend a guild meet-up or a casual, unofficial get-together, then log the games you played as "Played at an IRL meetup". These count toward the 2-month raffle bonus too.</p>
      {guests.length > 0 && !allDone && <KidPicker kids={guests} picked={picked} toggle={toggle} prefix="meetup" />}
      <ul className="mt-4 space-y-2">
        <Row tag={<span className={tagCls}><Coffee className="h-3 w-3" /></span>} name="Casual meetup" testid="casual-checkin"
          done={!!data.casual_checkin_today} busy={busy === "casual"}
          onGo={() => go("casual", "/checkin/casual", {}, "Checked in to a casual meetup")} />
        {data.guilds.map((g) => (
          <Row key={g.id} tag={<span className={tagCls}>{g.tag}</span>} name={g.name} testid={`guild-checkin-${g.id}`}
            done={data.guild_checkins_today.includes(g.id)} busy={busy === g.id}
            onGo={() => go(g.id, "/checkin/guild", { guild_id: g.id }, `Checked in to the ${g.name} meet-up`)} />
        ))}
      </ul>
      {!data.guilds.length && <p className="mt-3 text-xs text-slate-500">Guild meet-ups appear here once a host adds you to a guild.</p>}
    </div>
  );
};
