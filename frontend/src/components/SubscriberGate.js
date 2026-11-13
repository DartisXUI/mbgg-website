import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import { startCheckout } from "@/lib/api";

export const SubscriberGate = ({ what }) => (
  <div data-testid="subscriber-gate" className="panel panel-orange mx-auto max-w-xl text-center">
    <Lock className="mx-auto h-8 w-8 text-mb-orange" />
    <h2 className="mt-3 font-display text-3xl font-extrabold uppercase">Subscribers only</h2>
    <p className="mt-2 text-sm text-slate-400">{what} is part of the $120 annual membership.</p>
    <div className="mt-6 flex flex-wrap justify-center gap-3">
      <button data-testid="gate-subscribe-button" onClick={() => startCheckout("annual")} className="btn-orange">Subscribe · $120 / year</button>
      <Link to="/" className="btn-ghost">See all perks</Link>
    </div>
  </div>
);

export const HonorNote = () => (
  <p data-testid="honor-disclaimer" className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs leading-relaxed text-slate-400">
    Honour system: players enter their own results so our hosts don't have to. Stats are only as accurate as what members log. You can log games played anywhere, including digital games at home. Only games marked as played at an IRL meetup count toward the 2-month bonus: log one for every meetup you check in to and you get 3 free lucky-number raffle entries.
  </p>
);
