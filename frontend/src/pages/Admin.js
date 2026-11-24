import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Check, Crown, Lock, LockOpen, X } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { http, errMsg, plural, adelaideToday } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { CashEntryButton, GrantMembershipButton, PrizeTracker, SessionSummary } from "@/components/AdminExtras";
import { markCheckinsSeen } from "@/components/HeaderWidgets";
import { GuildsTab } from "@/components/GuildAdmin";

const when = (s) => new Date(s).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });

const TokenAlerts = () => {
  const [list, setList] = useState([]);
  const load = useCallback(() => http.get("/admin/token-alerts").then((r) => setList(r.data)), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);
  const ack = async (id) => {
    await http.post(`/admin/token-alerts/${id}/ack`).catch((e) => toast.error(errMsg(e)));
    window.dispatchEvent(new Event("mbgg-alerts"));
    load();
  };
  return (
    <div className="space-y-3">
      {list.map((a) => (
        <div key={a.id} data-testid={`game-choice-token-alert-${a.id}`} className={`panel flex flex-wrap items-center gap-4 ${a.acknowledged ? "opacity-60" : "panel-blue"}`}>
          <Crown className="h-6 w-6 text-mb-blue" />
          <div className="min-w-0 flex-1">
            <div className="font-display text-2xl font-bold uppercase">{a.game}</div>
            <div className="text-sm text-slate-400">{a.user_name} · {a.month} · {when(a.created_at)}</div>
            {a.note && <div className="mt-1 text-sm text-slate-300">"{a.note}"</div>}
          </div>
          {a.acknowledged ? (
            <span className="text-sm text-emerald-400">Seen by {a.acknowledged_by}</span>
          ) : (
            <button data-testid={`token-ack-button-${a.id}`} onClick={() => ack(a.id)} className="btn-blue"><Check className="h-4 w-4" /> Got it</button>
          )}
        </div>
      ))}
      {!list.length && <p className="py-10 text-center text-slate-500">No game choice tokens used yet.</p>}
    </div>
  );
};

const VIA = { subscription: "Member · free drink & snack", staff: "Host/admin · free", paid: "Paid $5", cash: "Paid $5 to host · free entry", paid_earlier: "Free · paid earlier today", guild: "Guild member · free", casual: "Casual · free" };

// Lock a date to the paid session check-in only (no free casual / guild check-ins).
const PaidDayToggle = ({ date, data, onDone }) => {
  const [busy, setBusy] = useState(false);
  const [upcoming, setUpcoming] = useState([]);
  const loadUpcoming = useCallback(() => http.get("/admin/paid-days").then((r) => setUpcoming(r.data)).catch(() => {}), []);
  useEffect(() => {
    loadUpcoming();
  }, [loadUpcoming, data?.paid_meetup_day]);
  if (!date || !data) return null;
  const on = data.paid_meetup_day;
  const past = date < adelaideToday();
  const toggle = async () => {
    const ask = on ? `Turn free casual & guild check-ins back on for ${date}?` : `Make ${date} an official paid meetup? Members will only see the session check-in: $5, or free for subscribers, hosts and anyone marked as paid cash. Free casual and guild check-ins are switched off for the day.`;
    if (busy || !window.confirm(ask)) return;
    setBusy(true);
    try {
      if (on) await http.delete(`/admin/paid-days/${date}`);
      else await http.put(`/admin/paid-days/${date}`);
      toast.success(on ? "Free check-ins are back on" : `${date} is now a paid meetup day`);
      await onDone();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-testid="paid-day-panel" className={`panel flex flex-wrap items-center gap-3 ${on ? "panel-red" : ""}`}>
      <div className="min-w-0 flex-1">
        <div className="font-display text-xl font-bold uppercase">{on ? "Paid meetup day · check-ins locked" : "Free check-ins allowed"}</div>
        <p className="text-sm text-slate-400">{on ? `Only the $5 session check-in is shown on ${date} (free for subscribers, hosts & cash payers). Set by ${data.paid_meetup_set_by || "a host"}.` : `On ${date} members can also use free casual and guild check-ins. Lock the day when a paid meetup is on.`}</p>
        {upcoming.length > 0 && <p data-testid="paid-day-upcoming" className="mt-1 text-xs text-mb-orange">Locked days: {upcoming.map((p) => p.date).join(", ")}</p>}
      </div>
      {(!past || on) && (
        <button data-testid="paid-day-toggle-button" disabled={busy} onClick={toggle} className={on ? "btn-ghost" : "btn-red"}>
          {on ? <><LockOpen className="h-4 w-4" /> Unlock free check-ins</> : <><Lock className="h-4 w-4" /> Paid meetup: lock check-ins</>}
        </button>
      )}
    </div>
  );
};

const CheckinRoster = () => {
  const [date, setDate] = useState("");
  const [data, setData] = useState(null);
  const load = useCallback(() => http.get("/admin/checkins", { params: date ? { date } : {} }).then((r) => {
    setData(r.data);
    if (!date) setDate(r.data.date);
  }), [date]);
  useEffect(() => {
    load();
    markCheckinsSeen();
  }, [load]);
  const remove = async (r) => {
    const paid = ["paid", "cash"].includes(r.via) ? " Their $5 stays on record, so they can check in again free." : "";
    if (!window.confirm(`Remove ${r.name}'s check-in${r.family.length ? ` (and their ${r.family.length} guest${r.family.length === 1 ? "" : "s"})` : ""}?${paid} Meetup games they logged that day will count as played anywhere.`)) return;
    try {
      await http.delete(`/admin/checkins/${r.id}`);
      toast.success(`${r.name}'s check-in was removed`);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <div className="space-y-4">
      <Input data-testid="admin-checkin-date-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11 w-48 bg-[#121826]" />
      <PaidDayToggle date={date} data={data} onDone={load} />
      <div className="panel !p-0">
        <div data-testid="admin-checkin-count" className="border-b border-white/10 px-5 py-3 font-display text-xl font-bold uppercase">{plural(data?.headcount || 0, "person").replace("persons", "people")} at main sessions · {plural(data?.rows.length || 0, "check-in")}</div>
        {data && Object.entries(data.session_labels).map(([key, label]) => (
          <div key={key} data-testid={`admin-checkin-session-${key}`}>
            <div className="flex justify-between bg-white/[0.03] px-5 py-2 text-xs uppercase tracking-widest text-slate-400">
              <span>{label}</span><span data-testid={`admin-checkin-session-count-${key}`}>{plural(data.session_headcount[key], "person").replace("persons", "people")}</span>
            </div>
            {data.rows.filter((r) => r.session === key).map((r) => (
              <div key={r.id} data-testid={`admin-checkin-row-${r.user_id}-${key}`} className="flex items-center gap-3 border-b border-white/5 px-5 py-3">
                <div className="flex-1">
                  <div className="font-semibold">{r.name}</div>
                  {r.family.length > 0 && <div data-testid={`admin-checkin-family-${r.user_id}-${key}`} className="text-xs text-slate-400">{r.family.some((f) => (f.kind || "child") === "child") && <div>+ {r.family.filter((f) => (f.kind || "child") === "child").map((f) => f.name).join(", ")} (under 15, free)</div>}{r.family.some((f) => f.kind === "support") && <div>+ Support: {r.family.filter((f) => f.kind === "support").map((f) => f.name).join(", ")} (free)</div>}</div>}
                </div>
                <span className={`text-sm ${["paid", "cash"].includes(r.via) ? "text-mb-blue" : "text-mb-orange"}`}>{VIA[r.via]}</span>
                <button data-testid={`admin-checkin-remove-${r.id}`} onClick={() => remove(r)} aria-label={`Remove ${r.name}'s check-in`} title="Remove check-in" className="rounded p-1 text-slate-500 hover:bg-white/5 hover:text-mb-red"><X className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

const UsersTab = () => {
  const { user } = useAuth();
  const [list, setList] = useState([]);
  const load = useCallback(() => http.get("/admin/users").then((r) => setList(r.data)), []);
  useEffect(() => {
    load();
  }, [load]);
  const setRole = async (id, role) => {
    try {
      await http.post(`/admin/users/${id}/role`, { role });
      toast.success(role === "host" ? "Promoted to host" : "Set back to member");
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <div className="panel !p-0">
      {list.map((u) => (
        <div key={u.user_id} data-testid={`admin-user-row-${u.user_id}`} className="flex flex-wrap items-center gap-3 border-b border-white/5 px-5 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 font-semibold">{u.name} {u.is_subscriber && <BadgeCheck className="h-4 w-4 text-mb-orange" />}</div>
            <div className="truncate text-xs text-slate-500">{u.email}{u.is_subscriber ? ` · member until ${u.subscription_expires_at.slice(0, 10)}` : ""}</div>
          </div>
          <span className="eyebrow">{u.role}</span>
          <CashEntryButton u={u} onDone={load} />
          {user.role === "admin" && <GrantMembershipButton u={u} onDone={load} />}
          {user.role === "admin" && u.role !== "admin" && (
            <button data-testid={`admin-promote-host-button-${u.user_id}`} onClick={() => setRole(u.user_id, u.role === "host" ? "member" : "host")} className={u.role === "host" ? "btn-ghost" : "btn-orange"}>
              {u.role === "host" ? "Remove host" : "Make host"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
};

export default function Admin() {
  return (
    <div data-testid="admin-page" className="space-y-6">
      <div>
        <div className="eyebrow text-mb-orange">Hosts & admin</div>
        <h1 className="font-display text-4xl font-black uppercase sm:text-5xl">Host desk</h1>
      </div>
      <Tabs defaultValue="tokens">
        <TabsList className="h-auto flex-wrap bg-[#121826]">
          <TabsTrigger value="tokens" data-testid="admin-tab-tokens">Game choices</TabsTrigger>
          <TabsTrigger value="checkins" data-testid="admin-tab-checkins">Check-ins</TabsTrigger>
          <TabsTrigger value="sessions" data-testid="admin-tab-sessions">Session summary</TabsTrigger>
          <TabsTrigger value="prizes" data-testid="admin-tab-prizes">Prizes</TabsTrigger>
          <TabsTrigger value="guilds" data-testid="admin-tab-guilds">Guilds</TabsTrigger>
          <TabsTrigger value="users" data-testid="admin-tab-users">Members</TabsTrigger>
        </TabsList>
        <TabsContent value="tokens" className="pt-4"><TokenAlerts /></TabsContent>
        <TabsContent value="checkins" className="pt-4"><CheckinRoster /></TabsContent>
        <TabsContent value="sessions" className="pt-4"><SessionSummary /></TabsContent>
        <TabsContent value="prizes" className="pt-4"><PrizeTracker /></TabsContent>
        <TabsContent value="guilds" className="pt-4"><GuildsTab /></TabsContent>
        <TabsContent value="users" className="pt-4"><UsersTab /></TabsContent>
      </Tabs>
    </div>
  );
}
