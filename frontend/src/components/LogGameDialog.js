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

const F = ({ id, label, children }) => (
  <div className="space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    {children}
  </div>
);

export const LogGameDialog = ({ genres, titles, playerTag, onSaved }) => {
  const blank = { title: "", genre: "", player_count: 4, player_id: playerTag || "", playtime_min: 30, score: 0, placement: 1, played_at: sessionDate() };
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
  const set = (k, num) => (e) => setF({ ...f, [k]: num ? Number(e.target.value) : e.target.value });
  const suggestions = [...new Set([...titles, ...FAVOURITE_GAMES.map((g) => g.name)])];

  const save = async (e) => {
    e.preventDefault();
    if (!f.genre) return toast.error("Pick the genre");
    setBusy(true);
    try {
      await http.post("/logs", { ...f, at_meetup: canMeetup && f.at_meetup });
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
          <F id="log-players" label="Player count"><Input id="log-players" data-testid="log-player-count-input" type="number" min="1" max="30" required value={f.player_count} onChange={set("player_count", true)} className={inp} /></F>
          <F id="log-pid" label="Your player ID"><Input id="log-pid" data-testid="log-player-id-input" required maxLength={40} value={f.player_id} onChange={set("player_id")} placeholder="e.g. Red / P2" className={inp} /></F>
          <F id="log-time" label="Est. playtime (min)"><Input id="log-time" data-testid="log-playtime-input" type="number" min="1" max="1440" required value={f.playtime_min} onChange={set("playtime_min", true)} className={inp} /></F>
          <F id="log-score" label="Your total score"><Input id="log-score" data-testid="log-score-input" type="number" required value={f.score} onChange={set("score", true)} className={inp} /></F>
          <F id="log-place" label="Endgame placement"><Input id="log-place" data-testid="log-placement-input" type="number" min="1" max={f.player_count} required value={f.placement} onChange={set("placement", true)} className={inp} /></F>
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
