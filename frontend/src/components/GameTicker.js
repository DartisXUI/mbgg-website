import { useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { FAVOURITE_GAMES, STRIP_COUNT, STRIP_GAMES, shuffle } from "@/data/games";
import { GameTile } from "@/components/GameTile";
import { GameDetailsDialog } from "@/components/GameDetailsDialog";

const pool = () => {
  if (!STRIP_GAMES.length) return FAVOURITE_GAMES;
  const wanted = STRIP_GAMES.map((n) => n.toLowerCase());
  return wanted.map((n) => FAVOURITE_GAMES.find((g) => g.name.toLowerCase() === n)).filter(Boolean);
};

// A fixed row of game pictures under the header. A fresh random set is picked on every page change,
// unless STRIP_GAMES lists exactly STRIP_COUNT games, in which case those stay in place.
export const GameTicker = () => {
  const { pathname } = useLocation();
  const picks = useMemo(() => {
    const games = pool();
    const fixed = STRIP_GAMES.length > 0 && games.length <= STRIP_COUNT;
    const chosen = fixed ? games : shuffle(games).slice(0, STRIP_COUNT);
    return chosen.map((g) => ({ game: g, variant: fixed || !g.imgs ? 0 : Math.floor(Math.random() * g.imgs.length) }));
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  const [sel, setSel] = useState(null);
  return (
    <div data-testid="game-rail-ticker" className="border-b border-white/10 bg-[#121826]/70 py-3">
      <div className="mx-auto grid max-w-6xl gap-2 px-3 sm:gap-4" style={{ gridTemplateColumns: `repeat(${picks.length}, minmax(0, 1fr))` }}>
        {picks.map(({ game, variant }, i) => (
          <GameTile key={game.name} game={game} index={i} variant={variant} compact onOpen={(g, art) => setSel({ game: g, art })} />
        ))}
      </div>
      <GameDetailsDialog game={sel?.game} art={sel?.art} onClose={() => setSel(null)} />
    </div>
  );
};
