document.addEventListener("DOMContentLoaded", () => {
  /* ===================== STATE ===================== */

  let floor = 1;
  let menuOpen = false;
  let activeTab = "inventory";
  let gamePaused = false;

  const VIEW_RADIUS = 8;
  const LOG_LIFETIME = 3000;
  const HIDDEN_TRAP_FLASH_PERIOD_MS = 3000;
  const HIDDEN_TRAP_FLASH_PULSE_MS = 350;

  let logHistory = [];
  let liveLogs = [];

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

  const gameEl = document.getElementById("game");
  const controlsEl = document.getElementById("controls");
  const mapContainerEl = document.getElementById("mapContainer");

  /* ===================== DATA ===================== */

  const POTIONS = [
    { name: "Health Potion", effect: "fullHeal", value: 1, symbol: "P", color: "red" },
    { name: "Strength Potion", effect: "damageBoost", value: 1, symbol: "P", color: "yellow" },
    { name: "Toughness Potion", effect: "toughnessBoost", value: 1, symbol: "P", color: "gray" },
  ];

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
    logDiv.innerHTML = liveLogs.map((l) => `<div style="color:${l.color}">${escapeHtml(l.text)}</div>`).join("");
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

    document.body.classList.toggle("menu-open", open);
    if (gameEl) gameEl.classList.toggle("is-menu", open);
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
    if (enemies.some((e) => e.x === x && e.y === y)) return false;
    return true;
  }

  /* ===================== MAP GEN ===================== */

  function generateFloor() {
    map = {};
    rooms = [];
    enemies = [];

    const roomCount = floor + 2;

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

    const s = rooms[0];
    player.x = Math.floor(s.x + s.w / 2);
    player.y = Math.floor(s.y + s.h / 2);

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
      const t = ENEMY_TYPES[Math.min(Math.floor((floor - 1) / 10), ENEMY_TYPES.length - 1)];

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
        });
        placed = true;
        break;
      }

      if (!placed) {
        enemies.push({ x, y, hp: t.hp, dmg: t.dmg, color: t.color, sight: t.sight });
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
      const prefix = trap.hidden ? "Enemy triggers a hidden trap!" : "Enemy triggers a trap!";
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

  function moveEnemies() {
    for (let idx = enemies.length - 1; idx >= 0; idx--) {
      const e = enemies[idx];
      const dx = player.x - e.x;
      const dy = player.y - e.y;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));

      if (Math.abs(dx) + Math.abs(dy) === 1) {
        const dmg = Math.max(0, e.dmg - player.toughness);
        player.hp -= dmg;
        addLog(`Enemy hits you for ${dmg}`, dmg ? "enemy" : "block");
        tickStatusEffects(e, "enemy");
        if (e.hp <= 0) {
          addLog("Enemy dies", "death");
          enemies.splice(idx, 1);
        }
        continue;
      }

      const beforeX = e.x;
      const beforeY = e.y;
      if (dist <= e.sight) {
        const sx = Math.sign(dx);
        const sy = Math.sign(dy);
        if (canMove(e.x + sx, e.y)) e.x += sx;
        else if (canMove(e.x, e.y + sy)) e.y += sy;
      } else {
        const dirs = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].sort(() => Math.random() - 0.5);

        for (const [mx, my] of dirs) {
          if (canMove(e.x + mx, e.y + my)) {
            e.x += mx;
            e.y += my;
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
        addLog("Enemy dies", "death");
        enemies.splice(idx, 1);
      }
    }
  }

  /* ===================== PLAYER ===================== */

  function move(dx, dy) {
    if (gamePaused) return;

    const nx = player.x + dx;
    const ny = player.y + dy;
    const tile = map[`${nx},${ny}`] || "#";

    if (tile === "#") return;

    const enemy = enemies.find((e) => e.x === nx && e.y === ny);
    if (enemy) {
      enemy.hp -= player.dmg;
      addLog(`You hit enemy for ${player.dmg}`, "player");

      if (enemy.hp <= 0) {
        addLog("Enemy dies", "death");
        enemies = enemies.filter((e) => e !== enemy);

        if (Math.random() < 0.05) {
          const p = POTIONS[rand(0, POTIONS.length - 1)];
          map[`${nx},${ny}`] = "P";
          map[`${nx},${ny}_loot`] = p;
          addLog("Enemy dropped a potion", "loot");
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

    // The visible map is (2*VIEW_RADIUS + 1) characters wide/tall.
    const cols = VIEW_RADIUS * 2 + 1;
    const rows = VIEW_RADIUS * 2 + 1;

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
        DMG ${player.dmg}<br>
        Tough ${player.toughness}<br>
        Floor ${floor}
        ${statusLines.length ? "<br><br>" + statusLines.map(escapeHtml).join("<br>") : ""}
      </div>`;
    } else {
      content = `<div class="menu-log">${logHistory
        .map((l) => `<div style="color:${l.color}">${escapeHtml(l.text)}</div>`)
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
    const hiddenFlashOn = Date.now() % HIDDEN_TRAP_FLASH_PERIOD_MS < HIDDEN_TRAP_FLASH_PULSE_MS;

    // Map draw - center on player
    let out = "";
    for (let y = -VIEW_RADIUS; y <= VIEW_RADIUS; y++) {
      for (let x = -VIEW_RADIUS; x <= VIEW_RADIUS; x++) {
        const tx = player.x + x;
        const ty = player.y + y;
        const key = `${tx},${ty}`;

        if (tx === player.x && ty === player.y) {
          const extra = getBurning(player)?.turns ? burningOutlineCss : "";
          out += tileSpan("@", "cyan", extra);
        }
        else if (enemyByPos.has(key)) {
          const e = enemyByPos.get(key);
          const extra = getBurning(e)?.turns ? burningOutlineCss : "";
          out += tileSpan("E", e.color, extra);
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

        const moveStr = btn.dataset.move;
        if (!moveStr) return;
        const [dx, dy] = moveStr.split(",").map(Number);
        move(dx, dy);
      });
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

    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;

      if (menuOpen) {
        if (e.key === "Escape" || e.key === "m" || e.key === "M") {
          e.preventDefault();
          toggleMenu();
        }
        return;
      }

      if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        toggleMenu();
        return;
      }

      let dx = 0;
      let dy = 0;

      if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") dy = -1;
      else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") dy = 1;
      else if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") dx = -1;
      else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") dx = 1;
      else return;

      e.preventDefault();
      move(dx, dy);
    });

    // Swipe anywhere on the map to move (good on phones).
    if (mapContainerEl) {
      let start = null;
      const SWIPE_MIN = 30;

      mapContainerEl.addEventListener(
        "touchstart",
        (e) => {
          if (gamePaused) return;
          if (e.touches.length !== 1) return;
          const t = e.touches[0];
          start = { x: t.clientX, y: t.clientY };
        },
        { passive: true },
      );

      mapContainerEl.addEventListener(
        "touchend",
        (e) => {
          if (gamePaused) return;
          if (!start) return;
          if (!e.changedTouches.length) return;

          const t = e.changedTouches[0];
          const dx = t.clientX - start.x;
          const dy = t.clientY - start.y;
          start = null;

          const ax = Math.abs(dx);
          const ay = Math.abs(dy);
          if (Math.max(ax, ay) < SWIPE_MIN) return;

          if (ax > ay) move(Math.sign(dx), 0);
          else move(0, Math.sign(dy));
        },
        { passive: true },
      );
    }
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
