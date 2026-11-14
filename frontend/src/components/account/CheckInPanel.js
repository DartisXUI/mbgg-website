import { useState } from "react";
import { CalendarCheck, Coffee, Users } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { http, errMsg, money, startCheckout } from "@/lib/api";

const under15 = (f) => (f.kind || "child") !== "child" || new Date().getFullYear() - f.birth_year <= 14;

const Group = ({ title, list, picked, toggle }) => list.length > 0 && (
  <>
    <div className="eyebrow">{title}</div>
    {list.map((k) => (
      <label key={k.id} className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border border-white/10 bg-[#0B0F19]/60 px-3">
        <Checkbox data-testid={`checkin-family-${k.id}`} checked={picked.includes(k.id)} onCheckedChange={() => toggle(k.id)} />
        <span className="font-semibold">{k.name}</span>
      </label>
    ))}
  </>
);

const KidPicker = ({ kids, picked, toggle }) => (
  <div data-testid="checkin-family-picker" className="mt-4 space-y-2">
    <Group title="Family under 15 with you · free" list={kids.filter((k) => (k.kind || "child") === "child")} picked={picked} toggle={toggle} />
    <Group title="Support workers with you · free" list={kids.filter((k) => k.kind === "support")} picked={picked} toggle={toggle} />
  </div>
);

export const CheckInCard = ({ data, reload }) => {
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState([]);
  const u = data.user;
  const free = data.free_entry || data.second_session_free;
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
    run(() => http.post("/checkin", { family_ids: picked }), u.is_subscriber ? "Checked in! Grab your free drink & snack." : data.free_entry ? "Checked in with free host admission" : "Checked in free – you already paid today");
  };
  const addKids = () => run(() => http.post("/checkin/family", { family_ids: picked }), "Guests checked in free");
  const note = u.is_subscriber ? "Members are not required to pay the admission while subscribed, plus a free drink and snack." : data.free_entry ? "Hosts & admins get free admission." : data.second_session_free ? "You paid for the day session, so this evening session is free." : `Tap to pay the ${money(500)} admission and you're on the list. Paying for the day session makes the evening session free.`;
  const label = free ? `Check in free${picked.length ? ` + ${picked.length} free guest${picked.length === 1 ? "" : "s"}` : ""}` : `Check in & pay $5${picked.length ? ` + ${picked.length} free guest${picked.length === 1 ? "" : "s"}` : ""}`;

  return (
    <div data-testid="checkin-card" className="panel panel-red">
      <div className="eyebrow text-mb-red">{data.today}</div>
      <h3 className="mt-2 font-display text-2xl font-extrabold uppercase">Session check-in</h3>
      <div data-testid="checkin-session-label" className="mt-1 text-sm font-semibold text-mb-blue">{data.session.label}</div>
      <p className="mt-1 text-xs text-slate-500">Everyone checks in here for each session they attend.</p>
      {data.checked_in_today ? (
        <>
          <div data-testid="checkin-status-done" className="mt-4 flex items-center gap-3 rounded-lg bg-emerald-500/10 p-4 text-emerald-300">
            <CalendarCheck className="h-6 w-6 shrink-0" />
            <div>
              <div className="font-semibold">You're checked in for this session</div>
              {u.is_subscriber && <div className="flex items-center gap-1 text-sm"><Coffee className="h-4 w-4" /> A free drink and snack included</div>}
              {inIds.size > 0 && (
                <div data-testid="checkin-family-done" className="flex items-center gap-1 text-sm"><Users className="h-4 w-4" /> With {data.today_checkin.family.map((f) => f.name).join(", ")}</div>
              )}
            </div>
          </div>
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
