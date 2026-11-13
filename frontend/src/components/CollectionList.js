import { Trash2 } from "lucide-react";

export const CATEGORIES = [
  { key: "board", label: "Board games", cls: "text-mb-red" },
  { key: "card", label: "Card games", cls: "text-mb-blue" },
  { key: "digital", label: "Digital", cls: "text-mb-orange" },
];

export const CollectionList = ({ items, category, onDelete }) => {
  if (!items.length) return <p data-testid={`collection-empty-${category}`} className="py-8 text-center text-sm text-slate-500">Nothing here yet.</p>;
  const groups = category === "digital"
    ? Object.entries(items.reduce((a, i) => ({ ...a, [i.platform]: [...(a[i.platform] || []), i] }), {}))
    : [["", items]];
  return (
    <div className="space-y-5">
      {groups.map(([platform, list]) => (
        <div key={platform}>
          {platform && <div className="eyebrow mb-2 text-mb-orange">{platform}</div>}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((i) => (
              <div key={i.id} data-testid={`collection-item-${i.id}`} className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#0B0F19]/60 px-3 py-2.5">
                <span className="flex-1 truncate font-semibold">{i.title}</span>
                {onDelete && (
                  <button data-testid={`collection-delete-${i.id}`} onClick={() => onDelete(i.id)} className="text-slate-500 hover:text-mb-red" aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
