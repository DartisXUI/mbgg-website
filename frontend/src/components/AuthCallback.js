import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { http, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Loader } from "@/components/ProtectedRoute";

export const AuthCallback = () => {
  const done = useRef(false);
  const nav = useNavigate();
  const { setUser } = useAuth();

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const sid = new URLSearchParams(window.location.hash.slice(1)).get("session_id");
    http
      .post("/auth/google/session", { session_id: sid })
      .then(({ data }) => {
        setUser(data);
        nav("/account", { replace: true });
      })
      .catch((e) => {
        toast.error(errMsg(e));
        nav("/login", { replace: true });
      });
  }, [nav, setUser]);

  return <Loader />;
};
