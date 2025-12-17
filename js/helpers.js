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
    ch === TILE.UPSTAIRS
  );
}

function getStatus(target, kind) {
  return target?.statusEffects?.[kind] || null;
}

function addStatus(target, kind, turns, value = 0) {
  if (!target) return;
  if (!target.statusEffects) target.statusEffects = {};
  target.statusEffects[kind] = { turns, value };
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
  let statusParts = [`Floor ${floor}`, `Score: ${player.score || 0}`];
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
}

function tickHunger(cost = 0) {
  // Hunger decreases with each player action.
  const c = Math.max(0, Number(cost || 0));
  const oldHunger = player.hunger;
  player.hunger = Math.max(0, Number(player.hunger || 0) - c);
  
  // Low hunger warning
  if (oldHunger >= 2 && player.hunger < 2 && player.hunger > 0) {
    addLog("Low hunger! Find food soon.", "danger");
  }
  
  if (player.hunger <= 0) {
    // Starvation: small damage each turn while empty.
    player.hp -= 0.01;
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
    if (missingHp > 0 && player.hunger >= HUNGER_COST_REGEN) {
      player.hp = Math.min(player.maxHp, player.hp + HP_REGEN_AMOUNT);
      player.hunger = Math.max(0, player.hunger - HUNGER_COST_REGEN);
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

function buyShopItem(shopIndex) {
  if (!atShop) return;
  const idx = Number(shopIndex);
  if (!Number.isFinite(idx)) return;

  const shopItems = [
    ...POTIONS.slice(0, 3).map((p, i) => ({ ...p, price: 50 + i * 25, shopIndex: i })),
    ...POTIONS.slice(3).map((p, i) => ({ ...p, price: 75 + i * 25, shopIndex: i + 3 })),
  ];

  const item = shopItems.find((it) => it.shopIndex === idx);
  if (!item) return;

  const price = Number(item.price || 0);
  if (player.score < price) {
    addLog("Not enough score", "block");
    return;
  }

  player.score -= price;
  // Store the base item (no price/shopIndex fields).
  const { price: _p, shopIndex: _s, ...baseItem } = item;
  player.inventory.push(baseItem);
  addLog(`Bought ${baseItem.name}`, "loot");
  vibrate(12);
  draw();
}

function getFloorRewardChoices() {
  const healthPotion = POTIONS.find((p) => p.name === "Health Potion") || POTIONS[0];
  const pool = [
    { id: "maxHp", label: "+1 Max HP", desc: "Also heal +1 hp", apply: () => { player.maxHp += 1; player.hp = Math.min(player.maxHp, player.hp + 1); } },
    { id: "dmg", label: "+1 Damage", desc: "Hit harder", apply: () => { player.dmg += 1; } },
    { id: "tough", label: "+1 Toughness", desc: "Take less damage", apply: () => { player.toughness += 1; } },
    { id: "maxHunger", label: "+1 Max Hunger", desc: "More sustain", apply: () => { player.maxHunger += 1; player.hunger = Math.min(player.maxHunger, player.hunger + 1); } },
    { id: "rations", label: "+3 Hunger", desc: "Immediate food", apply: () => { player.hunger = Math.min(player.maxHunger, player.hunger + 3); } },
    { id: "potion", label: "Random Potion", desc: "Add to inventory", apply: () => { player.inventory.push(POTIONS[rand(0, POTIONS.length - 1)]); } },
    { id: "healPotion", label: "Health Potion", desc: "Add to inventory", apply: () => { player.inventory.push(healthPotion); } },
  ];

  const shuffled = shuffleInPlace(pool.slice());
  return shuffled.slice(0, 3);
}

function applyFloorReward(reward) {
  if (!reward || typeof reward.apply !== "function") return;
  reward.apply();
  addLog(`Floor reward: ${reward.label}`, "loot");
  playSound?.("loot");
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

  const rewards = getFloorRewardChoices();
  let selectedRewardId = settings.confirmDescend ? null : rewards[0]?.id || null;
  
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
    <div style="margin: 12px 0; text-align:center;">
      <div style="color: var(--accent); margin-bottom: 8px; font-weight: bold;">Choose a reward</div>
      <div style="display:flex; gap: 10px; justify-content:center; flex-wrap: wrap;">
        ${rewards
          .map(
            (r) => `<button type="button" data-reward="${escapeHtml(r.id)}" style="min-width: 160px; padding: 10px 14px; border-radius: 10px; border: 2px solid rgba(0,255,255,0.35); background: rgba(0,0,0,0.75); color: var(--accent);">
              <div style="font-weight:700;">${escapeHtml(r.label)}</div>
              <div style="font-size: 0.85em; opacity: 0.8;">${escapeHtml(r.desc)}</div>
            </button>`,
          )
          .join("")}
      </div>
      ${settings.confirmDescend ? `<div style="margin-top: 8px; font-size: 0.85em; opacity: 0.8;">(Optional — you can skip)</div>` : `<div style="margin-top: 8px; font-size: 0.85em; opacity: 0.8;">(Auto-selected)</div>`}
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
  
  // Reward selection
  const rewardBtns = Array.from(transitionEl.querySelectorAll("button[data-reward]"));
  const syncRewardUi = () => {
    for (const b of rewardBtns) {
      const isSel = b.dataset.reward === selectedRewardId;
      b.style.borderColor = isSel ? "var(--accent)" : "rgba(0,255,255,0.35)";
      b.style.background = isSel ? "rgba(0,255,255,0.12)" : "rgba(0,0,0,0.75)";
    }
  };
  for (const b of rewardBtns) {
    b.onclick = () => {
      selectedRewardId = b.dataset.reward || null;
      playSound?.("menu");
      syncRewardUi();
    };
  }
  syncRewardUi();

  const btn = document.getElementById("continueBtn");
  if (btn) {
    btn.onclick = () => {
      transitionEl.style.display = "none";
      const chosen = rewards.find((r) => r.id === selectedRewardId);
      if (chosen) applyFloorReward(chosen);
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
  
  // Auto-continue after 3 seconds
  if (!settings.confirmDescend) {
    setTimeout(() => {
      if (transitionEl && transitionEl.style.display !== "none") {
        transitionEl.style.display = "none";
        const chosen = rewards.find((r) => r.id === selectedRewardId) || rewards[0];
        if (chosen) applyFloorReward(chosen);
        playSound?.("floor");
        floor++;
        generateFloor();
      }
    }, 3000);
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
    `<div style="opacity:0.9; text-align:center;">Leaving ends this dive. You keep whatever you carried out.</div>`,
    [
      {
        id: "exitToCourtyardBtn",
        label: "Exit",
        onClick: () => {
          const transitionEl = document.getElementById("floorTransition");
          if (transitionEl) transitionEl.style.display = "none";
          gamePaused = false;
          floor = 0;
          generateFloor();
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
    seedRng(createSeed());
    player = {
      x: 0,
      y: 0,
      hp: 10,
      maxHp: 10,
      dmg: 2,
      toughness: 0,
      inventory: [],
      hunger: 10,
      maxHunger: 10,
      kills: 0,
      combo: 0,
      score: 0,
      statusEffects: {},
      name: "",
      talent: "",
    };
    floor = 0;
  }

  // Mark game as started even if we came from a load.
  if (!gameStarted) gameStarted = true;
  
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
    if (settings.autoSave) {
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
        <button type="button" id="loadGameBtn" class="menu-screen-button">Load Game</button>
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
    if (settings.autoSave && gameStarted) {
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

  // Hidden area tiles render as walls until revealed.
  if (hiddenArea && !hiddenArea.revealed && hiddenArea.tiles?.has(key)) {
    const isFalseWall = hiddenArea.falseWalls?.has(key);
    return { kind: isFalseWall ? "falseWall" : "wall" };
  }

  const loot = lootAtKey(key);
  if (loot) {
    const effect = String(loot?.effect || "").toLowerCase();
    if (effect === "food") return { kind: "food", food: loot };
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

  const tile = tileAtKey(k);
  if (tile === TILE.WALL) return false;
  if (enemies.some((e) => e.x === x && e.y === y)) return false;
  return true;
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



n
function showRecruiterIntro(onDone) {
  const name = Array.isArray(NAMES) && NAMES.length ? NAMES[rand(0, NAMES.length - 1)] : "Unknown";
  const talentObj = Array.isArray(TALENTS) && TALENTS.length ? TALENTS[rand(0, TALENTS.length - 1)] : null;
  const talentLabel = talentObj?.label || "None";

  // Store for later systems (camp, lineage, etc.)
  player.name = name;
  player.talent = talentObj?.id || "none";


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
