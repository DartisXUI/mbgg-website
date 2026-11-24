import { useState } from "react";
import { BellRing, CalendarCheck, Coffee, Lock, Undo2, Users } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { http, errMsg, money, startCheckout } from "@/lib/api";

export const under15 = (f) => (f.kind || "child") !== "child" || new Date().getFullYear() - f.birth_year <= 14;

const Group = ({ title, list, picked, toggle, prefix }) => list.length > 0 && (
  <>
    <div className="eyebrow">{title}</div>
    {list.map((k) => (
      <label key={k.id} className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border border-white/10 bg-[#0B0F19]/60 px-3">
        <Checkbox data-testid={`${prefix}-family-${k.id}`} checked={picked.includes(k.id)} onCheckedChange={() => toggle(k.id)} />
        <span className="font-semibold">{k.name}</span>
      </label>
    ))}
  </>
);

export const KidPicker = ({ kids, picked, toggle, prefix = "checkin" }) => (
  <div data-testid={`${prefix}-family-picker`} className="mt-4 space-y-2">
    <Group prefix={prefix} title="Family under 15 with you · free" list={kids.filter((k) => (k.kind || "child") === "child")} picked={picked} toggle={toggle} />
    <Group prefix={prefix} title="Support workers with you · free" list={kids.filter((k) => k.kind === "support")} picked={picked} toggle={toggle} />
  </div>
);

// Undo a check-in made by accident. Any $5 already paid stays on record for the session.
export const undoCheckin = async (id, what, reload) => {
  if (!window.confirm(`Undo your check-in to ${what}? Any $5 you paid for it stays on record, so checking in again later is free. Games you logged as meetup results from today will count as played anywhere instead.`)) return;
  try {
    const { data } = await http.delete(`/checkin/${id}`);
    toast.success(data.unmarked_logs ? `Check-in undone · ${data.unmarked_logs} game log${data.unmarked_logs === 1 ? "" : "s"} moved to "anywhere"` : "Check-in undone");
    reload();
  } catch (e) {
    toast.error(errMsg(e));
  }
};

// Subscribers ask the hosts for their free drink & snack. Only unlocked on free official meetup days.
const TreatButton = ({ data, reload }) => {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const req = data.treat_request;
  if (!data.free_meetup_day) {
    return (
      <div data-testid="treat-locked" className="mt-4 flex items-center gap-2 rounded-lg border border-white/10 p-3 text-sm text-slate-500">
        <Lock className="h-4 w-4 shrink-0" /> Your free drink & snack unlocks at free official meetups.
      </div>
    );
  }
  if (req) {
    return (
      <div data-testid="treat-requested" className="mt-4 flex items-center gap-2 rounded-lg bg-[var(--mb-blue)]/10 p-3 text-sm text-mb-blue">
        <Coffee className="h-4 w-4 shrink-0" /> {req.acknowledged ? `Your free drink & snack is on its way (${req.acknowledged_by || "a host"} has it).` : "Hosts have been alerted. Your free drink & snack is coming."}
      </div>
    );
  }
  const ask = async () => {
    setBusy(true);
    try {
      await http.post("/treat/request", { note });
      toast.success("Hosts have been alerted for your free drink & snack");
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-testid="treat-panel" className="mt-4 rounded-lg border border-[var(--mb-blue)]/40 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-mb-blue"><Coffee className="h-4 w-4" /> Free drink & snack unlocked</div>
      <Input data-testid="treat-note-input" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder="What would you like? (optional)" className="mt-2" />
      <button data-testid="treat-request-button" disabled={busy} onClick={ask} className="btn-blue mt-2 w-full"><BellRing className="h-4 w-4" /> {busy ? "Alerting…" : "Alert hosts: free drink & snack"}</button>
    </div>
  );
};

export const CheckInCard = ({ data, reload }) => {
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState([]);
  const u = data.user;
  const free = data.free_entry || data.cash_entry || data.second_session_free || data.free_meetup_day;
  const inIds = new Set((data.today_checkin?.family || []).map((f) => f.id));
  const kids = (u.family || []).filter((f) => under15(f) && !inIds.has(f.id));
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const run = async (fn, msg) => {
    setBusy(true);
    try {
      await fn();
      toast.success(msg);
      setPicked([]);
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const checkIn = async () => {
    if (!free) {
      setBusy(true);
      if (!(await startCheckout("checkin", { family_ids: picked }))) setBusy(false);
      return;
    }
    run(() => http.post("/checkin", { family_ids: picked }), u.is_subscriber ? (data.free_meetup_day ? "Checked in! Your free drink & snack is unlocked." : "Checked in free with your subscription") : data.free_entry ? "Checked in with free host admission" : data.cash_entry ? "Checked in – your $5 was already paid to a host" : data.free_meetup_day ? "Checked in free to today's official meetup" : "Checked in free – you already paid today");
  };
  const addKids = () => run(() => http.post("/checkin/family", { family_ids: picked }), "Guests checked in free");
  const note = data.free_meetup_day && !u.is_subscriber && !data.free_entry ? "Today is a free official meetup, so there's no $5 entry. Just check in and log your meetup games." : u.is_subscriber ? (data.free_meetup_day ? "Members check in free. Today is a free official meetup, so your free drink & snack unlocks once you're checked in." : "Members are not required to pay the admission while subscribed. Your free drink & snack unlocks at free official meetups.") : data.free_entry ? "Hosts & admins get free admission." : data.cash_entry === "online" ? "You've already paid the $5 for this session, so check in again free." : data.cash_entry ? "A host has recorded your $5 entry as paid (cash or off the site), so check in free and log your meetup games." : data.second_session_free ? "You paid for the day session, so this evening session is free." : `Tap to pay the ${money(500)} admission and you're on the list. Paying for the day session makes the evening session free.`;
  const label = free ? `${data.cash_entry && !data.free_entry ? "Check in · already paid" : "Check in free"}${picked.length ? ` + ${picked.length} free guest${picked.length === 1 ? "" : "s"}` : ""}` : `Check in & pay $5${picked.length ? ` + ${picked.length} free guest${picked.length === 1 ? "" : "s"}` : ""}`;

  return (
    <div data-testid="checkin-card" className="panel panel-red">
      <div className="eyebrow text-mb-red">{data.today}</div>
      <h3 className="mt-2 font-display text-2xl font-extrabold uppercase">Session check-in</h3>
      <div data-testid="checkin-session-label" className="mt-1 text-sm font-semibold text-mb-blue">{data.session.label}</div>
      {data.free_meetup_day && <div data-testid="checkin-free-day-badge" className="mt-2 inline-block rounded-full bg-[var(--mb-blue)]/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-mb-blue">Free official meetup today</div>}
      {data.paid_meetup_day && <div data-testid="checkin-paid-day-badge" className="mt-2 inline-block rounded-full bg-[var(--mb-red)]/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-mb-red">Official paid meetup today</div>}
      <p className="mt-1 text-xs text-slate-500">Everyone checks in here for each session they attend.</p>
      {data.checked_in_today ? (
        <>
          <div data-testid="checkin-status-done" className="mt-4 flex items-center gap-3 rounded-lg bg-emerald-500/10 p-4 text-emerald-300">
            <CalendarCheck className="h-6 w-6 shrink-0" />
            <div>
              <div className="font-semibold">You're checked in for this session</div>
              {inIds.size > 0 && (
                <div data-testid="checkin-family-done" className="flex items-center gap-1 text-sm"><Users className="h-4 w-4" /> With {data.today_checkin.family.map((f) => f.name).join(", ")}</div>
              )}
            </div>
          </div>
          {u.is_subscriber && <TreatButton data={data} reload={reload} />}
          <button data-testid="checkin-undo-button" disabled={busy} onClick={() => undoCheckin(data.today_checkin.id, "this session", reload)} className="mt-2 flex items-center gap-1 text-xs text-slate-400 underline-offset-2 hover:text-mb-red hover:underline">
            <Undo2 className="h-3.5 w-3.5" /> Checked in by accident? Undo
          </button>
          {kids.length > 0 && (
            <>
              <KidPicker kids={kids} picked={picked} toggle={toggle} />
              <button data-testid="checkin-family-button" disabled={busy || !picked.length} onClick={addKids} className="btn-ghost mt-3 w-full">Check in selected guests (free)</button>
            </>
          )}
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-slate-400">{note}</p>
          {kids.length > 0 && <KidPicker kids={kids} picked={picked} toggle={toggle} />}
          <button data-testid="checkin-pay-button" disabled={busy} onClick={checkIn} className="btn-red mt-5 w-full">{busy ? "Working…" : label}</button>
        </>
      )}
    </div>
  );
};
