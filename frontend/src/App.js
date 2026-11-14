import "@/App.css";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/context/AuthContext";
import { Layout } from "@/components/Layout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
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
