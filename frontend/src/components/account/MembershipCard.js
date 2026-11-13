import { Progress } from "@/components/ui/progress";
import { money, plural, startCheckout } from "@/lib/api";

const fmt = (s) => new Date(s).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });

export const MembershipCard = ({ data }) => {
  const u = data.user;
  const a = data.attendance;
  const pct = Math.min(100, Math.round((a.door_value_cents / a.membership_cents) * 100));
  return (
    <div data-testid="membership-card" className="panel panel-orange">
      <div className="eyebrow text-mb-orange">Membership</div>
      {u.is_subscriber ? (
        <>
          <h3 data-testid="membership-status" className="mt-2 font-display text-2xl font-extrabold uppercase">Annual subscriber</h3>
          <p className="text-sm text-slate-400">Active until {fmt(u.subscription_expires_at)}</p>
        </>
      ) : (
        <>
          <h3 data-testid="membership-status" className="mt-2 font-display text-2xl font-extrabold uppercase">Pay as you go</h3>
          <p className="text-sm text-slate-400">$120 for the year instead of $170 at the door.</p>
        </>
      )}
      <div className="mt-5">
        <div className="flex justify-between text-sm">
          <span data-testid="attendance-sessions">{plural(a.sessions, "session")} since {a.since}</span>
          <span data-testid="attendance-value" className="font-mono-x text-mb-orange">{money(a.door_value_cents)} / {money(a.membership_cents)}</span>
        </div>
        <Progress value={pct} className="mt-2 h-2 bg-white/10 [&>div]:bg-[var(--mb-orange)]" />
        <p className="mt-2 text-xs text-slate-500">Door value of your check-ins compared with the $120 membership.</p>
      </div>
      <button data-testid="subscribe-annual-button" onClick={() => startCheckout("annual")} className="btn-orange mt-5 w-full">
        {u.is_subscriber ? "Renew another year · $120" : "Subscribe · $120 / year"}
      </button>
      <p className="mt-3 text-[11px] text-slate-500">No further discount applies should you not attend sessions.</p>
    </div>
  );
};
