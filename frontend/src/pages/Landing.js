import { Link } from "react-router-dom";
import { Award, CalendarCheck, Coffee, Crown, Gift, Ticket, Trophy } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { startCheckout } from "@/lib/api";

const PERKS = [
  { icon: CalendarCheck, title: "Check in free", text: "Everyone checks in on the site or app. Members are not required to pay the admission while subscribed, and can track attendance against what they paid." },
  { icon: Coffee, title: "Free drink & snack", text: "A free drink and snack (hot, cold or otherwise) during special member-wide free admission sessions." },
  { icon: Crown, title: "Guaranteed game choice", text: "1 x guaranteed game pick every month. Tap your token and the hosts are alerted." },
  { icon: Gift, title: "Win without being there", text: "Raffle prizes are held for you until collection, for up to 3 months." },
  { icon: Award, title: "Quarterly score prize", text: "The subscriber with the top total score at the end of March, June, September and December wins a free prize." },
];

const Offer = () => {
  const { user } = useAuth();
  return (
    <section data-testid="membership-offer" className="panel panel-orange relative overflow-hidden rise rise-2">
      <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[var(--mb-orange)]/20 blur-3xl" />
      <div className="eyebrow text-mb-orange">Annual membership</div>
      <div className="mt-3 flex items-end gap-3">
        <span data-testid="offer-old-price" className="font-display text-3xl font-bold text-slate-500 line-through">$170</span>
        <span data-testid="offer-price" className="font-display text-7xl font-black leading-none text-white">$120</span>
        <span className="mb-2 text-sm text-slate-400">AUD / year</span>
      </div>
      <div className="mt-3 inline-flex rounded-full bg-[var(--mb-red)]/15 px-3 py-1 text-sm font-semibold text-mb-red">Save $50 on a year of meetup admission</div>
      <p className="mt-4 text-sm text-slate-300">One payment covers a full year of access to the group, instead of $5 at the door every session.</p>
      {user ? (
        <button data-testid="subscribe-annual-button" onClick={() => startCheckout("annual")} className="btn-orange mt-6 w-full">Subscribe for $120</button>
      ) : (
        <Link to="/login" data-testid="subscribe-annual-button" className="btn-orange mt-6 w-full">Sign up to subscribe</Link>
      )}
      <p data-testid="offer-disclaimer" className="mt-4 text-xs leading-relaxed text-slate-500">
        Disclaimer: the $50 saving is the only discount. No further discount or refund applies for sessions you don't attend.
      </p>
    </section>
  );
};

const Hero = () => (
  <section className="grid items-center gap-10 lg:grid-cols-[1.3fr_1fr]">
    <div className="rise">
      <div className="eyebrow">Board · Card · Computer games</div>
      <h1 className="mt-4 font-display text-5xl font-black uppercase leading-[0.9] tracking-tight sm:text-6xl lg:text-7xl split-title">
        <span className="r">Murray</span> <span className="b">Bridge</span>
        <br />Games Group
      </h1>
      <p className="mt-6 max-w-xl text-base text-slate-300 sm:text-lg">
        A community that plays everything from deck-builders to Mario Kart. Make an account to check in and pay online, log your games and see how you stack up.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link to="/account" data-testid="hero-checkin-button" className="btn-red">Check in · $5</Link>
        <Link to="/leaderboards" data-testid="hero-leaderboards-button" className="btn-ghost">See the leaderboards</Link>
      </div>
    </div>
    <Offer />
  </section>
);

const Perks = () => (
  <section className="mt-24">
    <div className="eyebrow">What members get</div>
    <h2 className="mt-2 font-display text-3xl font-extrabold uppercase sm:text-4xl">Subscriber perks</h2>
    <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {PERKS.map((p, i) => (
        <div key={p.title} data-testid={`perk-${i}`} className={`panel ${["panel-red", "panel-blue", "panel-orange"][i % 3]} rise`} style={{ animationDelay: `${i * 0.06}s` }}>
          <p.icon className={`h-6 w-6 ${["text-mb-red", "text-mb-blue", "text-mb-orange"][i % 3]}`} />
          <h3 className="mt-3 font-display text-xl font-bold uppercase">{p.title}</h3>
          <p className="mt-1 text-sm text-slate-400">{p.text}</p>
        </div>
      ))}
    </div>
  </section>
);

const ForEveryone = () => (
  <section className="mt-24 grid gap-4 md:grid-cols-3">
    <div className="panel md:col-span-1">
      <img src="/brand/round.png" alt="Murray Bridge Games Group" className="h-28 w-28 rounded-full" />
      <h2 className="mt-4 font-display text-3xl font-extrabold uppercase">Every account</h2>
      <p className="mt-2 text-sm text-slate-400">No subscription needed for these.</p>
    </div>
    <div className="panel panel-blue">
      <CalendarCheck className="h-6 w-6 text-mb-blue" />
      <h3 className="mt-3 font-display text-xl font-bold uppercase">Digital check-in</h3>
      <p className="mt-1 text-sm text-slate-400">Everyone checks in on arrival. Tap check in, pay the $5 admission and you're on the host's list. Sessions run 10am–2pm and 4pm–late, and if you paid for the day session the evening one is free. Kids under 15 with you come in free and don't need a login.</p>
    </div>
    <div className="panel panel-red">
      <Ticket className="h-6 w-6 text-mb-red" />
      <h3 className="mt-3 font-display text-xl font-bold uppercase">Donate & raffle</h3>
      <p className="mt-1 text-sm text-slate-400">Chip in $5, $10, $20, $50 or any amount, and grab lucky-number entries for the end-of-year free session raffle.</p>
    </div>
    <div className="panel panel-blue md:col-span-3">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Trophy className="h-8 w-8 shrink-0 text-mb-blue" />
        <div className="flex-1">
          <h3 className="font-display text-xl font-bold uppercase">Game log & leaderboards</h3>
          <p className="mt-1 text-sm text-slate-400">Log your plays and climb the 365-day leaderboards. Log a game for every session you check in to across a 2-month block (Jan–Feb, Mar–Apr, May–Jun, Jul–Aug, Sep–Oct, Nov–Dec) and get 3 free entries into the end-of-year lucky number raffle.</p>
        </div>
        <Link to="/games" data-testid="landing-gamelog-link" className="btn-blue">Start logging</Link>
      </div>
    </div>
    <div className="panel panel-orange md:col-span-3">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex-1">
          <h3 className="font-display text-xl font-bold uppercase">Show off your shelf</h3>
          <p className="mt-1 text-sm text-slate-400">Everyone gets a public collection page split into board games, card games and digital platforms.</p>
        </div>
        <Link to="/members" data-testid="landing-members-link" className="btn-ghost">Browse members</Link>
      </div>
    </div>
  </section>
);

export default function Landing() {
  return (
    <div data-testid="landing-page">
      <Hero />
      <Perks />
      <ForEveryone />
    </div>
  );
}
