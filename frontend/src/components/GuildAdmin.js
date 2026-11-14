import { useCallback, useEffect, useState } from "react";
import { Shield, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { http, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const GuildRow = ({ g, users, isAdmin, reload }) => {
  const act = async (fn) => {
    try {
      await fn();
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const ids = new Set(g.members.map((m) => m.user_id));
  return (
    <div data-testid={`guild-row-${g.id}`} className="panel panel-blue space-y-3">
      <div className="flex items-center gap-3">
        <span className="rounded bg-[var(--mb-blue)]/15 px-2 py-0.5 font-mono-x text-xs text-mb-blue">{g.tag}</span>
        <h4 className="flex-1 font-display text-2xl font-bold uppercase">{g.name}</h4>
        {isAdmin && <button data-testid={`guild-delete-${g.id}`} onClick={() => window.confirm(`Delete ${g.name}?`) && act(() => http.delete(`/admin/guilds/${g.id}`))} className="text-slate-500 hover:text-mb-red" aria-label="Delete guild"><Trash2 className="h-4 w-4" /></button>}
      </div>
      <div className="flex flex-wrap gap-2">
        {g.members.map((m) => (
          <span key={m.user_id} data-testid={`guild-member-${g.id}-${m.user_id}`} className="flex items-center gap-1 rounded-full border border-white/10 px-3 py-1 text-sm">
            {m.name}
            <button data-testid={`guild-remove-${g.id}-${m.user_id}`} onClick={() => act(() => http.delete(`/admin/guilds/${g.id}/members/${m.user_id}`))} aria-label="Remove" className="text-slate-500 hover:text-mb-red"><X className="h-3 w-3" /></button>
          </span>
        ))}
        {!g.members.length && <span className="text-sm text-slate-500">No members yet.</span>}
      </div>
      <Select value="" onValueChange={(v) => act(() => http.post(`/admin/guilds/${g.id}/members`, { user_id: v }))}>
        <SelectTrigger data-testid={`guild-add-member-${g.id}`} className="h-10 bg-[#0B0F19] sm:w-64"><SelectValue placeholder="Add a member (from Discord role)" /></SelectTrigger>
        <SelectContent>{users.filter((u) => !ids.has(u.user_id)).map((u) => <SelectItem key={u.user_id} value={u.user_id}>{u.name}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
};

export const GuildsTab = () => {
  const { user } = useAuth();
  const [guilds, setGuilds] = useState([]);
  const [users, setUsers] = useState([]);
  const [f, setF] = useState({ name: "", tag: "" });
  const load = useCallback(() => http.get("/guilds").then((r) => setGuilds(r.data)), []);
  useEffect(() => {
    load();
    http.get("/admin/users").then((r) => setUsers(r.data)).catch(() => {});
  }, [load]);
  const create = async (e) => {
    e.preventDefault();
    try {
      await http.post("/admin/guilds", f);
      setF({ name: "", tag: "" });
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">Guild membership is earned through the Discord levelling role. Mirror each guild here so members can check in to guild meet-ups and appear on the guild leaderboard.</p>
      <form onSubmit={create} className="panel panel-orange flex flex-col gap-2 sm:flex-row">
        <Shield className="hidden h-10 w-6 text-mb-orange sm:block" />
        <Input data-testid="guild-name-input" required maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Guild name" className="h-11 bg-[#0B0F19]" />
        <Input data-testid="guild-tag-input" required maxLength={12} value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })} placeholder="Guild ID (e.g. DRGN)" className="h-11 bg-[#0B0F19] sm:w-48" />
        <button data-testid="guild-create-button" className="btn-orange shrink-0">Add guild</button>
      </form>
      {guilds.map((g) => <GuildRow key={g.id} g={g} users={users} isAdmin={user.role === "admin"} reload={load} />)}
      {!guilds.length && <p className="text-center text-slate-500">No guilds yet.</p>}
    </div>
  );
};
