import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { http, money } from "@/lib/api";
import { Loader } from "@/components/ProtectedRoute";
import { CheckInCard } from "@/components/account/CheckInPanel";
import { FamilyCard, SupportCard } from "@/components/account/FamilyCard";
import { GuildCheckInCard } from "@/components/account/GuildCheckInCard";
import { MembershipCard } from "@/components/account/MembershipCard";
import { TokenCard } from "@/components/account/TokenCard";
import { DonateCard, RaffleCard } from "@/components/account/MoneyCards";
import { BonusCard, PrizesCard } from "@/components/account/BonusPrizeCards";

const STATUS = { COMPLETED: "text-emerald-400", PENDING: "text-mb-orange", CANCELED: "text-slate-500" };

const History = ({ data }) => (
  <div data-testid="history-card" className="panel">
    <div className="eyebrow">History</div>
    <div className="mt-3 grid gap-6 sm:grid-cols-2">
      <div>
        <h4 className="font-display text-lg font-bold uppercase">Recent check-ins</h4>
        <ul className="mt-2 space-y-1 text-sm text-slate-300">
          {data.recent_checkins.length ? data.recent_checkins.map((c) => (
            <li key={c.id} className="flex justify-between"><span>{c.date} · {c.via === "guild" ? `Guild · ${c.guild_name}` : c.via === "casual" ? "Casual meetup" : c.session === "evening" ? "4pm–late" : "10am–2pm"}</span><span className="text-slate-500">{{ subscription: "Member", staff: "Host/admin", paid: "Paid $5", cash: "Paid $5 (host)", free_meetup: "Free official meetup", paid_earlier: "Free (paid earlier)", guild: "Free", casual: "Free" }[c.via]}</span></li>
          )) : <li className="text-slate-500">None yet</li>}
        </ul>
      </div>
      <div>
        <h4 className="font-display text-lg font-bold uppercase">Payments</h4>
        <ul className="mt-2 space-y-1 text-sm text-slate-300">
          {data.payments.length ? data.payments.map((p) => (
            <li key={p.checkout_id} className="flex justify-between gap-2"><span className="truncate">{p.label}</span><span className={STATUS[p.status]}>{money(p.amount_cents)} · {p.status.toLowerCase()}</span></li>
          )) : <li className="text-slate-500">None yet</li>}
        </ul>
      </div>
    </div>
  </div>
);

export default function Account() {
  const [data, setData] = useState(null);
  const load = useCallback(() => http.get("/me/dashboard").then((r) => setData(r.data)), []);
  useEffect(() => {
    load();
  }, [load]);
  if (!data) return <Loader />;
  const u = data.user;
  return (
    <div data-testid="account-page">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <img src={u.picture || "/brand/round.png"} alt="" className="h-16 w-16 rounded-full border-2 border-[var(--mb-orange)] object-cover" />
        <div className="flex-1">
          <div className="eyebrow">{u.role === "member" ? (u.is_subscriber ? "Subscriber" : "Member") : u.role}</div>
          <h1 data-testid="account-name" className="font-display text-4xl font-black uppercase sm:text-5xl">{u.name}</h1>
        </div>
        <Link to={`/u/${u.user_id}`} data-testid="view-public-profile-link" className="btn-ghost">My public page</Link>
      </div>
      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <CheckInCard data={data} reload={load} />
        <GuildCheckInCard data={data} reload={load} />
        <MembershipCard data={data} />
        <FamilyCard data={data} reload={load} />
        <SupportCard data={data} reload={load} />
        <TokenCard data={data} reload={load} />
        <BonusCard data={data} />
        <RaffleCard data={data} />
        <PrizesCard data={data} />
        <DonateCard />
        <History data={data} />
      </div>
    </div>
  );
}
