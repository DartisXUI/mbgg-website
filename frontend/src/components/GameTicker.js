import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { FAVOURITE_GAMES, shuffle } from "@/data/games";
import { GameTile } from "@/components/GameTile";

export const GameTicker = () => {
  const { pathname } = useLocation();
  // reshuffled on every page change and every load
  const ticker = useMemo(() => shuffle(FAVOURITE_GAMES), [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div data-testid="game-rail-ticker" className="overflow-hidden border-b border-white/10 bg-[#121826]/70 py-3">
      <div className="marquee-track flex gap-3 px-3">
        {[...ticker, ...ticker].map((g, i) => <GameTile key={`${g.name}-${i}`} game={g} index={i} compact />)}
      </div>
    </div>
  );
};
