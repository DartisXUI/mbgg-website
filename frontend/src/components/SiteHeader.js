import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { Bell, LogOut, Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/context/AuthContext";
import { InstallButton, useStaffAlerts } from "@/components/HeaderWidgets";
import { GameTicker } from "@/components/GameTicker";
import { thumb } from "@/data/games";

const links = (user) => [
  { to: "/", label: "Home", end: true },
  ...(user
    ? [
        { to: "/account", label: "Account" },
        { to: "/games", label: "Game Log" },
        { to: "/leaderboards", label: "Leaderboards" },
        { to: "/me/profile", label: "My Collection" },
      ]
    : []),
  { to: "/members", label: "Members" },
];

const NavItems = ({ user, alerts, onClick }) => (
  <>
    {links(user).map((l) => (
      <NavLink
        key={l.to}
        to={l.to}
        end={l.end}
        onClick={onClick}
        data-testid={`nav-${l.label.toLowerCase().replace(/\s+/g, "-")}`}
        className={({ isActive }) =>
          `rounded-full px-3 py-2 text-sm font-semibold transition-colors ${isActive ? "bg-white/10 text-white" : "text-slate-300 hover:text-white"}`
        }
      >
        {l.label}
      </NavLink>
    ))}
    {user && ["host", "admin"].includes(user.role) && (
      <NavLink to="/admin" onClick={onClick} data-testid="nav-admin" className="relative inline-flex items-center gap-1 rounded-full px-3 py-2 text-sm font-semibold text-mb-orange">
        <Bell className="h-4 w-4" /> Host
        {alerts > 0 && (
          <span data-testid="nav-admin-alert-count" className="ml-1 rounded-full bg-[var(--mb-red)] px-1.5 text-[11px] text-white">{alerts}</span>
        )}
      </NavLink>
    )}
  </>
);

export const SiteHeader = () => {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const alerts = useStaffAlerts(user);
  const [open, setOpen] = useState(false);
  const doLogout = async () => {
    await logout();
    nav("/");
  };

  return (
    <>
      <Link to="/" data-testid="widescreen-logo-header" className="block px-2 pt-3 sm:px-4">
        <img src={thumb("/brand/wide.png", 1280)} alt="Murray Bridge Games Group" className="mx-auto h-auto max-h-[180px] w-full max-w-5xl object-contain" />
      </Link>
      <div className="mt-2"><GameTicker /></div>
      <nav className="sticky top-0 z-30 border-b border-white/10 bg-[#0B0F19]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2">
          <Link to="/" className="flex items-center gap-2" data-testid="nav-round-logo">
            <img src={thumb("/brand/round.png", 96)} alt="MBGG" className="h-9 w-9 rounded-full" />
          </Link>
          <div className="hidden flex-1 items-center gap-1 md:flex">
            <NavItems user={user} alerts={alerts} />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <InstallButton />
            {user ? (
              <button data-testid="logout-button" onClick={doLogout} className="btn-ghost hidden !min-h-[38px] !px-3 text-xs md:inline-flex">
                <LogOut className="h-4 w-4" /> Log out
              </button>
            ) : (
              <Link to="/login" data-testid="nav-login-button" className="btn-red !min-h-[38px] !px-4 text-sm">Sign in</Link>
            )}
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <button data-testid="mobile-menu-button" className="btn-ghost !min-h-[40px] !px-3 md:hidden" aria-label="Menu">
                  <Menu className="h-5 w-5" />
                </button>
              </SheetTrigger>
              <SheetContent side="right" className="w-72 border-white/10 bg-[#0B0F19]">
                <SheetTitle className="flex items-center gap-2 font-display text-xl uppercase">
                  <img src="/brand/round.png" alt="" className="h-10 w-10 rounded-full" /> Menu
                </SheetTitle>
                <div className="mt-6 flex flex-col gap-1">
                  <NavItems user={user} alerts={alerts} onClick={() => setOpen(false)} />
                  {user && (
                    <button data-testid="mobile-logout-button" onClick={() => { setOpen(false); doLogout(); }} className="btn-ghost mt-4">
                      <LogOut className="h-4 w-4" /> Log out
                    </button>
                  )}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </nav>
    </>
  );
};
