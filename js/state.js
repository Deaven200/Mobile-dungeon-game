/* ===================== STATE ===================== */

let floor = 1;
let menuOpen = false;
let activeTab = "inventory";
// In-menu UI state (not saved; purely presentation).
let menuInvFilter = "all"; // all | weapons | trinkets | consumables | materials | valuables
let menuSelectedInvIid = null; // item iid (string) for inventory details pane
let menuInvAssignOpen = false; // whether "assign to hotbar" submenu is expanded
// Codex UI state (not saved; purely presentation).
let menuCodexSection = "items"; // enemies | items | trinkets | materials | statuses
let menuCodexSort = "name"; // name | count
let menuCodexSelectedKey = null; // string key in current section
let gamePaused = false;
let investigateArmed = false;
let cookingAtCampfire = false;
let atShop = false;
let atBlacksmith = false;
let atBountyBoard = false;
let atShrine = false;
let shrineKey = null; // keyOf(x,y) for the active shrine interaction
let inMainMenu = true;
let gameStarted = false;
// Seeded RNG so "true saves" can restore deterministically.
let runSeed = 0;
let rngState = 0;
let settings = {
  showDamageNumbers: true,
  showEnemyHealth: true,
  soundEnabled: false,
  autoSave: true,
  haptics: true,
  confirmDescend: true,
  permadeath: true,
  // Combat feedback
  screenShake: true,
  screenShakeIntensity: 1, // 0.5..2
  hitFlash: true,
  // Difficulty
  difficultyPreset: "normal", // easy | normal | hard
  enemyHpMult: 1,
  enemyDmgMult: 1,
  lootMult: 1,
  hazardMult: 1,
  propDensity: 1,
  // Accessibility
  largeText: false,
  highContrast: false,
  reducedMotion: false,
  reducedFlashing: false,
  diagonalMelee: true,
};
let floorStats = { enemiesKilled: 0, itemsFound: 0, trapsTriggered: 0, damageTaken: 0, damageDealt: 0 };
let hiddenTrapCount = 0;

// Run-wide totals (reset each new run/dive).
let runStats = {
  startedAt: 0,
  endedAt: 0,
  floorsReached: 0,
  enemiesKilled: 0,
  itemsFound: 0,
  trapsTriggered: 0,
  damageDealt: 0,
  damageTaken: 0,
  goldEarned: 0,
  propsDestroyed: 0,
  bestWeaponName: "",
  bestWeaponScore: 0,
};

// Last damage source for death card.
let lastDamageSource = null; // { kind, name, amount, floor, time, extra? }

// Sight model:
// - FULL_SIGHT_RADIUS: you can see everything (enemies, items, traps, etc.)
// - TERRAIN_ONLY_EXTRA_RADIUS: extra ring where you can only see walls/floors (no enemies/items/traps)
const FULL_SIGHT_RADIUS = 6;
const TERRAIN_ONLY_EXTRA_RADIUS = 3;
const BASE_VIEW_RADIUS = FULL_SIGHT_RADIUS + TERRAIN_ONLY_EXTRA_RADIUS;
const MIN_VIEW_RADIUS = 5;
const MAX_VIEW_RADIUS = 25;
const LOG_LIFETIME = 3000;
const HIDDEN_TRAP_FLASH_PERIOD_MS = 3000;
const HIDDEN_TRAP_FLASH_PULSE_MS = 350;

// Game balance constants
const HUNGER_COST_MOVE = 0.015; // Increased from 0.01
const HUNGER_COST_ATTACK = 0.05;
const HUNGER_COST_REGEN = 0.03; // Increased from 0.02
const HP_REGEN_AMOUNT = 0.08; // Reduced from 0.1
const MAX_DAMAGE_NUMBERS = 20;

let logHistory = [];
let liveLogs = [];

// Fog-of-war: tiles you've seen stay visible (terrain only) when zoomed out.
let explored = new Set(); // Set<string> of "x,y"
let visibleNow = new Set(); // Set<string> of "x,y" currently visible (line-of-sight)

// Pinch zoom: changes how many tiles are drawn (zoom out => more tiles).
let zoomScale = 1;
const touchPointers = new Map(); // pointerId -> {x,y}
let pinch = { active: false, startDist: 0, startZoom: 1 };

let player = {
  x: 0,
  y: 0,
  hp: 10,
  maxHp: 10,
  // Unarmed base is always 0-2; dmg is a bonus applied to unarmed and weapons.
  dmg: 0,
  toughness: 0,
  inventory: [],
  maxInventory: 10,
  hands: { main: null, off: null },
  // 4-slot quick hotbar (stores item IDs (iid) that point into inventory items).
  hotbar: [null, null, null, null],
  // 2 trinket slots (stores equipped trinket item objects).
  trinkets: { a: null, b: null },
  // Codex discovery tracking.
  codex: { enemies: {}, items: {}, trinkets: {}, materials: {}, statuses: {} },
  // Inventory UI preferences.
  inventorySort: "type",
  hunger: 10,
  maxHunger: 10,
  kills: 0,
  combo: 0,
  score: 0,
  gold: 0,
  gear: { weapon: 0, armor: 0, pack: 0 },
  statusEffects: {},
};

let map = {};
let rooms = [];
let enemies = [];
let hiddenArea = null; // { revealed, tiles:Set<string>, falseWalls:Set<string>, mouseFlashUntil:number }
let mouse = null; // { x, y }
let autoMove = { timerId: null, path: [], attackTarget: null, mode: null };
let damageNumbers = []; // { x, y, value, type, time }
let lastTarget = null; // { name, hp, maxHp, x, y, time }

const gameEl = document.getElementById("game");
const controlsEl = document.getElementById("controls");
const mapContainerEl = document.getElementById("mapContainer");
const investigateBtnEl = document.getElementById("investigateBtn");
