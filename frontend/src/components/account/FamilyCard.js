import { useState } from "react";
import { Baby, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { http, errMsg } from "@/lib/api";

export const FamilyCard = ({ data, reload }) => {
  const [name, setName] = useState("");
  const [year, setYear] = useState("");
  const family = data.user.family || [];
  const add = async (e) => {
    e.preventDefault();
    try {
      await http.post("/me/family", { name, birth_year: Number(year) });
      setName("");
      setYear("");
      reload();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  const del = async (id) => {
    await http.delete(`/me/family/${id}`).catch((e) => toast.error(errMsg(e)));
    reload();
  };
  const thisYear = new Date().getFullYear();
  return (
    <div data-testid="family-card" className="panel panel-blue">
      <div className="eyebrow text-mb-blue">Family</div>
      <h3 className="mt-2 flex items-center gap-2 font-display text-2xl font-extrabold uppercase"><Baby className="h-6 w-6 text-mb-blue" /> Kids under 15 with me</h3>
      <p className="mt-1 text-sm text-slate-400">Under-15s come in free with you. Check them in from your check-in card. They don't need their own login.</p>
      <ul className="mt-4 space-y-2">
        {family.map((f) => (
          <li key={f.id} data-testid={`family-member-${f.id}`} className="flex items-center gap-3 rounded-lg border border-white/10 bg-[#0B0F19]/60 px-3 py-2.5">
            <span className="flex-1 font-semibold">{f.name}</span>
            <span className="text-xs text-slate-500">born {f.birth_year}{thisYear - f.birth_year > 14 ? " · now 15+, needs own account" : ""}</span>
            <button data-testid={`family-delete-${f.id}`} onClick={() => del(f.id)} aria-label="Remove" className="text-slate-500 hover:text-mb-red"><Trash2 className="h-4 w-4" /></button>
          </li>
        ))}
        {!family.length && <li className="text-sm text-slate-500">No family members added.</li>}
      </ul>
      <form onSubmit={add} className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Input data-testid="family-name-input" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="h-11 bg-[#0B0F19]" />
        <Input data-testid="family-birth-year-input" required type="number" min={thisYear - 14} max={thisYear} value={year} onChange={(e) => setYear(e.target.value)} placeholder="Birth year" className="h-11 bg-[#0B0F19] sm:w-32" />
        <button data-testid="family-add-button" className="btn-blue shrink-0">Add</button>
      </form>
    </div>
  );
};
