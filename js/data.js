/* ===================== DATA ===================== */

const POTIONS = [
  { name: "Health Potion", effect: "fullHeal", value: 1, symbol: "P", color: "#ff3b3b" },
  { name: "Strength Potion", effect: "damageBoost", value: 1, symbol: "P", color: "#ffe600" },
  { name: "Toughness Potion", effect: "toughnessBoost", value: 1, symbol: "P", color: "#cfcfcf" },
  { name: "Speed Potion", effect: "speed", value: 3, symbol: "P", color: "#00ffff", turns: 10 },
  { name: "Invisibility Potion", effect: "invisibility", value: 1, symbol: "P", color: "#8888ff", turns: 5 },
  { name: "Explosive Potion", effect: "explosive", value: 3, symbol: "P", color: "#ff8800" },
];

const RAT_MEAT = { name: "Rat Meat", effect: "food", hunger: 2, heal: 0, symbol: "M", color: "#ff7aa0", cooked: false };
const COOKED_RAT_MEAT = {
  name: "Cooked Rat Meat",
  effect: "food",
  hunger: 5,
  heal: 0,
  symbol: "M",
  color: "#ffb65c",
  cooked: true,
};
// Food symbols avoid overlapping common entity glyphs (mouse/enemies).
const MUSHROOM = { name: "Mushroom", effect: "food", hunger: 1, heal: 1, symbol: "f", color: "#cc88cc", cooked: false };
const BERRY = { name: "Berry", effect: "food", hunger: 1, heal: 0, symbol: "y", color: "#ff4477", cooked: false };

// Brighter colors for readability
const RAT = { hp: 3, dmg: 1, color: "#bdbdbd", sight: 4, symbol: "r", name: "Rat" };
const GOBLIN = { hp: 6, dmg: 3, color: "#00ff3a", sight: 5, symbol: "g", name: "Goblin" };
const BAT = { hp: 2, dmg: 1, color: "#a055a0", sight: 5, symbol: "b", name: "Bat", speed: 2 };
const SKELETON = { hp: 8, dmg: 2, color: "#ffffff", sight: 4, symbol: "s", name: "Skeleton" };
const ORC = { hp: 12, dmg: 4, color: "#8b4513", sight: 3, symbol: "o", name: "Orc", toughness: 1 };

const ENEMY_TYPES = [
  { hp: 1, dmg: 1, color: "red", sight: 3 },
  { hp: 2, dmg: 2, color: "green", sight: 4 },
  { hp: 3, dmg: 2, color: "blue", sight: 5 },
  { hp: 4, dmg: 3, color: "purple", sight: 6 },
];

const TRAP_TYPES = [
  { type: "fire", color: "orange", dmg: 2, status: { kind: "burning", turns: 3, dmgPerTurn: 1 } },
  { type: "poison", color: "lime", dmg: 1 },
  { type: "spike", color: "silver", dmg: 1 },
  { type: "shock", color: "yellow", dmg: 2 },
];

// ===================== EXTRACTION CONCEPT (WIP) =====================
// Simple pools for the recruiter intro. These are intentionally small and readable.
const NAMES = [
  "Arin",
  "Bex",
  "Cora",
  "Dain",
  "Edda",
  "Fen",
  "Jori",
  "Kiva",
  "Lorn",
  "Mira",
  "Nox",
  "Orin",
];

// Talents are not yet wired into balance; we store the selection for later.
const TALENTS = [
  { id: "packrat", label: "Pack Rat", desc: "+2 inventory slots (later)" },
  { id: "tough", label: "Tough", desc: "+10% max HP (later)" },
  { id: "quick", label: "Quick", desc: "+10% move speed (later)" },
  { id: "scavenger", label: "Scavenger", desc: "+10% valuables (later)" },
  { id: "quiet", label: "Quiet Steps", desc: "-10% noise/heat (later)" },
];
