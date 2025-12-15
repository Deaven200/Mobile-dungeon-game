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
  x: 0, y: 0,
  hp: 10, maxHp: 10,
  dmg: 2,
  toughness: 0,
  inventory: []
};

let map = {};
let rooms = [];
let enemies = [];

/* ===================== DATA ===================== */

const POTIONS = [
  { name: "Health Potion", effect: "fullHeal", value: 1, symbol: "P", color: "red" },
  { name: "Strength Potion", effect: "damageBoost", value: 1, symbol: "P", color: "yellow" },
  { name: "Toughness Potion", effect: "toughnessBoost", value: 1, symbol: "P", color: "gray" }
];

const ENEMY_TYPES = [
  { hp: 1, dmg: 1, color: "red", sight: 3 },
  { hp: 2, dmg: 2, color: "green", sight: 4 },
  { hp: 3, dmg: 2, color: "blue", sight: 5 },
  { hp: 4, dmg: 3, color: "purple", sight: 6 }
];

/* ===================== HELPERS ===================== */

const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

function renderLiveLog() {
  const logDiv = document.getElementById("liveLog");
  if (!logDiv) return;
  logDiv.innerHTML = liveLogs
    .map(l => `<div style="color:${l.color}">${l.text}</div>`)
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
    info: "white"
  };

  let entry = { text, color: colors[type] || "white" };
  logHistory.push(entry);
  liveLogs.push(entry);

  renderLiveLog();

  setTimeout(() => {
    liveLogs = liveLogs.filter(e => e !== entry);
    renderLiveLog();
  }, LOG_LIFETIME);
}

function canMove(x, y) {
  if (map[`${x},${y}`] !== ".") return false;
  if (enemies.some(e => e.x === x && e.y === y)) return false;
  return true;
}

/* ===================== MAP GEN ===================== */

function generateFloor() {
  map = {};
  rooms = [];
  enemies = [];

  let roomCount = floor + 2;

  for (let i = 0; i < roomCount; i++) {
    let w = rand(5, 8);
    let h = rand(4, 6);
    let x = i === 0 ? 10 : rooms[i - 1].x + rooms[i - 1].w + rand(2, 4);
    let y = i === 0 ? 10 : rooms[i - 1].y + rand(-2, 2);
    let type = i === 0 ? "start" : (i === roomCount - 1 ? "boss" : "enemy");

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

  let s = rooms[0];
  player.x = Math.floor(s.x + s.w / 2);
  player.y = Math.floor(s.y + s.h / 2);

  draw();
}

function connectRooms(a, b) {
  let ax = Math.floor(a.x + a.w / 2);
  let ay = Math.floor(a.y + a.h / 2);
  let bx = Math.floor(b.x + b.w / 2);
  let by = Math.floor(b.y + b.h / 2);

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
  let count = rand(1, 2);
  for (let i = 0; i < count; i++) {
    let t = ENEMY_TYPES[Math.min(Math.floor((floor - 1) / 10), ENEMY_TYPES.length - 1)];
    enemies.push({
      x: rand(x, x + w - 1),
      y: rand(y, y + h - 1),
      hp: t.hp,
      dmg: t.dmg,
      color: t.color,
      sight: t.sight
    });
  }
}

function spawnPotion(x, y, w, h) {
  if (Math.random() < 0.05) {
    let p = POTIONS[rand(0, POTIONS.length - 1)];
    let px = rand(x, x + w - 1);
    let py = rand(y, y + h - 1);
    map[`${px},${py}`] = "P";
    map[`${px},${py}_loot`] = p;
  }
}

function placeTrapdoor() {
  let r = rooms[rooms.length - 1];
  let tx = Math.floor(r.x + r.w / 2);
  let ty = Math.floor(r.y + r.h / 2);
  map[`${tx},${ty}`] = "T";
}

/* ===================== ENEMY AI ===================== */

function moveEnemies() {
  for (let e of enemies) {
    let dx = player.x - e.x;
    let dy = player.y - e.y;
    let dist = Math.max(Math.abs(dx), Math.abs(dy));

    if (Math.abs(dx) + Math.abs(dy) === 1) {
      let dmg = Math.max(0, e.dmg - player.toughness);
      player.hp -= dmg;
      addLog(`Enemy hits you for ${dmg}`, dmg ? "enemy" : "block");
      continue;
    }

    if (dist <= e.sight) {
      let sx = Math.sign(dx);
      let sy = Math.sign(dy);
      if (canMove(e.x + sx, e.y)) e.x += sx;
      else if (canMove(e.x, e.y + sy)) e.y += sy;
    } else {
      let dirs = [[1,0],[-1,0],[0,1],[0,-1]].sort(() => Math.random() - 0.5);
      for (let [mx, my] of dirs) {
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

  let nx = player.x + dx;
  let ny = player.y + dy;
  let tile = map[`${nx},${ny}`] || "#";

  if (tile === "#") return;

  let enemy = enemies.find(e => e.x === nx && e.y === ny);
  if (enemy) {
    enemy.hp -= player.dmg;
    addLog(`You hit enemy for ${player.dmg}`, "player");

    if (enemy.hp <= 0) {
      addLog("Enemy dies", "death");
      enemies = enemies.filter(e => e !== enemy);

      if (Math.random() < 0.05) {
        let p = POTIONS[rand(0, POTIONS.length - 1)];
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
  }

  draw();
}

/* ===================== INVENTORY ===================== */

function usePotion(i) {
  let p = player.inventory[i];
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

/* ===================== MENU ===================== */

function toggleMenu() {
  menuOpen = !menuOpen;
  gamePaused = menuOpen;
  draw();
}

function setTab(tab) {
  activeTab = tab;
  draw();
}

/* ===================== DRAW ===================== */

function draw() {
  let g = document.getElementById("game");

  // Live log
  renderLiveLog();
  
if (menuOpen) {
  // Ensure menuOpen always triggers
  activeTab = activeTab || "inventory"; // default if undefined

  g.innerHTML = `
    <div class="menu-container">
      <div class="menu-tabs">
        <button onclick="setTab('inventory')">Inventory</button>
        <button onclick="setTab('status')">Status</button>
        <button onclick="setTab('log')">Log</button>
      </div>
      <div class="menu-content">
      ${
        activeTab === "inventory"
        ? (player.inventory.length
          ? player.inventory.map((p,i)=>`
            <button onclick="usePotion(${i})" class="menu-button" style="color:${p.color};">
              ${p.name}
            </button>`).join("")
          : "Inventory empty")
        : activeTab === "status"
        ? `<div class="menu-status">
            HP ${player.hp}/${player.maxHp}<br>
            DMG ${player.dmg}<br>
            Tough ${player.toughness}<br>
            Floor ${floor}
          </div>`
        : `<div class="menu-log">
            ${logHistory.map(l=>`<div style="color:${l.color}">${l.text}</div>`).join("")}
          </div>`
      }
      </div>
    </div>
  `;
  return;
}

  // Map draw - center on player
  let out = "";
  for (let y = -VIEW_RADIUS; y <= VIEW_RADIUS; y++) {
    for (let x = -VIEW_RADIUS; x <= VIEW_RADIUS; x++) {
      let tx = player.x + x;
      let ty = player.y + y;

      if (tx === player.x && ty === player.y) out += `<span style="color:lime">@</span>`;
      else if (enemies.some(e => e.x === tx && e.y === ty)) {
        let e = enemies.find(e => e.x === tx && e.y === ty);
        out += `<span style="color:${e.color}">E</span>`;
      }
      else if (map[`${tx},${ty}_loot`]) {
        let p = map[`${tx},${ty}_loot`];
        out += `<span style="color:${p.color}">${p.symbol}</span>`;
      }
      else out += map[`${tx},${ty}`] || "#";
    }
    out += "\n";
  }

  g.innerHTML = out;
}

/* ===================== INIT ===================== */

generateFloor();

window.move = move;
window.toggleMenu = toggleMenu;
window.setTab = setTab;
window.usePotion = usePotion;

});
