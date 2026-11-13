import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { FAVOURITE_GAMES, shuffle } from "@/data/games";
import { GameTile } from "@/components/GameTile";

const PER_SIDE = 5;

const usePicks = () => {
  const { pathname } = useLocation();
  // reshuffled on every page change and every load
  return useMemo(() => shuffle(FAVOURITE_GAMES), [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
};

export const GameTicker = () => {
  const ticker = usePicks().slice(0, 10);
  return (
    <div data-testid="game-rail-ticker" className="mt-0 overflow-hidden border-b border-white/10 bg-[#121826]/70 py-3 xl:hidden">
      <div className="marquee-track flex gap-3 px-3">
        {[...ticker, ...ticker].map((g, i) => <GameTile key={`${g.name}-${i}`} game={g} index={i} compact />)}
      </div>
    </div>
  );
};

export const GameRails = () => {
  const picks = usePicks();
  const left = picks.slice(0, PER_SIDE);
  const right = picks.slice(PER_SIDE, PER_SIDE * 2);

  return (
    <>
      <aside data-testid="game-rail-left" className="fixed left-0 top-0 z-20 hidden h-screen w-40 flex-col justify-center gap-3 px-3 2xl:w-48 xl:flex">
        <div className="eyebrow mb-1 text-center text-mb-red">Group faves</div>
        {left.map((g, i) => <GameTile key={g.name} game={g} index={i} />)}
      </aside>
      <aside data-testid="game-rail-right" className="fixed right-0 top-0 z-20 hidden h-screen w-40 flex-col justify-center gap-3 px-3 2xl:w-48 xl:flex">
        <div className="eyebrow mb-1 text-center text-mb-blue">Group faves</div>
        {right.map((g, i) => <GameTile key={g.name} game={g} index={i + 1} />)}
      </aside>
    </>
  );
};
