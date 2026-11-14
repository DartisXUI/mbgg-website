import { useEffect, useRef, useState } from "react";
import { Download, Share, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { http } from "@/lib/api";

const SEEN_KEY = "mbgg-checkins-seen";
const TOASTED_KEY = "mbgg-checkins-toasted";

export const markCheckinsSeen = () => {
  localStorage.setItem(SEEN_KEY, new Date().toISOString());
  window.dispatchEvent(new Event("mbgg-alerts"));
};

export const useStaffAlerts = (user) => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!user || !["host", "admin"].includes(user.role)) return;
    const load = async () => {
      try {
        let seen = localStorage.getItem(SEEN_KEY);
        if (!seen) {
          seen = new Date().toISOString();
          localStorage.setItem(SEEN_KEY, seen);
        }
        const { data } = await http.get("/admin/summary", { params: { since: seen } });
        const last = sessionStorage.getItem(TOASTED_KEY) || seen;
        data.new_checkins
          .filter((c) => c.created_at > last)
          .forEach((c) => toast.info(`${c.name} checked in · ${c.via === "guild" ? "Guild meet-up" : c.via === "casual" ? "Casual meetup" : c.session === "evening" ? "4pm–late" : "10am–2pm"}${c.family_count ? ` + ${c.family_count} free guest${c.family_count === 1 ? "" : "s"}` : ""}`, { id: c.id }));
        if (data.new_checkins.length) sessionStorage.setItem(TOASTED_KEY, data.new_checkins.at(-1).created_at);
        setCount(data.unacked_tokens + data.new_checkins.length);
      } catch {
        /* polling */
      }
    };
    load();
    const t = setInterval(load, 20000);
    window.addEventListener("mbgg-alerts", load);
    return () => {
      clearInterval(t);
      window.removeEventListener("mbgg-alerts", load);
    };
  }, [user]);
  return count;
};

const useInstallPrompt = () => {
  const [evt, setEvt] = useState(null);
  useEffect(() => {
    const h = (e) => {
      e.preventDefault();
      setEvt(e);
    };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);
  return evt;
};

export const InstallButton = ({ className = "" }) => {
  const evt = useInstallPrompt();
  const [open, setOpen] = useState(false);
  const standalone = useRef(window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone);
  if (standalone.current) return null;
  const click = async () => {
    if (evt) {
      evt.prompt();
      return;
    }
    setOpen(true);
  };
  return (
    <>
      <button data-testid="install-app-button" onClick={click} className={`btn-orange !min-h-[38px] !px-3 text-xs ${className}`}>
        <Download className="h-4 w-4" /> <span className="hidden sm:inline">Install to home screen</span><span className="sm:hidden">Install</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="install-instructions-dialog" className="border-white/10 bg-[#121826]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 font-display text-2xl uppercase">
              <img src="/brand/round.png" alt="" className="h-12 w-12 rounded-full" /> Add MBGG to your home screen
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm text-slate-300">
            <div className="flex gap-3"><Share className="h-5 w-5 shrink-0 text-mb-blue" /><p><b>iPhone / iPad (Safari):</b> tap the Share button, then <b>Add to Home Screen</b>.</p></div>
            <div className="flex gap-3"><Smartphone className="h-5 w-5 shrink-0 text-mb-orange" /><p><b>Android (Chrome):</b> tap the ⋮ menu, then <b>Install app</b> or <b>Add to Home screen</b>.</p></div>
            <div className="flex gap-3"><Download className="h-5 w-5 shrink-0 text-mb-red" /><p><b>Computer (Chrome / Edge):</b> click the install icon at the right of the address bar.</p></div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
