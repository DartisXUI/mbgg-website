import { useCallback, useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { http, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Loader } from "@/components/ProtectedRoute";
import { LogGameDialog } from "@/components/LogGameDialog";
import { HonorNote, SubscriberGate } from "@/components/SubscriberGate";

const ord = (n) => `${n}${["th", "st", "nd", "rd"][(n % 100 >> 3) ^ 1 && n % 10] || "th"}`;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

const Summary = ({ rows }) => {
  const wins = rows.filter((r) => r.placement === 1).length;
  const mins = rows.reduce((a, r) => a + r.playtime_min, 0);
  const stats = [["Plays", rows.length], ["Wins", wins], ["Total score", rows.reduce((a, r) => a + r.score, 0)], ["Hours", (mins / 60).toFixed(1)]];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map(([k, v], i) => (
        <div key={k} className="panel !p-4">
          <div className="eyebrow">{k}</div>
          <div data-testid={`gamelog-stat-${slug(k)}`} className={`font-display text-3xl font-black ${["text-mb-red", "text-mb-blue", "text-mb-orange", "text-white"][i]}`}>{v}</div>
        </div>
      ))}
    </div>
  );
};

const LogTable = ({ rows, onDelete }) => (
  <div className="panel !p-0 overflow-x-auto">
    <Table>
      <TableHeader>
        <TableRow className="border-white/10">
          {["Date", "Game", "Genre", "Players", "Player ID", "Mins", "Score", "Place", ""].map((h) => <TableHead key={h}>{h}</TableHead>)}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id} data-testid={`gamelog-row-${r.id}`} className="border-white/5">
            <TableCell className="font-mono-x text-xs">{r.played_at}</TableCell>
            <TableCell className="font-semibold">{r.title}</TableCell>
            <TableCell className="text-slate-400">{r.genre}</TableCell>
            <TableCell>{r.player_count}</TableCell>
            <TableCell>{r.player_id}</TableCell>
            <TableCell>{r.playtime_min}</TableCell>
            <TableCell className="font-mono-x">{r.score}</TableCell>
            <TableCell className={r.placement === 1 ? "font-bold text-mb-orange" : ""}>{ord(r.placement)}</TableCell>
            <TableCell>
              <button data-testid={`gamelog-delete-${r.id}`} onClick={() => onDelete(r.id)} className="text-slate-500 hover:text-mb-red" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
            </TableCell>
          </TableRow>
        ))}
        {!rows.length && <TableRow><TableCell colSpan={9} className="py-10 text-center text-slate-500">No games logged yet.</TableCell></TableRow>}
      </TableBody>
    </Table>
  </div>
);

export default function GameLog() {
  const { user } = useAuth();
  const [logs, setLogs] = useState(null);
  const [genres, setGenres] = useState([]);
  const [tab, setTab] = useState("all");
  const allowed = user.is_subscriber || ["host", "admin"].includes(user.role);
  const load = useCallback(() => http.get("/logs/me").then((r) => setLogs(r.data)), []);
  useEffect(() => {
    load();
    http.get("/meta/genres").then((r) => setGenres(r.data));
  }, [load]);
  const titles = useMemo(() => [...new Set((logs || []).map((l) => l.title))], [logs]);
  if (!allowed) return <SubscriberGate what="Personal game tracking" />;
  if (!logs) return <Loader />;
  const rows = tab === "all" ? logs : logs.filter((l) => l.title === tab);
  const del = async (id) => {
    try {
      await http.delete(`/logs/${id}`);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <div data-testid="gamelog-page" className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex-1">
          <div className="eyebrow">Your plays</div>
          <h1 className="font-display text-4xl font-black uppercase sm:text-5xl">Game log</h1>
        </div>
        <LogGameDialog genres={genres} titles={titles} playerTag={user.player_tag} onSaved={load} />
      </div>
      <HonorNote />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap justify-start gap-1 bg-[#121826] p-1">
          <TabsTrigger value="all" data-testid="gamelog-tab-all">All games</TabsTrigger>
          {titles.map((t) => <TabsTrigger key={t} value={t} data-testid={`gamelog-tab-${slug(t)}`}>{t}</TabsTrigger>)}
        </TabsList>
      </Tabs>
      <Summary rows={rows} />
      <LogTable rows={rows} onDelete={del} />
    </div>
  );
}
