import axios from "axios";
import { toast } from "sonner";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
export const http = axios.create({ baseURL: API, withCredentials: true });

export const errMsg = (e) => {
  const d = e?.response?.data?.detail;
  if (Array.isArray(d)) return d.map((x) => x.msg).join(", ");
  return d || e?.message || "Something went wrong";
};

export const adelaideToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Adelaide" });
// evening sessions run past midnight: before 5am counts as the previous day's session
export const sessionDate = () => {
  const hour = Number(new Date().toLocaleString("en-AU", { timeZone: "Australia/Adelaide", hour: "numeric", hourCycle: "h23" }));
  return hour < 5 ? new Date(Date.now() - 6 * 3600 * 1000).toLocaleDateString("en-CA", { timeZone: "Australia/Adelaide" }) : adelaideToday();
};
export const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

export const money = (cents) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

export async function startCheckout(product, extra = {}) {
  try {
    const { data } = await http.post("/payments/checkout", { product, ...extra });
    window.location.assign(data.checkout_url);
    return true;
  } catch (e) {
    toast.error(errMsg(e));
    return false;
  }
}
