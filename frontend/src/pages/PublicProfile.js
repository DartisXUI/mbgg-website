import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { BadgeCheck } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { http } from "@/lib/api";
import { Loader } from "@/components/ProtectedRoute";
import { CATEGORIES, CollectionList } from "@/components/CollectionList";

export default function PublicProfile() {
  const { userId } = useParams();
  const [p, setP] = useState(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    http.get(`/members/${userId}`).then((r) => setP(r.data)).catch(() => setMissing(true));
  }, [userId]);
  if (missing) return <div data-testid="profile-not-found" className="panel text-center">Member not found.</div>;
  if (!p) return <Loader />;
  const stats = [["Games logged (365d)", p.stats.games_logged], ["Wins", p.stats.wins], ["Favourite", p.stats.favourite_game || "—"]];
  return (
    <div data-testid="public-profile-page" className="space-y-6">
      <div className="panel flex flex-col items-start gap-5 sm:flex-row sm:items-center">
        <img src={p.picture || "/brand/round.png"} alt="" className="h-24 w-24 rounded-full border-2 border-[var(--mb-blue)] object-cover" />
        <div className="flex-1">
          <div className="eyebrow">{p.role !== "member" ? p.role : p.is_subscriber ? "Subscriber" : "Member"}{p.player_tag ? ` · ${p.player_tag}` : ""}</div>
          <h1 data-testid="profile-name" className="flex items-center gap-2 font-display text-4xl font-black uppercase sm:text-5xl">
            {p.name} {p.is_subscriber && <BadgeCheck data-testid="profile-subscriber-badge" className="h-7 w-7 text-mb-orange" />}
          </h1>
          {p.bio && <p className="mt-1 text-slate-300">{p.bio}</p>}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {stats.map(([k, v], i) => (
          <div key={k} className="panel !p-4">
            <div className="eyebrow">{k}</div>
            <div className={`truncate font-display text-3xl font-black ${["text-mb-red", "text-mb-blue", "text-mb-orange"][i]}`}>{v}</div>
          </div>
        ))}
      </div>
      <div className="panel">
        <h2 className="font-display text-2xl font-extrabold uppercase">Game collection</h2>
        <Tabs defaultValue="board" className="mt-4">
          <TabsList className="bg-[#0B0F19]">
            {CATEGORIES.map((c) => <TabsTrigger key={c.key} value={c.key} data-testid={`profile-collection-tab-${c.key}`}>{c.label} ({p.collection[c.key].length})</TabsTrigger>)}
          </TabsList>
          {CATEGORIES.map((c) => (
            <TabsContent key={c.key} value={c.key} className="pt-4"><CollectionList items={p.collection[c.key]} category={c.key} /></TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}
