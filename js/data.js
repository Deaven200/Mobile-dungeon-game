/* ===================== DATA ===================== */

const POTIONS = [
  { name: "Health Potion", effect: "fullHeal", value: 1, symbol: "P", color: "#ff3b3b" },
  { name: "Strength Potion", effect: "damageBoost", value: 1, symbol: "P", color: "#ffe600" },
  { name: "Toughness Potion", effect: "toughnessBoost", value: 1, symbol: "P", color: "#cfcfcf" },
  { name: "Speed Potion", effect: "speed", value: 3, symbol: "P", color: "#00ffff", turns: 10 },
  { name: "Invisibility Potion", effect: "invisibility", value: 1, symbol: "P", color: "#8888ff", turns: 5 },
  { name: "Explosive Potion", effect: "explosive", value: 3, symbol: "P", color: "#ff8800" },
];

const RARITIES = [
  { id: "trash", label: "Trash", color: "#9e9e9e", bonus: 0, weight: 52 },
  { id: "common", label: "Common", color: "#cfd8dc", bonus: 1, weight: 28 },
  { id: "uncommon", label: "Uncommon", color: "#4caf50", bonus: 2, weight: 14 },
  { id: "rare", label: "Rare", color: "#2196f3", bonus: 3, weight: 5 },
  { id: "legendary", label: "Legendary", color: "#ff9800", bonus: 5, weight: 1 },
];

function pickRarityForFloor(f) {
  // Better odds deeper, but level will still dominate damage.
  const floorNum = Math.max(1, Number(f || 1));
  const bump = Math.min(12, Math.floor(floorNum / 6)); // slowly increases rare odds
  const pool = RARITIES.map((r) => {
    const w = Number(r.weight || 0);
    const rareBoost = (r.id === "rare" ? bump * 0.4 : r.id === "legendary" ? bump * 0.2 : 0);
    const trashDrop = r.id === "trash" ? bump * 1.0 : 0;
    return { ...r, w: Math.max(0, Math.floor(w + rareBoost - trashDrop)) };
  }).filter((r) => r.w > 0);
  const total = pool.reduce((a, r) => a + r.w, 0);
  let roll = rand(1, Math.max(1, total));
  for (const r of pool) {
    roll -= r.w;
    if (roll <= 0) return r;
  }
  return pool[0] || RARITIES[0];
}

function calcWeaponMaxDamage(level, rarityId) {
  const lvl = Math.max(1, Math.floor(Number(level || 1)));
  const rar = (Array.isArray(RARITIES) ? RARITIES.find((r) => r.id === rarityId) : null) || RARITIES[0];
  // Level is the base damage; rarity adds a small bonus.
  return Math.max(1, lvl + Math.max(0, Number(rar.bonus || 0)));
}

function makeSword(level, rarity = null) {
  const rar = rarity || pickRarityForFloor(level);
  const lvl = Math.max(1, Math.floor(Number(level || 1)));
  const maxDmg = calcWeaponMaxDamage(lvl, rar.id);
  return {
    name: `${rar.label} Sword +${lvl}`,
    effect: "weapon",
    weaponType: "sword",
    slot: "hand",
    rarity: rar.id,
    level: lvl,
    maxDamage: maxDmg,
    symbol: "/",
    color: rar.color,
  };
}

// Valuables: can’t be used in-dungeon; meant to be sold after you extract.
// Keep the symbols ASCII so monospace rendering stays consistent.
const VALUABLES = [
  { name: "Coin Pouch", effect: "valuable", value: 30, symbol: "*", color: "#ffd700" },
  { name: "Silver Ring", effect: "valuable", value: 55, symbol: "*", color: "#cfd8dc" },
  { name: "Jeweled Goblet", effect: "valuable", value: 90, symbol: "*", color: "#7fffd4" },
  { name: "Ancient Relic", effect: "valuable", value: 140, symbol: "*", color: "#ff8c00" },
  { name: "Royal Gem", effect: "valuable", value: 220, symbol: "*", color: "#ff66ff" },
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
