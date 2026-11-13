import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { http, money } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

export default function CheckoutComplete() {
  const [params] = useSearchParams();
  const id = params.get("checkout_id");
  const { refresh } = useAuth();
  const [p, setP] = useState(null);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (!id) return;
    let timer;
    const poll = async (n) => {
      try {
        const { data } = await http.get(`/payments/${id}`);
        setP(data);
        setTries(n);
        if (data.status === "PENDING" && n < 12) timer = setTimeout(() => poll(n + 1), 2500);
        if (data.status === "COMPLETED") refresh();
      } catch {
        setP({ status: "MISSING" });
      }
    };
    poll(1);
    return () => clearTimeout(timer);
  }, [id, refresh]);

  const status = p?.status;
  const ok = status === "COMPLETED";
  const pending = !p || (status === "PENDING" && tries < 12);
  return (
    <div data-testid="checkout-complete-page" className="panel mx-auto max-w-lg text-center">
      <img src="/brand/round.png" alt="" className="mx-auto h-20 w-20 rounded-full" />
      {pending ? (
        <><Loader2 className="mx-auto mt-6 h-8 w-8 animate-spin text-mb-blue" /><h1 data-testid="checkout-status" className="mt-3 font-display text-3xl font-black uppercase">Confirming payment…</h1></>
      ) : ok ? (
        <>
          <CheckCircle2 className="mx-auto mt-6 h-10 w-10 text-emerald-400" />
          <h1 data-testid="checkout-status" className="mt-3 font-display text-3xl font-black uppercase">Payment confirmed</h1>
          <p className="mt-1 text-slate-300">{p.label} · {money(p.amount_cents)} AUD</p>
          {p.result?.raffle_numbers && (
            <div data-testid="checkout-raffle-numbers" className="mt-4 flex flex-wrap justify-center gap-2">
              {p.result.raffle_numbers.map((n) => <span key={n} className="rounded-md border border-[var(--mb-orange)]/40 px-2 py-1 font-mono-x text-mb-orange">#{String(n).padStart(4, "0")}</span>)}
            </div>
          )}
        </>
      ) : (
        <>
          <XCircle className="mx-auto mt-6 h-10 w-10 text-mb-red" />
          <h1 data-testid="checkout-status" className="mt-3 font-display text-3xl font-black uppercase">{status === "PENDING" ? "Still waiting on Square" : "Payment not completed"}</h1>
          <p className="mt-1 text-sm text-slate-400">If you paid, it'll appear on your account shortly.</p>
        </>
      )}
      <Link to="/account" data-testid="checkout-back-button" className="btn-red mt-6">Back to my account</Link>
    </div>
  );
}
