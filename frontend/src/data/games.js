export const FAVOURITE_GAMES = [
  { name: "Flip 7", sub: "With a Vengeance · Custom Combo Deck", kind: "card" },
  { name: "Love Letter", sub: "", kind: "card" },
  { name: "Tacta", sub: "", kind: "board" },
  { name: "Star Realms", sub: "", kind: "card" },
  { name: "Shards of Infinity", sub: "Saga Collection", kind: "card" },
  { name: "Project L", sub: "All In KSE", kind: "board" },
  { name: "Dominion", sub: "", kind: "card" },
  { name: "Nexus Ops", sub: "Renegade Studios", kind: "board" },
  { name: "King of Tokyo", sub: "Godzilla · New York · Monster Island + expansions", kind: "board" },
  { name: "Soloverse", sub: "Our very own printed game", kind: "original", logo: "/brand/soloverse.png" },
  { name: "Castles of Caleira", sub: "", kind: "board" },
  { name: "Ticket to Ride", sub: "", kind: "board" },
  { name: "Catan", sub: "", kind: "board" },
  { name: "Stardew Valley", sub: "", kind: "digital" },
  { name: "Survive the Island", sub: "Monster Pack · BFF", kind: "board" },
  { name: "Jackbox Party Packs", sub: "", kind: "digital" },
  { name: "12 Rivers", sub: "", kind: "board" },
  { name: "Splendor", sub: "Marvel Splendor", kind: "board" },
  { name: "Brawlhalla", sub: "", kind: "digital" },
  { name: "Mario Kart", sub: "", kind: "digital" },
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
