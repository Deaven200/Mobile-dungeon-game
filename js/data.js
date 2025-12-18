/* ===================== DATA ===================== */

const POTIONS = [
  { name: "Health Potion", effect: "fullHeal", value: 1, symbol: "P", color: "#ff3b3b" },
  { name: "Strength Potion", effect: "damageBoost", value: 1, symbol: "P", color: "#ffe600" },
  { name: "Toughness Potion", effect: "toughnessBoost", value: 1, symbol: "P", color: "#cfcfcf" },
  { name: "Speed Potion", effect: "speed", value: 3, symbol: "P", color: "#00ffff", turns: 10 },
  { name: "Invisibility Potion", effect: "invisibility", value: 1, symbol: "P", color: "#8888ff", turns: 5 },
  { name: "Explosive Potion", effect: "explosive", value: 3, symbol: "P", color: "#ff8800" },
];

// Rarity is an OUTLINE + a MULTIPLIER.
// Level is the base scaling axis; rarity multiplies stats/value.
const RARITIES = [
  { id: "trash", label: "Trash", outline: "#8e8e8e", mult: 0.8, weight: 52 },
  { id: "common", label: "Common", outline: "#cfd8dc", mult: 1.0, weight: 28 },
  { id: "uncommon", label: "Uncommon", outline: "#4caf50", mult: 2.0, weight: 14 },
  { id: "rare", label: "Rare", outline: "#2196f3", mult: 3.5, weight: 5 },
  { id: "epic", label: "Epic", outline: "#b400ff", mult: 5.0, weight: 2 },
  { id: "legendary", label: "Legendary", outline: "#ff9800", mult: 7.0, weight: 1 },
];

function getRarity(rarityId) {
  return (Array.isArray(RARITIES) ? RARITIES.find((r) => r.id === rarityId) : null) || RARITIES[1] || RARITIES[0];
}

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
  const rar = getRarity(rarityId);
  // Level is the base damage; rarity multiplies it.
  const mult = Math.max(0.1, Number(rar.mult || 1));
  return Math.max(1, Math.floor(lvl * mult));
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
    // Base item color (rarity is shown via outline).
    color: "#e6e6e6",
  };
}

// Valuables: can’t be used in-dungeon; meant to be sold after you extract.
// Keep the symbols ASCII so monospace rendering stays consistent.
const VALUABLES = [
  { name: "Coin Pouch", effect: "valuable", baseValue: 30, symbol: "*", color: "#ffd700" },
  { name: "Silver Ring", effect: "valuable", baseValue: 55, symbol: "*", color: "#cfd8dc" },
  { name: "Jeweled Goblet", effect: "valuable", baseValue: 90, symbol: "*", color: "#7fffd4" },
  { name: "Ancient Relic", effect: "valuable", baseValue: 140, symbol: "*", color: "#ff8c00" },
  { name: "Royal Gem", effect: "valuable", baseValue: 220, symbol: "*", color: "#ff66ff" },
];

function calcValuableValue(baseValue, rarityId) {
  const base = Math.max(1, Math.floor(Number(baseValue || 1)));
  const rar = getRarity(rarityId);
  const mult = Math.max(0.1, Number(rar.mult || 1));
  return Math.max(1, Math.floor(base * mult));
}

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

// Materials (stack in inventory)
const MATERIALS = [
  { name: "Iron Ore", effect: "material", matId: "iron", qty: 1, symbol: "m", color: "#b0bec5" },
  { name: "Leather Strip", effect: "material", matId: "leather", qty: 1, symbol: "m", color: "#c49a6c" },
  { name: "Arcane Dust", effect: "material", matId: "essence", qty: 1, symbol: "m", color: "#c77dff" },
];

// Trinkets (equip 2; passive bonuses live on the item)
const TRINKETS = [
  {
    name: "Lucky Charm",
    effect: "trinket",
    trinketId: "lucky_charm",
    rarity: "uncommon",
    symbol: "t",
    color: "#00ffff",
    desc: "+10% loot chance",
    bonuses: { lootMult: 0.1 },
    weight: 1,
  },
  {
    name: "Sturdy Band",
    effect: "trinket",
    trinketId: "sturdy_band",
    rarity: "uncommon",
    symbol: "t",
    color: "#cfd8dc",
    desc: "+1 toughness",
    bonuses: { toughness: 1 },
    weight: 1,
  },
  {
    name: "Sharpened Sigil",
    effect: "trinket",
    trinketId: "sharpened_sigil",
    rarity: "rare",
    symbol: "t",
    color: "#ffeb3b",
    desc: "+5% crit chance",
    bonuses: { critChance: 0.05 },
    weight: 1,
  },
  {
    name: "Bloodstone",
    effect: "trinket",
    trinketId: "bloodstone",
    rarity: "rare",
    symbol: "t",
    color: "#ff3366",
    desc: "Heal 0.25 on kill",
    bonuses: { lifeOnKill: 0.25 },
    weight: 1,
  },

  // ===== Build-defining trinkets (new) =====
  {
    name: "Vampiric Tooth",
    effect: "trinket",
    trinketId: "vampiric_tooth",
    rarity: "rare",
    symbol: "t",
    color: "#ff4d6d",
    desc: "Life steal: heal 18% of damage dealt",
    bonuses: { lifeSteal: 0.18 },
    weight: 0.75,
  },
  {
    name: "Thorn Token",
    effect: "trinket",
    trinketId: "thorn_token",
    rarity: "uncommon",
    symbol: "t",
    color: "#7CFC00",
    desc: "Thorns: reflect 1 damage on hit",
    bonuses: { thorns: 1 },
    weight: 0.9,
  },
  {
    name: "Shadow Anklet",
    effect: "trinket",
    trinketId: "shadow_anklet",
    rarity: "rare",
    symbol: "t",
    color: "#9aa0ff",
    desc: "Dodge: 12% chance to avoid melee hits",
    bonuses: { dodgeChance: 0.12 },
    weight: 0.75,
  },
  {
    name: "Force Bracer",
    effect: "trinket",
    trinketId: "force_bracer",
    rarity: "rare",
    symbol: "t",
    color: "#00e5ff",
    desc: "Knockback: 35% chance to shove enemies (slam +1)",
    bonuses: { knockbackChance: 0.35, knockbackDmg: 1 },
    weight: 0.7,
  },

  // ===== Cursed trinkets (big upside + drawback until cleansed) =====
  {
    name: "Cursed Glass Idol",
    effect: "trinket",
    trinketId: "cursed_glass_idol",
    rarity: "epic",
    symbol: "t",
    color: "#ff66ff",
    desc: "+15% crit, +2 dmg. Curse: you take +25% damage (cleanse at a shrine).",
    bonuses: { critChance: 0.15, dmg: 2 },
    curse: { dmgTakenMult: 1.25 },
    cursed: true,
    weight: 0.25,
  },
  {
    name: "Cursed Famine Locket",
    effect: "trinket",
    trinketId: "cursed_famine_locket",
    rarity: "rare",
    symbol: "t",
    color: "#ffd166",
    desc: "+35% loot. Curse: hunger drains 35% faster (cleanse at a shrine).",
    bonuses: { lootMult: 0.35 },
    curse: { hungerCostMult: 1.35 },
    cursed: true,
    weight: 0.35,
  },
];

// Brighter colors for readability
const RAT = { hp: 3, dmg: 1, color: "#bdbdbd", sight: 4, symbol: "r", name: "Rat" };
const GOBLIN = { hp: 6, dmg: 3, color: "#00ff3a", sight: 5, symbol: "g", name: "Goblin" };
const BAT = { hp: 2, dmg: 1, color: "#a055a0", sight: 5, symbol: "b", name: "Bat", speed: 2, flying: true };
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
