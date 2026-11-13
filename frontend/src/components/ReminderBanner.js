import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { BellRing, X } from "lucide-react";
import { http } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const fmt = (d) => new Date(`${d}T00:00:00`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });

export const ReminderBanner = () => {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [dates, setDates] = useState([]);
  const [hidden, setHidden] = useState(sessionStorage.getItem("mbgg-reminder-hidden") === "1");
  useEffect(() => {
    if (!user) {
      setDates([]);
      return;
    }
    const load = () => http.get("/me/reminders").then((r) => setDates(r.data.unlogged_dates)).catch(() => {});
    load();
    window.addEventListener("mbgg-logged", load);
    return () => window.removeEventListener("mbgg-logged", load);
  }, [user, pathname]);
  if (!user || hidden || !dates.length) return null;
  const hide = () => {
    sessionStorage.setItem("mbgg-reminder-hidden", "1");
    setHidden(true);
  };
  return (
    <div data-testid="log-reminder-banner" className="mx-auto mt-4 flex max-w-6xl items-start gap-3 rounded-xl border border-[var(--mb-orange)]/40 bg-[var(--mb-orange)]/10 px-4 py-3 text-sm sm:items-center">
      <BellRing className="h-5 w-5 shrink-0 text-mb-orange" />
      <p className="flex-1 text-slate-200">
        You checked in on <b>{dates.map(fmt).join(", ")}</b> but haven't logged a meetup game for {dates.length === 1 ? "it" : "them"} yet. Log every meetup to earn 3 free raffle entries.
      </p>
      <Link to="/games" data-testid="log-reminder-link" className="btn-orange !min-h-[36px] shrink-0 !px-4 text-xs">Log now</Link>
      <button data-testid="log-reminder-dismiss" onClick={hide} aria-label="Dismiss" className="text-slate-400 hover:text-white"><X className="h-4 w-4" /></button>
    </div>
  );
};
