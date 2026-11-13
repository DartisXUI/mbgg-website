import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { http, plural } from "@/lib/api";
import { KIND_LABEL } from "@/data/games";

const ord = (n) => `${n}${["th", "st", "nd", "rd"][(n % 100 >> 3) ^ 1 && n % 10] || "th"}`;
const CAT = { board: "Board", card: "Card", digital: "Digital" };

const Owners = ({ owners, close }) => (
  <div>
    <h4 className="eyebrow mb-2 text-mb-blue">Who owns it ({owners.length})</h4>
    {owners.length ? (
      <div className="flex flex-wrap gap-2">
        {owners.map((o) => (
          <Link key={o.user_id} to={`/u/${o.user_id}`} onClick={close} data-testid={`game-owner-${o.user_id}`} className="flex items-center gap-2 rounded-full border border-white/10 bg-[#0B0F19]/60 py-1 pl-1 pr-3 text-sm hover:border-[var(--mb-blue)]">
            <img src={o.picture || "/brand/round.png"} alt="" className="h-7 w-7 rounded-full object-cover" />
            <span className="font-semibold">{o.name}</span>
            <span className="text-xs text-slate-500">{o.copies.map((c) => c.platform || CAT[c.category]).join(", ")}</span>
          </Link>
        ))}
      </div>
    ) : <p className="text-sm text-slate-500">No one has added it to their collection yet.</p>}
  </div>
);

const Recent = ({ recent }) => (
  <div>
    <h4 className="eyebrow mb-2 text-mb-orange">Recent scores</h4>
    {recent.length ? (
      <ul className="divide-y divide-white/5">
        {recent.map((r) => (
          <li key={r.id} data-testid={`game-recent-${r.id}`} className="flex items-center gap-3 py-2 text-sm">
            <span className={`w-10 font-display text-lg font-black ${r.placement === 1 ? "text-mb-orange" : "text-slate-400"}`}>{ord(r.placement)}</span>
            <span className="flex-1 truncate"><b>{r.name}</b> <span className="text-xs text-slate-500">{r.title} · {r.player_count}p</span></span>
            <span className="font-mono-x">{r.score}</span>
            <span className="hidden w-24 text-right text-xs text-slate-500 sm:inline">{r.played_at}</span>
          </li>
        ))}
      </ul>
    ) : <p className="text-sm text-slate-500">No scores logged in the last 365 days.</p>}
  </div>
);

export const GameDetailsDialog = ({ game, art, onClose }) => {
  const [d, setD] = useState(null);
  useEffect(() => {
    if (!game) return;
    setD(null);
    http.get("/games/details", { params: { q: game.q || game.name } }).then((r) => setD(r.data)).catch(() => setD({ owners: [], recent: [], stats: { plays: 0, players: 0 } }));
  }, [game]);
  return (
    <Dialog open={!!game} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="game-details-dialog" className="max-h-[90vh] overflow-y-auto border-white/10 bg-[#121826] sm:max-w-xl">
        {game && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-4">
                {art && <img src={art} alt="" className="h-24 w-24 object-contain" />}
                <div className="text-left">
                  <div className="eyebrow">{KIND_LABEL[game.kind]}</div>
                  <DialogTitle data-testid="game-details-title" className="font-display text-3xl font-black uppercase">{game.name}</DialogTitle>
                  {game.sub && <div className="text-sm text-slate-400">{game.sub}</div>}
                  {d && <div data-testid="game-details-stats" className="mt-1 text-xs text-mb-blue">{plural(d.stats.plays, "play")} · {plural(d.stats.players, "player")} in the last 365 days{d.stats.top_score != null ? ` · top score ${d.stats.top_score}` : ""}</div>}
                </div>
              </div>
            </DialogHeader>
            {d ? (
              <div className="space-y-6">
                <Owners owners={d.owners} close={onClose} />
                <Recent recent={d.recent} />
              </div>
            ) : <p className="py-6 text-center text-sm text-slate-500">Loading…</p>}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
