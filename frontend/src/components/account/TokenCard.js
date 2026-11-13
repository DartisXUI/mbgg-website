import { useState } from "react";
import { Crown, Lock } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { http, errMsg } from "@/lib/api";
import { FAVOURITE_GAMES } from "@/data/games";

export const TokenCard = ({ data, reload }) => {
  const [game, setGame] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const sub = data.user.is_subscriber;
  const t = data.token;
  const use = async () => {
    if (!game.trim()) return toast.error("Tell the hosts which game you want");
    setBusy(true);
    try {
      await http.post("/token/use", { game, note });
      toast.success("Hosts have been alerted to your game choice!");
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-testid="token-card" className="panel panel-blue">
      <div className="eyebrow text-mb-blue">Monthly token · {data.month}</div>
      <h3 className="mt-2 flex items-center gap-2 font-display text-2xl font-extrabold uppercase"><Crown className="h-6 w-6 text-mb-blue" /> Guaranteed game choice</h3>
      {!sub ? (
        <p data-testid="token-locked" className="mt-3 flex items-center gap-2 text-sm text-slate-400"><Lock className="h-4 w-4" /> Annual subscribers get 1 guaranteed game pick each month.</p>
      ) : t ? (
        <div data-testid="token-used" className="mt-4 rounded-lg border border-[var(--mb-blue)]/30 bg-[var(--mb-blue)]/10 p-4">
          <div className="text-sm text-slate-300">This month's pick</div>
          <div className="font-display text-2xl font-bold uppercase text-white">{t.game}</div>
          <div className="text-xs text-slate-400">{t.acknowledged ? `Seen by ${t.acknowledged_by}` : "Waiting for a host to confirm"}</div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <Input data-testid="token-game-input" list="fav-games" value={game} onChange={(e) => setGame(e.target.value)} placeholder="Which game do you want to play?" className="h-11 bg-[#0B0F19]" />
          <datalist id="fav-games">{FAVOURITE_GAMES.map((g) => <option key={g.name} value={g.name} />)}</datalist>
          <Input data-testid="token-note-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for hosts (optional)" className="h-11 bg-[#0B0F19]" />
          <button data-testid="token-use-button" disabled={busy} onClick={use} className="btn-blue w-full">{busy ? "Sending…" : "Use my monthly game choice"}</button>
        </div>
      )}
    </div>
  );
};
