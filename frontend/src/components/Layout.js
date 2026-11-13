import { Outlet } from "react-router-dom";
import { SiteHeader } from "@/components/SiteHeader";
import { ReminderBanner } from "@/components/ReminderBanner";

export const Layout = () => (
  <div className="noise relative min-h-screen">
    <div className="relative z-10">
      <SiteHeader />
      <div className="px-4 sm:px-6"><ReminderBanner /></div>
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-6">
        <Outlet />
      </main>
      <footer className="border-t border-white/10 px-4 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
          <img src="/brand/round.png" alt="Murray Bridge Games Group" className="h-16 w-16 rounded-full" />
          <div>
            <div className="font-display text-xl font-bold uppercase split-title"><span className="r">Murray</span> <span className="b">Bridge</span> Games Group</div>
            <div className="text-sm text-slate-400">Board games, card games and computer games, together.</div>
          </div>
        </div>
      </footer>
    </div>
  </div>
);
