export const FAVOURITE_GAMES = [
  { name: "Flip 7", sub: "With a Vengeance · Custom Combo Deck", kind: "card" },
  { name: "Love Letter", sub: "", kind: "card", img: "/games/ll.webp" },
  { name: "Tacta", sub: "", kind: "board", img: "/games/tacta.webp" },
  { name: "Star Realms", sub: "", kind: "card", img: "/games/sr.webp" },
  { name: "Shards of Infinity", sub: "Saga Collection", kind: "card", img: "/games/soi-sc.webp" },
  { name: "Project L", sub: "All In KSE", kind: "board", img: "/games/pl-kse.webp" },
  { name: "Dominion", sub: "", kind: "card", img: "/games/dominion.webp" },
  { name: "Nexus Ops", sub: "Renegade Studios", kind: "board", img: "/games/nops.webp" },
  { name: "King of Tokyo", sub: "Godzilla · New York · Monster Island + expansions", kind: "board", imgs: ["/games/kot-g.webp", "/games/kot-mb.webp", "/games/komi.webp"] },
  { name: "Soloverse", sub: "Our very own printed game", kind: "original", logo: "/brand/soloverse.png" },
  { name: "Castles of Caleira", sub: "", kind: "board", img: "/games/coc.webp" },
  { name: "Ticket to Ride", sub: "", kind: "board", img: "/games/tor.webp" },
  { name: "Catan", sub: "", kind: "board", img: "/games/catan.webp" },
  { name: "Stardew Valley", sub: "", kind: "digital", img: "/games/sv.webp" },
  { name: "Survive the Island", sub: "Monster Pack · BFF", kind: "board", img: "/games/sti.webp" },
  { name: "Jackbox Party Packs", sub: "", kind: "digital", img: "/games/jackbox.webp" },
  { name: "12 Rivers", sub: "", kind: "board", img: "/games/12r.webp" },
  { name: "Splendor", sub: "Marvel Splendor", kind: "board", img: "/games/ms.webp" },
  { name: "Brawlhalla", sub: "", kind: "digital", img: "/games/brawlhalla.webp" },
  { name: "Mario Kart", sub: "", kind: "digital" },
  { name: "Super Smash Bros. Ultimate", sub: "", kind: "digital", img: "/games/ssbrosu.webp" },
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
