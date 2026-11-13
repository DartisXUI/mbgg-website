import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Check, Crown } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { http, errMsg, plural } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { GrantMembershipButton, PrizeTracker, SessionSummary } from "@/components/AdminExtras";
import { markCheckinsSeen } from "@/components/HeaderWidgets";

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

const VIA = { subscription: "Member · free drink & snack", staff: "Host/admin · free", paid: "Paid $5", paid_earlier: "Free · paid earlier today" };

const CheckinRoster = () => {
  const [date, setDate] = useState("");
  const [data, setData] = useState(null);
  useEffect(() => {
    http.get("/admin/checkins", { params: date ? { date } : {} }).then((r) => {
      setData(r.data);
      if (!date) setDate(r.data.date);
    });
    markCheckinsSeen();
  }, [date]);
  return (
    <div className="space-y-4">
      <Input data-testid="admin-checkin-date-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11 w-48 bg-[#121826]" />
      <div className="panel !p-0">
        <div data-testid="admin-checkin-count" className="border-b border-white/10 px-5 py-3 font-display text-xl font-bold uppercase">{plural(data?.headcount || 0, "person").replace("persons", "people")} · {plural(data?.rows.length || 0, "check-in")}</div>
        {data && Object.entries(data.session_labels).map(([key, label]) => (
          <div key={key} data-testid={`admin-checkin-session-${key}`}>
            <div className="flex justify-between bg-white/[0.03] px-5 py-2 text-xs uppercase tracking-widest text-slate-400">
              <span>{label}</span><span data-testid={`admin-checkin-session-count-${key}`}>{plural(data.session_headcount[key], "person").replace("persons", "people")}</span>
            </div>
            {data.rows.filter((r) => r.session === key).map((r) => (
              <div key={r.id} data-testid={`admin-checkin-row-${r.user_id}-${key}`} className="flex items-center gap-3 border-b border-white/5 px-5 py-3">
                <div className="flex-1">
                  <div className="font-semibold">{r.name}</div>
                  {r.family.length > 0 && <div data-testid={`admin-checkin-family-${r.user_id}-${key}`} className="text-xs text-slate-400">+ {r.family.map((f) => f.name).join(", ")} (under 15, free)</div>}
                </div>
                <span className={`text-sm ${r.via === "paid" ? "text-mb-blue" : "text-mb-orange"}`}>{VIA[r.via]}</span>
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
          <TabsTrigger value="users" data-testid="admin-tab-users">Members</TabsTrigger>
        </TabsList>
        <TabsContent value="tokens" className="pt-4"><TokenAlerts /></TabsContent>
        <TabsContent value="checkins" className="pt-4"><CheckinRoster /></TabsContent>
        <TabsContent value="sessions" className="pt-4"><SessionSummary /></TabsContent>
        <TabsContent value="prizes" className="pt-4"><PrizeTracker /></TabsContent>
        <TabsContent value="users" className="pt-4"><UsersTab /></TabsContent>
      </Tabs>
    </div>
  );
}
