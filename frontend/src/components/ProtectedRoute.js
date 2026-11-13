import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

export const Loader = () => (
  <div data-testid="page-loader" className="flex justify-center py-24">
    <img src="/brand/round.png" alt="Loading" className="h-16 w-16 animate-spin rounded-full [animation-duration:2.5s]" />
  </div>
);

export const ProtectedRoute = ({ children, staff = false }) => {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Loader />;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (staff && !["host", "admin"].includes(user.role)) return <Navigate to="/account" replace />;
  return children;
};
