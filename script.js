document.addEventListener("DOMContentLoaded", () => {
  /* ===================== STATE ===================== */

  let floor = 1;
  let menuOpen = false;
  let activeTab = "inventory";
  let gamePaused = false;
  let investigateArmed = false;

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
  };

  let map = {};
  let rooms = [];
  let enemies = [];
  let hiddenArea = null; // { revealed, tiles:Set<string>, falseWalls:Set<string>, mouseFlashUntil:number }
  let mouse = null; // { x, y }
  let autoMove = { timerId: null, path: [], attackTarget: null };

  const gameEl = document.getElementById("game");
  const controlsEl = document.getElementById("controls");
  const mapContainerEl = document.getElementById("mapContainer");
  const investigateBtnEl = document.getElementById("investigateBtn");

  /* ===================== DATA ===================== */

  const POTIONS = [
    { name: "Health Potion", effect: "fullHeal", value: 1, symbol: "P", color: "red" },
    { name: "Strength Potion", effect: "damageBoost", value: 1, symbol: "P", color: "yellow" },
    { name: "Toughness Potion", effect: "toughnessBoost", value: 1, symbol: "P", color: "gray" },
  ];

  const RAT = { hp: 3, dmg: 1, color: "#666", sight: 4, symbol: "r", name: "Rat" };
  const GOBLIN = { hp: 6, dmg: 3, color: "green", sight: 5, symbol: "g", name: "Goblin" };

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

  const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

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
    const u = lo + (hi - lo) * Math.random();
    const v = lo + (hi - lo) * Math.random();
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
    return ch === "." || ch === "~" || ch === "T";
  }

  function getBurning(target) {
    return target?.statusEffects?.burning || null;
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

  function tickStatusEffects(target, targetKind = "player") {
    if (!target || typeof target.hp !== "number") return;
    const burning = getBurning(target);
    if (!burning?.turns) return;

    const dmg = Math.max(0, Number(burning.dmgPerTurn || 0));
    if (dmg) target.hp -= dmg;

    burning.turns -= 1;
    if (burning.turns <= 0) delete target.statusEffects.burning;

    // Only spam logs for the player; enemies already have visible feedback and death logs.
    if (targetKind === "player") {
      addLog(`You are burning: -${dmg} hp`, dmg ? "danger" : "block");
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

  function setMenuOpen(open) {
    menuOpen = open;
    gamePaused = open;
    if (open) stopAutoMove();
    if (open) setInvestigateArmed(false);

    document.body.classList.toggle("menu-open", open);
    if (gameEl) gameEl.classList.toggle("is-menu", open);
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
    if (loot) return { kind: "potion", potion: loot };

    const trap = map[`${key}_trap`];
    if (trap) return { kind: "trap", trap };

    const ch = map[key] || "#";
    if (ch === "T") return { kind: "trapdoor" };
    if (ch === "#") return { kind: "wall" };
    return { kind: "floor" };
  }

  function investigateAt(tx, ty) {
    const info = getInvestigationInfoAt(tx, ty);
    const describe = window.getInvestigationDescription;
    const text = typeof describe === "function" ? describe(info) : "You investigate it. It investigates you back.";

    const kind = String(info?.kind || "info").toLowerCase();
    const logType =
      kind === "enemy"
        ? "enemy"
        : kind === "trap"
          ? "danger"
          : kind === "potion"
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

    // Pick boss room as the one farthest from start (keeps progression feel).
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

    // Populate rooms.
    for (const r of rooms) {
      if (r.type === "enemy") {
        spawnEnemies(r.x, r.y, r.w, r.h);
        spawnPotion(r.x, r.y, r.w, r.h);
      }
    }

    placeTrapdoor();
    placeTraps();
    generateHiddenRoom();

    const s = rooms[0];
    player.x = Math.floor(s.x + s.w / 2);
    player.y = Math.floor(s.y + s.h / 2);
    spawnMouse();

    // Always close menu when generating a new floor (death/descend).
    setMenuOpen(false);
    draw();
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
      const chance = d < 20 ? 0.18 : d < 35 ? 0.08 : 0.03;
      if (Math.random() < chance) {
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
      if (third != null && Math.random() < 0.5) edges.add(keyOf(0, third));
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

    const horizFirst = Math.random() < 0.5;
    const carveH = (y, x1, x2) => {
      for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
        map[`${x},${y}`] = ".";
        if (Math.random() < 0.85) map[`${x},${y + 1}`] = "."; // occasional 2-wide halls
      }
    };
    const carveV = (x, y1, y2) => {
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
        map[`${x},${y}`] = ".";
        if (Math.random() < 0.85) map[`${x + 1},${y}`] = ".";
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

  function spawnEnemies(x, y, w, h) {
    const count = rand(1, 2);

    for (let i = 0; i < count; i++) {
      // Floor 1-4: rats. Starting at floor 5: goblins replace rats.
      const t = floor >= 5 ? GOBLIN : RAT;

      let placed = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        const ex = rand(x, x + w - 1);
        const ey = rand(y, y + h - 1);
        if (map[`${ex},${ey}`] !== ".") continue;
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
        });
      }
    }
  }

  function spawnPotion(x, y, w, h) {
    if (Math.random() >= 0.05) return;

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

  function placeTrapdoor() {
    const r = rooms.find((rr) => rr.type === "boss") || rooms[rooms.length - 1];
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
      const hidden = Math.random() < 0.45;

      let placed = false;
      for (let attempt = 0; attempt < 80; attempt++) {
        const x = rand(r.x, r.x + r.w - 1);
        const y = rand(r.y, r.y + r.h - 1);
        const key = `${x},${y}`;
        if (map[key] !== ".") continue;
        if (map[`${key}_loot`]) continue;
        if (enemies.some((e) => e.x === x && e.y === y)) continue;

        map[`${key}_trap`] = { ...trap, hidden };
        if (!hidden) map[key] = "~";
        placed = true;
        break;
      }

      if (!placed) continue;
    }
  }

  function shouldHaveHiddenRoomOnFloor(f) {
    if (f === 1) return true;
    return Math.random() < 0.1;
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
    } else {
      const name = target?.name || "Enemy";
      const prefix = trap.hidden ? `${name} triggers a hidden trap!` : `${name} triggers a trap!`;
      addLog(`${prefix} ${trap.type} deals ${dmg} damage`, dmg ? "danger" : "block");
    }

    if (target && typeof target.hp === "number") target.hp -= dmg;
    if (trap.status?.kind === "burning") {
      addBurning(target, trap.status.turns ?? 3, trap.status.dmgPerTurn ?? 1);
      if (targetKind === "player") addLog("You are burning!", "danger");
    }

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
        options.push(
          ...[
            { x: mouse.x + 1, y: mouse.y },
            { x: mouse.x - 1, y: mouse.y },
            { x: mouse.x, y: mouse.y + 1 },
            { x: mouse.x, y: mouse.y - 1 },
          ].sort(() => Math.random() - 0.5),
        );

        for (const c of options) {
          if (canMouseMoveTo(c.x, c.y)) {
            next = c;
            break;
          }
        }
      }
    } else {
      const dirs = [
        { x: mouse.x + 1, y: mouse.y },
        { x: mouse.x - 1, y: mouse.y },
        { x: mouse.x, y: mouse.y + 1 },
        { x: mouse.x, y: mouse.y - 1 },
      ].sort(() => Math.random() - 0.5);

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
    const canEnemyStep = (fromX, fromY, toX, toY) => isStepAllowed(fromX, fromY, toX, toY, canMove);

    for (let idx = enemies.length - 1; idx >= 0; idx--) {
      const e = enemies[idx];
      const eName = e?.name || "Enemy";
      const dx = player.x - e.x;
      const dy = player.y - e.y;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));

      if (dist === 1) {
        const rolled = rollBellInt(0, e.dmg);
        const dmg = Math.max(0, rolled - player.toughness);
        player.hp -= dmg;
        addLog(`${eName} hits you for ${dmg}`, dmg ? "enemy" : "block");
        tickStatusEffects(e, "enemy");
        if (e.hp <= 0) {
          addLog(`${eName} dies`, "death");
          enemies.splice(idx, 1);
        }
        continue;
      }

      const beforeX = e.x;
      const beforeY = e.y;
      if (dist <= e.sight) {
        const candidates = [
          { x: e.x + Math.sign(dx), y: e.y + Math.sign(dy) },
          { x: e.x + Math.sign(dx), y: e.y },
          { x: e.x, y: e.y + Math.sign(dy) },
          { x: e.x + Math.sign(dx), y: e.y - Math.sign(dy) },
          { x: e.x - Math.sign(dx), y: e.y + Math.sign(dy) },
          { x: e.x - Math.sign(dx), y: e.y },
          { x: e.x, y: e.y - Math.sign(dy) },
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
          e.x = best.x;
          e.y = best.y;
        }
      } else {
        const dirs = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ].sort(() => Math.random() - 0.5);

        for (const [mx, my] of dirs) {
          const nx = e.x + mx;
          const ny = e.y + my;
          if (canEnemyStep(e.x, e.y, nx, ny)) {
            e.x = nx;
            e.y = ny;
            break;
          }
        }
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
      const dealt = rollBellInt(0, player.dmg);
      enemy.hp -= dealt;
      addLog(`You hit ${(enemy?.name || "enemy").toLowerCase()} for ${dealt}`, dealt ? "player" : "block");

      if (enemy.hp <= 0) {
        addLog(`${enemy?.name || "Enemy"} dies`, "death");
        enemies = enemies.filter((e) => e !== enemy);

        if (Math.random() < 0.05) {
          const p = POTIONS[rand(0, POTIONS.length - 1)];
          map[`${nx},${ny}`] = "P";
          map[`${nx},${ny}_loot`] = p;
          addLog(`${enemy?.name || "Enemy"} dropped a potion`, "loot");
        }
      }
    } else {
      player.x = nx;
      player.y = ny;
    }

    // Traps trigger when you step onto the tile (including hidden traps that look like floor).
    triggerTrapAtEntity(player.x, player.y, player, "player");

    // Only pick up loot from the tile you are actually standing on.
    const pKey = `${player.x},${player.y}`;
    if (map[`${pKey}_loot`]) {
      player.inventory.push(map[`${pKey}_loot`]);
      addLog("Picked up potion", "loot");
      delete map[`${pKey}_loot`];
      map[pKey] = ".";
    }

    if (tile === "T") {
      addLog(`Descending to floor ${floor + 1}`, "floor");
      floor++;
      generateFloor();
      return;
    }

    moveMouse();
    moveEnemies();
    tickStatusEffects(player, "player");

    if (player.hp <= 0) {
      addLog("You died", "danger");
      alert("You died");
      floor = 1;
      player.hp = player.maxHp;
      generateFloor();
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

    player.inventory.splice(i, 1);
    draw();
  }

  /* ===================== DRAW ===================== */

  let measureEl = null;

  function getMonoCellMetricsPx(testFontPx = 100) {
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

    return { unitW, unitH };
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
              `<button type="button" data-use-potion="${i}" class="menu-button" style="color:${p.color};">${escapeHtml(
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
      content = `<div class="menu-status">
        HP ${player.hp}/${player.maxHp}<br>
        DMG 0-${player.dmg}<br>
        Tough ${player.toughness}<br>
        Floor ${floor}
        ${statusLines.length ? "<br><br>" + statusLines.map(escapeHtml).join("<br>") : ""}
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
          ${tabBtn("log", "Log")}
          ${actionBtn("close-menu", "Close")}
        </div>
        <div class="menu-content">${content}</div>
      </div>
    `;
  }

  function draw() {
    if (!gameEl) return;

    // Live log
    renderLiveLog();

    if (menuOpen) {
      activeTab = activeTab || "inventory";
      gameEl.innerHTML = renderMenuHtml();
      return;
    }

    const enemyByPos = new Map();
    for (const e of enemies) enemyByPos.set(`${e.x},${e.y}`, e);

    const tileSpan = (ch, color, extraStyle = "") => `<span style="color:${color};${extraStyle}">${ch}</span>`;
    const burningOutlineCss = "text-shadow: 0 0 3px orange, 0 0 6px orange;";
    const mouseCss =
      "display:inline-block; transform: translate(0.28em, 0.16em) scale(0.65); transform-origin:center;";
    const hiddenFlashOn = Date.now() % HIDDEN_TRAP_FLASH_PERIOD_MS < HIDDEN_TRAP_FLASH_PULSE_MS;
    const mouseWallPulseOn = Date.now() % 240 < 120;

    const viewRadius = getViewRadius();
    markExploredAroundPlayer();

    // Map draw - center on player
    let out = "";
    for (let y = -viewRadius; y <= viewRadius; y++) {
      for (let x = -viewRadius; x <= viewRadius; x++) {
        const tx = player.x + x;
        const ty = player.y + y;
        const key = `${tx},${ty}`;
        const dist = Math.max(Math.abs(x), Math.abs(y)); // square distance

        // Fog-of-war beyond current sight: show only explored terrain, hide unseen.
        if (dist > BASE_VIEW_RADIUS) {
          if (!explored.has(key)) {
            out += " ";
            continue;
          }

          // Hidden hallway/room stays hidden as walls until revealed.
          const hiddenAsWall = hiddenArea && !hiddenArea.revealed && hiddenArea.tiles?.has(key);
          const ch = hiddenAsWall ? "#" : map[key] || "#";
          const t = ch === "#" ? "#" : ".";
          out += t === "#" ? tileSpan("#", "lime") : tileSpan(".", "#555");
          continue;
        }

        const terrainOnly = dist > FULL_SIGHT_RADIUS;

        // Terrain-only ring: show walls/floors only (no enemies, items, traps, mouse, trapdoor).
        if (terrainOnly) {
          // Hidden hallway/room stays hidden as walls until revealed.
          if (hiddenArea && !hiddenArea.revealed && hiddenArea.tiles?.has(key)) {
            const isFalseWall = hiddenArea.falseWalls?.has(key);
            const flash = isFalseWall && Date.now() < (hiddenArea.mouseFlashUntil || 0);
            const mouseWallPulseOn = Date.now() % 240 < 120;
            const color = isFalseWall ? (flash ? (mouseWallPulseOn ? "#0a0" : "#070") : "#0a0") : "lime";
            out += tileSpan("#", color);
          } else {
            const ch = map[key] || "#";
            // Only terrain: walls and floors. Everything else renders as floor.
            const t = ch === "#" ? "#" : ".";
            out += t === "#" ? tileSpan("#", "lime") : tileSpan(".", "#555");
          }
          continue;
        }

        if (tx === player.x && ty === player.y) {
          const extra = getBurning(player)?.turns ? burningOutlineCss : "";
          out += tileSpan("@", "cyan", extra);
        } else if (enemyByPos.has(key)) {
          const e = enemyByPos.get(key);
          const extra = getBurning(e)?.turns ? burningOutlineCss : "";
          out += tileSpan(e.symbol || "E", e.color, extra);
        } else if (mouse && tx === mouse.x && ty === mouse.y) {
          // Mouse hint: visually smaller and offset between tiles.
          out += tileSpan("m", "#ddd", mouseCss);
        } else if (hiddenArea && !hiddenArea.revealed && hiddenArea.tiles?.has(key)) {
          // Hidden hallway/room are drawn as walls until revealed.
          const isFalseWall = hiddenArea.falseWalls?.has(key);
          const flash = isFalseWall && Date.now() < (hiddenArea.mouseFlashUntil || 0);
          const color = isFalseWall ? (flash ? (mouseWallPulseOn ? "#0a0" : "#070") : "#0a0") : "lime";
          out += tileSpan("#", color);
        } else if (map[`${key}_loot`]) {
          const p = map[`${key}_loot`];
          out += tileSpan(p.symbol, p.color);
        } else {
          const ch = map[key] || "#";
          const trap = map[`${key}_trap`];
          if (trap) {
            if (trap.hidden) {
              // Hidden traps look like floor, but flash orange every few seconds.
              out += tileSpan(".", hiddenFlashOn ? "orange" : "#555");
            } else {
              out += tileSpan("~", trap.color || "orange");
            }
          } else if (ch === ".") out += tileSpan(".", "#555"); // dark gray floors
          else if (ch === "~") out += tileSpan("~", "orange"); // fallback (should normally be typed via _trap)
          else if (ch === "#") out += tileSpan("#", "lime"); // green walls
          else if (ch === "T") out += tileSpan("T", "lime"); // green trapdoor
          else out += tileSpan(ch, "white");
        }
      }
      out += "\n";
    }

    gameEl.innerHTML = out;
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
          toggleMenu();
          return;
        }
        if (action === "investigate") {
          if (menuOpen || gamePaused) return;
          setInvestigateArmed(!investigateArmed);
          return;
        }
      });
    }

    // Tap-to-move on the map: tap a tile to auto-walk to it (step-by-step).
    if (mapContainerEl) {
      mapContainerEl.addEventListener("pointerdown", (e) => {
        if (menuOpen || gamePaused) return;
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
        zoomScale = clamp(pinch.startZoom * (dist / pinch.startDist), minZoom, maxZoom);
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

        if (btn.dataset.tab) {
          setTab(btn.dataset.tab);
          return;
        }

        if (btn.dataset.usePotion != null) {
          usePotion(Number(btn.dataset.usePotion));
        }
      });
    }

    window.addEventListener("resize", () => updateMapFontSize());
  }

  /* ===================== INIT ===================== */

  bindInputs();
  generateFloor();

  // Redraw periodically so hidden trap flashing is visible.
  window.setInterval(() => {
    if (menuOpen) return;
    draw();
  }, 250);
});
