import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { http, errMsg, adelaideToday, sessionDate } from "@/lib/api";
import { FAVOURITE_GAMES } from "@/data/games";

const today = adelaideToday;

const F = ({ id, label, hint, children }) => (
  <div className="space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    {children}
    {hint && <p className="text-xs text-slate-500">{hint}</p>}
  </div>
);

// Number boxes keep what's typed as text so they can be cleared and retyped (no forced 0).
const whole = (v) => (/^-?\d+$/.test(String(v).trim()) ? Number(v) : NaN);

export const LogGameDialog = ({ genres, titles, playerTag, onSaved }) => {
  const blank = { title: "", genre: "", player_count: 4, player_id: playerTag || "", playtime_min: 30, score: "", placement: 1, played_at: sessionDate() };
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [checkins, setCheckins] = useState([]);
  useEffect(() => {
    if (open) http.get("/me/checkin-dates").then((r) => setCheckins(r.data)).catch(() => {});
  }, [open]);
  const canMeetup = checkins.includes(f.played_at);
  useEffect(() => {
    setF((p) => ({ ...p, at_meetup: canMeetup }));
  }, [canMeetup, open]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const suggestions = [...new Set([...titles, ...FAVOURITE_GAMES.map((g) => g.name)])];

  const save = async (e) => {
    e.preventDefault();
    if (!f.genre) return toast.error("Pick the genre");
    const players = whole(f.player_count);
    const placement = whole(f.placement);
    const playtime = whole(f.playtime_min);
    const score = String(f.score).trim() === "" ? null : whole(f.score);
    if (!(players >= 1 && players <= 30)) return toast.error("Enter how many players were at the table (1–30)");
    if (!(playtime >= 1)) return toast.error("Enter the playtime in minutes");
    if (!(placement >= 1)) return toast.error("Enter your placement (1 = first)");
    if (placement > players) return toast.error(`Placement ${placement} is higher than the ${players} players. Count everyone at the table, not teams`);
    if (Number.isNaN(score)) return toast.error("Score, health or VPs must be a whole number, or leave it blank for N/A");
    setBusy(true);
    try {
      await http.post("/logs", { ...f, player_count: players, placement, playtime_min: playtime, score, at_meetup: canMeetup && f.at_meetup });
      toast.success(`${f.title} logged`);
      setF({ ...blank, title: f.title, genre: f.genre, played_at: f.played_at, at_meetup: canMeetup });
      setOpen(false);
      onSaved();
      window.dispatchEvent(new Event("mbgg-logged"));
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  const inp = "h-11 bg-[#0B0F19]";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button data-testid="log-game-open-button" className="btn-red"><Plus className="h-4 w-4" /> Log a game</button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-white/10 bg-[#121826] sm:max-w-lg">
        <DialogHeader><DialogTitle className="font-display text-2xl uppercase">Log a game</DialogTitle></DialogHeader>
        <form onSubmit={save} className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><F id="log-title" label="Game title">
            <Input id="log-title" data-testid="log-title-input" list="log-titles" required value={f.title} onChange={set("title")} className={inp} />
            <datalist id="log-titles">{suggestions.map((t) => <option key={t} value={t} />)}</datalist>
          </F></div>
          <div className="col-span-2"><F id="log-genre" label="Genre (most identifiable)">
            <Select value={f.genre} onValueChange={(v) => setF({ ...f, genre: v })}>
              <SelectTrigger data-testid="log-genre-select" className={inp}><SelectValue placeholder="Pick one" /></SelectTrigger>
              <SelectContent>{genres.map((g) => <SelectItem key={g} value={g} data-testid={`genre-option-${g}`}>{g}</SelectItem>)}</SelectContent>
            </Select>
          </F></div>
          <F id="log-players" label="Players at the table"><Input id="log-players" data-testid="log-player-count-input" type="number" inputMode="numeric" min="1" max="30" required value={f.player_count} onChange={set("player_count")} className={inp} /></F>
          <F id="log-pid" label="Your player ID"><Input id="log-pid" data-testid="log-player-id-input" required maxLength={40} value={f.player_id} onChange={set("player_id")} placeholder="e.g. Red / P2" className={inp} /></F>
          <F id="log-time" label="Est. playtime (min)"><Input id="log-time" data-testid="log-playtime-input" type="number" inputMode="numeric" min="1" max="1440" required value={f.playtime_min} onChange={set("playtime_min")} className={inp} /></F>
          <F id="log-score" label="Score, health or VPs (if any)" hint="Leave blank for N/A. 0 counts, e.g. your health hit 0.">
            <div className="flex gap-2">
              <Input id="log-score" data-testid="log-score-input" type="number" inputMode="numeric" placeholder="N/A" value={f.score} onChange={set("score")} className={inp} />
              {String(f.score).trim() !== "" && <button type="button" data-testid="log-score-na-button" onClick={() => setF({ ...f, score: "" })} className="btn-ghost shrink-0 !px-3 text-xs">N/A</button>}
            </div>
          </F>
          <F id="log-place" label="Endgame placement" hint="Ties & teams share a place: everyone on the winning side logs 1st.">
            <Input id="log-place" data-testid="log-placement-input" type="number" inputMode="numeric" min="1" required value={f.placement} onChange={set("placement")} className={inp} />
          </F>
          <F id="log-date" label="Date played"><Input id="log-date" data-testid="log-date-input" type="date" max={today()} required value={f.played_at} onChange={set("played_at")} className={inp} /></F>
          <div className="col-span-2 rounded-lg border border-white/10 bg-[#0B0F19]/60 p-3">
            <label className="flex items-center justify-between gap-3">
              <span className="font-semibold">Played at an IRL meetup</span>
              <Switch data-testid="log-at-meetup-switch" disabled={!canMeetup} checked={canMeetup && !!f.at_meetup} onCheckedChange={(v) => setF({ ...f, at_meetup: v })} />
            </label>
            <p data-testid="log-at-meetup-hint" className="mt-1 text-xs text-slate-400">
              {canMeetup ? "You checked in to a meetup this day. Meetup results count toward the 2-month raffle bonus." : "No meetup check-in on this date, so this logs as a game played anywhere (digital or at home). It counts for leaderboards but not the raffle bonus."}
            </p>
          </div>
          <button data-testid="log-game-submit-button" disabled={busy} className="btn-red col-span-2">{busy ? "Saving…" : "Save result"}</button>
        </form>
      </DialogContent>
    </Dialog>
  );
};
