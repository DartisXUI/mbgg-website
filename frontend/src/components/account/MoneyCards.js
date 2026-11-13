import { useState } from "react";
import { HeartHandshake, Minus, Plus, Ticket } from "lucide-react";
import { Input } from "@/components/ui/input";
import { money, startCheckout } from "@/lib/api";

const PRESETS = [5, 10, 20, 50];

export const DonateCard = () => {
  const [custom, setCustom] = useState("");
  return (
    <div data-testid="donate-card" className="panel panel-red">
      <div className="eyebrow text-mb-red">Support the group</div>
      <h3 className="mt-2 flex items-center gap-2 font-display text-2xl font-extrabold uppercase"><HeartHandshake className="h-6 w-6 text-mb-red" /> Donate</h3>
      <div className="mt-4 grid grid-cols-4 gap-2">
        {PRESETS.map((a) => (
          <button key={a} data-testid={`donate-${a}-button`} onClick={() => startCheckout(`donation_${a}`)} className="btn-ghost !px-0 font-display text-xl">${a}</button>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <Input data-testid="donate-custom-input" type="number" min="1" step="0.01" placeholder="Custom $" value={custom} onChange={(e) => setCustom(e.target.value)} className="h-11 bg-[#0B0F19]" />
        <button data-testid="donate-custom-button" disabled={!custom} onClick={() => startCheckout("donation_custom", { custom_amount: custom })} className="btn-red shrink-0">Donate</button>
      </div>
    </div>
  );
};

export const RaffleCard = ({ data }) => {
  const [qty, setQty] = useState(1);
  const price = data.raffle_entry_cents;
  return (
    <div data-testid="raffle-card" className="panel panel-orange">
      <div className="eyebrow text-mb-orange">End-of-year free session</div>
      <h3 className="mt-2 flex items-center gap-2 font-display text-2xl font-extrabold uppercase"><Ticket className="h-6 w-6 text-mb-orange" /> Lucky number raffle</h3>
      <p className="mt-1 text-sm text-slate-400">{money(price)} per entry. Each entry gets its own lucky number.</p>
      <div className="mt-4 flex items-center gap-3">
        <button data-testid="raffle-qty-minus" onClick={() => setQty(Math.max(1, qty - 1))} className="btn-ghost !px-3"><Minus className="h-4 w-4" /></button>
        <span data-testid="raffle-qty" className="w-8 text-center font-display text-3xl font-bold">{qty}</span>
        <button data-testid="raffle-qty-plus" onClick={() => setQty(Math.min(20, qty + 1))} className="btn-ghost !px-3"><Plus className="h-4 w-4" /></button>
        <button data-testid="raffle-buy-entry-button" onClick={() => startCheckout("raffle", { quantity: qty })} className="btn-orange ml-auto">Buy · {money(price * qty)}</button>
      </div>
      <div className="mt-4">
        <div className="text-xs text-slate-500">Your numbers this year</div>
        <div data-testid="raffle-numbers" className="mt-2 flex flex-wrap gap-2">
          {data.raffle_numbers.length ? data.raffle_numbers.map((n) => (
            <span key={n} className="rounded-md border border-[var(--mb-orange)]/40 px-2 py-1 font-mono-x text-sm text-mb-orange">#{String(n).padStart(4, "0")}</span>
          )) : <span className="text-sm text-slate-500">No entries yet</span>}
        </div>
      </div>
    </div>
  );
};
