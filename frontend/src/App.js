import "@/App.css";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/context/AuthContext";
import { Layout } from "@/components/Layout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AuthCallback } from "@/components/AuthCallback";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import Account from "@/pages/Account";
import GameLog from "@/pages/GameLog";
import Leaderboards from "@/pages/Leaderboards";
import Members from "@/pages/Members";
import PublicProfile from "@/pages/PublicProfile";
import MyProfile from "@/pages/MyProfile";
import Admin from "@/pages/Admin";
import CheckoutComplete from "@/pages/CheckoutComplete";

const guard = (el, staff) => <ProtectedRoute staff={staff}>{el}</ProtectedRoute>;

const AppRouter = () => {
  const location = useLocation();
  if (location.hash?.includes("session_id=")) return <AuthCallback />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/members" element={<Members />} />
        <Route path="/u/:userId" element={<PublicProfile />} />
        <Route path="/account" element={guard(<Account />)} />
        <Route path="/games" element={guard(<GameLog />)} />
        <Route path="/leaderboards" element={guard(<Leaderboards />)} />
        <Route path="/me/profile" element={guard(<MyProfile />)} />
        <Route path="/admin" element={guard(<Admin />, true)} />
        <Route path="/checkout/complete" element={guard(<CheckoutComplete />)} />
        <Route path="*" element={<Landing />} />
      </Route>
    </Routes>
  );
};

export default function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <AppRouter />
          <Toaster theme="dark" position="top-center" richColors />
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}
