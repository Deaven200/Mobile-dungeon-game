document.addEventListener("DOMContentLoaded", () => {
  /* ===================== STATE ===================== */

  let floor = 1;
  let menuOpen = false;
  let activeTab = "inventory";
  let gamePaused = false;

  const VIEW_RADIUS = 8;
  const LOG_LIFETIME = 3000;

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

  /* ===================== HELPERS ===================== */

  const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

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
    if (map[`${x},${y}`] !== ".") return false;
    if (enemies.some((e) => e.x === x && e.y === y)) return false;
    return true;
  }

  /* ===================== MAP GEN ===================== */

  function generateFloor() {
    map = {};
    rooms = [];
    enemies = [];

    const roomCount = floor + 2;

    for (let i = 0; i < roomCount; i++) {
      const w = rand(5, 8);
      const h = rand(4, 6);
      const x = i === 0 ? 10 : rooms[i - 1].x + rooms[i - 1].w + rand(2, 4);
      const y = i === 0 ? 10 : rooms[i - 1].y + rand(-2, 2);
      const type = i === 0 ? "start" : i === roomCount - 1 ? "boss" : "enemy";

      rooms.push({ x, y, w, h, type });

      for (let ry = y; ry < y + h; ry++) {
        for (let rx = x; rx < x + w; rx++) {
          map[`${rx},${ry}`] = ".";
        }
      }

      if (i > 0) connectRooms(rooms[i - 1], rooms[i]);

      if (type === "enemy") {
        spawnEnemies(x, y, w, h);
        spawnPotion(x, y, w, h);
      }
    }

    placeTrapdoor();

    const s = rooms[0];
    player.x = Math.floor(s.x + s.w / 2);
    player.y = Math.floor(s.y + s.h / 2);

    // Always close menu when generating a new floor (death/descend).
    setMenuOpen(false);
    draw();
  }

  function connectRooms(a, b) {
    const ax = Math.floor(a.x + a.w / 2);
    const ay = Math.floor(a.y + a.h / 2);
    const bx = Math.floor(b.x + b.w / 2);
    const by = Math.floor(b.y + b.h / 2);

    for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) {
      map[`${x},${ay}`] = ".";
      map[`${x},${ay + 1}`] = ".";
    }

    for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) {
      map[`${bx},${y}`] = ".";
      map[`${bx + 1},${y}`] = ".";
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
    const r = rooms[rooms.length - 1];
    const tx = Math.floor(r.x + r.w / 2);
    const ty = Math.floor(r.y + r.h / 2);
    map[`${tx},${ty}`] = "T";
  }

  /* ===================== ENEMY AI ===================== */

  function moveEnemies() {
    for (const e of enemies) {
      const dx = player.x - e.x;
      const dy = player.y - e.y;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));

      if (Math.abs(dx) + Math.abs(dy) === 1) {
        const dmg = Math.max(0, e.dmg - player.toughness);
        player.hp -= dmg;
        addLog(`Enemy hits you for ${dmg}`, dmg ? "enemy" : "block");
        continue;
      }

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

    // Slight safety margin so we don't clip on fractional pixels.
    const cellPx = Math.floor(Math.min(usableW / cols, usableH / rows) * 0.98);
    const fontPx = Math.max(12, Math.min(36, cellPx));

    gameEl.style.fontSize = `${fontPx}px`;
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
      content = `<div class="menu-status">
        HP ${player.hp}/${player.maxHp}<br>
        DMG ${player.dmg}<br>
        Tough ${player.toughness}<br>
        Floor ${floor}
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

    // Map draw - center on player
    let out = "";
    for (let y = -VIEW_RADIUS; y <= VIEW_RADIUS; y++) {
      for (let x = -VIEW_RADIUS; x <= VIEW_RADIUS; x++) {
        const tx = player.x + x;
        const ty = player.y + y;
        const key = `${tx},${ty}`;

        if (tx === player.x && ty === player.y) out += `<span style="color:lime">@</span>`;
        else if (enemyByPos.has(key)) {
          const e = enemyByPos.get(key);
          out += `<span style="color:${e.color}">E</span>`;
        } else if (map[`${key}_loot`]) {
          const p = map[`${key}_loot`];
          out += `<span style="color:${p.color}">${p.symbol}</span>`;
        } else out += map[key] || "#";
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
});
