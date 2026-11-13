import { useState } from "react";
import { CalendarCheck, Coffee } from "lucide-react";
import { toast } from "sonner";
import { http, errMsg, money, startCheckout } from "@/lib/api";

export const CheckInCard = ({ data, reload }) => {
  const [busy, setBusy] = useState(false);
  const sub = data.user.is_subscriber;
  const checkIn = async () => {
    setBusy(true);
    if (!sub) {
      if (!(await startCheckout("checkin"))) setBusy(false);
      return;
    }
    try {
      await http.post("/checkin");
      toast.success("Checked in! Grab your free drink & snack.");
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-testid="checkin-card" className="panel panel-red">
      <div className="eyebrow text-mb-red">Today · {data.today}</div>
      <h3 className="mt-2 font-display text-2xl font-extrabold uppercase">Session check-in</h3>
      {data.checked_in_today ? (
        <div data-testid="checkin-status-done" className="mt-4 flex items-center gap-3 rounded-lg bg-emerald-500/10 p-4 text-emerald-300">
          <CalendarCheck className="h-6 w-6" />
          <div>
            <div className="font-semibold">You're checked in for today</div>
            {sub && <div className="flex items-center gap-1 text-sm"><Coffee className="h-4 w-4" /> 1 x free drink & snack included</div>}
          </div>
        </div>
      ) : (
        <>
          <p className="mt-2 text-sm text-slate-400">
            {sub ? "Members check in free. Your free drink & snack is included." : `Tap to pay the ${money(500)} admission and you're on the list.`}
          </p>
          <button data-testid="checkin-pay-button" disabled={busy} onClick={checkIn} className="btn-red mt-5 w-full">
            {busy ? "Working…" : sub ? "Check in (free for members)" : "Check in & pay $5"}
          </button>
        </>
      )}
    </div>
  );
};
