/* ===================== HELPERS ===================== */

// Tiny synth sounds (no external audio files).
let audioState = { ctx: null, lastPlayAt: 0 };
let lastStarveLogAt = 0;

function applyAccessibilitySettings() {
  try {
    document.body.classList.toggle("high-contrast", !!settings?.highContrast);
    document.body.classList.toggle("large-text", !!settings?.largeText);
    document.body.classList.toggle("reduced-motion", !!settings?.reducedMotion);
    document.body.classList.toggle("reduced-flashing", !!settings?.reducedFlashing);
  } catch {
    // ignore
  }
}
window.applyAccessibilitySettings = applyAccessibilitySettings;

function ensureAudioContext() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!audioState.ctx) audioState.ctx = new AC();
  // Best-effort resume (mobile browsers often start suspended).
  try {
    if (audioState.ctx.state === "suspended") audioState.ctx.resume();
  } catch {
    // ignore
  }
  return audioState.ctx;
}

function playTone(freqHz, durationMs, type = "square", gain = 0.04) {
  if (!settings?.soundEnabled) return;
  const now = Date.now();
  // Rate limit to avoid audio spam.
  if (now - (audioState.lastPlayAt || 0) < 40) return;
  audioState.lastPlayAt = now;

  const ctx = ensureAudioContext();
  if (!ctx) return;

  try {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();

    osc.type = type;
    osc.frequency.value = Math.max(30, Number(freqHz || 440));

    const dur = Math.max(20, Number(durationMs || 60)) / 1000;
    const t0 = ctx.currentTime;
    const t1 = t0 + dur;

    // Simple attack/decay so it doesn't click.
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(Math.max(0.0001, Number(gain || 0.04)), t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t1);

    osc.connect(g);
    g.connect(ctx.destination);

    osc.start(t0);
    osc.stop(t1 + 0.01);
  } catch {
    // ignore
  }
}

function playSound(kind) {
  if (!settings?.soundEnabled) return;
  const k = String(kind || "").toLowerCase();
  if (k === "hit") playTone(520, 55, "square", 0.045);
  else if (k === "crit") playTone(820, 80, "sawtooth", 0.05);
  else if (k === "miss") playTone(160, 60, "triangle", 0.03);
  else if (k === "hurt") playTone(110, 90, "square", 0.05);
  else if (k === "loot") playTone(700, 70, "triangle", 0.04);
  else if (k === "menu") playTone(300, 40, "triangle", 0.03);
  else if (k === "floor") playTone(240, 120, "sine", 0.04);
  else if (k === "death") playTone(70, 220, "sawtooth", 0.06);
}

// Expose for other modules.
window.playSound = playSound;

function createSeed() {
  try {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] >>> 0;
  } catch {
    // Best-effort fallback.
    return (Date.now() ^ ((performance?.now?.() || 0) * 1000)) >>> 0;
  }
}

function seedRng(seed) {
  runSeed = (seed >>> 0) || 1;
  rngState = runSeed;
}

// Mulberry32: fast PRNG with 32-bit state (good enough for gameplay randomness).
function rand01() {
  rngState |= 0;
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Expose seeded RNG for non-core scripts (e.g. investigation text) while still allowing fallback.
window.rand01 = rand01;

const rand = (a, b) => Math.floor(rand01() * (b - a + 1)) + a;
const rollChance = (p) => rand01() < Number(p || 0);

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand01() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function getViewRadius() {
  return clamp(Math.round(BASE_VIEW_RADIUS * zoomScale), MIN_VIEW_RADIUS, MAX_VIEW_RADIUS);
}

function isOpaqueForSight(x, y) {
  const k = keyOf(x, y);
  // Hidden areas render as walls until revealed: treat as opaque.
  if (hiddenArea && !hiddenArea.revealed && hiddenArea.tiles?.has(k)) return true;
  const ch = map[k] || "#";
  return ch === "#";
}

function hasLineOfSight(x0, y0, x1, y1) {
  // Bresenham line; allow seeing the blocking tile itself but not beyond it.
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  // Skip the origin tile; check each subsequent tile.
  while (!(x === x1 && y === y1)) {
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }

    if (x === x1 && y === y1) return true; // target always visible if the line reaches it
    if (isOpaqueForSight(x, y)) return false;
  }
  return true;
}

function computeVisibility() {
  const vis = new Set();
  const px = player.x;
  const py = player.y;

  // Always see your own tile.
  vis.add(keyOf(px, py));

  for (let y = -BASE_VIEW_RADIUS; y <= BASE_VIEW_RADIUS; y++) {
    for (let x = -BASE_VIEW_RADIUS; x <= BASE_VIEW_RADIUS; x++) {
      const tx = px + x;
      const ty = py + y;
      const dist = Math.max(Math.abs(x), Math.abs(y));
      if (dist > BASE_VIEW_RADIUS) continue;
      if (tx === px && ty === py) continue;
      if (hasLineOfSight(px, py, tx, ty)) vis.add(keyOf(tx, ty));
    }
  }

  visibleNow = vis;
  for (const k of vis) explored.add(k);
  return vis;
}

function getTwoTouchPoints() {
  if (touchPointers.size < 2) return null;
  const it = touchPointers.values();
  const a = it.next().value;
  const b = it.next().value;
  if (!a || !b) return null;
  return [a, b];
}

function touchDist(a, b) {
  const dx = (a?.x ?? 0) - (b?.x ?? 0);
  const dy = (a?.y ?? 0) - (b?.y ?? 0);
  return Math.sqrt(dx * dx + dy * dy);
}

// Bell-curve-ish integer roll in [min,max] (triangular distribution).
function rollBellInt(min, max) {
  const lo = Math.min(Number(min || 0), Number(max || 0));
  const hi = Math.max(Number(min || 0), Number(max || 0));
  if (hi <= lo) return lo;
  const u = lo + (hi - lo) * rand01();
  const v = lo + (hi - lo) * rand01();
  const x = (u + v) / 2;
  return Math.max(lo, Math.min(hi, Math.round(x)));
}

function chebDist(ax, ay, bx, by) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function isStepAllowed(fromX, fromY, toX, toY, isWalkableFn) {
  if (!isWalkableFn(toX, toY)) return false;
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (!dx || !dy) return true; // not diagonal
  // Prevent squeezing through diagonal corners.
  return isWalkableFn(fromX + dx, fromY) && isWalkableFn(fromX, fromY + dy);
}

function roomCenter(r) {
  return { x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) };
}

function rectsOverlap(a, b, pad = 0) {
  return !(
    a.x + a.w + pad <= b.x - pad ||
    b.x + b.w + pad <= a.x - pad ||
    a.y + a.h + pad <= b.y - pad ||
    b.y + b.h + pad <= a.y - pad
  );
}

function distManhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function keyOf(x, y) {
  return `${x},${y}`;
}

// Tile constants (avoid magic characters scattered everywhere).
const TILE = Object.freeze({
  WALL: "#",
  FLOOR: ".",
  TRAPDOOR: "T",
  TRAP_VISIBLE: "~",
  CAMPFIRE: "C",
  SHOP: "$",
  POTION: "P",
  GRASS: ",",
  ENTRANCE: "D", // courtyard -> dungeon
  UPSTAIRS: "U", // dungeon -> courtyard
  BLACKSMITH: "K",
  BOUNTY: "!",
  CRATE: "X",
  BARREL: "O",
  SHRINE: "&",
});

// Map access helpers (still backed by the existing string-keyed map object).
function tileAtKey(k) {
  return map[k] || TILE.WALL;
}
function tileAt(x, y) {
  return tileAtKey(keyOf(x, y));
}
function setTileAtKey(k, ch) {
  map[k] = ch;
}
function setTileAt(x, y, ch) {
  setTileAtKey(keyOf(x, y), ch);
}

function lootKeyOfKey(k) {
  return `${k}_loot`;
}
function lootAtKey(k) {
  return map[lootKeyOfKey(k)] || null;
}
function lootAt(x, y) {
  return lootAtKey(keyOf(x, y));
}
function setLootAtKey(k, item) {
  map[lootKeyOfKey(k)] = item;
}
function clearLootAtKey(k) {
  delete map[lootKeyOfKey(k)];
}

function trapKeyOfKey(k) {
  return `${k}_trap`;
}
function trapAtKey(k) {
  return map[trapKeyOfKey(k)] || null;
}
function trapAt(x, y) {
  return trapAtKey(keyOf(x, y));
}
function setTrapAtKey(k, trap) {
  map[trapKeyOfKey(k)] = trap;
}
function clearTrapAtKey(k) {
  delete map[trapKeyOfKey(k)];
}

function propKeyOfKey(k) {
  return `${k}_prop`;
}
function propAtKey(k) {
  return map[propKeyOfKey(k)] || null;
}
function setPropAtKey(k, prop) {
  map[propKeyOfKey(k)] = prop;
}
function clearPropAtKey(k) {
  delete map[propKeyOfKey(k)];
}

function pointInRoom(x, y, r) {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

function pointInCombatRoom(x, y) {
  // "Combat rooms" are rooms that can contain enemies: enemy rooms and the boss room.
  return rooms.some((r) => (r.type === "enemy" || r.type === "boss") && pointInRoom(x, y, r));
}

function isWalkableTile(ch) {
  return (
    ch === TILE.FLOOR ||
    ch === TILE.GRASS ||
    ch === TILE.TRAP_VISIBLE ||
    ch === TILE.TRAPDOOR ||
    ch === TILE.CAMPFIRE ||
    ch === TILE.SHOP ||
    ch === TILE.ENTRANCE ||
    ch === TILE.UPSTAIRS ||
    ch === TILE.BLACKSMITH ||
    ch === TILE.BOUNTY ||
    ch === TILE.SHRINE
  );
}

function getStatus(target, kind) {
  return target?.statusEffects?.[kind] || null;
}

function addStatus(target, kind, turns, value = 0) {
  if (!target) return;
  if (!target.statusEffects) target.statusEffects = {};
  target.statusEffects[kind] = { turns, value };
  try {
    if (target === player) recordCodexStatus(kind);
  } catch {
    // ignore
  }
}

function getBurning(target) {
  return getStatus(target, "burning");
}

function addBurning(target, turns = 3, dmgPerTurn = 1) {
  if (!target) return;
  if (!target.statusEffects) target.statusEffects = {};
  const cur = target.statusEffects.burning;
  if (!cur) target.statusEffects.burning = { turns, dmgPerTurn };
  else {
    target.statusEffects.burning = {
      turns: Math.max(Number(cur.turns || 0), Number(turns || 0)),
      dmgPerTurn: Math.max(Number(cur.dmgPerTurn || 0), Number(dmgPerTurn || 0)),
    };
  }
  try {
    if (target === player) recordCodexStatus("burning");
  } catch {
    // ignore
  }
}

function addPoisoned(target, turns = 3, dmgPerTurn = 1) {
  if (!target) return;
  if (!target.statusEffects) target.statusEffects = {};
  const cur = target.statusEffects.poisoned;
  if (!cur) target.statusEffects.poisoned = { turns, dmgPerTurn };
  else {
    target.statusEffects.poisoned = {
      turns: Math.max(Number(cur.turns || 0), Number(turns || 0)),
      dmgPerTurn: Math.max(Number(cur.dmgPerTurn || 0), Number(dmgPerTurn || 0)),
    };
  }
  try {
    if (target === player) recordCodexStatus("poisoned");
  } catch {
    // ignore
  }
}

function tickStatusEffects(target, targetKind = "player") {
  if (!target || typeof target.hp !== "number") return;
  const status = target.statusEffects || {};

  // Burning
  const burning = status.burning;
  if (burning?.turns) {
    const dmg = Math.max(0, Number(burning.dmgPerTurn || 0));
    if (dmg > 0) {
      target.hp -= dmg;
      if (targetKind === "player") {
        try {
          setLastDamageSource({ kind: "status", name: "Burning", amount: dmg, floor });
          runStats.damageTaken = Math.max(0, Number(runStats.damageTaken || 0) + dmg);
        } catch {
          // ignore
        }
        addLog(`You are burning: -${dmg} hp`, "danger");
        showDamageNumber(target.x || player.x, target.y || player.y, dmg, "enemy");
      }
    }
    burning.turns -= 1;
    if (burning.turns <= 0) delete target.statusEffects.burning;
  }

  // Poison
  const poisoned = status.poisoned;
  if (poisoned?.turns) {
    const dmg = Math.max(0, Number(poisoned.dmgPerTurn || 0));
    if (dmg > 0) {
      target.hp -= dmg;
      if (targetKind === "player") {
        try {
          setLastDamageSource({ kind: "status", name: "Poisoned", amount: dmg, floor });
          runStats.damageTaken = Math.max(0, Number(runStats.damageTaken || 0) + dmg);
        } catch {
          // ignore
        }
        addLog(`Poisoned: -${dmg} hp`, "danger");
        showDamageNumber(target.x || player.x, target.y || player.y, dmg, "enemy");
      }
    }
    poisoned.turns -= 1;
    if (poisoned.turns <= 0) delete target.statusEffects.poisoned;
  }

  // Regeneration
  const regeneration = status.regeneration;
  if (regeneration?.turns) {
    const heal = Math.max(0, Number(regeneration.healPerTurn || 0));
    if (heal && target.maxHp) {
      target.hp = Math.min(target.maxHp, target.hp + heal);
    }
    regeneration.turns -= 1;
    if (regeneration.turns <= 0) delete target.statusEffects.regeneration;
    if (targetKind === "player" && heal) {
      addLog(`Regenerating: +${heal} hp`, "loot");
    }
  }

  // Invisibility/Speed - just decrement turns
  if (status.invisibility?.turns) {
    status.invisibility.turns -= 1;
    if (status.invisibility.turns <= 0) {
      delete target.statusEffects.invisibility;
      if (targetKind === "player") addLog("Invisibility faded", "info");
    }
  }
  if (status.speed?.turns) {
    status.speed.turns -= 1;
    if (status.speed.turns <= 0) {
      delete target.statusEffects.speed;
      if (targetKind === "player") addLog("Speed boost faded", "info");
    }
  }
  if (status.slow?.turns) {
    status.slow.turns -= 1;
    if (status.slow.turns <= 0) {
      delete target.statusEffects.slow;
      if (targetKind === "player") addLog("Slowness faded", "info");
    }
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ===================== META SYSTEMS (Hotbar / Codex / Run Stats / Feedback) ===================== */

let _itemIdCounter = 1;
function newItemId() {
  // Short, stable-enough id for a run + saves.
  return `${Date.now().toString(36)}_${(_itemIdCounter++).toString(36)}`;
}

function ensureItemId(it) {
  if (!it || typeof it !== "object") return it;
  if (!it.iid) it.iid = newItemId();
  return it;
}

function normalizePlayerMeta() {
  if (!player || typeof player !== "object") return;
  if (!Array.isArray(player.inventory)) player.inventory = [];
  for (const it of player.inventory) ensureItemId(it);

  if (!Array.isArray(player.hotbar)) player.hotbar = [null, null, null, null];
  if (player.hotbar.length !== 4) player.hotbar = [player.hotbar[0] ?? null, player.hotbar[1] ?? null, player.hotbar[2] ?? null, player.hotbar[3] ?? null];

  if (!player.trinkets || typeof player.trinkets !== "object") player.trinkets = { a: null, b: null };
  if (!("a" in player.trinkets)) player.trinkets.a = null;
  if (!("b" in player.trinkets)) player.trinkets.b = null;

  if (!player.codex || typeof player.codex !== "object") player.codex = { enemies: {}, items: {}, trinkets: {}, materials: {}, statuses: {} };
  for (const k of ["enemies", "items", "trinkets", "materials", "statuses"]) {
    if (!player.codex[k] || typeof player.codex[k] !== "object") player.codex[k] = {};
  }

  if (!player.inventorySort) player.inventorySort = "type";

  if (!player.bounties || typeof player.bounties !== "object") {
    player.bounties = { dayKey: "", offers: [], accepted: [], claimed: {} };
  }
  if (!Array.isArray(player.bounties.offers)) player.bounties.offers = [];
  if (!Array.isArray(player.bounties.accepted)) player.bounties.accepted = [];
  if (!player.bounties.claimed || typeof player.bounties.claimed !== "object") player.bounties.claimed = {};
}

function findInventoryIndexById(iid) {
  if (!iid) return -1;
  const inv = player.inventory || [];
  for (let i = 0; i < inv.length; i++) {
    if (inv[i]?.iid === iid) return i;
  }
  return -1;
}

function syncHotbar() {
  normalizePlayerMeta();
  for (let s = 0; s < 4; s++) {
    const iid = player.hotbar[s];
    if (!iid) continue;
    if (findInventoryIndexById(iid) < 0) player.hotbar[s] = null;
  }
}

function assignHotbarSlot(slotIdx, invIndex) {
  const s = Number(slotIdx);
  const idx = Number(invIndex);
  if (!Number.isFinite(s) || s < 0 || s > 3) return;
  if (!Number.isFinite(idx) || idx < 0) return;
  const it = player.inventory?.[idx];
  if (!it) return;
  ensureItemId(it);
  player.hotbar[s] = it.iid;
  playSound?.("menu");
  vibrate(8);
  draw();
}

function clearHotbarSlot(slotIdx) {
  const s = Number(slotIdx);
  if (!Number.isFinite(s) || s < 0 || s > 3) return;
  player.hotbar[s] = null;
  playSound?.("menu");
  draw();
}

function useHotbarSlot(slotIdx) {
  if (gamePaused || menuOpen) return;
  syncHotbar();
  const s = Number(slotIdx);
  if (!Number.isFinite(s) || s < 0 || s > 3) return;
  const iid = player.hotbar[s];
  if (!iid) {
    addLog("Hotbar slot empty", "info");
    playSound?.("menu");
    return;
  }
  const invIdx = findInventoryIndexById(iid);
  if (invIdx < 0) {
    player.hotbar[s] = null;
    return;
  }
  const it = player.inventory?.[invIdx];
  const eff = String(it?.effect || "").toLowerCase();
  if (eff === "weapon") {
    equipToHand?.("main", invIdx);
    return;
  }
  useInventoryItem?.(invIdx);
}

function codexInc(section, key, n = 1) {
  normalizePlayerMeta();
  const s = String(section || "");
  const k = String(key || "");
  if (!s || !k) return;
  if (!player.codex[s]) player.codex[s] = {};
  const curRaw = Number(player.codex[s][k]);
  const cur = Number.isFinite(curRaw) ? curRaw : 0;
  const addRaw = Number(n);
  const add = Number.isFinite(addRaw) ? addRaw : 0;
  player.codex[s][k] = Math.max(0, cur + add);
}

function recordCodexEnemy(name) {
  const n = String(name || "").trim();
  if (!n) return;
  codexInc("enemies", n, 0); // ensure exists
}

function recordCodexItem(it) {
  if (!it) return;
  const name = String(it?.name || "").trim() || "Unknown Item";
  const eff = String(it?.effect || "").toLowerCase();
  codexInc("items", name, 1);
  if (eff === "trinket") codexInc("trinkets", name, 1);
  if (eff === "material") codexInc("materials", name, 1);
}

function recordCodexItemSeen(it) {
  if (!it) return;
  const name = String(it?.name || "").trim() || "Unknown Item";
  const eff = String(it?.effect || "").toLowerCase();
  // Ensure it appears in codex without counting as "picked".
  codexInc("items", name, 0);
  if (eff === "trinket") codexInc("trinkets", name, 0);
  if (eff === "material") codexInc("materials", name, 0);
}
window.recordCodexItemSeen = recordCodexItemSeen;

function recordCodexStatus(kind) {
  const k = String(kind || "").trim();
  if (!k) return;
  codexInc("statuses", k, 0);
}

function addItemToInventory(item, opts = {}) {
  normalizePlayerMeta();
  if (!item || typeof item !== "object") return false;
  ensureItemId(item);
  if (!item.pickedAt) item.pickedAt = Date.now();

  const eff = String(item.effect || "").toLowerCase();
  const cap = Math.max(0, Number(player.maxInventory ?? 10));

  // Stack materials by matId to avoid inventory spam.
  if (eff === "material" && item.matId) {
    const id = String(item.matId);
    const qty = Math.max(1, Math.floor(Number(item.qty || 1)));
    const inv = player.inventory || [];
    const existing = inv.find((it) => String(it?.effect || "").toLowerCase() === "material" && String(it?.matId || "") === id);
    if (existing) {
      existing.qty = Math.max(1, Math.floor(Number(existing.qty || 1))) + qty;
      recordCodexItem(existing);
      try {
        bountyNotify?.({ type: "collectMat", matId: id, qty });
      } catch {
        // ignore
      }
      return true;
    }
    if (cap && inv.length >= cap) return false;
    item.qty = qty;
    inv.push(item);
    recordCodexItem(item);
    try {
      bountyNotify?.({ type: "collectMat", matId: id, qty });
    } catch {
      // ignore
    }
    return true;
  }

  // Regular items
  if (cap && (player.inventory?.length || 0) >= cap) return false;
  player.inventory.push(item);
  recordCodexItem(item);
  if (eff === "weapon") noteBestWeaponCandidate(item);
  syncHotbar();
  return true;
}
window.addItemToInventory = addItemToInventory;

function getMaterialCount(matId) {
  normalizePlayerMeta();
  const id = String(matId || "");
  if (!id) return 0;
  const it = (player.inventory || []).find((x) => String(x?.effect || "").toLowerCase() === "material" && String(x?.matId || "") === id);
  return it ? Math.max(0, Math.floor(Number(it.qty || 0))) : 0;
}
function consumeMaterial(matId, qty) {
  normalizePlayerMeta();
  const id = String(matId || "");
  const q = Math.max(1, Math.floor(Number(qty || 1)));
  const inv = player.inventory || [];
  const idx = inv.findIndex((x) => String(x?.effect || "").toLowerCase() === "material" && String(x?.matId || "") === id);
  if (idx < 0) return false;
  const it = inv[idx];
  const have = Math.max(0, Math.floor(Number(it.qty || 0)));
  if (have < q) return false;
  const left = have - q;
  if (left <= 0) inv.splice(idx, 1);
  else it.qty = left;
  syncHotbar();
  return true;
}
window.getMaterialCount = getMaterialCount;
window.consumeMaterial = consumeMaterial;

function setInventorySort(mode) {
  normalizePlayerMeta();
  const m = String(mode || "").toLowerCase();
  const allowed = new Set(["type", "name", "value", "rarity", "recent"]);
  player.inventorySort = allowed.has(m) ? m : "type";
  playSound?.("menu");
  draw();
}
window.setInventorySort = setInventorySort;


function resetRunStats() {
  runStats = {
    startedAt: Date.now(),
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
}

function noteBestWeaponCandidate(it) {
  if (!it || String(it.effect || "") !== "weapon") return;
  const maxDmg = Math.max(1, Math.floor(Number(it.maxDamage || 1)));
  const lvl = Math.max(1, Math.floor(Number(it.level || 1)));
  const rar = typeof getRarity === "function" ? getRarity(it.rarity) : null;
  const mult = Math.max(0.1, Number(rar?.mult || 1));
  const score = Math.floor((maxDmg + lvl) * mult);
  if (score > Number(runStats.bestWeaponScore || 0)) {
    runStats.bestWeaponScore = score;
    runStats.bestWeaponName = String(it.name || "");
  }
}

function setLastDamageSource(src) {
  if (!src || typeof src !== "object") return;
  lastDamageSource = {
    kind: String(src.kind || "unknown"),
    name: String(src.name || "Unknown"),
    amount: Math.max(0, Number(src.amount || 0)),
    floor: Number.isFinite(Number(src.floor)) ? Number(src.floor) : floor,
    time: Date.now(),
    extra: src.extra || null,
  };
}

let _shakeRaf = 0;
function shakeScreen(intensity = 1, durationMs = 120) {
  try {
    if (!settings?.screenShake) return;
    if (settings?.reducedMotion) return;
    if (!gameEl) return;
    const base = Math.max(0, Number(intensity || 1)) * Math.max(0.2, Number(settings.screenShakeIntensity || 1));
    const dur = Math.max(40, Number(durationMs || 120));
    const t0 = performance?.now?.() || Date.now();
    if (_shakeRaf) cancelAnimationFrame(_shakeRaf);

    const tick = () => {
      const now = performance?.now?.() || Date.now();
      const t = (now - t0) / dur;
      if (t >= 1) {
        gameEl.style.transform = "";
        _shakeRaf = 0;
        return;
      }
      // Ease out
      const mag = base * (1 - t) * 3.0;
      const dx = (rand01() * 2 - 1) * mag;
      const dy = (rand01() * 2 - 1) * mag;
      gameEl.style.transform = `translate(${dx}px, ${dy}px)`;
      _shakeRaf = requestAnimationFrame(tick);
    };
    _shakeRaf = requestAnimationFrame(tick);
  } catch {
    // ignore
  }
}

function flashGame(filterCss = "brightness(1.35)") {
  try {
    if (!settings?.hitFlash) return;
    if (settings?.reducedFlashing) return;
    if (!gameEl) return;
    gameEl.style.transition = "filter 0.08s";
    gameEl.style.filter = filterCss;
    setTimeout(() => {
      if (!gameEl) return;
      gameEl.style.filter = "";
      setTimeout(() => {
        if (!gameEl) return;
        gameEl.style.transition = "";
      }, 90);
    }, 90);
  } catch {
    // ignore
  }
}

// Difficulty presets (applied to multipliers in settings).
const DIFFICULTY_PRESETS = Object.freeze({

  // Risk/reward: easier runs yield less loot.
  easy: { enemyHpMult: 0.85, enemyDmgMult: 0.8, lootMult: 0.75, hazardMult: 0.85, propDensity: 0.9 },
  normal: { enemyHpMult: 1, enemyDmgMult: 1, lootMult: 1, hazardMult: 1, propDensity: 1 },
  hard: { enemyHpMult: 1.2, enemyDmgMult: 1.25, lootMult: 1.15, hazardMult: 1.25, propDensity: 1.1 },

});

function applyDifficultyPreset(presetId) {
  const id = String(presetId || settings?.difficultyPreset || "normal").toLowerCase();
  const p = DIFFICULTY_PRESETS[id];
  if (!p) return;
  settings.difficultyPreset = id;
  settings.enemyHpMult = p.enemyHpMult;
  settings.enemyDmgMult = p.enemyDmgMult;
  settings.lootMult = p.lootMult;
  settings.hazardMult = p.hazardMult;
  settings.propDensity = p.propDensity;
  window.gameSettings = settings;
}
window.applyDifficultyPreset = applyDifficultyPreset;

function getPlayerBonuses() {
  const out = {
    lootMult: 0,
    toughness: 0,
    dmg: 0,
    critChance: 0,
    lifeOnKill: 0,
    // New build levers
    dodgeChance: 0, // 0..1
    thorns: 0, // flat reflect on being hit
    lifeSteal: 0, // percent of damage dealt returned as hp
    knockbackChance: 0, // chance to shove enemies on hit
    knockbackDmg: 0, // extra slam damage when knocking into something solid
    // Multipliers (curses live here too)
    dmgTakenMult: 1, // incoming damage multiplier
    hungerCostMult: 1, // hunger cost multiplier
  };
  try {
    const tr = player?.trinkets;
    const hands = player?.hands || { main: null, off: null };
    const list = [tr?.a, tr?.b, hands?.main, hands?.off].filter(Boolean);
    for (const it of list) {
      const applyObj = (b) => {
        if (!b || typeof b !== "object") return;
        if (Number.isFinite(Number(b.lootMult))) out.lootMult += Number(b.lootMult);
        if (Number.isFinite(Number(b.toughness))) out.toughness += Number(b.toughness);
        if (Number.isFinite(Number(b.dmg))) out.dmg += Number(b.dmg);
        if (Number.isFinite(Number(b.critChance))) out.critChance += Number(b.critChance);
        if (Number.isFinite(Number(b.lifeOnKill))) out.lifeOnKill += Number(b.lifeOnKill);
        if (Number.isFinite(Number(b.dodgeChance))) out.dodgeChance += Number(b.dodgeChance);
        if (Number.isFinite(Number(b.thorns))) out.thorns += Number(b.thorns);
        if (Number.isFinite(Number(b.lifeSteal))) out.lifeSteal += Number(b.lifeSteal);
        if (Number.isFinite(Number(b.knockbackChance))) out.knockbackChance += Number(b.knockbackChance);
        if (Number.isFinite(Number(b.knockbackDmg))) out.knockbackDmg += Number(b.knockbackDmg);
        if (Number.isFinite(Number(b.dmgTakenMult))) out.dmgTakenMult *= Math.max(0.05, Number(b.dmgTakenMult));
        if (Number.isFinite(Number(b.hungerCostMult))) out.hungerCostMult *= Math.max(0.05, Number(b.hungerCostMult));
      };
      applyObj(it?.bonuses);
      applyObj(it?.curse);
    }
  } catch {
    // ignore
  }
  // Clamp the spicy stuff to keep runs sane.
  out.dodgeChance = clamp(Number(out.dodgeChance || 0), 0, 0.6);
  out.lifeSteal = clamp(Number(out.lifeSteal || 0), 0, 0.6);
  out.knockbackChance = clamp(Number(out.knockbackChance || 0), 0, 0.8);
  out.dmgTakenMult = clamp(Number(out.dmgTakenMult || 1), 0.1, 3);
  out.hungerCostMult = clamp(Number(out.hungerCostMult || 1), 0.25, 3);
  out.thorns = clamp(Number(out.thorns || 0), 0, 10);
  out.knockbackDmg = clamp(Number(out.knockbackDmg || 0), 0, 10);
  return out;
}
window.getPlayerBonuses = getPlayerBonuses;

function equipTrinketToSlot(slotKey, invIndex) {
  normalizePlayerMeta();
  const slot = String(slotKey || "");
  if (slot !== "a" && slot !== "b") return;
  const idx = Number(invIndex);
  if (!Number.isFinite(idx)) return;
  const it = player.inventory?.[idx];
  if (!it || String(it.effect || "") !== "trinket") {
    addLog("That isn't a trinket.", "block");
    return;
  }
  if (!player.trinkets) player.trinkets = { a: null, b: null };
  const prev = player.trinkets[slot] || null;
  player.trinkets[slot] = it;
  player.inventory.splice(idx, 1);
  if (prev) addItemToInventory(prev);
  syncHotbar();
  addLog(`Equipped trinket: ${it.name} (${slot.toUpperCase()})`, "loot");
  playSound?.("menu");
  draw();
}
function unequipTrinket(slotKey) {
  normalizePlayerMeta();
  const slot = String(slotKey || "");
  if (slot !== "a" && slot !== "b") return;
  const it = player?.trinkets?.[slot];
  if (!it) return;
  const cap = Math.max(0, Number(player.maxInventory ?? 10));
  if (cap && (player.inventory?.length || 0) >= cap) {
    addLog("Inventory full", "block");
    return;
  }
  player.trinkets[slot] = null;
  addItemToInventory(it);
  addLog(`Unequipped trinket: ${it.name}`, "info");
  playSound?.("menu");
  draw();
}
window.equipTrinketToSlot = equipTrinketToSlot;
window.unequipTrinket = unequipTrinket;

function _todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function ensureBountyOffers() {
  normalizePlayerMeta();
  const day = _todayKey();
  if (player.bounties.dayKey === day && player.bounties.offers?.length) return;
  player.bounties.dayKey = day;
  player.bounties.offers = [];
  const mk = (o) => ({ id: `${day}_${o.kind}_${rand(1000, 9999)}`, ...o });
  const offers = [
    mk({ kind: "kill", target: "Rat", goal: 8, title: "Pest Control", desc: "Kill 8 Rats", rewardGold: 45, rewardMat: { matId: "iron", qty: 1 } }),
    mk({ kind: "kill", target: "Goblin", goal: 6, title: "Green Menace", desc: "Kill 6 Goblins", rewardGold: 70, rewardMat: { matId: "leather", qty: 2 } }),
    mk({ kind: "collectMat", target: "iron", goal: 4, title: "Ore Run", desc: "Collect 4 Iron Ore", rewardGold: 55, rewardMat: { matId: "essence", qty: 1 } }),
  ];
  shuffleInPlace(offers);
  player.bounties.offers = offers.slice(0, 3);
}

function acceptBounty(bountyId) {
  normalizePlayerMeta();
  ensureBountyOffers();
  const id = String(bountyId || "");
  if (!id) return;
  if ((player.bounties.accepted || []).some((b) => b.id === id)) return;
  const offer = (player.bounties.offers || []).find((b) => b.id === id);
  if (!offer) return;
  if ((player.bounties.accepted || []).length >= 2) {
    addLog("You can only take 2 bounties at a time.", "block");
    return;
  }
  player.bounties.accepted.push({ ...offer, progress: 0, completed: false });
  addLog(`Bounty accepted: ${offer.title}`, "loot");
  playSound?.("menu");
  draw();
}

function _rewardBounty(b) {
  const gold = Math.max(0, Number(b.rewardGold || 0));
  if (gold) {
    player.gold = Math.max(0, Number(player.gold || 0) + gold);
    runStats.goldEarned = Math.max(0, Number(runStats.goldEarned || 0) + gold);
  }
  if (b.rewardMat?.matId) {
    const base = (Array.isArray(MATERIALS) ? MATERIALS.find((m) => m.matId === b.rewardMat.matId) : null) || null;
    if (base) addItemToInventory({ ...base, qty: Math.max(1, Math.floor(Number(b.rewardMat.qty || 1))) });
  }
  if (b.rewardTrinketChance && rollChance(Number(b.rewardTrinketChance))) {
    const t = Array.isArray(TRINKETS) && TRINKETS.length ? TRINKETS[rand(0, TRINKETS.length - 1)] : null;
    if (t) addItemToInventory({ ...t });
  }
}

function claimBounty(bountyId) {
  normalizePlayerMeta();
  const id = String(bountyId || "");
  const b = (player.bounties.accepted || []).find((x) => x.id === id);
  if (!b) return;
  if (!b.completed) {
    addLog("Not completed yet.", "block");
    return;
  }
  if (player.bounties.claimed?.[id]) return;
  player.bounties.claimed[id] = true;
  _rewardBounty(b);
  addLog(`Bounty claimed: ${b.title}`, "loot");
  playSound?.("loot");
  vibrate([12, 30, 12]);
  draw();
}

function bountyNotify(evt) {
  normalizePlayerMeta();
  const e = evt || {};
  const type = String(e.type || "");
  for (const b of player.bounties.accepted || []) {
    if (b.completed) continue;
    if (b.kind === "kill" && type === "kill" && String(e.enemy || "") === String(b.target || "")) {
      b.progress = Math.min(b.goal, Number(b.progress || 0) + 1);
    }
    if (b.kind === "collectMat" && type === "collectMat" && String(e.matId || "") === String(b.target || "")) {
      b.progress = Math.min(b.goal, Number(b.progress || 0) + Number(e.qty || 1));
    }
    if (b.kind === "floor" && type === "floor") {
      b.progress = Math.max(Number(b.progress || 0), Number(e.floor || 0));
    }
    if (Number(b.progress || 0) >= Number(b.goal || 0)) b.completed = true;
  }
}
window.ensureBountyOffers = ensureBountyOffers;
window.acceptBounty = acceptBounty;
window.claimBounty = claimBounty;
window.bountyNotify = bountyNotify;

function blacksmithUpgrade() {
  normalizePlayerMeta();
  const w = player?.hands?.main && String(player.hands.main.effect || "") === "weapon" ? player.hands.main : null;
  if (!w) {
    addLog("Equip a weapon in your main hand.", "block");
    return;
  }
  const tier = Math.max(0, Math.floor(Number(w.forged || 0)));
  const goldCost = 60 + tier * 45;
  const ironCost = 2 + tier;
  const essCost = tier >= 2 ? 1 : 0;
  if (Number(player.gold || 0) < goldCost) {
    addLog("Not enough gold.", "block");
    return;
  }
  if (getMaterialCount("iron") < ironCost) {
    addLog("Not enough Iron Ore.", "block");
    return;
  }
  if (essCost && getMaterialCount("essence") < essCost) {
    addLog("Not enough Arcane Dust.", "block");
    return;
  }
  player.gold -= goldCost;
  consumeMaterial("iron", ironCost);
  if (essCost) consumeMaterial("essence", essCost);
  w.maxDamage = Math.max(1, Math.floor(Number(w.maxDamage || 1) + 1));
  w.forged = tier + 1;
  addLog(`Blacksmith reforged your weapon (+1 max damage)`, "loot");
  playSound?.("loot");
  vibrate(15);
  draw();
}
window.blacksmithUpgrade = blacksmithUpgrade;

function renderLiveLog() {
  const logDiv = document.getElementById("liveLog");
  if (!logDiv) return;
  logDiv.innerHTML = liveLogs
    .map((l) => `<div class="log-line" style="color:${l.color}">${escapeHtml(l.text)}</div>`)
    .join("");
}

function showDamageNumber(x, y, value, type = "player") {
  if (!settings.showDamageNumbers) return;
  damageNumbers.push({
    x,
    y,
    value: Math.floor(value),
    type,
    time: Date.now(),
  });
}

// Expose globally for use in other functions
window.showDamageNumber = showDamageNumber;

function updateDamageNumbers() {
  if (damageNumbers.length === 0) return; // Skip if no damage numbers
  
  const now = Date.now();
  damageNumbers = damageNumbers.filter((dn) => now - dn.time < 1000);
  
  // Limit array size
  if (damageNumbers.length > MAX_DAMAGE_NUMBERS) {
    damageNumbers = damageNumbers.slice(-MAX_DAMAGE_NUMBERS);
  }
  
  // Render damage numbers
  const damageEl = document.getElementById("damageNumbers");
  if (!damageEl || !gameEl) return;
  
  const gRect = gameEl.getBoundingClientRect();
  const mRect = mapContainerEl.getBoundingClientRect();
  const fontPx = Number.parseFloat(window.getComputedStyle(gameEl).fontSize || "16");
  const { unitW, unitH } = getMonoCellMetricsPx(120);
  const cellW = unitW * fontPx;
  const cellH = unitH * fontPx;
  
  if (!cellW || !cellH) return;
  
  const viewRadius = getViewRadius();
  damageEl.innerHTML = damageNumbers
    .map((dn) => {
      const dx = dn.x - player.x;
      const dy = dn.y - player.y;
      if (Math.abs(dx) > viewRadius || Math.abs(dy) > viewRadius) return "";
      
      const screenX = gRect.left + (dx + viewRadius) * cellW + cellW / 2 - mRect.left;
      const screenY = gRect.top + (dy + viewRadius) * cellH + cellH / 2 - mRect.top;
      
      const color = dn.type === "player" ? "#00ff00" : dn.type === "crit" ? "#ffff00" : "#ff0000";
      const age = now - dn.time;
      const offsetY = -(age / 1000) * 40;
      const opacity = 1 - age / 1000;
      
      return `<div class="damage-number" style="left:${screenX}px;top:${screenY + offsetY}px;color:${color};opacity:${opacity};">${dn.value}</div>`;
    })
    .filter(Boolean)
    .join("");
}

function addLog(text, type = "info") {
  const colors = {
    player: "lime",
    enemy: "red",
    loot: "cyan",
    block: "gray",
    death: "orange",
    floor: "violet",
    danger: "darkred",
    info: "white",
  };

  const entry = { text, color: colors[type] || "white" };
  logHistory.push(entry);
  liveLogs.push(entry);

  renderLiveLog();

  window.setTimeout(() => {
    liveLogs = liveLogs.filter((e) => e !== entry);
    renderLiveLog();
  }, LOG_LIFETIME);
}

function updateHud() {
  const hpFill = document.getElementById("hpFill");
  const hungerFill = document.getElementById("hungerFill");
  const hpCurrent = document.getElementById("hpCurrent");
  const hpMax = document.getElementById("hpMax");
  const hungerCurrent = document.getElementById("hungerCurrent");
  const hungerMax = document.getElementById("hungerMax");
  const floorLabel = document.getElementById("floorLabel");

  if (hpFill) {
    const pct = player.maxHp ? (player.hp / player.maxHp) * 100 : 0;
    hpFill.style.width = `${clamp(pct, 0, 100)}%`;
  }
  if (hungerFill) {
    const pct = player.maxHunger ? (player.hunger / player.maxHunger) * 100 : 0;
    hungerFill.style.width = `${clamp(pct, 0, 100)}%`;
  }

  if (hpCurrent) hpCurrent.textContent = Number(player.hp || 0).toFixed(1);
  if (hpMax) hpMax.textContent = Number(player.maxHp || 0).toFixed(1);
  if (hungerCurrent) hungerCurrent.textContent = Number(player.hunger || 0).toFixed(1);
  if (hungerMax) hungerMax.textContent = Number(player.maxHunger || 0).toFixed(1);
  
  // Build status line with combo and status effects
  let statusParts = [`Floor ${floor}`, `Gold: ${player.gold || 0}`, `Score: ${player.score || 0}`];
  if (player.combo > 0) {
    statusParts.push(`${player.combo}x Combo`);
  }

  // Optional target info (makes "Show Enemy Health" meaningful in normal play).
  const showTargetHealth = settings.showEnemyHealth !== false;
  if (showTargetHealth && lastTarget && typeof lastTarget.hp === "number") {
    const tName = String(lastTarget.name || "Enemy");
    const hpStr =
      typeof lastTarget.maxHp === "number" ? `${Math.max(0, lastTarget.hp)}/${lastTarget.maxHp}` : `${Math.max(0, lastTarget.hp)}`;
    statusParts.push(`Target: ${tName} ${hpStr}`);
  }
  
  // Add status effect indicators
  const statusEffects = player.statusEffects || {};
  const statusList = [];
  if (statusEffects.burning?.turns) statusList.push(`Burn(${statusEffects.burning.turns})`);
  if (statusEffects.poisoned?.turns) statusList.push(`Pois(${statusEffects.poisoned.turns})`);
  if (statusEffects.speed?.turns) statusList.push(`Spd(${statusEffects.speed.turns})`);
  if (statusEffects.invisibility?.turns) statusList.push(`Invis(${statusEffects.invisibility.turns})`);
  if (statusEffects.slow?.turns) statusList.push(`Slow(${statusEffects.slow.turns})`);
  if (statusEffects.regeneration?.turns) statusList.push(`Regen(${statusEffects.regeneration.turns})`);
  
  if (statusList.length > 0) {
    statusParts.push(statusList.join(" "));
  }
  
  if (floorLabel) floorLabel.textContent = statusParts.join(" | ");
  updateHotbarUi();
}

function updateHotbarUi() {
  try {
    const hb = document.getElementById("hotbar");
    if (!hb) return;
    if (inMainMenu) {
      hb.innerHTML = "";
      return;
    }
    syncHotbar();
    const slots = Array.isArray(player.hotbar) ? player.hotbar : [null, null, null, null];
    const rarityCss = (it) => {
      const rid = String(it?.rarity || "");
      const rar = (Array.isArray(RARITIES) ? RARITIES.find((r) => r.id === rid) : null) || null;
      const c = rar?.outline;
      return c ? `text-shadow: -1px 0 ${c}, 1px 0 ${c}, 0 -1px ${c}, 0 1px ${c}, 0 0 6px ${c};` : "";
    };
    const btnHtml = (s) => {
      const iid = slots[s];
      const idx = iid ? findInventoryIndexById(iid) : -1;
      const it = idx >= 0 ? player.inventory?.[idx] : null;
      const name = it?.name ? String(it.name) : "Empty";
      const qty = it && String(it.effect || "").toLowerCase() === "material" ? ` x${Math.max(1, Math.floor(Number(it.qty || 1)))}` : "";
      const label = it ? `${name}${qty}` : "Empty";
      const title = it ? `${label} (tap to use)` : "Empty (assign in Inventory)";
      const color = it?.color ? `color:${it.color};` : "";
      const glow = it ? rarityCss(it) : "";
      return `<button type="button" class="hotbar-btn ${it ? "" : "is-empty"}" data-hotbar-use="${s}" title="${escapeHtml(title)}" style="${color}${glow}">
        <span class="hb-num">${s + 1}</span>${escapeHtml(label)}
      </button>`;
    };
    hb.innerHTML = [0, 1, 2, 3].map(btnHtml).join("");
  } catch {
    // ignore
  }
}

function tickHunger(cost = 0) {
  // Hunger decreases with each player action.
  const b = typeof getPlayerBonuses === "function" ? getPlayerBonuses() : { hungerCostMult: 1 };
  const mult = Math.max(0, Number(b.hungerCostMult || 1));
  const c = Math.max(0, Number(cost || 0)) * mult;
  const oldHunger = player.hunger;
  player.hunger = Math.max(0, Number(player.hunger || 0) - c);
  
  // Low hunger warning
  if (oldHunger >= 2 && player.hunger < 2 && player.hunger > 0) {
    addLog("Low hunger! Find food soon.", "danger");
  }
  
  if (player.hunger <= 0) {
    // Starvation: small damage each turn while empty.
    player.hp -= 0.01;
    try {
      setLastDamageSource({ kind: "starvation", name: "Starvation", amount: 0.01, floor });
    } catch {
      // ignore
    }
    const now = Date.now();
    if (now - (lastStarveLogAt || 0) > 1200) {
      lastStarveLogAt = now;
      addLog("You are starving: -0.01 hp", "danger");
    }
  }
}

function tickHungerRegeneration() {
  // If out of combat and missing health, regenerate using hunger
  if (player.hp >= player.maxHp) return; // Full health, no need to regen
  if (player.hunger <= 0) return; // No hunger to use
  
  // Check if out of combat (no enemies adjacent)
  const isOutOfCombat = !enemies.some((e) => {
    const dist = Math.max(Math.abs(e.x - player.x), Math.abs(e.y - player.y));
    return dist <= 1; // No enemies adjacent
  });
  
  if (isOutOfCombat) {
    // Only regenerate if actually missing HP
    const missingHp = player.maxHp - player.hp;
    const b = typeof getPlayerBonuses === "function" ? getPlayerBonuses() : { hungerCostMult: 1 };
    const mult = Math.max(0, Number(b.hungerCostMult || 1));
    const effectiveCost = HUNGER_COST_REGEN * mult;
    if (missingHp > 0 && player.hunger >= effectiveCost) {
      player.hp = Math.min(player.maxHp, player.hp + HP_REGEN_AMOUNT);
      // Route through tickHunger so curses/modifiers apply consistently.
      tickHunger(HUNGER_COST_REGEN);
    }
  }
}

function setMenuOpen(open) {
  if (inMainMenu) return; // Don't allow in-game menu when in main menu
  menuOpen = open;
  gamePaused = open;
  if (open) stopAutoMove();
  if (open) setInvestigateArmed(false);
  if (!open) {
    cookingAtCampfire = false;
    atShop = false;
    atBlacksmith = false;
    atBountyBoard = false;
    atShrine = false;
    shrineKey = null;
  }

  document.body.classList.toggle("menu-open", open);
  if (gameEl) gameEl.classList.toggle("is-menu", open);
}

function openCampfireMenu() {
  cookingAtCampfire = true;
  activeTab = "cook";
  setMenuOpen(true);
  draw();
}

function openShopMenu() {
  atShop = true;
  activeTab = "shop";
  setMenuOpen(true);
  draw();
}

function openBlacksmithMenu() {
  atBlacksmith = true;
  activeTab = "blacksmith";
  setMenuOpen(true);
  draw();
}

function openBountyBoardMenu() {
  atBountyBoard = true;
  activeTab = "bounties";
  setMenuOpen(true);
  draw();
}

function openShrineMenuAt(x, y) {
  atShrine = true;
  shrineKey = keyOf(x, y);
  activeTab = "shrine";
  setMenuOpen(true);
  draw();
}

function cleanseCurseByRef(ref) {
  if (!atShrine) return;
  const r = String(ref || "");
  if (!r) return;

  const getItem = () => {
    if (r.startsWith("inv:")) {
      const idx = Number(r.split(":")[1]);
      if (!Number.isFinite(idx)) return null;
      return { kind: "inv", idx, item: player.inventory?.[idx] || null };
    }
    if (r === "hand:main") return { kind: "hand", slot: "main", item: player?.hands?.main || null };
    if (r === "hand:off") return { kind: "hand", slot: "off", item: player?.hands?.off || null };
    if (r === "trinket:a") return { kind: "trinket", slot: "a", item: player?.trinkets?.a || null };
    if (r === "trinket:b") return { kind: "trinket", slot: "b", item: player?.trinkets?.b || null };
    return null;
  };

  const info = getItem();
  const it = info?.item;
  if (!it) return;
  if (!it.curse && !it.cursed) {
    addLog("That item isn't cursed.", "info");
    return;
  }

  const oldName = String(it.name || "Item");
  it.curse = null;
  it.cursed = false;
  if (oldName.toLowerCase().startsWith("cursed ")) it.name = oldName.slice(7);
  addLog(`Cleansed the curse from ${it.name || oldName}`, "loot");
  playSound?.("loot");
  vibrate([10, 30, 10]);

  // Consume the shrine.
  const k = String(shrineKey || "");
  if (k) {
    try {
      delete map[`${k}_shrine`];
    } catch {
      // ignore
    }
    try {
      setTileAtKey(k, TILE.FLOOR);
    } catch {
      // ignore
    }
  }

  setMenuOpen(false);
  draw();
}
window.openShrineMenuAt = openShrineMenuAt;
window.cleanseCurseByRef = cleanseCurseByRef;

function getItemSellValue(item) {
  if (!item) return 0;
  // Allow selling any item type at the shop.
  // Note: Many items use `value` for gameplay effects (e.g. potions), so we avoid
  // treating a generic `value` field as gold unless it's a "valuable".
  if (Number.isFinite(Number(item.sellValue))) return Math.max(0, Math.floor(Number(item.sellValue)));

  const effect = String(item.effect || "").toLowerCase();

  const rarityMult = (() => {
    try {
      if (typeof getRarity === "function") {
        const rar = getRarity(item.rarity);
        const m = Number(rar?.mult || 1);
        return Number.isFinite(m) ? Math.max(0.1, m) : 1;
      }
    } catch {
      // ignore
    }
    return 1;
  })();

  if (effect === "valuable") {
    // Valuables are authored with baseValue; generated valuables should also have a computed `value`.
    const explicit = Number(item.value);
    if (Number.isFinite(explicit)) return Math.max(0, Math.floor(explicit));

    const base = Number(item.baseValue || 0);
    if (Number.isFinite(base) && base > 0) {
      if (typeof calcValuableValue === "function") return Math.max(1, Math.floor(calcValuableValue(base, item.rarity)));
      return Math.max(1, Math.floor(base * rarityMult));
    }
    return 0;
  }

  if (effect === "weapon") {
    const lvl = Math.max(1, Math.floor(Number(item.level || 1)));
    const maxDmg = Math.max(1, Math.floor(Number(item.maxDamage || 1)));
    // Keep weapon resale below "upgrade" prices and scale reasonably with level/rarity.
    const base = 20 + lvl * 14 + maxDmg * 10;
    const mult = 0.45 + Math.min(0.7, rarityMult * 0.1); // common ~0.55, legendary ~1.15
    return Math.max(5, Math.floor(base * mult));
  }

  if (effect === "food") {
    const hunger = Math.max(0, Number(item.hunger || 0));
    const heal = Math.max(0, Number(item.heal || 0));
    const cookedBonus = item.cooked ? 6 : 0;
    return Math.max(1, Math.floor(5 + hunger * 4 + heal * 8 + cookedBonus));
  }

  // Potions / consumables (resale is intentionally worse than buying).
  if (effect === "fullheal") return 12;
  if (effect === "damageboost") return 20;
  if (effect === "toughnessboost") return 27;
  if (effect === "speed") return 35;
  if (effect === "invisibility") return 45;
  if (effect === "explosive") return 55;

  // Fallback for future item types: allow selling for a small amount.
  return effect ? 5 : 0;
}

function sellInventoryItem(invIndex) {
  if (!atShop) return;
  const idx = Number(invIndex);
  if (!Number.isFinite(idx)) return;
  const it = player.inventory?.[idx];
  if (!it) return;
  const v = getItemSellValue(it);
  if (!v) {
    addLog("That can't be sold here.", "block");
    return;
  }
  player.gold = Math.max(0, Number(player.gold || 0) + v);
  player.inventory.splice(idx, 1);
  try {
    runStats.goldEarned = Math.max(0, Number(runStats.goldEarned || 0) + v);
  } catch {
    // ignore
  }
  syncHotbar();
  addLog(`Sold ${it.name} (+${v} gold)`, "loot");
  playSound?.("loot");
  vibrate(10);
  draw();
}

function sellAllValuables() {
  if (!atShop) return;
  let gained = 0;
  const kept = [];
  for (const it of player.inventory || []) {
    const v = getItemSellValue(it);
    if (v > 0) gained += v;
    else kept.push(it);
  }
  if (gained <= 0) {
    addLog("No items to sell.", "info");
    return;
  }
  player.inventory = kept;
  player.gold = Math.max(0, Number(player.gold || 0) + gained);
  try {
    runStats.goldEarned = Math.max(0, Number(runStats.goldEarned || 0) + gained);
  } catch {
    // ignore
  }
  syncHotbar();
  addLog(`Sold items (+${gained} gold)`, "loot");
  playSound?.("loot");
  vibrate([12, 30, 12]);
  draw();
}

function getUpgradeCost(kind) {
  const w = Number(player.gear?.weapon || 0);
  const a = Number(player.gear?.armor || 0);
  const p = Number(player.gear?.pack || 0);
  if (kind === "weapon") return 80 + w * 60;
  if (kind === "armor") return 80 + a * 60;
  if (kind === "pack") return 60 + p * 50;
  return 999999;
}

function buyUpgrade(kind) {
  if (!atShop) return;
  const k = String(kind || "");
  const cost = getUpgradeCost(k);
  if (!Number.isFinite(cost)) return;
  if (Number(player.gold || 0) < cost) {
    addLog("Not enough gold", "block");
    return;
  }
  player.gold -= cost;
  if (!player.gear || typeof player.gear !== "object") player.gear = { weapon: 0, armor: 0, pack: 0 };

  if (k === "weapon") {
    player.gear.weapon = Number(player.gear.weapon || 0) + 1;
    player.dmg += 1;
    addLog("Upgraded weapon (+1 dmg)", "loot");
  } else if (k === "armor") {
    player.gear.armor = Number(player.gear.armor || 0) + 1;
    player.toughness += 1;
    addLog("Upgraded armor (+1 toughness)", "loot");
  } else if (k === "pack") {
    player.gear.pack = Number(player.gear.pack || 0) + 1;
    player.maxInventory = Math.max(0, Number(player.maxInventory ?? 10) + 2);
    addLog("Upgraded pack (+2 slots)", "loot");
  } else {
    // Refund
    player.gold += cost;
    return;
  }
  playSound?.("loot");
  vibrate(12);
  draw();
}

function isHandItem(item) {
  return item && String(item.effect || "") === "weapon" && String(item.slot || "") === "hand";
}

function equipToHand(hand, invIndex) {
  const h = String(hand || "");
  if (h !== "main" && h !== "off") return;
  const idx = Number(invIndex);
  if (!Number.isFinite(idx)) return;
  const it = player.inventory?.[idx];
  if (!isHandItem(it)) {
    addLog("That doesn't fit in your hand.", "block");
    return;
  }

  if (!player.hands || typeof player.hands !== "object") player.hands = { main: null, off: null };

  // Swap with whatever is in the slot.
  const prev = player.hands[h] || null;
  player.hands[h] = it;
  // Remove from inventory
  player.inventory.splice(idx, 1);
  // Put previous back in inventory if it existed
  if (prev) addItemToInventory(prev);
  syncHotbar();

  addLog(`Equipped: ${it.name} (${h} hand)`, "loot");
  playSound?.("menu");
  draw();
}

function unequipHand(hand) {
  const h = String(hand || "");
  if (h !== "main" && h !== "off") return;
  if (!player.hands || typeof player.hands !== "object") player.hands = { main: null, off: null };
  const it = player.hands[h];
  if (!it) return;

  const cap = Math.max(0, Number(player.maxInventory ?? 10));
  if (cap && (player.inventory?.length || 0) >= cap) {
    addLog("Inventory full", "block");
    return;
  }

  player.hands[h] = null;
  addItemToInventory(it);
  addLog(`Unequipped: ${it.name}`, "info");
  playSound?.("menu");
  draw();
}

function buyShopItem(shopIndex) {
  if (!atShop) return;
  const idx = Number(shopIndex);
  if (!Number.isFinite(idx)) return;

  const shopItems = [
    ...POTIONS.slice(0, 3).map((p, i) => ({ ...p, price: 25 + i * 15, shopIndex: i })),
    ...POTIONS.slice(3).map((p, i) => ({ ...p, price: 70 + i * 20, shopIndex: i + 3 })),
  ];

  const item = shopItems.find((it) => it.shopIndex === idx);
  if (!item) return;

  const price = Number(item.price || 0);
  if (Number(player.gold || 0) < price) {
    addLog("Not enough gold", "block");
    return;
  }

  const cap = Math.max(0, Number(player.maxInventory ?? 10));
  if (cap && (player.inventory?.length || 0) >= cap) {
    addLog("Inventory full", "block");
    return;
  }

  player.gold -= price;
  // Store the base item (no price/shopIndex fields).
  const { price: _p, shopIndex: _s, ...baseItem } = item;
  if (!addItemToInventory(baseItem)) {
    // Refund if inventory became full due to some edge-case.
    player.gold += price;
    addLog("Inventory full", "block");
    return;
  }
  addLog(`Bought ${baseItem.name}`, "loot");
  vibrate(12);
  draw();
}

function showFloorTransition() {
  const transitionEl = document.getElementById("floorTransition");
  if (!transitionEl) {
    // Fallback if element doesn't exist
    floor++;
    generateFloor();
    return;
  }
  stopAutoMove();
  setInvestigateArmed(false);
  gamePaused = true;

  transitionEl.style.display = "flex";
  transitionEl.innerHTML = `
    <h2>Descend to Floor ${floor + 1}?</h2>
    <div class="transition-stats">
      Enemies Killed: ${floorStats.enemiesKilled || 0}<br>
      Items Found: ${floorStats.itemsFound || 0}<br>
      Traps Triggered: ${floorStats.trapsTriggered || 0}<br>
      ${floorStats.damageDealt ? `Damage Dealt: ${floorStats.damageDealt}<br>` : ""}
      ${floorStats.damageTaken ? `Damage Taken: ${floorStats.damageTaken}<br>` : ""}
    </div>
    ${
      settings.confirmDescend
        ? `<div style="display:flex; gap: 10px; justify-content:center; flex-wrap: wrap;">
            <button type="button" id="continueBtn">Descend</button>
            <button type="button" id="cancelDescendBtn" style="border-color: rgba(255,255,255,0.4); color: rgba(255,255,255,0.9);">Stay</button>
          </div>`
        : `<button type="button" id="continueBtn">Continue to Floor ${floor + 1}</button>`
    }
  `;

  const btn = document.getElementById("continueBtn");
  if (btn) {
    btn.onclick = () => {
      transitionEl.style.display = "none";
      playSound?.("floor");
      floor++;
      generateFloor();
    };
  }

  const cancelBtn = document.getElementById("cancelDescendBtn");
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      transitionEl.style.display = "none";
      gamePaused = false;
      draw();
    };
  }
  
  // Auto-save before continuing
  if (settings.autoSave) {
    saveGame("Auto-save");
  }
  
  // Auto-continue quickly when confirm is off.
  if (!settings.confirmDescend) {
    setTimeout(() => {
      if (transitionEl && transitionEl.style.display !== "none") {
        transitionEl.style.display = "none";
        playSound?.("floor");
        floor++;
        generateFloor();
      }
    }, 450);
  }
}

function showEnterDungeonPrompt() {
  showPromptOverlay(
    "Enter the dungeon?",
    `<div style="opacity:0.9; text-align:center;">Step inside and see what you can bring back out.</div>`,
    [
      {
        id: "enterDungeonBtn",
        label: "Enter",
        onClick: () => {
          const transitionEl = document.getElementById("floorTransition");
          if (transitionEl) transitionEl.style.display = "none";
          gamePaused = false;

          // New dive => new dungeon. Reseed so the floor layouts are fresh every time you enter.
          seedRng(createSeed());

          // New dive stats
          player.score = 0;
          player.kills = 0;
          player.combo = 0;
          player.statusEffects = {};

          floor = 1;
          generateFloor();
        },
      },
      {
        id: "stayOutsideBtn",
        label: "Stay",
        subtle: true,
        onClick: () => {
          const transitionEl = document.getElementById("floorTransition");
          if (transitionEl) transitionEl.style.display = "none";
          gamePaused = false;
          draw();
        },
      },
    ],
  );
}

function showExitToCourtyardPrompt() {
  showPromptOverlay(
    "Exit to courtyard?",
    `<div style="opacity:0.9; text-align:center;">Leaving ends this dive. Bring loot to the courtyard shop to sell for gold.</div>`,
    [
      {
        id: "exitToCourtyardBtn",
        label: "Exit",
        onClick: () => {
          const transitionEl = document.getElementById("floorTransition");
          if (transitionEl) transitionEl.style.display = "none";
          gamePaused = false;
          try {
            runStats.endedAt = Date.now();
            runStats.floorsReached = Math.max(Number(runStats.floorsReached || 0), Number(floor || 0));
          } catch {
            // ignore
          }
          floor = 0;
          generateFloor();
          // Show run summary after arriving in the courtyard.
          setTimeout(() => {
            showRunSummaryOverlay?.();
          }, 30);
        },
      },
      {
        id: "stayInsideBtn",
        label: "Stay",
        subtle: true,
        onClick: () => {
          const transitionEl = document.getElementById("floorTransition");
          if (transitionEl) transitionEl.style.display = "none";
          gamePaused = false;
          draw();
        },
      },
    ],
  );
}

function showRunSummaryOverlay() {
  try {
    const durSec =
      runStats?.startedAt ? Math.max(0, Math.floor((Date.now() - Number(runStats.startedAt || 0)) / 1000)) : 0;
    const timeLine = durSec ? `${Math.floor(durSec / 60)}m ${durSec % 60}s` : "—";
    const best = runStats.bestWeaponName ? escapeHtml(runStats.bestWeaponName) : "(none)";
    const bDone = (player?.bounties?.accepted || []).filter((b) => b.completed).length;
    showPromptOverlay(
      "Run Summary",
      `<div style="text-align:center; opacity:0.92;">
        Floors reached: ${Number(runStats.floorsReached || 0)}<br>
        Time: ${escapeHtml(timeLine)}<br><br>
        Kills: ${Number(runStats.enemiesKilled || 0)}<br>
        Items found: ${Number(runStats.itemsFound || 0)}<br>
        Damage dealt: ${Number(runStats.damageDealt || 0)}<br>
        Damage taken: ${Number(runStats.damageTaken || 0)}<br>
        Props destroyed: ${Number(runStats.propsDestroyed || 0)}<br>
        Gold earned: ${Number(runStats.goldEarned || 0)}<br>
        Best weapon: ${best}<br>
        Bounties completed: ${bDone}
      </div>`,
      [
        {
          id: "summaryOkBtn",
          label: "Continue",
          onClick: () => {
            const transitionEl = document.getElementById("floorTransition");
            if (transitionEl) transitionEl.style.display = "none";
            gamePaused = false;
            draw();
          },
        },
      ],
    );
  } catch {
    // ignore
  }
}
window.showRunSummaryOverlay = showRunSummaryOverlay;

function getAllSaves() {
  try {
    const savesStr = localStorage.getItem("dungeonGameSaves");
    if (!savesStr) return [];
    return JSON.parse(savesStr);
  } catch (e) {
    return [];
  }
}

function saveSavesList(saves) {
  try {
    localStorage.setItem("dungeonGameSaves", JSON.stringify(saves));
    return true;
  } catch (e) {
    return false;
  }
}

function serializeHiddenArea(ha) {
  if (!ha) return null;
  return {
    ...ha,
    tiles: Array.from(ha.tiles || []),
    falseWalls: Array.from(ha.falseWalls || []),
  };
}

function deserializeHiddenArea(ha) {
  if (!ha) return null;
  return {
    ...ha,
    tiles: new Set(ha.tiles || []),
    falseWalls: new Set(ha.falseWalls || []),
  };
}

function saveGame(saveName = null) {
  try {
    if (settings?.permadeath) {
      addLog("Saving disabled (Permadeath)", "info");
      return false;
    }

    const trimmedLog = Array.isArray(logHistory) ? logHistory.slice(-200) : [];
    const exploredArr = Array.from(explored || []);
    const trimmedExplored = exploredArr.length > 25000 ? exploredArr.slice(-25000) : exploredArr;

    const saveData = {
      id: `save_${Date.now()}`,
      name: saveName || `Save ${new Date().toLocaleString()}`,
      player,
      floor,
      score: player.score,
      timestamp: Date.now(),
      version: 2,
      state: {
        runSeed,
        rngState,
        zoomScale,
        floorStats,
        hiddenTrapCount,
        explored: trimmedExplored,
        map,
        rooms,
        enemies,
        hiddenArea: serializeHiddenArea(hiddenArea),
        mouse,
        logHistory: trimmedLog,
      },
    };
    
    // Get all saves
    const saves = getAllSaves();
    
    // Remove old save if it exists (by name or add new)
    const existingIndex = saves.findIndex(s => s.name === saveData.name);
    if (existingIndex >= 0) {
      saves[existingIndex] = saveData;
    } else {
      saves.push(saveData);
    }
    
    // Keep only last 5 saves (full dungeon state can be large in localStorage).
    saves.sort((a, b) => b.timestamp - a.timestamp);
    const limitedSaves = saves.slice(0, 5);
    
    let ok = saveSavesList(limitedSaves);
    if (!ok) {
      // Fallback: try a smaller save (drop explored, further trim log).
      try {
        const lite = typeof structuredClone === "function" ? structuredClone(saveData) : JSON.parse(JSON.stringify(saveData));
        if (lite?.state) {
          lite.state.explored = [];
          lite.state.logHistory = trimmedLog.slice(-50);
        }
        const saves2 = getAllSaves().sort((a, b) => b.timestamp - a.timestamp).slice(0, 4);
        saves2.unshift(lite);
        ok = saveSavesList(saves2);
      } catch {
        // ignore
      }
      if (!ok) {
        addLog("Save failed (storage full?)", "danger");
        return false;
      }
      addLog("Saved (lite)", "info");
      return true;
    }
    addLog(`Game saved: ${saveData.name}`, "info");
    return true;
  } catch (e) {
    addLog("Save failed", "danger");
    return false;
  }
}

function loadGame(saveId = null) {
  try {
    if (settings?.permadeath) {
      addLog("Loading disabled (Permadeath)", "info");
      return false;
    }

    const saves = getAllSaves();
    
    if (saves.length === 0) {
      addLog("No saved games found", "info");
      return false;
    }
    
    // If no ID provided, load the most recent
    let saveData;
    if (saveId) {
      saveData = saves.find(s => s.id === saveId);
      if (!saveData) {
        addLog("Save not found", "danger");
        return false;
      }
    } else {
      // Load most recent
      saveData = saves.sort((a, b) => b.timestamp - a.timestamp)[0];
    }
    
    player = { ...player, ...saveData.player };
    if (!Number.isFinite(player.maxInventory)) player.maxInventory = 10;
    if (!Number.isFinite(player.gold)) player.gold = 0;
    if (!player.gear || typeof player.gear !== "object") player.gear = { weapon: 0, armor: 0, pack: 0 };
    if (!Number.isFinite(player.gear.weapon)) player.gear.weapon = 0;
    if (!Number.isFinite(player.gear.armor)) player.gear.armor = 0;
    if (!Number.isFinite(player.gear.pack)) player.gear.pack = 0;
    if (!player.hands || typeof player.hands !== "object") player.hands = { main: null, off: null };
    if (!("main" in player.hands)) player.hands.main = null;
    if (!("off" in player.hands)) player.hands.off = null;
    floor = saveData.floor || floor;

    // Restore full game state if present.
    if (saveData.state) {
      runSeed = (saveData.state.runSeed >>> 0) || runSeed || 1;
      rngState = (saveData.state.rngState >>> 0) || rngState || runSeed || 1;
      zoomScale = Number(saveData.state.zoomScale || 1);
      floorStats = saveData.state.floorStats || floorStats;
      hiddenTrapCount = Number(saveData.state.hiddenTrapCount || 0);
      explored = new Set(saveData.state.explored || []);
      map = saveData.state.map || map;
      rooms = saveData.state.rooms || rooms;
      enemies = saveData.state.enemies || enemies;
      hiddenArea = deserializeHiddenArea(saveData.state.hiddenArea);
      mouse = saveData.state.mouse || mouse;
      logHistory = saveData.state.logHistory || logHistory;
      liveLogs = [];
    } else {
      // Older saves: keep behavior (regen the floor), but ensure RNG exists.
      if (!runSeed) seedRng(createSeed());
    }
    
    // Start a run without wiping the loaded player stats.
    startGame({ fromLoad: true, skipGenerateFloor: !!saveData.state });
    addLog(`Game loaded: ${saveData.name}`, "loot");
    return true;
  } catch (e) {
    addLog("Load failed", "danger");
    return false;
  }
}

function deleteSave(saveId) {
  try {
    const saves = getAllSaves();
    const filtered = saves.filter(s => s.id !== saveId);
    saveSavesList(filtered);
    return true;
  } catch (e) {
    return false;
  }
}

function showLoadMenu() {
  const mainMenuEl = document.getElementById("mainMenu");
  if (!mainMenuEl) return;

  if (settings?.permadeath) {
    mainMenuEl.innerHTML = `
      <div class="menu-screen">
        <h1 class="menu-title">Load Game</h1>
        <div class="menu-buttons">
          <div style="text-align: center; padding: 20px; color: var(--accent);">Disabled in Permadeath</div>
          <button type="button" class="menu-screen-button" id="backToMainMenuBtn">Back to Menu</button>
        </div>
      </div>
    `;
    const backBtn = document.getElementById("backToMainMenuBtn");
    if (backBtn) backBtn.addEventListener("click", () => initMainMenu());
    return;
  }
  
  const saves = getAllSaves();
  
  if (saves.length === 0) {
    mainMenuEl.innerHTML = `
      <div class="menu-screen">
        <h1 class="menu-title">Load Game</h1>
        <div class="menu-buttons">
          <div style="text-align: center; padding: 20px; color: var(--accent);">No saved games found</div>
          <button type="button" class="menu-screen-button" id="backToMainMenuBtn">Back to Menu</button>
        </div>
      </div>
    `;
    
    const backBtn = document.getElementById("backToMainMenuBtn");
    if (backBtn) {
      backBtn.addEventListener("click", () => {
        initMainMenu();
      });
    }
    return;
  }
  
  // Sort by timestamp (newest first)
  saves.sort((a, b) => b.timestamp - a.timestamp);
  
  const saveButtons = saves.map((save, index) => {
    const date = new Date(save.timestamp);
    const dateStr = date.toLocaleString();
    return `
      <div style="display: flex; flex-direction: column; gap: 5px; margin: 5px 0;">
        <button type="button" class="menu-screen-button" data-load-save="${save.id}" style="text-align: left; padding: 12px 16px;">
          <div style="font-weight: bold;">${escapeHtml(save.name)}</div>
          <div style="font-size: 0.85em; opacity: 0.8;">Floor ${save.floor} | Score: ${save.score || 0}</div>
          <div style="font-size: 0.75em; opacity: 0.6;">${dateStr}</div>
        </button>
        <button type="button" class="menu-screen-button" data-delete-save="${save.id}" style="padding: 6px 12px; font-size: 0.9em; border-color: #ff4444; color: #ff4444; background: rgba(255, 68, 68, 0.1);">
          Delete
        </button>
      </div>
    `;
  }).join("");
  
  mainMenuEl.innerHTML = `
    <div class="menu-screen">
      <h1 class="menu-title">Load Game</h1>
      <div class="menu-buttons" style="max-height: 60vh; overflow-y: auto;">
        ${saveButtons}
        <button type="button" class="menu-screen-button" id="backToMainMenuBtn" style="margin-top: 15px;">Back to Menu</button>
      </div>
    </div>
  `;
  
  // Bind load buttons
  saves.forEach(save => {
    const loadBtn = document.querySelector(`[data-load-save="${save.id}"]`);
    if (loadBtn) {
      loadBtn.addEventListener("click", () => {
        loadGame(save.id);
      });
    }
    
    const deleteBtn = document.querySelector(`[data-delete-save="${save.id}"]`);
    if (deleteBtn) {
      deleteBtn.addEventListener("click", () => {
        if (confirm(`Delete save "${save.name}"?`)) {
          deleteSave(save.id);
          showLoadMenu(); // Refresh the menu
        }
      });
    }
  });
  
  const backBtn = document.getElementById("backToMainMenuBtn");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      initMainMenu();
    });
  }
}

function startGame(options = {}) {
  const { fromLoad = false, skipGenerateFloor = false } = options || {};

  // Reset player stats for new game (but do not reset when loading a save)
  if (!gameStarted && !fromLoad) {
    try {
      resetRunStats?.();
    } catch {
      // ignore
    }
    seedRng(createSeed());
    player = {
      x: 0,
      y: 0,
      hp: 10,
      maxHp: 10,
      dmg: 0,
      toughness: 0,
      inventory: [],
      maxInventory: 10,
      hands: { main: null, off: null },
      hunger: 10,
      maxHunger: 10,
      kills: 0,
      combo: 0,
      score: 0,
      gold: 0,
      gear: { weapon: 0, armor: 0, pack: 0 },
      statusEffects: {},
      name: "",
      talent: "",
    };
    floor = 0;
  }

  // Mark game as started even if we came from a load.
  if (!gameStarted) gameStarted = true;
  try {
    normalizePlayerMeta?.();
    syncHotbar?.();
  } catch {
    // ignore
  }
  
  inMainMenu = false;
  const mainMenuEl = document.getElementById("mainMenu");
  const mapContainerEl = document.getElementById("mapContainer");
  const controlsEl = document.getElementById("controls");
  
  if (mainMenuEl) mainMenuEl.style.display = "none";
  if (mapContainerEl) mapContainerEl.style.display = "flex";
  if (controlsEl) controlsEl.style.display = "flex";
  
  const begin = () => {
    if (skipGenerateFloor) {
      setMenuOpen(false);
      draw();
    } else {
      generateFloor();
      setMenuOpen(false);
    }
  };

  // New game: do the recruiter intro first, then start in the courtyard.
  if (!fromLoad && !skipGenerateFloor) {
    showRecruiterIntro(begin);
  } else {
    begin();
  }
}

function returnToMainMenu() {
  inMainMenu = true;
  gameStarted = false;
  gamePaused = true;
  setMenuOpen(false);
  
  const mainMenuEl = document.getElementById("mainMenu");
  const mapContainerEl = document.getElementById("mapContainer");
  const controlsEl = document.getElementById("controls");
  const quitBtn = document.getElementById("quitGameBtn");
  
  if (mainMenuEl) mainMenuEl.style.display = "flex";
  if (mapContainerEl) mapContainerEl.style.display = "none";
  if (controlsEl) controlsEl.style.display = "none";
  if (quitBtn) quitBtn.style.display = "block";
  
  // Reset game state
  stopAutoMove();
  damageNumbers = [];
  logHistory = [];
  liveLogs = [];
}

function quitToMenu() {
  if (confirm("Quit to main menu? Progress will be saved.")) {
    if (settings.autoSave && !settings?.permadeath) {
      saveGame("Auto-save");
    }
    returnToMainMenu();
  }
}

function showMainMenuSettings() {
  const mainMenuEl = document.getElementById("mainMenu");
  if (!mainMenuEl) return;
  
  const highScore = localStorage.getItem("dungeonHighScore") || 0;
  const saves = getAllSaves();
  const hasSave = saves.length > 0;
  
  mainMenuEl.innerHTML = `
    <div class="menu-screen">
      <h1 class="menu-title">Settings</h1>
      <div class="menu-buttons" style="align-items: stretch;">
        <div style="margin-bottom: 15px; text-align: center; padding: 10px; background: rgba(0, 0, 0, 0.5); border-radius: 8px;">
          <div style="margin: 10px 0;">High Score: ${highScore}</div>
          ${hasSave ? '<div style="margin: 10px 0; color: #0ff;">Saved game available</div>' : ''}
        </div>
        <label style="display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--accent); border-radius: 8px; margin: 5px 0;">
          <input type="checkbox" ${settings.showDamageNumbers ? "checked" : ""} id="setting-damage" style="width: 20px; height: 20px;">
          Show Damage Numbers
        </label>
        <label style="display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--accent); border-radius: 8px; margin: 5px 0;">
          <input type="checkbox" ${settings.showEnemyHealth ? "checked" : ""} id="setting-health" style="width: 20px; height: 20px;">
          Show Enemy Health
        </label>
        <label style="display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--accent); border-radius: 8px; margin: 5px 0;">
          <input type="checkbox" ${settings.autoSave ? "checked" : ""} id="setting-autosave" style="width: 20px; height: 20px;">
          Auto-Save
        </label>
        <label style="display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--accent); border-radius: 8px; margin: 5px 0;">
          <input type="checkbox" ${settings.soundEnabled ? "checked" : ""} id="setting-sound" style="width: 20px; height: 20px;">
          Sound
        </label>
        <label style="display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--accent); border-radius: 8px; margin: 5px 0;">
          <input type="checkbox" ${settings.largeText ? "checked" : ""} id="setting-large-text" style="width: 20px; height: 20px;">
          Large Text
        </label>
        <label style="display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--accent); border-radius: 8px; margin: 5px 0;">
          <input type="checkbox" ${settings.highContrast ? "checked" : ""} id="setting-high-contrast" style="width: 20px; height: 20px;">
          High Contrast
        </label>
        <label style="display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--accent); border-radius: 8px; margin: 5px 0;">
          <input type="checkbox" ${settings.reducedMotion ? "checked" : ""} id="setting-reduced-motion" style="width: 20px; height: 20px;">
          Reduced Motion
        </label>
        <label style="display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--accent); border-radius: 8px; margin: 5px 0;">
          <input type="checkbox" ${settings.reducedFlashing ? "checked" : ""} id="setting-reduced-flashing" style="width: 20px; height: 20px;">
          Reduced Flashing
        </label>
        <label style="display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--accent); border-radius: 8px; margin: 5px 0;">
          <input type="checkbox" ${settings.diagonalMelee ? "checked" : ""} id="setting-diagonal-melee" style="width: 20px; height: 20px;">
          Diagonal Melee
        </label>
        <label style="display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--accent); border-radius: 8px; margin: 5px 0;">
          <input type="checkbox" ${settings.haptics ? "checked" : ""} id="setting-haptics" style="width: 20px; height: 20px;">
          Haptics (vibration)
        </label>
        <label style="display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--accent); border-radius: 8px; margin: 5px 0;">
          <input type="checkbox" ${settings.confirmDescend ? "checked" : ""} id="setting-confirm-descend" style="width: 20px; height: 20px;">
          Confirm descend on trapdoor
        </label>
        <label style="display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--accent); border-radius: 8px; margin: 5px 0;">
          <input type="checkbox" ${settings.permadeath ? "checked" : ""} id="setting-permadeath" style="width: 20px; height: 20px;">
          Permadeath (no saves)
        </label>
        <button type="button" class="menu-screen-button" id="backToMenuBtn" style="margin-top: 15px;">Back to Menu</button>
      </div>
    </div>
  `;
  
  const backBtn = document.getElementById("backToMenuBtn");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      initMainMenu();
    });
  }
  
  const damageCheck = document.getElementById("setting-damage");
  const healthCheck = document.getElementById("setting-health");
  const autosaveCheck = document.getElementById("setting-autosave");
  const soundCheck = document.getElementById("setting-sound");
  const largeTextCheck = document.getElementById("setting-large-text");
  const highContrastCheck = document.getElementById("setting-high-contrast");
  const reducedMotionCheck = document.getElementById("setting-reduced-motion");
  const reducedFlashingCheck = document.getElementById("setting-reduced-flashing");
  const diagonalMeleeCheck = document.getElementById("setting-diagonal-melee");
  const hapticsCheck = document.getElementById("setting-haptics");
  const confirmDescendCheck = document.getElementById("setting-confirm-descend");
  const permadeathCheck = document.getElementById("setting-permadeath");
  
  if (damageCheck) {
    damageCheck.addEventListener("change", (e) => {
      settings.showDamageNumbers = e.target.checked;
      localStorage.setItem("dungeonGameSettings", JSON.stringify(settings));
    });
  }
  
  if (healthCheck) {
    healthCheck.addEventListener("change", (e) => {
      settings.showEnemyHealth = e.target.checked;
      window.gameSettings = settings;
      localStorage.setItem("dungeonGameSettings", JSON.stringify(settings));
    });
  }
  
  if (autosaveCheck) {
    autosaveCheck.addEventListener("change", (e) => {
      settings.autoSave = e.target.checked;
      localStorage.setItem("dungeonGameSettings", JSON.stringify(settings));
    });
  }

  if (soundCheck) {
    soundCheck.addEventListener("change", (e) => {
      settings.soundEnabled = e.target.checked;
      localStorage.setItem("dungeonGameSettings", JSON.stringify(settings));
      // Tiny confirmation ping.
      if (settings.soundEnabled) playSound("menu");
    });
  }

  const bindA11y = (el, key) => {
    if (!el) return;
    el.addEventListener("change", (e) => {
      settings[key] = !!e.target.checked;
      localStorage.setItem("dungeonGameSettings", JSON.stringify(settings));
      applyAccessibilitySettings();
    });
  };

  bindA11y(largeTextCheck, "largeText");
  bindA11y(highContrastCheck, "highContrast");
  bindA11y(reducedMotionCheck, "reducedMotion");
  bindA11y(reducedFlashingCheck, "reducedFlashing");
  bindA11y(diagonalMeleeCheck, "diagonalMelee");

  if (hapticsCheck) {
    hapticsCheck.addEventListener("change", (e) => {
      settings.haptics = e.target.checked;
      localStorage.setItem("dungeonGameSettings", JSON.stringify(settings));
      // Provide a tiny confirmation pulse.
      if (settings.haptics) vibrate(10);
    });
  }

  if (confirmDescendCheck) {
    confirmDescendCheck.addEventListener("change", (e) => {
      settings.confirmDescend = e.target.checked;
      localStorage.setItem("dungeonGameSettings", JSON.stringify(settings));
    });
  }

  if (permadeathCheck) {
    permadeathCheck.addEventListener("change", (e) => {
      settings.permadeath = !!e.target.checked;
      // If enabling permadeath, also disable autosave (it’s meaningless).
      if (settings.permadeath) settings.autoSave = false;
      localStorage.setItem("dungeonGameSettings", JSON.stringify(settings));
    });
  }
}

function initMainMenu() {
  const mainMenuEl = document.getElementById("mainMenu");
  if (!mainMenuEl) return;
  
  const highScore = localStorage.getItem("dungeonHighScore") || 0;
  const saves = getAllSaves();
  const hasSave = saves.length > 0;
  const versionLabel = typeof GAME_VERSION === "string" ? GAME_VERSION : (window.GAME_VERSION || "");
  
  mainMenuEl.innerHTML = `
    <div class="menu-screen">
      <h1 class="menu-title">Dungeon Roguelike</h1>
      ${versionLabel ? `<div class="menu-version">v${escapeHtml(versionLabel)}</div>` : ""}
      <div class="menu-buttons">
        <button type="button" id="startGameBtn" class="menu-screen-button">Start Game</button>
        ${settings?.permadeath ? "" : `<button type="button" id="loadGameBtn" class="menu-screen-button">Load Game</button>`}
        <button type="button" id="settingsMenuBtn" class="menu-screen-button">Settings</button>
        ${gameStarted ? '<button type="button" id="quitToMenuBtn" class="menu-screen-button">Quit to Menu</button>' : ''}
        <button type="button" id="quitGameBtn" class="menu-screen-button" style="margin-top: 10px; border-color: #ff4444; color: #ff4444;">Quit Game</button>
      </div>
      ${highScore > 0 ? `<div style="margin-top: 20px; text-align: center; color: var(--accent);">High Score: ${highScore}</div>` : ''}
    </div>
  `;
  
  // Re-bind event handlers
  const startBtn = document.getElementById("startGameBtn");
  const loadBtn = document.getElementById("loadGameBtn");
  const settingsBtn = document.getElementById("settingsMenuBtn");
  const quitToMenuBtn = document.getElementById("quitToMenuBtn");
  const quitGameBtn = document.getElementById("quitGameBtn");
  
  if (startBtn) startBtn.addEventListener("click", startGame);
  if (loadBtn) loadBtn.addEventListener("click", showLoadMenu);
  if (settingsBtn) settingsBtn.addEventListener("click", showMainMenuSettings);
  if (quitToMenuBtn) quitToMenuBtn.addEventListener("click", quitToMenu);
  if (quitGameBtn) quitGameBtn.addEventListener("click", quitGame);
}

function quitGame() {
  if (confirm("Quit the game? Your progress will be saved automatically.")) {
    if (settings.autoSave && gameStarted && !settings?.permadeath) {
      saveGame("Auto-save");
    }
    // Close the window/tab if possible, otherwise just show a message
    try {
      window.close();
    } catch (e) {
      // Can't close window (might be opened by user), just return to menu
      returnToMainMenu();
      addLog("Game saved. You can close this tab/window.", "info");
    }
  }
}

function setInvestigateArmed(armed) {
  investigateArmed = !!armed;
  if (investigateBtnEl) investigateBtnEl.classList.toggle("is-armed", investigateArmed);
  if (investigateArmed) addLog("Investigation armed. Tap something on the map.", "info");
}

function getInvestigationInfoAt(tx, ty) {
  const key = `${tx},${ty}`;

  if (tx === player.x && ty === player.y) return { kind: "player" };

  const enemy = enemies.find((e) => e.x === tx && e.y === ty);
  if (enemy) return { kind: "enemy", enemy };

  if (mouse && tx === mouse.x && ty === mouse.y) return { kind: "mouse" };
  
  const prop = propAtKey?.(key);
  if (prop) return { kind: "prop", prop };

  // Hidden area tiles render as walls until revealed.
  if (hiddenArea && !hiddenArea.revealed && hiddenArea.tiles?.has(key)) {
    const isFalseWall = hiddenArea.falseWalls?.has(key);
    return { kind: isFalseWall ? "falseWall" : "wall" };
  }

  const loot = lootAtKey(key);
  if (loot) {
    const effect = String(loot?.effect || "").toLowerCase();
    if (effect === "food") return { kind: "food", food: loot };
    if (effect === "valuable") return { kind: "valuable", valuable: loot };
    if (effect === "weapon") return { kind: "weapon", weapon: loot };
    if (effect === "material") return { kind: "material", material: loot };
    if (effect === "trinket") return { kind: "trinket", trinket: loot };
    return { kind: "potion", potion: loot };
  }

  const trap = trapAtKey(key);
  if (trap) return { kind: "trap", trap };

  const ch = tileAtKey(key);
  if (ch === TILE.TRAPDOOR) return { kind: "trapdoor" };
  if (ch === TILE.ENTRANCE) return { kind: "entrance" };
  if (ch === TILE.UPSTAIRS) return { kind: "upstairs" };

  if (ch === TILE.GRASS) return { kind: "grass" };



  if (ch === TILE.CAMPFIRE) return { kind: "campfire" };
  if (ch === TILE.SHOP) return { kind: "shop" };
  if (ch === TILE.BLACKSMITH) return { kind: "blacksmith" };
  if (ch === TILE.BOUNTY) return { kind: "bounty" };
  if (ch === TILE.SHRINE) return { kind: "shrine" };
  if (ch === TILE.WALL) return { kind: "wall" };
  return { kind: "floor" };
}

function investigateAt(tx, ty) {
  const info = getInvestigationInfoAt(tx, ty);
  const describe = window.getInvestigationDescription;
  let text = typeof describe === "function" ? describe(info) : "You investigate it. It investigates you back.";

  const kind = String(info?.kind || "info").toLowerCase();
  
  const logType =
    kind === "enemy"
      ? "enemy"
      : kind === "trap"
        ? "danger"
        : kind === "potion" || kind === "food"
          ? "loot"
          : kind === "trapdoor"
            ? "floor"
            : "info";

  addLog(text, logType);
}

function toggleMenu() {
  setMenuOpen(!menuOpen);
  draw();
}

function setTab(tab) {
  activeTab = tab;
  draw();
}

function canMove(x, y) {
  const ch = tileAt(x, y);
  if (!isWalkableTile(ch)) return false;
  if (hiddenArea && !hiddenArea.revealed && hiddenArea.tiles?.has(keyOf(x, y))) return false;
  if (enemies.some((e) => e.x === x && e.y === y)) return false;
  return true;
}

function canEnemyMove(x, y) {
  const k = keyOf(x, y);
  const ch = tileAtKey(k);
  if (!isWalkableTile(ch)) return false;
  if (hiddenArea && !hiddenArea.revealed && hiddenArea.tiles?.has(k)) return false;
  if (enemies.some((e) => e.x === x && e.y === y)) return false;

  // Enemies avoid visible traps (~), but can still step on hidden traps (they look like floor).
  if (ch === TILE.TRAP_VISIBLE) return false;
  // Enemies avoid shrines so the player can interact.
  if (ch === TILE.SHRINE) return false;
  const trap = trapAtKey(k);
  if (trap && !trap.hidden) return false;

  return true;
}

function stopAutoMove() {
  if (autoMove?.timerId) window.clearInterval(autoMove.timerId);
  autoMove = { timerId: null, path: [], attackTarget: null, mode: null };
}

function isPlayerWalkable(x, y) {
  const k = keyOf(x, y);
  // Hidden area tiles block movement until revealed, except the entrance false-wall tiles.
  if (hiddenArea && !hiddenArea.revealed && hiddenArea.tiles?.has(k) && !hiddenArea.falseWalls?.has(k)) return false;

  // Enemies block movement.
  if (enemies.some((e) => e.x === x && e.y === y)) return false;

  const tile = tileAtKey(k);

  // Props are solid until smashed.
  if (tile === TILE.CRATE || tile === TILE.BARREL) return false;

  // Allow stepping onto loot glyphs (loot is stored in *_loot; the visible glyph is not walkable terrain).
  if (lootAtKey(k)) return true;

  // Otherwise require walkable terrain/special tiles.
  return isWalkableTile(tile);
}

function buildPathBfs(goalX, goalY, limitOverride = null) {
  const startX = player.x;
  const startY = player.y;
  const startKey = keyOf(startX, startY);
  const goalKey = keyOf(goalX, goalY);
  if (goalKey === startKey) return [];

  // The player can only tap within the visible grid, so keep BFS bounded for performance.
  const LIMIT =
    Number.isFinite(limitOverride) && limitOverride != null
      ? Math.max(10, Math.floor(limitOverride))
      : Math.max(30, getViewRadius() + 8);

  const prev = new Map();
  prev.set(startKey, null);

  const q = [{ x: startX, y: startY }];
  let qi = 0;

  const dirs = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
    { dx: 1, dy: 1 },
    { dx: 1, dy: -1 },
    { dx: -1, dy: 1 },
    { dx: -1, dy: -1 },
  ];

  while (qi < q.length) {
    const cur = q[qi++];
    for (const d of dirs) {
      const nx = cur.x + d.dx;
      const ny = cur.y + d.dy;
      if (Math.abs(nx - startX) > LIMIT || Math.abs(ny - startY) > LIMIT) continue;

      const nk = keyOf(nx, ny);
      if (prev.has(nk)) continue;
      if (!isStepAllowed(cur.x, cur.y, nx, ny, isPlayerWalkable)) continue;

      prev.set(nk, keyOf(cur.x, cur.y));
      if (nk === goalKey) {
        qi = q.length;
        break;
      }
      q.push({ x: nx, y: ny });
    }
  }

  if (!prev.has(goalKey)) return null;

  const steps = [];
  let curKey = goalKey;
  while (curKey && curKey !== startKey) {
    const parentKey = prev.get(curKey);
    if (!parentKey) break;
    const [cx, cy] = curKey.split(",").map(Number);
    const [px, py] = parentKey.split(",").map(Number);
    steps.push({ dx: cx - px, dy: cy - py });
    curKey = parentKey;
  }
  steps.reverse();
  return steps;
}

function startAutoMoveTo(targetX, targetY) {
  stopAutoMove();
  if (gamePaused || menuOpen) return;
  autoMove.mode = null;

  const tile = map[keyOf(targetX, targetY)] || "#";
  if (tile === "#") return;

  // If tapping an enemy, path to an adjacent tile, then do one final attack step.
  const enemy = enemies.find((e) => e.x === targetX && e.y === targetY);
  if (enemy) {
    const adj = [
      { x: targetX + 1, y: targetY },
      { x: targetX - 1, y: targetY },
      { x: targetX, y: targetY + 1 },
      { x: targetX, y: targetY - 1 },
      { x: targetX + 1, y: targetY + 1 },
      { x: targetX + 1, y: targetY - 1 },
      { x: targetX - 1, y: targetY + 1 },
      { x: targetX - 1, y: targetY - 1 },
    ].filter((p) => isPlayerWalkable(p.x, p.y));

    if (!adj.length) return;

    let best = null;
    for (const a of adj) {
      const path = buildPathBfs(a.x, a.y);
      if (!path) continue;
      if (!best || path.length < best.path.length) best = { x: a.x, y: a.y, path };
    }
    if (!best) return;

    autoMove.path = best.path;
    autoMove.attackTarget = { x: targetX, y: targetY };
  } else {
    const path = buildPathBfs(targetX, targetY);
    if (!path) return;
    autoMove.path = path;
    autoMove.attackTarget = null;
  }

  autoMove.timerId = window.setInterval(() => {
    if (gamePaused || menuOpen) {
      stopAutoMove();
      return;
    }

    if (autoMove.path.length) {
      const step = autoMove.path.shift();
      if (!step) {
        stopAutoMove();
        return;
      }
      move(step.dx, step.dy);
      return;
    }

    if (autoMove.attackTarget) {
      const ax = autoMove.attackTarget.x;
      const ay = autoMove.attackTarget.y;
      const dist = chebDist(player.x, player.y, ax, ay);
      if (dist === 1) move(Math.sign(ax - player.x), Math.sign(ay - player.y));
    }

    stopAutoMove();
  }, 120);
}

function findFirstTile(ch) {
  const want = String(ch || "");
  for (const [k, v] of Object.entries(map || {})) {
    if (k.includes("_")) continue;
    if (v !== want) continue;
    const [xs, ys] = k.split(",");
    const x = Number(xs);
    const y = Number(ys);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    return { x, y };
  }
  return null;
}

function startWalkout() {
  if (inMainMenu) return;
  if (menuOpen) setMenuOpen(false);

  if (floor === 0) {
    addLog("You are already outside.", "info");
    draw();
    return;
  }

  const exit = findFirstTile(TILE.UPSTAIRS);
  if (!exit) {
    addLog("No exit found.", "danger");
    draw();
    return;
  }

  // Walkout should handle long routes. Use a larger BFS bound based on distance.
  const d = Math.abs(exit.x - player.x) + Math.abs(exit.y - player.y);
  const limit = clamp(d + 30, 60, 220);

  stopAutoMove();
  const path = buildPathBfs(exit.x, exit.y, limit);
  if (!path) {
    addLog("Can't find a route out.", "danger");
    draw();
    return;
  }
  autoMove.path = path;
  autoMove.attackTarget = null;
  autoMove.mode = "walkout";
  autoMove.timerId = window.setInterval(() => {
    if (gamePaused || menuOpen) {
      stopAutoMove();
      return;
    }
    if (autoMove.path.length) {
      const step = autoMove.path.shift();
      if (!step) {
        stopAutoMove();
        return;
      }
      move(step.dx, step.dy);
      return;
    }
    stopAutoMove();
  }, 120);

  addLog("Walking out...", "info");
  draw();
}

function showPromptOverlay(title, bodyHtml, buttons) {
  const transitionEl = document.getElementById("floorTransition");
  if (!transitionEl) return false;
  stopAutoMove();
  setInvestigateArmed(false);
  gamePaused = true;

  const btnHtml = (buttons || [])
    .map(
      (b) =>
        `<button type="button" id="${escapeHtml(b.id)}" style="${b.subtle ? "border-color: rgba(255,255,255,0.4); color: rgba(255,255,255,0.9);" : ""}">${escapeHtml(
          b.label,
        )}</button>`,
    )
    .join("");

  transitionEl.style.display = "flex";
  transitionEl.innerHTML = `
    <h2>${escapeHtml(title || "")}</h2>
    <div class="transition-stats">${bodyHtml || ""}</div>
    <div style="display:flex; gap: 10px; justify-content:center; flex-wrap: wrap;">${btnHtml}</div>
  `;

  for (const b of buttons || []) {
    const el = document.getElementById(b.id);
    if (!el) continue;
    el.onclick = () => b.onClick?.();
  }
  return true;
}


function showDialogueOverlay(title, pages, onDone) {
  const transitionEl = document.getElementById("floorTransition");
  if (!transitionEl) return false;
  stopAutoMove();
  setInvestigateArmed(false);
  gamePaused = true;

  const pageList = Array.isArray(pages) ? pages.filter(Boolean) : [];
  if (!pageList.length) return false;

  let idx = 0;

  const close = () => {
    transitionEl.style.display = "none";
    gamePaused = false;
    onDone?.();
  };

  const render = () => {
    transitionEl.style.display = "flex";
    const isLast = idx >= pageList.length - 1;
    transitionEl.innerHTML = `
      <h2>${escapeHtml(title || "")}</h2>
      <div class="transition-stats" style="text-align:left; max-width: 560px;">${pageList[idx]}</div>
      <div style="display:flex; gap: 10px; justify-content:center; flex-wrap: wrap;">
        ${idx > 0 ? `<button type="button" id="dlgBackBtn" style="border-color: rgba(255,255,255,0.4); color: rgba(255,255,255,0.9);">Back</button>` : ""}
        <button type="button" id="dlgNextBtn">${isLast ? "Continue" : "Next"}</button>
        <button type="button" id="dlgSkipBtn" style="border-color: rgba(255,255,255,0.4); color: rgba(255,255,255,0.9);">Skip</button>
      </div>
    `;

    const backBtn = document.getElementById("dlgBackBtn");
    if (backBtn) {
      backBtn.onclick = () => {
        idx = Math.max(0, idx - 1);
        playSound?.("menu");
        render();
      };
    }

    const nextBtn = document.getElementById("dlgNextBtn");
    if (nextBtn) {
      nextBtn.onclick = () => {
        playSound?.("menu");
        if (idx >= pageList.length - 1) close();
        else {
          idx += 1;
          render();
        }
      };
    }

    const skipBtn = document.getElementById("dlgSkipBtn");
    if (skipBtn) {
      skipBtn.onclick = () => {
        playSound?.("menu");
        close();
      };
    }
  };

  render();
  return true;
}
function showRecruiterIntro(onDone) {
  const name = Array.isArray(NAMES) && NAMES.length ? NAMES[rand(0, NAMES.length - 1)] : "Unknown";
  const talentObj = Array.isArray(TALENTS) && TALENTS.length ? TALENTS[rand(0, TALENTS.length - 1)] : null;
  const talentLabel = talentObj?.label || "None";

  // Store for later systems (camp, lineage, etc.)
  player.name = name;
  player.talent = talentObj?.id || "none";
  // Apply a small, immediate passive so talents feel real.
  player.maxInventory = 10 + (player.talent === "packrat" ? 2 : 0);


  const you = (t) => `<div style="margin-top:6px; color: var(--accent);">You: ${t}</div>`;
  const rec = (t) => `<div style="opacity:0.92;">Recruiter: ${t}</div>`;

  const pages = [
    [rec("Alright, next. Step up."), rec("Name?")].join(""),
    [you(`I'm ${escapeHtml(name)}.`), rec("Good. Try to keep it.")].join(""),
    [rec("Any talents?"), rec("And don't say 'dying'.")].join(""),
    [you(`${escapeHtml(talentLabel)}.`), rec("That'll have to do.")].join(""),
    [rec("Rule one: you go in, you come back out."), rec("If you don't come back out… you're done.")].join(""),
    [rec("Courtyard's safe. Dungeon isn't."), rec("Bring something worth selling. Then go deeper.")].join(""),
    [you("Got it."), rec("Door's at the center. Don't make me regret this.")].join(""),

  ];

  showDialogueOverlay("Recruitment", pages, onDone);



}
