import { Dices, Gamepad2, Layers, Sparkles } from "lucide-react";
import { ACCENTS, KIND_LABEL } from "@/data/games";

const ICONS = { card: Layers, board: Dices, digital: Gamepad2, original: Sparkles };

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export const GameTile = ({ game, index, compact = false, onOpen }) => {
  const accent = ACCENTS[index % ACCENTS.length];
  const Icon = ICONS[game.kind];
  const art = game.imgs ? game.imgs[index % game.imgs.length] : game.img;
  const open = () => onOpen?.(game, art);
  if (art) {
    return (
      <button
        type="button"
        onClick={open}
        data-testid={`rail-tile-${slug(game.name)}`}
        title={`${game.name} · tap for details`}
        aria-label={`${game.name} details`}
        className={`rail-tile flex cursor-pointer items-center justify-center ${compact ? "h-32 w-44 shrink-0" : "h-32"}`}
      >
        <img src={art} alt={game.name} loading="lazy" className="max-h-full max-w-full object-contain drop-shadow-[0_6px_14px_rgba(0,0,0,0.6)]" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={open}
      data-testid={`rail-tile-${slug(game.name)}`}
      className={`rail-tile relative overflow-hidden rounded-lg border bg-[#121826]/90 text-left backdrop-blur ${compact ? "w-44 shrink-0 p-3" : "p-3"}`}
      style={{ borderColor: `${accent}55`, boxShadow: `0 0 18px ${accent}22` }}
    >
      <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: accent }} />
      {game.logo ? (
        <img src={game.logo} alt={`${game.name} logo`} className="mb-2 h-12 w-full object-contain" />
      ) : (
        <Icon className="mb-2 h-5 w-5" style={{ color: accent }} />
      )}
      <div className="font-display text-lg font-extrabold uppercase leading-[0.95] tracking-tight text-white">{game.name}</div>
      {game.sub && <div className="mt-1 text-[11px] leading-snug text-slate-400">{game.sub}</div>}
      <div className="mt-2 font-mono-x text-[9px] uppercase tracking-[0.2em]" style={{ color: accent }}>
        {KIND_LABEL[game.kind]}
      </div>
    </button>
  );
};
