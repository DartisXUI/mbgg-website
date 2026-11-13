import { useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { FAVOURITE_GAMES, shuffle } from "@/data/games";
import { GameTile } from "@/components/GameTile";
import { GameDetailsDialog } from "@/components/GameDetailsDialog";

export const GameTicker = () => {
  const { pathname } = useLocation();
  // reshuffled on every page change and every load
  const ticker = useMemo(() => shuffle(FAVOURITE_GAMES), [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  const [sel, setSel] = useState(null);
  return (
    <div data-testid="game-rail-ticker" className="overflow-hidden border-b border-white/10 bg-[#121826]/70 py-3">
      <div className="marquee-track flex gap-3 px-3">
        {[...ticker, ...ticker].map((g, i) => <GameTile key={`${g.name}-${i}`} game={g} index={i} compact onOpen={(game, art) => setSel({ game, art })} />)}
      </div>
      <GameDetailsDialog game={sel?.game} art={sel?.art} onClose={() => setSel(null)} />
    </div>
  );
};
