export const FAVOURITE_GAMES = [
  { name: "Flip 7", sub: "With a Vengeance · Custom Combo Deck", kind: "card", q: "flip 7", imgs: ["/games/flip7.png", "/games/flip7-v.png"] },
  { name: "Love Letter", sub: "", kind: "card", img: "/games/ll.png" },
  { name: "Tacta", sub: "Promotional Edition", kind: "card", imgs: ["/games/tacta.png", "/games/tacta-p.png"] },
  { name: "Star Realms", sub: "", kind: "card", img: "/games/sr.png" },
  { name: "Shards of Infinity", sub: "Saga Collection", kind: "card", img: "/games/soi-sc.png" },
  { name: "Project L", sub: "All In KSE", kind: "board", img: "/games/pl-kse.png?v=2" },
  { name: "Dominion", sub: "Intrigue · Prosperity · Hinterlands · Renaissance", kind: "card", imgs: ["/games/dominion.png", "/games/dominion-i.png", "/games/dominion-p.png", "/games/dominion-h.png", "/games/dominion-r.png"] },
  { name: "Nexus Ops", sub: "Renegade Studios", kind: "board", img: "/games/nops.png" },
  { name: "King of Tokyo", sub: "Godzilla · New York · Monster Island + expansions", kind: "board", q: "king of", imgs: ["/games/kot-g.png", "/games/kot-mb.png", "/games/komi.png"] },
  { name: "Soloverse", sub: "Our very own printed game", kind: "original", img: "/games/soloverse.png" },
  { name: "Castles of Caleira", sub: "", kind: "board", img: "/games/coc.png" },
  { name: "Ticket to Ride", sub: "", kind: "board", img: "/games/tor.png" },
  { name: "Catan", sub: "", kind: "board", img: "/games/catan.png" },
  { name: "Stardew Valley", sub: "", kind: "digital", img: "/games/sv.png" },
  { name: "Survive the Island", sub: "Monster Pack · BFF", kind: "board", imgs: ["/games/sti.png", "/games/sti-mp.png"] },
  { name: "Jackbox Party Packs", sub: "", kind: "digital", q: "jackbox", img: "/games/jackbox.png" },
  { name: "12 Rivers", sub: "", kind: "board", img: "/games/12r.png" },
  { name: "Splendor", sub: "Marvel Splendor", kind: "board", q: "splendor", img: "/games/ms.png" },
  { name: "Brawlhalla", sub: "", kind: "digital", img: "/games/brawlhalla.png" },
  { name: "Super Smash Bros. Ultimate", sub: "", kind: "digital", q: "smash", img: "/games/ssbrosu.png" },
  { name: "Star Wars: The Deckbuilding Game", sub: "Clone Wars · Mandalorian Faction", kind: "card", q: "Star Wars: The Deckbuilding Game", imgs: ["/games/sw-dbg.png", "/games/sw-dbg-cw.png", "/games/sw-dbg-mf.png"] },
];

export const KIND_LABEL = { card: "Card game", board: "Board game", digital: "Video game", original: "Group original" };
export const ACCENTS = ["#FF3B5C", "#00E5FF", "#FF8C00"];

export const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export const PLATFORMS = ["PC / Steam", "Nintendo Switch", "PlayStation", "Xbox", "Mobile", "Other"];
