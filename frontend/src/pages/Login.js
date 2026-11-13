import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { http, errMsg } from "@/lib/api";

const googleLogin = () => {
  // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
  const redirectUrl = window.location.origin + "/account";
  window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
};

const Field = ({ id, label, ...props }) => (
  <div className="space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    <Input id={id} data-testid={`${id}-input`} className="h-11 bg-[#0B0F19]" {...props} />
  </div>
);

const AuthForm = ({ mode, onDone }) => {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = mode === "login" ? { email: form.email, password: form.password } : form;
      const { data } = await http.post(`/auth/${mode}`, body);
      onDone(data);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      {mode === "register" && <Field id="register-name" label="Display name" value={form.name} onChange={set("name")} required />}
      <Field id={`${mode}-email`} label="Email" type="email" value={form.email} onChange={set("email")} required />
      <Field id={`${mode}-password`} label="Password" type="password" minLength={mode === "register" ? 8 : undefined} value={form.password} onChange={set("password")} required />
      <button data-testid={`${mode}-submit-button`} disabled={busy} className="btn-red w-full">
        {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
      </button>
    </form>
  );
};

export default function Login() {
  const { user, setUser } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  if (user) return <Navigate to="/account" replace />;
  const done = (u) => {
    setUser(u);
    nav(loc.state?.from || "/account", { replace: true });
  };
  return (
    <div data-testid="login-page" className="mx-auto max-w-md">
      <div className="panel rise">
        <div className="flex items-center gap-3">
          <img src="/brand/round.png" alt="" className="h-14 w-14 rounded-full" />
          <div>
            <h1 className="font-display text-3xl font-black uppercase">Join the table</h1>
            <p className="text-sm text-slate-400">Sign in to check in, log games and more.</p>
          </div>
        </div>
        <button data-testid="google-login-button" onClick={googleLogin} className="btn-ghost mt-6 w-full">
          <svg viewBox="0 0 48 48" className="h-5 w-5"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
          Continue with Google
        </button>
        <div className="my-6 flex items-center gap-3 text-xs text-slate-500"><div className="h-px flex-1 bg-white/10" />or use email<div className="h-px flex-1 bg-white/10" /></div>
        <Tabs defaultValue="login">
          <TabsList className="grid w-full grid-cols-2 bg-[#0B0F19]">
            <TabsTrigger value="login" data-testid="login-tab">Sign in</TabsTrigger>
            <TabsTrigger value="register" data-testid="register-tab">Create account</TabsTrigger>
          </TabsList>
          <TabsContent value="login" className="pt-4"><AuthForm mode="login" onDone={done} /></TabsContent>
          <TabsContent value="register" className="pt-4"><AuthForm mode="register" onDone={done} /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
