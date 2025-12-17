document.addEventListener("DOMContentLoaded", () => {
  /* ===================== STATE ===================== */

  let floor = 1;
  let menuOpen = false;
  let activeTab = "inventory";
  let gamePaused = false;
  let investigateArmed = false;
  let cookingAtCampfire = false;
  let atShop = false;
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
    paletteMode: "default", // default | highContrast | colorblind
    haptics: true,
    confirmDescend: true,
  };
  let floorStats = { enemiesKilled: 0, itemsFound: 0, trapsTriggered: 0, damageTaken: 0, damageDealt: 0 };
  let hiddenTrapCount = 0;

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

  // Pinch zoom: changes how many tiles are drawn (zoom out => more tiles).
  let zoomScale = 1;
  const touchPointers = new Map(); // pointerId -> {x,y}
  let pinch = { active: false, startDist: 0, startZoom: 1 };

  let player = {
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
  };

  let map = {};
  let rooms = [];
  let enemies = [];
  let hiddenArea = null; // { revealed, tiles:Set<string>, falseWalls:Set<string>, mouseFlashUntil:number }
  let mouse = null; // { x, y }
  let autoMove = { timerId: null, path: [], attackTarget: null };
  let damageNumbers = []; // { x, y, value, type, time }

  const gameEl = document.getElementById("game");
  const controlsEl = document.getElementById("controls");
  const mapContainerEl = document.getElementById("mapContainer");
  const investigateBtnEl = document.getElementById("investigateBtn");

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

  /* ===================== HELPERS ===================== */

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

  function markExploredAroundPlayer() {
    // Mark everything in the current "sight rendering" square as explored.
    for (let y = -BASE_VIEW_RADIUS; y <= BASE_VIEW_RADIUS; y++) {
      for (let x = -BASE_VIEW_RADIUS; x <= BASE_VIEW_RADIUS; x++) {
        const tx = player.x + x;
        const ty = player.y + y;
        explored.add(`${tx},${ty}`);
      }
    }
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

  function pointInRoom(x, y, r) {
    return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  }

  function pointInCombatRoom(x, y) {
    // "Combat rooms" are rooms that can contain enemies: enemy rooms and the boss room.
    return rooms.some((r) => (r.type === "enemy" || r.type === "boss") && pointInRoom(x, y, r));
  }

  function isWalkableTile(ch) {
    return ch === "." || ch === "~" || ch === "T" || ch === "C";
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
    
    // Regeneration (for potions)
    if (status.regeneration?.turns) {
      const regen = status.regeneration;
      regen.turns -= 1;
      if (regen.turns <= 0) {
        delete target.statusEffects.regeneration;
        if (targetKind === "player") addLog("Regeneration faded", "info");
      }
    }
    
    // Regeneration (for potions)
    if (status.regeneration?.turns) {
      const regen = status.regeneration;
      regen.turns -= 1;
      if (regen.turns <= 0) {
        delete target.statusEffects.regeneration;
        if (targetKind === "player") addLog("Regeneration faded", "info");
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
        
        const dmgColors = getPalette().damage;
        const color = dn.type === "player" ? dmgColors.player : dn.type === "crit" ? dmgColors.crit : dmgColors.enemy;
        const age = now - dn.time;
        const offsetY = -(age / 1000) * 40;
        const opacity = 1 - age / 1000;
        
        return `<div class="damage-number" style="left:${screenX}px;top:${screenY + offsetY}px;color:${color};opacity:${opacity};">${dn.value}</div>`;
      })
      .filter(Boolean)
      .join("");
  }

  function addLog(text, type = "info") {
    const colors = getPalette().log;

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
      addLog("You are starving: -0.01 hp", "danger");
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
          floor++;
          generateFloor();
        }
      }, 3000);
    }
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
          explored: Array.from(explored),
          map,
          rooms,
          enemies,
          hiddenArea: serializeHiddenArea(hiddenArea),
          mouse,
          logHistory,
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
      
      const ok = saveSavesList(limitedSaves);
      if (!ok) {
        addLog("Save failed (storage full?)", "danger");
        return false;
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
      };
      floor = 1;
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
    
    if (skipGenerateFloor) {
      setMenuOpen(false);
      draw();
    } else {
      generateFloor();
      setMenuOpen(false);
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
          <label style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px; border: 1px solid var(--accent); border-radius: 8px; margin: 5px 0;">
            <span>Palette</span>
            <select id="setting-palette" style="flex: 0 0 auto; padding: 6px 10px; background: rgba(0,0,0,0.75); color: var(--accent); border: 1px solid var(--accent); border-radius: 8px;">
              <option value="default" ${settings.paletteMode === "default" ? "selected" : ""}>Default</option>
              <option value="highContrast" ${settings.paletteMode === "highContrast" ? "selected" : ""}>High contrast</option>
              <option value="colorblind" ${settings.paletteMode === "colorblind" ? "selected" : ""}>Colorblind-friendly</option>
            </select>
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
    const paletteSelect = document.getElementById("setting-palette");
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

    if (paletteSelect) {
      paletteSelect.addEventListener("change", (e) => {
        settings.paletteMode = e.target.value;
        applyPaletteToCss();
        localStorage.setItem("dungeonGameSettings", JSON.stringify(settings));
      });
    }

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
    
    mainMenuEl.innerHTML = `
      <div class="menu-screen">
        <h1 class="menu-title">Dungeon Roguelike</h1>
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

    const loot = map[`${key}_loot`];
    if (loot) {
      const effect = String(loot?.effect || "").toLowerCase();
      if (effect === "food") return { kind: "food", food: loot };
      return { kind: "potion", potion: loot };
    }

    const trap = map[`${key}_trap`];
    if (trap) return { kind: "trap", trap };

    const ch = map[key] || "#";
    if (ch === "T") return { kind: "trapdoor" };
    if (ch === "C") return { kind: "campfire" };
    if (ch === "$") return { kind: "shop" };
    if (ch === "#") return { kind: "wall" };
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
    const ch = map[`${x},${y}`];
    if (!isWalkableTile(ch)) return false;
    if (hiddenArea && !hiddenArea.revealed && hiddenArea.tiles?.has(keyOf(x, y))) return false;
    if (enemies.some((e) => e.x === x && e.y === y)) return false;
    return true;
  }

  function canEnemyMove(x, y) {
    const k = keyOf(x, y);
    const ch = map[k];
    if (!isWalkableTile(ch)) return false;
    if (hiddenArea && !hiddenArea.revealed && hiddenArea.tiles?.has(k)) return false;
    if (enemies.some((e) => e.x === x && e.y === y)) return false;

    // Enemies avoid visible traps (~), but can still step on hidden traps (they look like floor).
    if (ch === "~") return false;
    const trap = map[`${k}_trap`];
    if (trap && !trap.hidden) return false;

    return true;
  }

  function stopAutoMove() {
    if (autoMove?.timerId) window.clearInterval(autoMove.timerId);
    autoMove = { timerId: null, path: [], attackTarget: null };
  }

  function isPlayerWalkable(x, y) {
    const k = keyOf(x, y);
    // Hidden area tiles block movement until revealed, except the entrance false-wall tiles.
    if (hiddenArea && !hiddenArea.revealed && hiddenArea.tiles?.has(k) && !hiddenArea.falseWalls?.has(k)) return false;

    const tile = map[k] || "#";
    if (tile === "#") return false;
    if (enemies.some((e) => e.x === x && e.y === y)) return false;
    return true;
  }

  function buildPathBfs(goalX, goalY) {
    const startX = player.x;
    const startY = player.y;
    const startKey = keyOf(startX, startY);
    const goalKey = keyOf(goalX, goalY);
    if (goalKey === startKey) return [];

    // The player can only tap within the visible grid, so keep BFS bounded for performance.
    const LIMIT = Math.max(30, getViewRadius() + 8);

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

  /* ===================== MAP GEN ===================== */

  function calculateRoomCountForFloor(f) {
    // Floor 1 starts at 3 rooms. After that, the room count grows more slowly:
    // Every 5 floors, it takes +1 more floor to earn +1 room (max: every 5 floors).
    const baseRooms = 3;
    const floorNum = Math.max(1, Number(f || 1));
    if (floorNum <= 1) return baseRooms;

    let roomCount = baseRooms;
    let floorsSinceIncrease = 0;

    for (let cur = 2; cur <= floorNum; cur++) {
      const floorsPerRoom = Math.min(1 + Math.floor((cur - 1) / 5), 5);
      floorsSinceIncrease += 1;
      if (floorsSinceIncrease >= floorsPerRoom) {
        roomCount += 1;
        floorsSinceIncrease = 0;
      }
    }

    return roomCount;
  }

  function generateFloor() {
    stopAutoMove();
    map = {};
    rooms = [];
    enemies = [];
    hiddenArea = null;
    mouse = null;
    explored = new Set();
    floorStats = { enemiesKilled: 0, itemsFound: 0, damageTaken: 0, damageDealt: 0, trapsTriggered: 0 };
    hiddenTrapCount = 0;

    const roomCount = calculateRoomCountForFloor(floor);

    // --- Place rooms (non-overlapping), then connect via a graph ---
    // Start room is anchored so the camera/controls feel consistent.
    const startRoom = { x: 10, y: 10, w: rand(6, 9), h: rand(5, 7), type: "start" };
    rooms.push(startRoom);

    // Keep rooms in a bounded region so the dungeon feels cohesive.
    const spread = Math.max(35, roomCount * 10);
    const PAD = 2;

    for (let i = 1; i < roomCount; i++) {
      const w = rand(5, 9);
      const h = rand(4, 7);

      let placed = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const x = rand(4, 4 + spread);
        const y = rand(4, 4 + spread);
        const candidate = { x, y, w, h, type: "enemy" };
        if (rooms.some((r) => rectsOverlap(candidate, r, PAD))) continue;
        rooms.push(candidate);
        placed = true;
        break;
      }

      // Fallback: if we fail to pack nicely, place it loosely near the last room.
      if (!placed) {
        const prev = rooms[rooms.length - 1];
        rooms.push({
          x: prev.x + prev.w + rand(3, 6),
          y: prev.y + rand(-6, 6),
          w,
          h,
          type: "enemy",
        });
      }
    }

    // Pick boss room as the one farthest from start (only every 5 floors).
    if (floor % 5 === 0) {
      const sC = roomCenter(rooms[0]);
      let bossIdx = 1;
      let best = -1;
      for (let i = 1; i < rooms.length; i++) {
        const d = distManhattan(sC, roomCenter(rooms[i]));
        if (d > best) {
          best = d;
          bossIdx = i;
        }
      }
      rooms[bossIdx].type = "boss";
    }

    // Carve rooms.
    for (const r of rooms) {
      for (let ry = r.y; ry < r.y + r.h; ry++) {
        for (let rx = r.x; rx < r.x + r.w; rx++) {
          map[`${rx},${ry}`] = ".";
        }
      }
    }

    // Connect rooms: MST ensures all rooms connected, then add a few extra edges for loops/randomness.
    connectRoomGraph();

    // Generate special rooms (treasure, trap, shop) BEFORE populating
    generateSpecialRooms();

    // Populate rooms.
    for (const r of rooms) {
      if (r.type === "enemy") {
        spawnEnemies(r.x, r.y, r.w, r.h);
        spawnPotion(r.x, r.y, r.w, r.h);
        // Sometimes spawn food in enemy rooms too
        if (rollChance(0.15)) spawnFood(r.x, r.y, r.w, r.h);
      } else if (r.type === "boss") {
        // Spawn boss enemy (uppercase version of regular enemy)
        spawnBossEnemy(r.x, r.y, r.w, r.h);
        // Boss room has guaranteed potion
        if (rollChance(0.8)) spawnPotion(r.x, r.y, r.w, r.h);
      } else if (r.type === "treasure") {
        // Treasure room: lots of loot, no enemies
        for (let i = 0; i < rand(2, 4); i++) {
          spawnPotion(r.x, r.y, r.w, r.h);
        }
        // Spawn food in treasure rooms (higher chance)
        if (rollChance(0.7)) spawnFood(r.x, r.y, r.w, r.h);
      } else if (r.type === "trap") {
        // Trap room: many traps, high risk/reward
        for (let i = 0; i < rand(3, 6); i++) {
          const tx = rand(r.x, r.x + r.w - 1);
          const ty = rand(r.y, r.y + r.h - 1);
          const key = `${tx},${ty}`;
          if (map[key] === "." && !map[`${key}_loot`] && !map[`${key}_trap`]) {
            const trap = TRAP_TYPES[rand(0, TRAP_TYPES.length - 1)];
            const hidden = rollChance(0.3);
            map[`${key}_trap`] = { ...trap, hidden };
            if (hidden) hiddenTrapCount++;
            else map[key] = "~";
          }
        }
        // Guaranteed potion in trap room
        spawnPotion(r.x, r.y, r.w, r.h);
      } else if (r.type === "shop") {
        // Shop room: merchant NPC
        const shopX = Math.floor(r.x + r.w / 2);
        const shopY = Math.floor(r.y + r.h / 2);
        map[`${shopX},${shopY}`] = "$";
        map[`${shopX},${shopY}_shop`] = true;
      }
    }

    placeTrapdoor();
    placeTraps();
    generateHiddenRoom();

    const s = rooms[0];
    player.x = Math.floor(s.x + s.w / 2);
    player.y = Math.floor(s.y + s.h / 2);
    placeCampfire();
    spawnMouse();

    // Always close menu when generating a new floor (death/descend).
    setMenuOpen(false);
    draw();
  }

  function placeCampfire() {
    // 50% chance to spawn a campfire in the safe (start) room.
    if (!rollChance(0.5)) return;

    const s = rooms.find((r) => r.type === "start") || rooms[0];
    if (!s) return;

    for (let attempt = 0; attempt < 80; attempt++) {
      const x = rand(s.x, s.x + s.w - 1);
      const y = rand(s.y, s.y + s.h - 1);
      const k = keyOf(x, y);
      if ((map[k] || "#") !== ".") continue;
      if (x === player.x && y === player.y) continue;
      if (map[`${k}_loot`] || map[`${k}_trap`]) continue;
      map[k] = "C";
      return;
    }
  }

  function connectRoomGraph() {
    if (rooms.length <= 1) return;

    const centers = rooms.map(roomCenter);
    const edges = new Set(); // "a-b" with a<b
    const keyOf = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);

    // Prim's algorithm for MST (Manhattan distance).
    const inTree = new Set([0]);
    while (inTree.size < rooms.length) {
      let bestEdge = null;
      let bestD = Infinity;
      for (const i of inTree) {
        for (let j = 0; j < rooms.length; j++) {
          if (inTree.has(j)) continue;
          const d = distManhattan(centers[i], centers[j]);
          if (d < bestD) {
            bestD = d;
            bestEdge = [i, j];
          }
        }
      }
      if (!bestEdge) break;
      const [a, b] = bestEdge;
      edges.add(keyOf(a, b));
      inTree.add(b);
    }

    // Add extra random connections (creates alternate routes/loops).
    // Bias towards nearby rooms so hallways stay sane.
    const allPairs = [];
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        allPairs.push([i, j, distManhattan(centers[i], centers[j])]);
      }
    }
    allPairs.sort((a, b) => a[2] - b[2]);

    const extraBudget = Math.max(1, Math.floor(rooms.length / 3));
    let added = 0;
    for (const [i, j, d] of allPairs) {
      if (added >= extraBudget) break;
      const k = keyOf(i, j);
      if (edges.has(k)) continue;
      const edgeChance = d < 20 ? 0.18 : d < 35 ? 0.08 : 0.03;
      if (rollChance(edgeChance)) {
        edges.add(k);
        added++;
      }
    }

    // Ensure the start room often has 2+ connections (room1 -> room2 and maybe 3/4).
    if (rooms.length >= 3) {
      const startNeighbors = [];
      for (let j = 1; j < rooms.length; j++) startNeighbors.push([j, distManhattan(centers[0], centers[j])]);
      startNeighbors.sort((a, b) => a[1] - b[1]);
      const second = startNeighbors[1]?.[0];
      const third = startNeighbors[2]?.[0];
      if (second != null) edges.add(keyOf(0, second));
      if (third != null && rollChance(0.5)) edges.add(keyOf(0, third));
    }

    // Carve edges into corridors.
    for (const e of edges) {
      const [aStr, bStr] = e.split("-");
      const a = Number(aStr);
      const b = Number(bStr);
      connectRooms(rooms[a], rooms[b]);
    }
  }

  function connectRooms(a, b) {
    const ax = Math.floor(a.x + a.w / 2);
    const ay = Math.floor(a.y + a.h / 2);
    const bx = Math.floor(b.x + b.w / 2);
    const by = Math.floor(b.y + b.h / 2);

    const horizFirst = rollChance(0.5);
    const carveH = (y, x1, x2) => {
      for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
        map[`${x},${y}`] = ".";
        if (rollChance(0.85)) map[`${x},${y + 1}`] = "."; // occasional 2-wide halls
      }
    };
    const carveV = (x, y1, y2) => {
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
        map[`${x},${y}`] = ".";
        if (rollChance(0.85)) map[`${x + 1},${y}`] = ".";
      }
    };

    if (horizFirst) {
      carveH(ay, ax, bx);
      carveV(bx, ay, by);
    } else {
      carveV(ax, ay, by);
      carveH(by, ax, bx);
    }
  }

  function getEnemyTypeForFloor() {
    // Enemy type selection based on floor
    if (floor >= 15) {
      return rollChance(0.4) ? ORC : (rollChance(0.5) ? SKELETON : GOBLIN);
    } else if (floor >= 10) {
      return rollChance(0.5) ? SKELETON : GOBLIN;
    } else if (floor >= 7) {
      return rollChance(0.3) ? SKELETON : (rollChance(0.5) ? GOBLIN : BAT);
    } else if (floor >= 5) {
      return rollChance(0.4) ? GOBLIN : (rollChance(0.5) ? BAT : RAT);
    } else if (floor >= 3) {
      return rollChance(0.3) ? BAT : RAT;
    } else {
      return RAT;
    }
  }

  function spawnBossEnemy(x, y, w, h) {
    // Boss is uppercase version of regular enemy for this floor
    const baseEnemy = getEnemyTypeForFloor();
    const bossX = Math.floor(x + w / 2);
    const bossY = Math.floor(y + h / 2);
    
    const boss = {
      ...baseEnemy,
      x: bossX,
      y: bossY,
      symbol: baseEnemy.symbol.toUpperCase(), // Uppercase symbol
      name: `Boss ${baseEnemy.name}`,
      hp: Math.floor(baseEnemy.hp * 2.5) + Math.floor(floor / 5), // Much stronger
      dmg: Math.floor(baseEnemy.dmg * 1.5) + Math.floor(floor / 10),
      toughness: (baseEnemy.toughness || 0) + 1,
      statusEffects: {},
    };
    
    enemies.push(boss);
  }

  function spawnEnemies(x, y, w, h) {
    const count = rand(1, 2);

    for (let i = 0; i < count; i++) {
      const t = getEnemyTypeForFloor();

      let placed = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        const ex = rand(x, x + w - 1);
        const ey = rand(y, y + h - 1);
        const tile = map[`${ex},${ey}`];
        if (tile !== "." && tile !== "T") continue; // Don't spawn on trapdoor
        if (enemies.some((e) => e.x === ex && e.y === ey)) continue;

        enemies.push({
          x: ex,
          y: ey,
          hp: t.hp,
          dmg: t.dmg,
          color: t.color,
          sight: t.sight,
          symbol: t.symbol || "r",
          name: t.name || "Rat",
          toughness: t.toughness || 0,
          speed: t.speed || 1,
          statusEffects: {},
        });
        placed = true;
        break;
      }

      if (!placed) {
        enemies.push({
          x,
          y,
          hp: t.hp,
          dmg: t.dmg,
          color: t.color,
          sight: t.sight,
          symbol: t.symbol || "r",
          name: t.name || "Rat",
          toughness: t.toughness || 0,
          speed: t.speed || 1,
          statusEffects: {},
        });
      }
    }
  }

  function spawnPotion(x, y, w, h) {
    if (!rollChance(0.05)) return;

    const p = POTIONS[rand(0, POTIONS.length - 1)];

    for (let attempt = 0; attempt < 40; attempt++) {
      const px = rand(x, x + w - 1);
      const py = rand(y, y + h - 1);
      if (map[`${px},${py}`] !== ".") continue;
      if (enemies.some((e) => e.x === px && e.y === py)) continue;

      map[`${px},${py}`] = "P";
      map[`${px},${py}_loot`] = p;
      return;
    }
  }

  function spawnFood(x, y, w, h) {
    const foods = [MUSHROOM, BERRY];
    const food = foods[rand(0, foods.length - 1)];
    
    for (let attempt = 0; attempt < 40; attempt++) {
      const fx = rand(x, x + w - 1);
      const fy = rand(y, y + h - 1);
      if (map[`${fx},${fy}`] !== ".") continue;
      if (enemies.some((e) => e.x === fx && e.y === fy)) continue;
      if (map[`${fx},${fy}_loot`]) continue;

      map[`${fx},${fy}`] = food.symbol;
      map[`${fx},${fy}_loot`] = food;
      return;
    }
  }

  function generateSpecialRooms() {
    // 15% chance for treasure room, 10% for trap room
    if (rooms.length < 3) return; // Need at least 3 rooms
    
    const eligibleRooms = rooms.filter((r) => r.type === "enemy");
    if (!eligibleRooms.length) return;

    if (rollChance(0.15) && eligibleRooms.length > 0) {
      const idx = rand(0, eligibleRooms.length - 1);
      eligibleRooms[idx].type = "treasure";
    }
    
    if (rollChance(0.10) && eligibleRooms.length > 0) {
      const idx = rand(0, eligibleRooms.length - 1);
      if (eligibleRooms[idx].type === "enemy") {
        eligibleRooms[idx].type = "trap";
      }
    }
    
    // 5% chance for shop room
    if (rollChance(0.05) && eligibleRooms.length > 0) {
      const idx = rand(0, eligibleRooms.length - 1);
      if (eligibleRooms[idx].type === "enemy") {
        eligibleRooms[idx].type = "shop";
      }
    }
  }

  function placeTrapdoor() {
    // On boss floors, place trapdoor in boss room, otherwise in farthest room
    let r = rooms.find((rr) => rr.type === "boss");
    if (!r) {
      const sC = roomCenter(rooms[0]);
      let farthestIdx = 0;
      let best = -1;
      for (let i = 1; i < rooms.length; i++) {
        const d = distManhattan(sC, roomCenter(rooms[i]));
        if (d > best) {
          best = d;
          farthestIdx = i;
        }
      }
      r = rooms[farthestIdx];
    }
    const tx = Math.floor(r.x + r.w / 2);
    const ty = Math.floor(r.y + r.h / 2);
    map[`${tx},${ty}`] = "T";
  }

  function placeTraps() {
    const eligibleRooms = rooms.filter((r) => r.type === "enemy");
    if (!eligibleRooms.length) return;

    const trapCount = Math.min(12, Math.max(2, Math.floor(1 + floor * 0.9)));
    for (let i = 0; i < trapCount; i++) {
      const r = eligibleRooms[rand(0, eligibleRooms.length - 1)];
      const trap = TRAP_TYPES[rand(0, TRAP_TYPES.length - 1)];
      const hidden = rollChance(0.45);

      let placed = false;
      for (let attempt = 0; attempt < 80; attempt++) {
        const x = rand(r.x, r.x + r.w - 1);
        const y = rand(r.y, r.y + r.h - 1);
        const key = `${x},${y}`;
        if (map[key] !== ".") continue;
        if (map[`${key}_loot`]) continue;
        if (enemies.some((e) => e.x === x && e.y === y)) continue;

        map[`${key}_trap`] = { ...trap, hidden };
        if (hidden) hiddenTrapCount++;
        else map[key] = "~";
        placed = true;
        break;
      }

      if (!placed) continue;
    }
  }

  function shouldHaveHiddenRoomOnFloor(f) {
    if (f === 1) return true;
    return rollChance(0.1);
  }

  function generateHiddenRoom() {
    hiddenArea = null;
    mouse = null;

    if (!shouldHaveHiddenRoomOnFloor(floor)) return;

    const eligibleAnchorRooms = rooms.filter((r) => r.type === "enemy");
    if (!eligibleAnchorRooms.length) return;

    const healthPotion = POTIONS.find((p) => p.name === "Health Potion") || POTIONS[0];
    const hiddenPotion = floor === 1 ? healthPotion : POTIONS[rand(0, POTIONS.length - 1)];

    const makeHiddenTrap = () => {
      const base = TRAP_TYPES[rand(0, TRAP_TYPES.length - 1)];
      return { ...base, hidden: true };
    };

    // Try many placements; if all fail, no hidden room this floor.
    for (let attempt = 0; attempt < 220; attempt++) {
      const r = eligibleAnchorRooms[rand(0, eligibleAnchorRooms.length - 1)];

      // Pick a wall side. Corridor always 2 tiles wide.
      const side = rand(0, 3); // 0=up,1=right,2=down,3=left
      let dx = 0;
      let dy = 0;
      if (side === 0) dy = -1;
      else if (side === 1) dx = 1;
      else if (side === 2) dy = 1;
      else dx = -1;

      // Perpendicular unit vector for 2-wide hall.
      const px = -dy;
      const py = dx;

      // We need two adjacent tiles along the wall, so keep away from corners.
      // If room is too small for a 2-wide doorway on that side, skip.
      let ex, ey;
      if (dx !== 0) {
        if (r.h < 4) continue;
        const y0 = rand(r.y + 1, r.y + r.h - 3);
        ex = dx > 0 ? r.x + r.w : r.x - 1;
        ey = y0;
      } else {
        if (r.w < 4) continue;
        const x0 = rand(r.x + 1, r.x + r.w - 3);
        ex = x0;
        ey = dy > 0 ? r.y + r.h : r.y - 1;
      }

      const hallLen = rand(4, 7);
      const roomW = rand(5, 8);
      const roomH = rand(4, 7);

      // Room rectangle starts after the hallway.
      // Align so the hallway feeds into a 2-wide doorway on the room edge.
      let roomX, roomY;
      if (dx === 1) {
        roomX = ex + hallLen;
        roomY = ey - rand(0, roomH - 2);
      } else if (dx === -1) {
        roomX = ex - hallLen - (roomW - 1);
        roomY = ey - rand(0, roomH - 2);
      } else if (dy === 1) {
        roomY = ey + hallLen;
        roomX = ex - rand(0, roomW - 2);
      } else {
        roomY = ey - hallLen - (roomH - 1);
        roomX = ex - rand(0, roomW - 2);
      }

      const tiles = new Set();
      const falseWalls = new Set();
      const roomTiles = [];

      // Hallway tiles (2-wide).
      for (let i = 0; i < hallLen; i++) {
        for (let off = 0; off < 2; off++) {
          const hx = ex + dx * i + px * off;
          const hy = ey + dy * i + py * off;
          const k = keyOf(hx, hy);
          tiles.add(k);
          if (i === 0) falseWalls.add(k);
        }
      }

      // Room tiles.
      for (let yy = roomY; yy < roomY + roomH; yy++) {
        for (let xx = roomX; xx < roomX + roomW; xx++) {
          const k = keyOf(xx, yy);
          tiles.add(k);
          roomTiles.push(k);
        }
      }

      // Validate: must be fully behind existing walls (no overlap with carved dungeon).
      let ok = true;
      for (const k of tiles) {
        if (k.includes("_")) continue;
        const ch = map[k];
        if (ch === "." || ch === "T" || ch === "~" || ch === "P") {
          ok = false;
          break;
        }
        if (map[`${k}_loot`] || map[`${k}_trap`]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      // Carve the hidden hallway + room into the map data (but render as walls until revealed).
      for (const k of tiles) map[k] = ".";

      // Contents: exactly 1 potion and exactly 1 hidden trap (no enemies).
      const candidates = roomTiles.filter((k) => !falseWalls.has(k));
      if (candidates.length < 2) continue;

      const potionKey = candidates[rand(0, candidates.length - 1)];
      map[potionKey] = "P";
      map[`${potionKey}_loot`] = hiddenPotion;

      let trapKey = potionKey;
      for (let t = 0; t < 40 && trapKey === potionKey; t++) {
        trapKey = candidates[rand(0, candidates.length - 1)];
      }
      if (trapKey === potionKey) continue;
      map[`${trapKey}_trap`] = makeHiddenTrap();
      hiddenTrapCount++;

      hiddenArea = {
        revealed: false,
        tiles,
        falseWalls,
        mouseFlashUntil: 0,
      };

      return;
    }
  }

  function spawnMouse() {
    mouse = null;
    if (!hiddenArea) return;

    const candidates = [];
    for (const [k, v] of Object.entries(map)) {
      if (v !== ".") continue;
      if (k.includes("_")) continue;
      if (hiddenArea.tiles.has(k) && !hiddenArea.revealed) continue;

      const [xs, ys] = k.split(",");
      const x = Number(xs);
      const y = Number(ys);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

      if (x === player.x && y === player.y) continue;
      if (enemies.some((e) => e.x === x && e.y === y)) continue;
      if (pointInCombatRoom(x, y)) continue;

      candidates.push({ x, y });
    }

    if (!candidates.length) {
      // Fallback: pick a safe tile in the start room.
      const s = rooms.find((r) => r.type === "start") || rooms[0];
      if (!s) return;
      for (let yy = s.y; yy < s.y + s.h; yy++) {
        for (let xx = s.x; xx < s.x + s.w; xx++) {
          const k = keyOf(xx, yy);
          if ((map[k] || "#") !== ".") continue;
          if (xx === player.x && yy === player.y) continue;
          candidates.push({ x: xx, y: yy });
        }
      }
    }

    if (!candidates.length) return;
    mouse = candidates[rand(0, candidates.length - 1)];
  }

  function triggerTrapAtEntity(x, y, target, targetKind = "player") {
    const key = `${x},${y}`;
    const trap = map[`${key}_trap`];
    if (!trap) return false;

    const toughness = Number(target?.toughness || 0);
    const dmg = Math.max(0, Number(trap.dmg || 0) - toughness);

    if (targetKind === "player") {
      const prefix = trap.hidden ? "A hidden trap springs!" : "Trap!";
      addLog(`${prefix} ${trap.type} deals ${dmg} damage`, dmg ? "danger" : "block");
      if (dmg > 0) vibrate(30);
    } else {
      const name = target?.name || "Enemy";
      const prefix = trap.hidden ? `${name} triggers a hidden trap!` : `${name} triggers a trap!`;
      addLog(`${prefix} ${trap.type} deals ${dmg} damage`, dmg ? "danger" : "block");
    }

    if (target && typeof target.hp === "number") target.hp -= dmg;
    if (trap.status?.kind === "burning") {
      addBurning(target, trap.status.turns ?? 3, trap.status.dmgPerTurn ?? 1);
      if (targetKind === "player") {
        addLog("You are burning!", "danger");
        floorStats.trapsTriggered++;
      }
    }
    if (trap.type === "poison") {
      addPoisoned(target, 4, 1);
      if (targetKind === "player") {
        addLog("Poisoned!", "danger");
        floorStats.trapsTriggered++;
      }
    }
    if (targetKind === "player") floorStats.trapsTriggered++;

    if (trap.hidden) hiddenTrapCount = Math.max(0, hiddenTrapCount - 1);
    delete map[`${key}_trap`];
    map[key] = ".";
    return true;
  }

  /* ===================== ENEMY AI ===================== */

  function canMouseMoveTo(x, y) {
    const k = keyOf(x, y);
    if (hiddenArea && !hiddenArea.revealed) {
      if (hiddenArea.falseWalls?.has(k)) return true; // mouse can enter the false wall
      if (hiddenArea.tiles?.has(k)) return false; // but not the hidden hall/room
    }

    const ch = map[k] || "#";
    return ch === "." || ch === "T";
  }

  function moveMouse() {
    if (!mouse || !hiddenArea) return;

    // If the hidden area has already been revealed, the mouse just wanders.
    const dist = Math.abs(player.x - mouse.x) + Math.abs(player.y - mouse.y);
    const panic = !hiddenArea.revealed && dist <= 6;

    let next = null;

    if (panic) {
      // Run toward the closest false-wall entrance tile.
      let best = null;
      let bestD = Infinity;
      for (const k of hiddenArea.falseWalls) {
        const [xs, ys] = k.split(",");
        const tx = Number(xs);
        const ty = Number(ys);
        const d = Math.abs(tx - mouse.x) + Math.abs(ty - mouse.y);
        if (d < bestD) {
          bestD = d;
          best = { x: tx, y: ty };
        }
      }

      if (best) {
        const stepX = Math.sign(best.x - mouse.x);
        const stepY = Math.sign(best.y - mouse.y);

        const options = [];
        if (stepX) options.push({ x: mouse.x + stepX, y: mouse.y });
        if (stepY) options.push({ x: mouse.x, y: mouse.y + stepY });
        // If the greedy step is blocked, try the other axis, then random.
        const rnd = shuffleInPlace([
          { x: mouse.x + 1, y: mouse.y },
          { x: mouse.x - 1, y: mouse.y },
          { x: mouse.x, y: mouse.y + 1 },
          { x: mouse.x, y: mouse.y - 1 },
        ]);
        options.push(...rnd);

        for (const c of options) {
          if (canMouseMoveTo(c.x, c.y)) {
            next = c;
            break;
          }
        }
      }
    } else {
      const dirs = shuffleInPlace([
        { x: mouse.x + 1, y: mouse.y },
        { x: mouse.x - 1, y: mouse.y },
        { x: mouse.x, y: mouse.y + 1 },
        { x: mouse.x, y: mouse.y - 1 },
      ]);

      for (const c of dirs) {
        if (canMouseMoveTo(c.x, c.y)) {
          next = c;
          break;
        }
      }
    }

    if (!next) return;

    const nk = keyOf(next.x, next.y);
    if (hiddenArea && !hiddenArea.revealed && hiddenArea.falseWalls?.has(nk)) {
      // Mouse slips into the false wall, disappears, and hints the wall again.
      mouse = null;
      hiddenArea.mouseFlashUntil = Date.now() + 900;
      return;
    }

    mouse.x = next.x;
    mouse.y = next.y;
  }

  function moveEnemies() {
    const canEnemyStep = (fromX, fromY, toX, toY) => isStepAllowed(fromX, fromY, toX, toY, canEnemyMove);

    for (let idx = enemies.length - 1; idx >= 0; idx--) {
      const e = enemies[idx];
      const eName = e?.name || "Enemy";
      const dx = player.x - e.x;
      const dy = player.y - e.y;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));

      // Check slow status
      const slow = e.statusEffects?.slow;
      if (slow && slow.turns > 0 && rollChance(0.5)) {
        tickStatusEffects(e, "enemy");
        continue; // Skip turn when slowed
      }

      if (dist === 1) {
        // Check invisibility - enemies can't see invisible players
        if (player.statusEffects?.invisibility?.turns) {
          // 80% chance to miss, 20% chance enemy still detects you
          if (rollChance(0.8)) {
            tickStatusEffects(e, "enemy");
            continue; // Miss due to invisibility
          } else {
            addLog(`${eName} detects you despite invisibility!`, "danger");
          }
        }
        
        // Enemies don't chase invisible players outside attack range
        if (player.statusEffects?.invisibility?.turns && dist > 1) {
          tickStatusEffects(e, "enemy");
          continue;
        }
        
        let rolled = rollBellInt(0, e.dmg);
        const crit = rollChance(0.05);
        if (crit && rolled > 0) {
          rolled = Math.floor(rolled * 1.5);
          addLog(`${eName} CRITICAL HIT! ${rolled} damage!`, "enemy");
        }
        
        const dmg = Math.max(0, rolled - player.toughness);
        player.hp -= dmg;
        if (dmg > 0) {
          addLog(`${eName} hits you for ${dmg}`, "enemy");
          showDamageNumber(player.x, player.y, dmg, "enemy");
          vibrate(20);
          floorStats.damageTaken += dmg;
          // Visual feedback
          try {
            if (gameEl) {
              gameEl.style.transition = "filter 0.1s";
              gameEl.style.filter = "brightness(1.5)";
              setTimeout(() => {
                if (gameEl) gameEl.style.filter = "";
                setTimeout(() => {
                  if (gameEl) gameEl.style.transition = "";
                }, 100);
              }, 100);
            }
          } catch (e) {
            // Ignore visual feedback errors
          }
          player.combo = 0;
        } else {
          addLog(`${eName} hits you for ${dmg}`, "block");
        }
        tickStatusEffects(e, "enemy");
        if (e.hp <= 0) {
          addLog(`${eName} dies`, "death");
          enemies.splice(idx, 1);
        }
        continue;
      }

      const beforeX = e.x;
      const beforeY = e.y;
      const speed = e.speed || 1;
      const moves = slow ? 1 : Math.max(1, Math.floor(speed));
      
      let currentDist = dist;
      for (let move = 0; move < moves && currentDist > 1; move++) {
        if (currentDist <= e.sight) {
          const candidates = [
            { x: e.x + Math.sign(player.x - e.x), y: e.y + Math.sign(player.y - e.y) },
            { x: e.x + Math.sign(player.x - e.x), y: e.y },
            { x: e.x, y: e.y + Math.sign(player.y - e.y) },
            { x: e.x + Math.sign(player.x - e.x), y: e.y - Math.sign(player.y - e.y) },
            { x: e.x - Math.sign(player.x - e.x), y: e.y + Math.sign(player.y - e.y) },
            { x: e.x - Math.sign(player.x - e.x), y: e.y },
            { x: e.x, y: e.y - Math.sign(player.y - e.y) },
          ];

          let best = null;
          let bestD = Infinity;
          for (const c of candidates) {
            if (c.x === e.x && c.y === e.y) continue;
            if (!canEnemyStep(e.x, e.y, c.x, c.y)) continue;
            const d2 = chebDist(c.x, c.y, player.x, player.y);
            if (d2 < bestD) {
              bestD = d2;
              best = c;
            }
          }

          if (best) {
            // Bounds check
            const tile = map[keyOf(best.x, best.y)] || "#";
            if (tile !== "#") {
              e.x = best.x;
              e.y = best.y;
            }
          }
        } else {
          const dirs = shuffleInPlace([
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
            [1, 1],
            [1, -1],
            [-1, 1],
            [-1, -1],
          ]);

          for (const [mx, my] of dirs) {
            const nx = e.x + mx;
            const ny = e.y + my;
            // Bounds check - ensure tile exists and is walkable
            const tile = map[keyOf(nx, ny)] || "#";
            if (tile !== "#" && canEnemyStep(e.x, e.y, nx, ny)) {
              e.x = nx;
              e.y = ny;
              break;
            }
          }
        }
        
        // Update distance after move
        const newDx = player.x - e.x;
        const newDy = player.y - e.y;
        currentDist = Math.max(Math.abs(newDx), Math.abs(newDy));
      }

      // Enemies can trigger traps too (including hidden ones).
      if (e.x !== beforeX || e.y !== beforeY) {
        triggerTrapAtEntity(e.x, e.y, e, "enemy");
      }

      tickStatusEffects(e, "enemy");
      if (e.hp <= 0) {
        addLog(`${eName} dies`, "death");
        enemies.splice(idx, 1);
      }
    }
  }

  /* ===================== PLAYER ===================== */

  function move(dx, dy) {
    if (gamePaused) return;

    const nx = player.x + dx;
    const ny = player.y + dy;
    const nKey = keyOf(nx, ny);
    const tile = map[nKey] || "#";
    const enemy = enemies.find((e) => e.x === nx && e.y === ny);

    // Diagonal movement: prevent squeezing through corners.
    if (dx && dy) {
      const okCorner = isPlayerWalkable(player.x + dx, player.y) && isPlayerWalkable(player.x, player.y + dy);
      if (!okCorner) return;
      // If not attacking, also require the destination to be walkable.
      if (!enemy && !isPlayerWalkable(nx, ny)) return;
    }

    if (hiddenArea && !hiddenArea.revealed && hiddenArea.tiles?.has(nKey)) {
      // Only the entrance "false wall" can be broken by walking into it.
      if (hiddenArea.falseWalls?.has(nKey)) {
        hiddenArea.revealed = true;
        addLog("A false wall breaks and reveals a hidden passage!", "floor");
        player.x = nx;
        player.y = ny;
      } else {
        return;
      }
    } else if (tile === "#") {
      return;
    }

    if (enemy) {
      // Critical hits & misses
      let dealt = rollBellInt(0, player.dmg);
      const crit = rollChance(0.1); // 10% crit chance
      const miss = rollChance(0.05); // 5% miss chance
      
      if (miss) {
        dealt = 0;
        addLog(`You miss ${(enemy?.name || "enemy").toLowerCase()}!`, "block");
      } else if (crit && dealt > 0) {
        dealt = Math.floor(dealt * 2);
        addLog(`CRITICAL HIT! ${dealt} damage to ${(enemy?.name || "enemy").toLowerCase()}!`, "player");
      } else {
        addLog(`You hit ${(enemy?.name || "enemy").toLowerCase()} for ${dealt}`, dealt ? "player" : "block");
      }
      
      enemy.hp -= dealt;
      
      // Show damage number and track stats
      if (dealt > 0) {
        showDamageNumber(enemy.x, enemy.y, dealt, crit ? "crit" : "player");
        floorStats.damageDealt += dealt;
      }

      if (enemy.hp <= 0) {
        const enemyValue = Math.max(1, (enemy.hp + dealt)); // Use original HP before death
        addLog(`${enemy?.name || "Enemy"} dies`, "death");
        enemies = enemies.filter((e) => e !== enemy);
        
        // Combo system
        player.kills++;
        player.combo++;
        const scoreGain = Math.floor(enemyValue) * 10 * (1 + Math.floor(player.combo / 3));
        player.score += scoreGain;
        floorStats.scoreGained = (floorStats.scoreGained || 0) + scoreGain;
        floorStats.maxCombo = Math.max(floorStats.maxCombo || 0, player.combo);
        
        // Combo messages
        if (player.combo === 3) addLog("Double kill!", "loot");
        else if (player.combo === 5) addLog("Killing spree!", "loot");
        else if (player.combo === 10) addLog("Unstoppable!", "loot");
        else if (player.combo > 0 && player.combo % 5 === 0) addLog(`${player.combo} kills!`, "loot");

        // Rat meat drop (rats only).
        if ((enemy?.name || "").toLowerCase().includes("rat") && rollChance(0.2) && !map[`${nx},${ny}_loot`]) {
          map[`${nx},${ny}`] = RAT_MEAT.symbol;
          map[`${nx},${ny}_loot`] = RAT_MEAT;
          addLog("Rat dropped meat", "loot");
        } else if (rollChance(0.05) || (player.combo >= 3 && rollChance(0.15))) {
          // Better drop rate on combo
          const p = POTIONS[rand(0, POTIONS.length - 1)];
          map[`${nx},${ny}`] = "P";
          map[`${nx},${ny}_loot`] = p;
          addLog(`${enemy?.name || "Enemy"} dropped a potion`, "loot");
        }
      } else {
        // Reset combo if enemy survives
        player.combo = 0;
      }
    } else {
      // Speed boost allows double move occasionally
      const speedBoost = player.statusEffects?.speed;
      let moves = 1;
      if (speedBoost && speedBoost.turns > 0 && rollChance(0.3)) {
        moves = 2;
      }
      
      for (let m = 0; m < moves; m++) {
        if (m === 0 || (m === 1 && isPlayerWalkable(nx, ny))) {
          player.x = nx;
          player.y = ny;
        }
      }
    }

    // Hunger cost based on action type
    // Speed status reduces hunger cost
    const speedBoost = player.statusEffects?.speed?.value || 0;
    const baseHungerCost = enemy ? HUNGER_COST_ATTACK : HUNGER_COST_MOVE;
    const hungerCost = Math.max(HUNGER_COST_MOVE, baseHungerCost - (speedBoost * HUNGER_COST_MOVE));
    tickHunger(hungerCost);

    // Traps trigger when you step onto the tile (including hidden traps that look like floor).
    triggerTrapAtEntity(player.x, player.y, player, "player");

    // Only pick up loot from the tile you are actually standing on.
    const pKey = `${player.x},${player.y}`;
    if (map[`${pKey}_loot`]) {
      const loot = map[`${pKey}_loot`];
      player.inventory.push(loot);
      const lootName = loot?.name || "item";
      addLog(`Picked up ${lootName}`, "loot");
      vibrate(10);
      floorStats.itemsFound++;
      delete map[`${pKey}_loot`];
      map[pKey] = ".";
    }

    // Check if we're standing on a trapdoor (either just moved onto it, or killed enemy on it)
    const currentTile = map[keyOf(player.x, player.y)] || "#";
    if (currentTile === "T" && !enemies.some((e) => e.x === player.x && e.y === player.y)) {
      showFloorTransition();
      return;
    }
    
    // Shop interaction
    const shopKey = keyOf(player.x, player.y);
    if (map[`${shopKey}_shop`]) {
      openShopMenu();
      return;
    }

    moveMouse();
    moveEnemies();
    tickStatusEffects(player, "player");
    
    // Hunger-based regeneration when out of combat
    tickHungerRegeneration();

    if (player.hp <= 0) {
      addLog("You died", "death");
      // Save high score before returning to menu
      const highScore = localStorage.getItem("dungeonHighScore") || 0;
      if (player.score > Number(highScore)) {
        localStorage.setItem("dungeonHighScore", player.score);
        addLog(`NEW HIGH SCORE: ${player.score}!`, "loot");
      }
      
      // Return to main menu after a brief delay
      setTimeout(() => {
        returnToMainMenu();
      }, 2000);
      return;
    }

    draw();
  }

  /* ===================== INVENTORY ===================== */

  function usePotion(i) {
    const p = player.inventory[i];
    if (!p) return;

    if (p.effect === "fullHeal") {
      player.maxHp += p.value;
      player.hp = player.maxHp;
      addLog("You drink a Health Potion", "loot");
    }

    if (p.effect === "damageBoost") {
      player.dmg += p.value;
      addLog("You feel stronger", "loot");
    }

    if (p.effect === "toughnessBoost") {
      player.toughness += p.value;
      addLog("You feel tougher", "loot");
    }

    if (p.effect === "speed") {
      // If already has speed, refresh duration instead of stacking
      if (player.statusEffects?.speed) {
        player.statusEffects.speed.turns = Math.max(player.statusEffects.speed.turns, p.turns || 10);
        addLog(`Speed refreshed! (${player.statusEffects.speed.turns} turns)`, "loot");
      } else {
        addStatus(player, "speed", p.turns || 10, p.value);
        addLog(`You feel faster! (+${p.value} speed for ${p.turns || 10} turns)`, "loot");
      }
    }

    if (p.effect === "invisibility") {
      // If already invisible, refresh duration instead of stacking
      if (player.statusEffects?.invisibility) {
        player.statusEffects.invisibility.turns = Math.max(player.statusEffects.invisibility.turns, p.turns || 5);
        addLog(`Invisibility refreshed! (${player.statusEffects.invisibility.turns} turns)`, "loot");
      } else {
        addStatus(player, "invisibility", p.turns || 5, p.value);
        addLog(`You become invisible! (${p.turns || 5} turns)`, "loot");
      }
    }

    if (p.effect === "explosive") {
      // Damage all adjacent enemies
      let hit = false;
            const enemiesToKill = [];
            for (const e of enemies) {
              const dist = Math.max(Math.abs(e.x - player.x), Math.abs(e.y - player.y));
              if (dist <= 1) {
                const dmg = p.value || 3;
                const enemyValue = Math.max(1, e.hp);
                e.hp -= dmg;
                hit = true;
                
                // Show damage number
                showDamageNumber(e.x, e.y, dmg, "player");
                
                if (e.hp <= 0) {
                  enemiesToKill.push(e);
                  addLog(`${e.name} dies from explosion!`, "death");
                  
                  // Award combo and score with adjusted scaling
                  player.kills++;
                  player.combo++;
                  const comboMultiplier = 1 + Math.floor(player.combo / 5);
                  player.score += Math.floor(enemyValue) * 8 * comboMultiplier;
                  floorStats.enemiesKilled++;
                  floorStats.damageDealt += dmg;
                  floorStats.scoreGained = (floorStats.scoreGained || 0) + Math.floor(enemyValue) * 8 * comboMultiplier;
                  floorStats.maxCombo = Math.max(floorStats.maxCombo || 0, player.combo);
                  
                  // Combo messages
                  if (player.combo === 3) addLog("Double kill!", "loot");
                  else if (player.combo === 5) addLog("Killing spree!", "loot");
                  else if (player.combo === 10) addLog("Unstoppable!", "loot");
                } else {
                  addLog(`Explosion hits ${e.name} for ${dmg}!`, "player");
                  floorStats.damageDealt += dmg;
                  // Reset combo if enemy survives
                  player.combo = 0;
                }
              }
            }
      
      // Remove killed enemies
      enemies = enemies.filter((en) => !enemiesToKill.includes(en));
      
      if (!hit) addLog("Explosive potion fizzles...", "block");
      else addLog("BOOM! Explosive potion!", "player");
    }

    if (p.effect === "food") {
      const hungerGain = Math.max(0, Number(p.hunger || 0));
      const heal = Math.max(0, Number(p.heal || 0));
      player.hunger = Math.min(player.maxHunger, player.hunger + hungerGain);
      player.hp = Math.min(player.maxHp, player.hp + heal);
      addLog(`You eat ${p.name}`, "loot");
    }

    player.inventory.splice(i, 1);
    draw();
  }

  function cookFood(i) {
    if (!cookingAtCampfire) return;
    const item = player.inventory[i];
    if (!item || item.effect !== "food") return;
    if (item.cooked) return;

    let cooked;
    const name = String(item.name || "").toLowerCase();
    if (name.includes("rat meat")) cooked = COOKED_RAT_MEAT;
    else {
      const baseHunger = Math.max(0, Number(item.hunger || 0));
      cooked = {
        ...item,
        name: `Cooked ${item.name || "Food"}`,
        hunger: Math.max(baseHunger, Math.round(baseHunger * 2.5)),
        color: item.color || "#ffd6a6",
        cooked: true,
      };
    }

    player.inventory[i] = cooked;
    addLog(`Cooked ${item.name}`, "loot");
    draw();
  }

  /* ===================== DRAW ===================== */

  let measureEl = null;
  let cachedCellMetrics = null;
  let lastMapHtml = "";

  function getMonoCellMetricsPx(testFontPx = 100) {
    // Cache metrics on first call
    if (cachedCellMetrics) return cachedCellMetrics;
    // Measures actual monospace character width/height at a known font size.
    // Returns width/height per 1px of font-size (so we can scale linearly).
    if (!measureEl) {
      measureEl = document.createElement("span");
      measureEl.style.position = "fixed";
      measureEl.style.left = "-9999px";
      measureEl.style.top = "-9999px";
      measureEl.style.visibility = "hidden";
      measureEl.style.whiteSpace = "pre";
      measureEl.style.fontFamily = "monospace";
      measureEl.style.lineHeight = "1";
      document.body.appendChild(measureEl);
    }

    const n = 40;
    measureEl.style.fontSize = `${testFontPx}px`;
    measureEl.textContent = "0".repeat(n);
    const rect = measureEl.getBoundingClientRect();

    const unitW = rect.width / (testFontPx * n);
    const unitH = rect.height / testFontPx;

    cachedCellMetrics = { unitW, unitH };
    return cachedCellMetrics;
  }

  function updateMapFontSize() {
    if (!mapContainerEl || !gameEl) return;
    if (menuOpen) return;

    const viewRadius = getViewRadius();
    // The visible map is (2*viewRadius + 1) characters wide/tall.
    const cols = viewRadius * 2 + 1;
    const rows = viewRadius * 2 + 1;

    const rect = mapContainerEl.getBoundingClientRect();
    // mapContainer has 8px padding on each side in CSS.
    const usableW = Math.max(0, rect.width - 16);
    const usableH = Math.max(0, rect.height - 16);

    const { unitW, unitH } = getMonoCellMetricsPx(120);

    // Max font that fits:
    // - width: cols * (unitW * fontPx) <= usableW
    // - height: rows * (unitH * fontPx) <= usableH
    const maxByW = usableW / (cols * unitW);
    const maxByH = usableH / (rows * unitH);

    // Slight safety margin so we don't clip on fractional pixels.
    const fontPx = Math.floor(Math.min(maxByW, maxByH) * 0.98);
    const clamped = Math.max(12, Math.min(48, fontPx));

    gameEl.style.fontSize = `${clamped}px`;
  }

  function renderMenuHtml() {
    const tabBtn = (tab, label) =>
      `<button type="button" data-tab="${tab}" class="${activeTab === tab ? "is-active" : ""}">${label}</button>`;
    const actionBtn = (action, label) => `<button type="button" data-action="${action}">${label}</button>`;

    let content;

    if (activeTab === "inventory") {
      if (player.inventory.length) {
        const buttons = player.inventory
          .map(
            (p, i) =>
              `<button type="button" data-use-potion="${i}" class="menu-button" style="color:${getLootColor(p)};">${escapeHtml(
                p.name,
              )}</button>`,
          )
          .join("");
        content = `<div class="menu-inventory">${buttons}</div>`;
      } else {
        content = `<div class="menu-empty">Inventory empty</div>`;
      }
    } else if (activeTab === "status") {
      const burning = getBurning(player);
      const statusLines = [];
      if (burning?.turns) {
        statusLines.push(`You are burning -${burning.dmgPerTurn} hp per turn (${burning.turns} turns remaining)`);
      }
      // Show all status effects
      const statusEffects = player.statusEffects || {};
      if (statusEffects.poisoned?.turns) statusLines.push(`Poisoned -${statusEffects.poisoned.dmgPerTurn} hp per turn (${statusEffects.poisoned.turns} turns)`);
      if (statusEffects.speed?.turns) statusLines.push(`Speed boost (${statusEffects.speed.turns} turns)`);
      if (statusEffects.invisibility?.turns) statusLines.push(`Invisible (${statusEffects.invisibility.turns} turns)`);
      if (statusEffects.slow?.turns) statusLines.push(`Slowed (${statusEffects.slow.turns} turns)`);
      if (statusEffects.regeneration?.turns) statusLines.push(`Regenerating (${statusEffects.regeneration.turns} turns)`);
      
      content = `<div class="menu-status">
        HP ${player.hp}/${player.maxHp}<br>
        DMG 0-${player.dmg}<br>
        Tough ${player.toughness}<br>
        Floor ${floor}<br>
        Score: ${player.score || 0}<br>
        Kills: ${player.kills || 0}<br>
        Combo: ${player.combo || 0}x
        ${statusLines.length ? "<br><br>" + statusLines.map(escapeHtml).join("<br>") : ""}
      </div>`;
    } else if (activeTab === "cook") {
      if (!cookingAtCampfire) {
        content = `<div class="menu-empty">No campfire.</div>`;
      } else {
        const cookables = player.inventory
          .map((it, idx) => ({ it, idx }))
          .filter(({ it }) => it?.effect === "food" && !it?.cooked);

        if (!cookables.length) {
          content = `<div class="menu-empty">No raw food to cook</div>`;
        } else {
          const buttons = cookables
            .map(
              ({ it, idx }) =>
                `<button type="button" data-cook-food="${idx}" class="menu-button" style="color:${it.color || "#ffd6a6"};">Cook ${escapeHtml(
                  it.name,
                )}</button>`,
            )
            .join("");
          content = `<div class="menu-inventory">${buttons}</div>`;
        }
      }
    } else if (activeTab === "shop") {
      const shopItems = [
        ...POTIONS.slice(0, 3).map((p, i) => ({ ...p, price: 50 + i * 25, shopIndex: i })),
        ...POTIONS.slice(3).map((p, i) => ({ ...p, price: 75 + i * 25, shopIndex: i + 3 })),
      ];
      
      const buttons = shopItems
        .map(
          (item) => {
            let desc = "";
            if (item.effect === "fullHeal") desc = " (Heal +1 Max HP)";
            else if (item.effect === "damageBoost") desc = " (+1 Damage)";
            else if (item.effect === "toughnessBoost") desc = " (+1 Toughness)";
            else if (item.effect === "speed") desc = ` (Speed ${item.turns || 10} turns)`;
            else if (item.effect === "invisibility") desc = ` (Invisible ${item.turns || 5} turns)`;
            else if (item.effect === "explosive") desc = " (AOE Damage)";
            return `<button type="button" data-buy-item="${item.shopIndex}" class="menu-button" style="color:${getLootColor(item)};${player.score < item.price ? "opacity:0.5;" : ""}" title="${escapeHtml(item.name + desc)}">
              ${escapeHtml(item.name)}${desc ? `<small style="opacity:0.7;">${escapeHtml(desc)}</small>` : ""}<br><small>${item.price} score</small>
            </button>`;
          },
        )
        .join("");
      content = `<div class="menu-status">
        <div>Score: ${player.score}</div>
        <div style="margin-top: 10px;">Shop Items:</div>
        <div class="menu-inventory">${buttons}</div>
      </div>`;
    } else if (activeTab === "help") {
      content = `<div class="menu-log" style="text-align:left;">
        <div class="log-line" style="color: var(--accent); font-weight: bold;">Controls</div>
        <div class="log-line">- Tap a tile to auto-walk there (pathfinding).</div>
        <div class="log-line">- Tap <b>●</b> to open/close the menu (pauses).</div>
        <div class="log-line">- Tap <b>?</b> to arm Investigate, then tap a tile to inspect it.</div>
        <div class="log-line">- Pinch with 2 fingers to zoom the view in/out.</div>
        <div class="log-line" style="color: var(--accent); font-weight: bold; margin-top:6px;">Keyboard (desktop)</div>
        <div class="log-line">- Move: WASD / Arrow keys</div>
        <div class="log-line">- Diagonals: Q/E/Z/C</div>
        <div class="log-line">- Menu: M, Inventory: I, Close: Escape</div>
        <div class="log-line" style="color: var(--accent); font-weight: bold; margin-top:6px;">Tips</div>
        <div class="log-line">- Hidden traps flash briefly—watch the floor.</div>
        <div class="log-line">- If a mouse panics, it may be hinting at a false wall.</div>
        <div class="log-line">- You can cook raw food at campfires.</div>
      </div>`;
    } else if (activeTab === "settings") {
      const highScore = localStorage.getItem("dungeonHighScore") || 0;
      content = `<div class="menu-status">
        <div style="margin-bottom: 15px; text-align: center; padding: 10px; background: rgba(0, 0, 0, 0.5); border-radius: 8px;">
          <div style="margin: 5px 0;">High Score: ${highScore}</div>
          <div style="margin: 5px 0;">Current Score: ${player.score || 0}</div>
        </div>
        <div style="margin-bottom: 15px;">
          <label style="display: flex; align-items: center; gap: 10px; margin: 8px 0; padding: 8px; background: rgba(0, 0, 0, 0.3); border-radius: 6px;">
            <input type="checkbox" ${settings.showDamageNumbers ? "checked" : ""} data-setting="showDamageNumbers" style="width: 20px; height: 20px;">
            Show Damage Numbers
          </label>
          <label style="display: flex; align-items: center; gap: 10px; margin: 8px 0; padding: 8px; background: rgba(0, 0, 0, 0.3); border-radius: 6px;">
            <input type="checkbox" ${settings.showEnemyHealth ? "checked" : ""} data-setting="showEnemyHealth" style="width: 20px; height: 20px;">
            Show Enemy Health
          </label>
          <label style="display: flex; align-items: center; gap: 10px; margin: 8px 0; padding: 8px; background: rgba(0, 0, 0, 0.3); border-radius: 6px;">
            <input type="checkbox" ${settings.autoSave ? "checked" : ""} data-setting="autoSave" style="width: 20px; height: 20px;">
            Auto-Save
          </label>
          <label style="display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 8px 0; padding: 8px; background: rgba(0, 0, 0, 0.3); border-radius: 6px;">
            <span>Palette</span>
            <select data-setting="paletteMode" style="flex: 0 0 auto; padding: 6px 10px; background: rgba(0,0,0,0.75); color: var(--accent); border: 1px solid var(--accent); border-radius: 8px;">
              <option value="default" ${settings.paletteMode === "default" ? "selected" : ""}>Default</option>
              <option value="highContrast" ${settings.paletteMode === "highContrast" ? "selected" : ""}>High contrast</option>
              <option value="colorblind" ${settings.paletteMode === "colorblind" ? "selected" : ""}>Colorblind-friendly</option>
            </select>
          </label>
          <label style="display: flex; align-items: center; gap: 10px; margin: 8px 0; padding: 8px; background: rgba(0, 0, 0, 0.3); border-radius: 6px;">
            <input type="checkbox" ${settings.haptics ? "checked" : ""} data-setting="haptics" style="width: 20px; height: 20px;">
            Haptics (vibration)
          </label>
          <label style="display: flex; align-items: center; gap: 10px; margin: 8px 0; padding: 8px; background: rgba(0, 0, 0, 0.3); border-radius: 6px;">
            <input type="checkbox" ${settings.confirmDescend ? "checked" : ""} data-setting="confirmDescend" style="width: 20px; height: 20px;">
            Confirm descend on trapdoor
          </label>
        </div>
        <div style="margin-top: 15px;">
          <button type="button" data-action="save-game" class="menu-button" style="width: 100%; margin: 5px 0;">Save Game</button>
        </div>
      </div>`;
    } else {
      content = `<div class="menu-log">${logHistory
        .map((l) => `<div class="log-line" style="color:${l.color}">${escapeHtml(l.text)}</div>`)
        .join("")}</div>`;
    }

    return `
      <div class="menu-container">
        <div class="menu-tabs">
          ${tabBtn("inventory", "Inventory")}
          ${tabBtn("status", "Status")}
          ${cookingAtCampfire ? tabBtn("cook", "Cook") : ""}
          ${atShop ? tabBtn("shop", "Shop") : ""}
          ${tabBtn("help", "Help")}
          ${tabBtn("settings", "Settings")}
          ${tabBtn("log", "Log")}
          ${actionBtn("quit-to-menu", "Quit to Menu")}
          ${actionBtn("close-menu", "Close")}
        </div>
        <div class="menu-content">${content}</div>
      </div>
    `;
  }

  function draw() {
    if (!gameEl || inMainMenu) return;

    // Live log
    renderLiveLog();
    updateHud();
    updateDamageNumbers();

    if (menuOpen) {
      activeTab = activeTab || "inventory";
      gameEl.innerHTML = renderMenuHtml();
      lastMapHtml = "";
      return;
    }

    const palette = getPalette();
    const enemyByPos = new Map();
    for (const e of enemies) enemyByPos.set(`${e.x},${e.y}`, e);

    const dimCss = "opacity:0.5;";
    const popCss = "font-weight:700;";
    const burningOutlineCss = `text-shadow: 0 0 3px ${palette.map.trapVisible}, 0 0 6px ${palette.map.trapVisible};`;
    const hiddenFlashOn = Date.now() % HIDDEN_TRAP_FLASH_PERIOD_MS < HIDDEN_TRAP_FLASH_PULSE_MS;
    const mouseWallPulseOn = Date.now() % 240 < 120;

    const viewRadius = getViewRadius();
    markExploredAroundPlayer();

    // Map draw - center on player
    let out = "";
    let runStyle = null;
    let runText = "";
    const flush = () => {
      if (!runText) return;
      if (runStyle) out += `<span style="${runStyle}">${escapeHtml(runText)}</span>`;
      else out += escapeHtml(runText);
      runText = "";
    };
    const pushCell = (ch, style) => {
      if (style !== runStyle) {
        flush();
        runStyle = style;
      }
      runText += ch;
    };

    for (let y = -viewRadius; y <= viewRadius; y++) {
      for (let x = -viewRadius; x <= viewRadius; x++) {
        const tx = player.x + x;
        const ty = player.y + y;
        const key = `${tx},${ty}`;
        const dist = Math.max(Math.abs(x), Math.abs(y)); // square distance

        // Fog-of-war beyond current sight: show only explored terrain, hide unseen.
        if (dist > BASE_VIEW_RADIUS) {
          if (!explored.has(key)) {
            pushCell(" ", null);
            continue;
          }

          // Hidden hallway/room stays hidden as walls until revealed.
          const hiddenAsWall = hiddenArea && !hiddenArea.revealed && hiddenArea.tiles?.has(key);
          const ch = hiddenAsWall ? "#" : map[key] || "#";
          const t = ch === "#" ? "#" : ".";
          pushCell(
            t === "#" ? "#" : ".",
            `color:${t === "#" ? palette.map.fogWall : palette.map.fogFloor};${dimCss}`,
          );
          continue;
        }

        const terrainOnly = dist > FULL_SIGHT_RADIUS;

        // Terrain-only ring: show walls/floors only (no enemies, items, traps, mouse, trapdoor).
        if (terrainOnly) {
          // Hidden hallway/room stays hidden as walls until revealed.
          if (hiddenArea && !hiddenArea.revealed && hiddenArea.tiles?.has(key)) {
            const isFalseWall = hiddenArea.falseWalls?.has(key);
            const flash = isFalseWall && Date.now() < (hiddenArea.mouseFlashUntil || 0);
            const color = isFalseWall ? (flash ? (mouseWallPulseOn ? palette.map.falseWallA : palette.map.falseWallB) : palette.map.falseWallA) : palette.map.fogWall;
            pushCell("#", `color:${color};${dimCss}`);
          } else {
            const ch = map[key] || "#";
            // Only terrain: walls and floors. Everything else renders as floor.
            const t = ch === "#" ? "#" : ".";
            pushCell(
              t === "#" ? "#" : ".",
              `color:${t === "#" ? palette.map.fogWall : palette.map.fogFloor};${dimCss}`,
            );
          }
          continue;
        }

        if (tx === player.x && ty === player.y) {
          const extra = `${popCss}${getBurning(player)?.turns ? burningOutlineCss : ""}`;
          pushCell("@", `color:${palette.map.player};${extra}`);
        } else if (enemyByPos.has(key)) {
          const e = enemyByPos.get(key);
          const extra = `${popCss}${getBurning(e)?.turns ? burningOutlineCss : ""}`;
          pushCell(e.symbol || "E", `color:${getEnemyColor(e)};${extra}`);
        } else if (mouse && tx === mouse.x && ty === mouse.y) {
          pushCell("m", `color:${palette.map.mouse};${popCss}`);
        } else if (hiddenArea && !hiddenArea.revealed && hiddenArea.tiles?.has(key)) {
          // Hidden hallway/room are drawn as walls until revealed.
          const isFalseWall = hiddenArea.falseWalls?.has(key);
          const flash = isFalseWall && Date.now() < (hiddenArea.mouseFlashUntil || 0);
          const color = isFalseWall ? (flash ? (mouseWallPulseOn ? palette.map.falseWallA : palette.map.falseWallB) : palette.map.falseWallA) : palette.map.wall;
          pushCell("#", `color:${color};`);
        } else if (map[`${key}_loot`]) {
          const p = map[`${key}_loot`];
          pushCell(p.symbol, `color:${getLootColor(p)};${popCss}`);
        } else {
          const ch = map[key] || "#";
          const trap = map[`${key}_trap`];
          if (trap) {
            if (trap.hidden) {
              // Hidden traps look like floor, but flash orange every few seconds.
              pushCell(".", `color:${hiddenFlashOn ? palette.map.hiddenTrapFlash : palette.map.floor};`);
            } else {
              pushCell("~", `color:${getTrapColor(trap)};`);
            }
          } else if (ch === ".") pushCell(".", `color:${palette.map.floor};`); // floor
          else if (ch === "~") pushCell("~", `color:${palette.map.trapVisible};`); // fallback
          else if (ch === "#") pushCell("#", `color:${palette.map.wall};`); // wall
          else if (ch === "T") {
            // Only show trapdoor if no enemy is on it
            if (!enemyByPos.has(key)) {
              pushCell("T", `color:${palette.map.trapdoor};${popCss}`); // trapdoor
            } else {
              // Enemy is on trapdoor, show enemy instead
              const e = enemyByPos.get(key);
              const extra = `${popCss}${getBurning(e)?.turns ? burningOutlineCss : ""}`;
              const isBoss = e.symbol && e.symbol === e.symbol.toUpperCase() && e.symbol !== e.symbol.toLowerCase();
              const bossGlow = isBoss ? "text-shadow: 0 0 4px #ff0000, 0 0 8px #ff0000;" : "";
              pushCell(e.symbol || "E", `color:${getEnemyColor(e)};${extra}${bossGlow}`);
            }
          }
          else if (ch === "C") pushCell("C", `color:${palette.map.campfire};${popCss}`); // campfire
          else if (ch === "$") pushCell("$", `color:${palette.map.shop};${popCss}`); // shop
          else pushCell(ch, `color:${palette.map.unknown};`);
        }
      }
      flush();
      runStyle = null;
      out += "\n";
    }
    flush();

    if (out !== lastMapHtml) {
      gameEl.innerHTML = out;
      lastMapHtml = out;
    }
    updateMapFontSize();
  }

  /* ===================== INPUTS ===================== */

  function bindInputs() {
    if (controlsEl) {
      // Use pointerdown for snappy mobile controls.
      controlsEl.addEventListener("pointerdown", (e) => {
        const btn = e.target.closest("button");
        if (!btn) return;

        e.preventDefault();

        const action = btn.dataset.action;
        if (action === "menu") {
          if (inMainMenu) return;
          toggleMenu();
          return;
        }
        if (action === "investigate") {
          if (menuOpen || gamePaused || inMainMenu) return;
          setInvestigateArmed(!investigateArmed);
          return;
        }
      });
    }

    // Tap-to-move on the map: tap a tile to auto-walk to it (step-by-step).
    if (mapContainerEl) {
      mapContainerEl.addEventListener("pointerdown", (e) => {
        if (menuOpen || gamePaused || inMainMenu) return;
        // Don't treat button taps as movement (menu button lives outside, but be safe).
        if (e.target.closest("button")) return;

        // Pinch zoom (touch): track pointers and, when 2 fingers are down, zoom instead of moving.
        if (e.pointerType === "touch") {
          touchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          try {
            mapContainerEl.setPointerCapture(e.pointerId);
          } catch {
            // ignore
          }

          if (touchPointers.size >= 2) {
            pinch.active = true;
            const pts = getTwoTouchPoints();
            pinch.startDist = pts ? Math.max(1, touchDist(pts[0], pts[1])) : 1;
            pinch.startZoom = zoomScale;
            stopAutoMove(); // cancel any tap-to-move started by the first finger
            if (investigateArmed) setInvestigateArmed(false);
            e.preventDefault();
            return;
          }
        }

        if (pinch.active) return;

        e.preventDefault();

        const viewRadius = getViewRadius();
        const cols = viewRadius * 2 + 1;
        const rows = viewRadius * 2 + 1;
        const gRect = gameEl?.getBoundingClientRect?.();
        if (!gRect) return;

        const inGrid =
          e.clientX >= gRect.left && e.clientX <= gRect.right && e.clientY >= gRect.top && e.clientY <= gRect.bottom;
        if (!inGrid) return;

        const fontPx = Number.parseFloat(window.getComputedStyle(gameEl).fontSize || "16");
        const { unitW, unitH } = getMonoCellMetricsPx(120);
        const cellW = unitW * fontPx;
        const cellH = unitH * fontPx;
        if (!cellW || !cellH) return;

        const col = Math.floor((e.clientX - gRect.left) / cellW);
        const row = Math.floor((e.clientY - gRect.top) / cellH);
        if (col < 0 || col >= cols || row < 0 || row >= rows) return;

        const tx = player.x + (col - viewRadius);
        const ty = player.y + (row - viewRadius);
        const tappedKey = keyOf(tx, ty);
        const tappedTile = map[tappedKey] || "#";

        // Campfire: tap to open cooking menu when adjacent/on it.
        if (tappedTile === "C") {
          const d = chebDist(player.x, player.y, tx, ty);
          if (d <= 1) {
            openCampfireMenu();
            return;
          }
          // If it's far, keep normal behavior: walk to it.
        }
        
        // Shop: tap to open shop menu when adjacent/on it.
        if (tappedTile === "$") {
          const d = chebDist(player.x, player.y, tx, ty);
          if (d <= 1) {
            openShopMenu();
            return;
          }
        }

        if (investigateArmed) {
          e.preventDefault();
          setInvestigateArmed(false);
          investigateAt(tx, ty);
          return;
        }

        startAutoMoveTo(tx, ty);
      });

      mapContainerEl.addEventListener("pointermove", (e) => {
        if (e.pointerType !== "touch") return;
        if (!touchPointers.has(e.pointerId)) return;

        touchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (touchPointers.size !== 2) return;
        if (!pinch.active) {
          pinch.active = true;
          const pts = getTwoTouchPoints();
          pinch.startDist = pts ? Math.max(1, touchDist(pts[0], pts[1])) : 1;
          pinch.startZoom = zoomScale;
        }

        const pts = getTwoTouchPoints();
        if (!pts) return;

        const dist = Math.max(1, touchDist(pts[0], pts[1]));
        const minZoom = MIN_VIEW_RADIUS / BASE_VIEW_RADIUS;
        const maxZoom = MAX_VIEW_RADIUS / BASE_VIEW_RADIUS;
        // Invert pinch behavior: pinch OUT => zoom IN (show fewer tiles), pinch IN => zoom OUT.
        zoomScale = clamp(pinch.startZoom * (pinch.startDist / dist), minZoom, maxZoom);
        draw();
        e.preventDefault();
      });

      const endTouch = (e) => {
        if (e.pointerType !== "touch") return;
        touchPointers.delete(e.pointerId);
        if (touchPointers.size < 2) pinch.active = false;
      };

      mapContainerEl.addEventListener("pointerup", endTouch);
      mapContainerEl.addEventListener("pointercancel", endTouch);
    }

    if (gameEl) {
      // Menu click handling via event delegation.
      gameEl.addEventListener("click", (e) => {
        const btn = e.target.closest("button");
        if (!btn) return;
        if (!menuOpen) return;

        if (btn.dataset.action === "close-menu") {
          toggleMenu();
          return;
        }

        if (btn.dataset.action === "quit-to-menu") {
          quitToMenu();
          return;
        }

        if (btn.dataset.action === "save-game") {
          saveGame();
          draw();
          return;
        }

        if (btn.dataset.tab) {
          setTab(btn.dataset.tab);
          return;
        }

        if (btn.dataset.usePotion != null) {
          usePotion(Number(btn.dataset.usePotion));
          return;
        }

        if (btn.dataset.cookFood != null) {
          cookFood(Number(btn.dataset.cookFood));
          return;
        }

        if (btn.dataset.buyItem != null) {
          buyShopItem(Number(btn.dataset.buyItem));
          return;
        }
      });

      // Settings controls in the in-game menu use [data-setting] elements.
      gameEl.addEventListener("change", (e) => {
        if (!menuOpen) return;
        const el = e.target.closest?.("[data-setting]");
        if (!el) return;
        const key = el.dataset.setting;
        if (!key) return;

        if (el.tagName === "SELECT") {
          settings[key] = String(el.value || "default");
        } else {
          settings[key] = !!el.checked;
        }
        window.gameSettings = settings; // Update global reference
        try {
          localStorage.setItem("dungeonGameSettings", JSON.stringify(settings));
        } catch {
          // ignore
        }

        if (key === "paletteMode") {
          applyPaletteToCss();
        }
        if (key === "haptics" && settings.haptics) {
          vibrate(10);
        }

        if (settings.autoSave && key !== "autoSave") {
          setTimeout(() => saveGame("Auto-save"), 100);
        }
        draw();
      });
    }

    window.addEventListener("resize", () => updateMapFontSize());
    
    // Keyboard shortcuts (for desktop testing)
    window.addEventListener("keydown", (e) => {
      if (inMainMenu) return;
      if (menuOpen && e.key === "Escape") {
        toggleMenu();
        e.preventDefault();
        return;
      }
      if (gamePaused || menuOpen) return;
      
      // Arrow keys / WASD for movement
      if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
        stopAutoMove();
        move(0, -1);
        e.preventDefault();
      } else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
        stopAutoMove();
        move(0, 1);
        e.preventDefault();
      } else if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
        stopAutoMove();
        move(-1, 0);
        e.preventDefault();
      } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
        stopAutoMove();
        move(1, 0);
        e.preventDefault();
      } else if (e.key === "q" || e.key === "Q" || e.key === "e" || e.key === "E") {
        // Diagonal movement
        stopAutoMove();
        if (e.key === "q" || e.key === "Q") move(-1, -1);
        else move(1, -1);
        e.preventDefault();
      } else if (e.key === "z" || e.key === "Z" || e.key === "c" || e.key === "C") {
        stopAutoMove();
        if (e.key === "z" || e.key === "Z") move(-1, 1);
        else move(1, 1);
        e.preventDefault();
      } else if (e.key === "i" || e.key === "I") {
        toggleMenu();
        setTab("inventory");
        e.preventDefault();
      } else if (e.key === "m" || e.key === "M") {
        toggleMenu();
        e.preventDefault();
      } else if (e.key === "Escape") {
        stopAutoMove();
        e.preventDefault();
      }
    });
  }

  /* ===================== INIT ===================== */

  /* ===================== ACCESSIBILITY / UX HELPERS ===================== */

  function getPaletteName() {
    const v = String(settings?.paletteMode || "default");
    if (v === "highContrast") return "highContrast";
    if (v === "colorblind") return "colorblind";
    return "default";
  }

  function getPalette() {
    // Default colors roughly match the current look.
    const palettes = {
      default: {
        ui: { bg: "#000000", fg: "#00ff00", accent: "#00ffff" },
        map: {
          player: "cyan",
          wall: "lime",
          floor: "#555",
          fogWall: "lime",
          fogFloor: "#555",
          mouse: "#eee",
          trapVisible: "orange",
          hiddenTrapFlash: "orange",
          trapdoor: "#00ff3a",
          campfire: "orange",
          shop: "#ffd700",
          unknown: "white",
          falseWallA: "#0a0",
          falseWallB: "#070",
        },
        enemies: {
          rat: "#bdbdbd",
          goblin: "#00ff3a",
          bat: "#a055a0",
          skeleton: "#ffffff",
          orc: "#8b4513",
        },
        loot: {
          health: "#ff3b3b",
          strength: "#ffe600",
          toughness: "#cfcfcf",
          speed: "#00ffff",
          invisibility: "#8888ff",
          explosive: "#ff8800",
          food: "#ffd6a6",
        },
        traps: {
          fire: "orange",
          poison: "lime",
          spike: "silver",
          shock: "yellow",
          unknown: "orange",
        },
        damage: { player: "#00ff00", crit: "#ffff00", enemy: "#ff0000" },
        log: {
          player: "lime",
          enemy: "red",
          loot: "cyan",
          block: "gray",
          death: "orange",
          floor: "violet",
          danger: "darkred",
          info: "white",
        },
      },
      highContrast: {
        ui: { bg: "#000000", fg: "#ffffff", accent: "#ffffff" },
        map: {
          player: "#00ffff",
          wall: "#ffffff",
          floor: "#9a9a9a",
          fogWall: "#ffffff",
          fogFloor: "#666",
          mouse: "#ffffff",
          trapVisible: "#ff00ff",
          hiddenTrapFlash: "#ff00ff",
          trapdoor: "#00ff00",
          campfire: "#ff9900",
          shop: "#ffff00",
          unknown: "#ffffff",
          falseWallA: "#00ff00",
          falseWallB: "#00aa00",
        },
        enemies: {
          rat: "#ffffff",
          goblin: "#00ffff",
          bat: "#ff00ff",
          skeleton: "#ffff00",
          orc: "#ff6600",
        },
        loot: {
          health: "#ff0000",
          strength: "#ffff00",
          toughness: "#ffffff",
          speed: "#00ffff",
          invisibility: "#ff00ff",
          explosive: "#ff6600",
          food: "#ffffff",
        },
        traps: {
          fire: "#ff6600",
          poison: "#00ff00",
          spike: "#ffffff",
          shock: "#ffff00",
          unknown: "#ff00ff",
        },
        damage: { player: "#00ff00", crit: "#ffff00", enemy: "#ff0000" },
        log: {
          player: "#00ff00",
          enemy: "#ff4444",
          loot: "#00ffff",
          block: "#bbbbbb",
          death: "#ff9900",
          floor: "#ffffff",
          danger: "#ff0000",
          info: "#ffffff",
        },
      },
      // Okabe-Ito inspired, better separation for common colorblindness.
      colorblind: {
        ui: { bg: "#000000", fg: "#f0f0f0", accent: "#56b4e9" },
        map: {
          player: "#56b4e9", // sky blue
          wall: "#f0f0f0",
          floor: "#8a8a8a",
          fogWall: "#f0f0f0",
          fogFloor: "#666",
          mouse: "#f0f0f0",
          trapVisible: "#d55e00", // vermillion
          hiddenTrapFlash: "#d55e00",
          trapdoor: "#009e73", // bluish green
          campfire: "#e69f00", // orange
          shop: "#f0e442", // yellow
          unknown: "#f0f0f0",
          falseWallA: "#009e73",
          falseWallB: "#007f5f",
        },
        enemies: {
          rat: "#f0f0f0",
          goblin: "#e69f00",
          bat: "#cc79a7",
          skeleton: "#f0e442",
          orc: "#d55e00",
        },
        loot: {
          health: "#d55e00",
          strength: "#e69f00",
          toughness: "#f0f0f0",
          speed: "#56b4e9",
          invisibility: "#cc79a7",
          explosive: "#0072b2",
          food: "#f0f0f0",
        },
        traps: {
          fire: "#d55e00",
          poison: "#009e73",
          spike: "#f0f0f0",
          shock: "#f0e442",
          unknown: "#d55e00",
        },
        damage: { player: "#009e73", crit: "#f0e442", enemy: "#d55e00" },
        log: {
          player: "#009e73",
          enemy: "#d55e00",
          loot: "#56b4e9",
          block: "#bbbbbb",
          death: "#e69f00",
          floor: "#56b4e9",
          danger: "#d55e00",
          info: "#f0f0f0",
        },
      },
    };

    const name = getPaletteName();
    return palettes[name] || palettes.default;
  }

  function applyPaletteToCss() {
    const p = getPalette();
    const root = document.documentElement;
    root.style.setProperty("--bg", p.ui.bg);
    root.style.setProperty("--fg", p.ui.fg);
    root.style.setProperty("--accent", p.ui.accent);
  }

  function getEnemyColor(e) {
    const p = getPalette();
    const name = String(e?.name || "").toLowerCase();
    if (name.includes("rat")) return p.enemies.rat;
    if (name.includes("goblin")) return p.enemies.goblin;
    if (name.includes("bat")) return p.enemies.bat;
    if (name.includes("skeleton")) return p.enemies.skeleton;
    if (name.includes("orc")) return p.enemies.orc;
    return e?.color || p.map.unknown;
  }

  function getTrapColor(trap) {
    const p = getPalette();
    const t = String(trap?.type || "").toLowerCase();
    return p.traps[t] || p.traps.unknown;
  }

  function getLootColor(loot) {
    const p = getPalette();
    const effect = String(loot?.effect || "").toLowerCase();
    if (effect === "fullheal") return p.loot.health;
    if (effect === "damageboost") return p.loot.strength;
    if (effect === "toughnessboost") return p.loot.toughness;
    if (effect === "speed") return p.loot.speed;
    if (effect === "invisibility") return p.loot.invisibility;
    if (effect === "explosive") return p.loot.explosive;
    if (effect === "food") return p.loot.food;
    return loot?.color || p.map.unknown;
  }

  function vibrate(pattern) {
    if (!settings?.haptics) return;
    const vib = navigator?.vibrate;
    if (typeof vib !== "function") return;
    try {
      vib(pattern);
    } catch {
      // ignore
    }
  }

  // Load settings from localStorage
  try {
    const savedSettings = localStorage.getItem("dungeonGameSettings");
    if (savedSettings) {
      settings = { ...settings, ...JSON.parse(savedSettings) };
    }
  } catch (e) {
    // Use defaults
  }
  
  // Initialize RNG so gameplay logic is deterministic and safe before starting.
  seedRng(createSeed());
  applyPaletteToCss();

  // Expose settings globally for investigation descriptions
  window.gameSettings = settings;

  try {
    bindInputs();
    initMainMenu(); // Initialize main menu
    
    // Set initial display state
    const mapContainerEl = document.getElementById("mapContainer");
    const controlsEl = document.getElementById("controls");
    if (mapContainerEl) mapContainerEl.style.display = "none";
    if (controlsEl) controlsEl.style.display = "none";

    // Redraw periodically only when timed visual effects are active (saves battery on mobile).
    window.setInterval(() => {
      if (menuOpen || inMainMenu) return;
      const mouseHintActive = !!(hiddenArea && !hiddenArea.revealed && (hiddenArea.mouseFlashUntil || 0) > Date.now());
      if (hiddenTrapCount > 0 || mouseHintActive) draw();
    }, 250);
  } catch (error) {
    console.error("Game initialization error:", error);
    if (gameEl) gameEl.innerHTML = `<div style="color: red; padding: 20px;">Error: ${error.message}<br>Check console for details.</div>`;
  }
});

