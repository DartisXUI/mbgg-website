import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { http, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PLATFORMS } from "@/data/games";
import { CATEGORIES, CollectionList } from "@/components/CollectionList";

const ProfileForm = () => {
  const { user, setUser } = useAuth();
  const [f, setF] = useState({ name: user.name, player_tag: user.player_tag || "", bio: user.bio || "" });
  const save = async (e) => {
    e.preventDefault();
    try {
      const { data } = await http.patch("/me/profile", f);
      setUser(data);
      toast.success("Profile saved");
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  return (
    <form onSubmit={save} className="panel panel-blue space-y-4">
      <h2 className="font-display text-2xl font-extrabold uppercase">Profile</h2>
      <div className="space-y-1.5"><Label htmlFor="pf-name">Display name</Label><Input id="pf-name" data-testid="profile-name-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="h-11 bg-[#0B0F19]" required /></div>
      <div className="space-y-1.5"><Label htmlFor="pf-tag">Default player ID</Label><Input id="pf-tag" data-testid="profile-tag-input" value={f.player_tag} maxLength={40} onChange={(e) => setF({ ...f, player_tag: e.target.value })} className="h-11 bg-[#0B0F19]" /></div>
      <div className="space-y-1.5"><Label htmlFor="pf-bio">Bio</Label><Textarea id="pf-bio" data-testid="profile-bio-input" value={f.bio} maxLength={300} onChange={(e) => setF({ ...f, bio: e.target.value })} className="bg-[#0B0F19]" /></div>
      <button data-testid="profile-save-button" className="btn-blue w-full">Save profile</button>
    </form>
  );
};

const AddItem = ({ category, onAdded }) => {
  const [title, setTitle] = useState("");
  const [platform, setPlatform] = useState("");
  const add = async (e) => {
    e.preventDefault();
    try {
      await http.post("/me/collection", { category, title, platform });
      setTitle("");
      onAdded();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  return (
    <form onSubmit={add} className="flex flex-col gap-2 sm:flex-row">
      <Input data-testid={`collection-title-input-${category}`} required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Game title" className="h-11 bg-[#0B0F19]" />
      {category === "digital" && (
        <Select value={platform} onValueChange={setPlatform}>
          <SelectTrigger data-testid="collection-platform-select" className="h-11 bg-[#0B0F19] sm:w-48"><SelectValue placeholder="Platform" /></SelectTrigger>
          <SelectContent>{PLATFORMS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
        </Select>
      )}
      <button data-testid={`collection-add-button-${category}`} className="btn-orange shrink-0">Add</button>
    </form>
  );
};

export default function MyProfile() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const load = useCallback(() => http.get("/me/collection").then((r) => setItems(r.data)), []);
  useEffect(() => {
    load();
  }, [load]);
  const del = async (id) => {
    await http.delete(`/me/collection/${id}`).catch((e) => toast.error(errMsg(e)));
    load();
  };
  return (
    <div data-testid="my-profile-page" className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex-1">
          <div className="eyebrow">Shown publicly to everyone on the site</div>
          <h1 className="font-display text-4xl font-black uppercase sm:text-5xl">My collection</h1>
        </div>
        <Link to={`/u/${user.user_id}`} data-testid="my-public-page-link" className="btn-ghost">View public page</Link>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <ProfileForm />
        <div className="panel panel-orange">
          <Tabs defaultValue="board">
            <TabsList className="bg-[#0B0F19]">
              {CATEGORIES.map((c) => <TabsTrigger key={c.key} value={c.key} data-testid={`collection-tab-${c.key}`}>{c.label}</TabsTrigger>)}
            </TabsList>
            {CATEGORIES.map((c) => (
              <TabsContent key={c.key} value={c.key} className="space-y-4 pt-4">
                <AddItem category={c.key} onAdded={load} />
                <CollectionList items={items.filter((i) => i.category === c.key)} category={c.key} onDelete={del} />
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </div>
    </div>
  );
}
