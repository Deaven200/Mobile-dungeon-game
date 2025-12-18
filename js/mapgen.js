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
  lastTarget = null;
  explored = new Set();
  visibleNow = new Set();
  floorStats = { enemiesKilled: 0, itemsFound: 0, damageTaken: 0, damageDealt: 0, trapsTriggered: 0 };
  hiddenTrapCount = 0;

  // Floor 0: safe courtyard outside the dungeon.
  if (floor === 0) {
    const SIZE = 35;
    const MAX = SIZE - 1;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const isBorder = x === 0 || y === 0 || x === MAX || y === MAX;
        map[keyOf(x, y)] = isBorder ? TILE.WALL : TILE.GRASS;
      }
    }

    const cx = Math.floor(SIZE / 2);
    const cy = Math.floor(SIZE / 2);

    // Helper: carve a simple path.
    const carvePath = (x0, y0, x1, y1) => {
      let x = x0;
      let y = y0;
      const stepX = () => (x < x1 ? 1 : x > x1 ? -1 : 0);
      const stepY = () => (y < y1 ? 1 : y > y1 ? -1 : 0);
      for (let i = 0; i < 300; i++) {
        map[keyOf(x, y)] = TILE.FLOOR;
        if (x === x1 && y === y1) break;
        // Slightly jitter between horizontal/vertical for a more “path” feel.
        const dx = stepX();
        const dy = stepY();
        if (dx && dy) {
          if (rollChance(0.5)) x += dx;
          else y += dy;
        } else if (dx) x += dx;
        else if (dy) y += dy;
        else break;
      }
      map[keyOf(x1, y1)] = TILE.FLOOR;
    };

    // Helper: place a little building (walls with a floor interior and a doorway).
    const placeBuilding = (x, y, w, h, doorSide = "south") => {
      for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) {
          const isEdge = xx === x || yy === y || xx === x + w - 1 || yy === y + h - 1;
          map[keyOf(xx, yy)] = isEdge ? TILE.WALL : TILE.FLOOR;
        }
      }
      let dx = x + Math.floor(w / 2);
      let dy = y + h - 1;
      if (doorSide === "north") {
        dy = y;
      } else if (doorSide === "east") {
        dx = x + w - 1;
        dy = y + Math.floor(h / 2);
      } else if (doorSide === "west") {
        dx = x;
        dy = y + Math.floor(h / 2);
      }
      map[keyOf(dx, dy)] = TILE.FLOOR;
      return { doorX: dx, doorY: dy };
    };

    // Campfire at the camp center.
    const fireX = cx - 5;
    const fireY = cy + 6;
    map[keyOf(fireX, fireY)] = TILE.CAMPFIRE;

    // Merchant building with shop inside.
    const shopB = placeBuilding(cx + 6, cy + 3, 9, 7, "south");
    const shopX = cx + 6 + 4;
    const shopY = cy + 3 + 3;
    map[keyOf(shopX, shopY)] = TILE.SHOP;
    map[`${shopX},${shopY}_shop`] = true;

    // A couple extra huts for flavor.
    const hut1 = placeBuilding(cx - 15, cy + 2, 7, 6, "south");
    const hut2 = placeBuilding(cx - 14, cy - 10, 8, 6, "east");

    // Blacksmith + bounty board inside the huts.
    const smithX = cx - 15 + Math.floor(7 / 2);
    const smithY = cy + 2 + Math.floor(6 / 2);
    map[keyOf(smithX, smithY)] = TILE.BLACKSMITH;
    map[`${smithX},${smithY}_blacksmith`] = true;

    const bountyX = cx - 14 + Math.floor(8 / 2);
    const bountyY = cy - 10 + Math.floor(6 / 2);
    map[keyOf(bountyX, bountyY)] = TILE.BOUNTY;
    map[`${bountyX},${bountyY}_bounty`] = true;

    // Paths between key points.
    carvePath(cx, cy, fireX, fireY);
    carvePath(fireX, fireY, shopB.doorX, shopB.doorY);
    carvePath(fireX, fireY, hut1.doorX, hut1.doorY);
    carvePath(cx, cy, hut2.doorX, hut2.doorY);

    // Center entrance (dungeon door).
    // Note: carvePath() writes TILE.FLOOR along the route, including its start tile,
    // so we restore the entrance after carving paths.
    map[keyOf(cx, cy)] = TILE.ENTRANCE;

    // Spawn player near the entrance.
    player.x = cx;
    player.y = cy + 10;

    setMenuOpen(false);
    try {
      ensureBountyOffers?.();
      bountyNotify?.({ type: "floor", floor: 0 });
    } catch {
      // ignore
    }
    draw();
    return;
  }

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
      spawnValuable(r.x, r.y, r.w, r.h, 0.07);
      spawnSword(r.x, r.y, r.w, r.h, 0.06);
      // Sometimes spawn food in enemy rooms too
      if (rollChance(0.15)) spawnFood(r.x, r.y, r.w, r.h);
      spawnMaterial(r.x, r.y, r.w, r.h, 0.10);
      spawnPropsInRoom(r.x, r.y, r.w, r.h, rand(0, 2));
    } else if (r.type === "boss") {
      // Spawn boss enemy (uppercase version of regular enemy)
      spawnBossEnemy(r.x, r.y, r.w, r.h);
      // Boss room has guaranteed potion
      if (rollChance(0.8)) spawnPotion(r.x, r.y, r.w, r.h);
      // Boss room should feel “worth it”
      for (let i = 0; i < rand(1, 2); i++) spawnValuable(r.x, r.y, r.w, r.h, 1.0);
      // Boss drop: guaranteed sword
      spawnSword(r.x, r.y, r.w, r.h, 1.0);
      spawnTrinket(r.x, r.y, r.w, r.h, 0.45);
      spawnPropsInRoom(r.x, r.y, r.w, r.h, rand(1, 2));
    } else if (r.type === "treasure") {
      // Treasure room: lots of loot, no enemies
      for (let i = 0; i < rand(2, 4); i++) {
        spawnPotion(r.x, r.y, r.w, r.h);
      }
      for (let i = 0; i < rand(1, 3); i++) spawnValuable(r.x, r.y, r.w, r.h, 1.0);
      for (let i = 0; i < rand(1, 2); i++) spawnSword(r.x, r.y, r.w, r.h, 1.0);
      // Spawn food in treasure rooms (higher chance)
      if (rollChance(0.7)) spawnFood(r.x, r.y, r.w, r.h);
      spawnMaterial(r.x, r.y, r.w, r.h, 0.85);
      spawnTrinket(r.x, r.y, r.w, r.h, 0.35);
      spawnPropsInRoom(r.x, r.y, r.w, r.h, rand(2, 4));
    } else if (r.type === "trap") {
      // Trap room: many traps, high risk/reward
      for (let i = 0; i < rand(3, 6); i++) {
        const tx = rand(r.x, r.x + r.w - 1);
        const ty = rand(r.y, r.y + r.h - 1);
        const key = `${tx},${ty}`;
        if (map[key] === "." && !lootAtKey(key) && !trapAtKey(key)) {
          const trap = TRAP_TYPES[rand(0, TRAP_TYPES.length - 1)];
          const hidden = rollChance(0.3);
          setTrapAtKey(key, { ...trap, hidden });
          if (hidden) hiddenTrapCount++;
          else map[key] = "~";
        }
      }
      // Guaranteed potion in trap room
      spawnPotion(r.x, r.y, r.w, r.h);
      spawnValuable(r.x, r.y, r.w, r.h, 0.65);
      spawnSword(r.x, r.y, r.w, r.h, 0.25);
      spawnMaterial(r.x, r.y, r.w, r.h, 0.35);
      spawnPropsInRoom(r.x, r.y, r.w, r.h, rand(1, 3));
    } else if (r.type === "shop") {
      // Shop room: merchant NPC
      const shopX = Math.floor(r.x + r.w / 2);
      const shopY = Math.floor(r.y + r.h / 2);
      map[`${shopX},${shopY}`] = "$";
      map[`${shopX},${shopY}_shop`] = true;
      spawnMaterial(r.x, r.y, r.w, r.h, 0.25);
      spawnPropsInRoom(r.x, r.y, r.w, r.h, rand(0, 1));
    } else if (r.type === "shrine") {
      // Shrine room: cleanse one curse, no enemies.
      const sx = Math.floor(r.x + r.w / 2);
      const sy = Math.floor(r.y + r.h / 2);
      map[keyOf(sx, sy)] = TILE.SHRINE;
      map[`${sx},${sy}_shrine`] = true;
      // Some loot to make it feel like a discovery.
      spawnTrinket(r.x, r.y, r.w, r.h, 0.35);
      spawnMaterial(r.x, r.y, r.w, r.h, 0.35);
      spawnPropsInRoom(r.x, r.y, r.w, r.h, rand(0, 1));
    }
  }

  placeTrapdoor();
  placeTraps();
  generateHiddenRoom();

  const s = rooms[0];
  const sx = Math.floor(s.x + s.w / 2);
  const sy = Math.floor(s.y + s.h / 2);

  // Place an exit back to the courtyard in the start room.
  setTileAt(sx, sy, TILE.UPSTAIRS);

  // Spawn adjacent so we don't immediately trigger the exit prompt.
  player.x = sx;
  player.y = Math.min(s.y + s.h - 1, sy + 1);
  if (!isPlayerWalkable(player.x, player.y)) {
    player.y = Math.max(s.y, sy - 1);
  }
  placeCampfire();
  spawnMouse();

  // Soft guarantees to reduce streaky runs (pity-style pacing).
  ensureFloorHasAtLeastOneFood();
  ensureFloorHasAtLeastOneHealthPotion();

  // Always close menu when generating a new floor (death/descend).
  setMenuOpen(false);
  try {
    runStats.floorsReached = Math.max(Number(runStats.floorsReached || 0), Number(floor || 0));
    bountyNotify?.({ type: "floor", floor });
  } catch {
    // ignore
  }
  draw();
}

function pickRandomOpenTileInRoom(r) {
  if (!r) return null;
  for (let attempt = 0; attempt < 80; attempt++) {
    const x = rand(r.x, r.x + r.w - 1);
    const y = rand(r.y, r.y + r.h - 1);
    const k = keyOf(x, y);
    if (tileAtKey(k) !== TILE.FLOOR) continue;
    if (enemies.some((e) => e.x === x && e.y === y)) continue;
    if (lootAtKey(k) || trapAtKey(k)) continue;
    if (x === player.x && y === player.y) continue;
    return { x, y, k };
  }
  return null;
}

function countLootWhere(predicate) {
  let n = 0;
  for (const [k, v] of Object.entries(map)) {
    if (!k.endsWith("_loot")) continue;
    if (predicate(v)) n++;
  }
  return n;
}

function ensureFloorHasAtLeastOneFood() {
  const hasFood = countLootWhere((it) => String(it?.effect || "") === "food") > 0;
  if (hasFood) return;
  // Prefer start room, then any non-boss room.
  const candidates = rooms.filter((r) => r.type === "start" || r.type === "enemy" || r.type === "treasure" || r.type === "shop");
  const r = candidates.length ? candidates[rand(0, candidates.length - 1)] : rooms[0];
  const spot = pickRandomOpenTileInRoom(r);
  if (!spot) return;
  const food = rollChance(0.5) ? MUSHROOM : BERRY;
  setTileAtKey(spot.k, food.symbol);
  setLootAtKey(spot.k, food);
}

function ensureFloorHasAtLeastOneHealthPotion() {
  // Keep it gentle: guarantee a heal potion every floor 1-2, then every ~3 floors.
  const hasHeal = countLootWhere((it) => String(it?.effect || "") === "fullHeal") > 0;
  if (hasHeal) return;
  const shouldGuarantee = floor <= 2 || floor % 3 === 0;
  if (!shouldGuarantee) return;
  const healthPotion = POTIONS.find((p) => p.name === "Health Potion") || POTIONS[0];
  const candidates = rooms.filter((r) => r.type === "start" || r.type === "enemy" || r.type === "treasure" || r.type === "trap" || r.type === "shop");
  const r = candidates.length ? candidates[rand(0, candidates.length - 1)] : rooms[0];
  const spot = pickRandomOpenTileInRoom(r);
  if (!spot) return;
  setTileAtKey(spot.k, TILE.POTION);
  setLootAtKey(spot.k, healthPotion);
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
    if (lootAtKey(k) || trapAtKey(k)) continue;
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
  
  const hpMult = Math.max(0.1, Number(settings?.enemyHpMult || 1));
  const dmgMult = Math.max(0.1, Number(settings?.enemyDmgMult || 1));
  const bossHp = Math.floor((Math.floor(baseEnemy.hp * 2.5) + Math.floor(floor / 5)) * hpMult);
  const boss = {
    ...baseEnemy,
    x: bossX,
    y: bossY,
    symbol: baseEnemy.symbol.toUpperCase(), // Uppercase symbol
    name: `Boss ${baseEnemy.name}`,
    hp: bossHp, // Much stronger
    maxHp: bossHp,
    dmg: Math.max(1, Math.floor((Math.floor(baseEnemy.dmg * 1.5) + Math.floor(floor / 10)) * dmgMult)),
    toughness: (baseEnemy.toughness || 0) + 1,
    statusEffects: {},
    isBoss: true,
    bossCd: 0,
    bossSummoned: false,
  };
  
  enemies.push(boss);
}

function spawnEnemies(x, y, w, h) {
  const count = rand(1, 2);
  const hpMult = Math.max(0.1, Number(settings?.enemyHpMult || 1));
  const dmgMult = Math.max(0.1, Number(settings?.enemyDmgMult || 1));

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
        hp: Math.max(1, Math.floor(Number(t.hp || 1) * hpMult)),
        maxHp: Math.max(1, Math.floor(Number(t.hp || 1) * hpMult)),
        dmg: Math.max(1, Math.floor(Number(t.dmg || 1) * dmgMult)),
        color: t.color,
        sight: t.sight,
        symbol: t.symbol || "r",
        name: t.name || "Rat",
        toughness: t.toughness || 0,
        speed: t.speed || 1,
        flying: !!t.flying,
        statusEffects: {},
      });
      placed = true;
      break;
    }

    if (!placed) {
      enemies.push({
        x,
        y,
        hp: Math.max(1, Math.floor(Number(t.hp || 1) * hpMult)),
        maxHp: Math.max(1, Math.floor(Number(t.hp || 1) * hpMult)),
        dmg: Math.max(1, Math.floor(Number(t.dmg || 1) * dmgMult)),
        color: t.color,
        sight: t.sight,
        symbol: t.symbol || "r",
        name: t.name || "Rat",
        toughness: t.toughness || 0,
        speed: t.speed || 1,
        flying: !!t.flying,
        statusEffects: {},
      });
    }
  }
}

function spawnPotion(x, y, w, h) {
  const b = typeof getPlayerBonuses === "function" ? getPlayerBonuses() : { lootMult: 0 };
  const lootMult = clamp(Math.max(0, Number(settings?.lootMult || 1)) * (1 + Number(b.lootMult || 0)), 0, 3);
  if (!rollChance(0.05 * lootMult)) return;

  const p = POTIONS[rand(0, POTIONS.length - 1)];

  for (let attempt = 0; attempt < 40; attempt++) {
    const px = rand(x, x + w - 1);
    const py = rand(y, y + h - 1);
    if (map[`${px},${py}`] !== ".") continue;
    if (enemies.some((e) => e.x === px && e.y === py)) continue;

    setTileAt(px, py, TILE.POTION);
    setLootAtKey(keyOf(px, py), p);
    return;
  }
}

function spawnValuable(x, y, w, h, chance = 0.08) {
  if (!Array.isArray(VALUABLES) || !VALUABLES.length) return;
  const b = typeof getPlayerBonuses === "function" ? getPlayerBonuses() : { lootMult: 0 };
  const lootMult = clamp(Math.max(0, Number(settings?.lootMult || 1)) * (1 + Number(b.lootMult || 0)), 0, 3);
  if (!rollChance(chance * lootMult)) return;

  const base = VALUABLES[rand(0, VALUABLES.length - 1)];
  const rar = typeof pickRarityForFloor === "function" ? pickRarityForFloor(floor) : null;
  const rarityId = rar?.id || "common";
  const it = {
    ...base,
    rarity: rarityId,
    value: typeof calcValuableValue === "function" ? calcValuableValue(base.baseValue || base.value || 1, rarityId) : base.value,
    name: `${rar?.label || "Common"} ${base.name}`,
  };
  for (let attempt = 0; attempt < 40; attempt++) {
    const vx = rand(x, x + w - 1);
    const vy = rand(y, y + h - 1);
    const k = keyOf(vx, vy);
    if (map[k] !== ".") continue;
    if (enemies.some((e) => e.x === vx && e.y === vy)) continue;
    if (lootAtKey(k) || trapAtKey(k)) continue;
    map[k] = it.symbol;
    setLootAtKey(k, it);
    return;
  }
}

function rollGearLevelForFloor(f) {
  const floorNum = Math.max(1, Number(f || 1));
  // Level is the main scaling axis: deeper floors yield higher level gear.
  // Keep it simple and steady: ~floor +/- small variance.
  const base = floorNum + rand(-1, 2);
  return Math.max(1, base);
}

function spawnSword(x, y, w, h, chance = 0.06) {
  if (typeof makeSword !== "function") return;
  const b = typeof getPlayerBonuses === "function" ? getPlayerBonuses() : { lootMult: 0 };
  const lootMult = clamp(Math.max(0, Number(settings?.lootMult || 1)) * (1 + Number(b.lootMult || 0)), 0, 3);
  if (!rollChance(chance * lootMult)) return;
  const lvl = rollGearLevelForFloor(floor);
  let sword = makeSword(lvl, pickRarityForFloor(floor));
  // Small chance for cursed weapons deeper down: powerful but risky until cleansed at a shrine.
  if (floor >= 4 && rollChance(0.06)) {
    const bonus = 1 + Math.floor(lvl / 4);
    sword = {
      ...sword,
      name: `Cursed ${sword.name}`,
      color: "#ff3366",
      maxDamage: Math.max(1, Math.floor(Number(sword.maxDamage || 1) + bonus)),
      cursed: true,
      curse: { dmgTakenMult: 1.15 },
    };
  }

  for (let attempt = 0; attempt < 40; attempt++) {
    const sx = rand(x, x + w - 1);
    const sy = rand(y, y + h - 1);
    const k = keyOf(sx, sy);
    if (map[k] !== ".") continue;
    if (enemies.some((e) => e.x === sx && e.y === sy)) continue;
    if (lootAtKey(k) || trapAtKey(k)) continue;
    map[k] = sword.symbol;
    setLootAtKey(k, sword);
    return;
  }
}

function spawnFood(x, y, w, h) {
  const b = typeof getPlayerBonuses === "function" ? getPlayerBonuses() : { lootMult: 0 };
  const lootMult = clamp(Math.max(0, Number(settings?.lootMult || 1)) * (1 + Number(b.lootMult || 0)), 0, 3);
  const foods = [MUSHROOM, BERRY];
  const food = foods[rand(0, foods.length - 1)];
  
  for (let attempt = 0; attempt < 40; attempt++) {
    const fx = rand(x, x + w - 1);
    const fy = rand(y, y + h - 1);
    if (map[`${fx},${fy}`] !== ".") continue;
    if (enemies.some((e) => e.x === fx && e.y === fy)) continue;
    if (lootAt(fx, fy)) continue;

    map[`${fx},${fy}`] = food.symbol;
    setLootAtKey(keyOf(fx, fy), food);
    return;
  }
}

function spawnPropsInRoom(x, y, w, h, baseCount = 1) {
  const density = clamp(Math.max(0, Number(settings?.propDensity || 1)), 0, 3);
  const count = Math.max(0, Math.floor(Number(baseCount || 0) * density));
  if (count <= 0) return;
  for (let i = 0; i < count; i++) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const px = rand(x, x + w - 1);
      const py = rand(y, y + h - 1);
      const k = keyOf(px, py);
      if (map[k] !== ".") continue;
      if (enemies.some((e) => e.x === px && e.y === py)) continue;
      if (lootAtKey(k) || trapAtKey(k) || propAtKey(k)) continue;
      const kind = rollChance(0.6) ? "crate" : "barrel";
      const hp = kind === "crate" ? 3 : 2;
      setPropAtKey(k, { kind, hp });
      setTileAtKey(k, kind === "crate" ? TILE.CRATE : TILE.BARREL);
      break;
    }
  }
}

function spawnMaterial(x, y, w, h, chance = 0.12) {
  if (!Array.isArray(MATERIALS) || !MATERIALS.length) return;
  const b = typeof getPlayerBonuses === "function" ? getPlayerBonuses() : { lootMult: 0 };
  const lootMult = clamp(Math.max(0, Number(settings?.lootMult || 1)) * (1 + Number(b.lootMult || 0)), 0, 3);
  if (!rollChance(chance * lootMult)) return;
  const base = MATERIALS[rand(0, MATERIALS.length - 1)];
  const qty = 1 + (rollChance(0.25) ? 1 : 0);
  const it = { ...base, qty };
  for (let attempt = 0; attempt < 40; attempt++) {
    const mx = rand(x, x + w - 1);
    const my = rand(y, y + h - 1);
    const k = keyOf(mx, my);
    if (map[k] !== ".") continue;
    if (enemies.some((e) => e.x === mx && e.y === my)) continue;
    if (lootAtKey(k) || trapAtKey(k)) continue;
    map[k] = it.symbol;
    setLootAtKey(k, it);
    return;
  }
}

function spawnTrinket(x, y, w, h, chance = 0.25) {
  if (!Array.isArray(TRINKETS) || !TRINKETS.length) return;
  const b = typeof getPlayerBonuses === "function" ? getPlayerBonuses() : { lootMult: 0 };
  const lootMult = clamp(Math.max(0, Number(settings?.lootMult || 1)) * (1 + Number(b.lootMult || 0)), 0, 3);
  if (!rollChance(chance * lootMult)) return;
  // Weighted pick so cursed trinkets can be rarer without a separate pool.
  const pool = TRINKETS.map((t) => ({ t, w: Math.max(0.05, Number(t?.weight ?? 1)) }));
  const total = pool.reduce((a, x) => a + x.w, 0);
  const r01 = typeof window !== "undefined" && typeof window.rand01 === "function" ? window.rand01() : Math.random();
  let roll = r01 * total;
  let base = pool[0]?.t || TRINKETS[0];
  for (const p of pool) {
    roll -= p.w;
    if (roll <= 0) {
      base = p.t;
      break;
    }
  }
  const it = { ...base };
  for (let attempt = 0; attempt < 50; attempt++) {
    const tx = rand(x, x + w - 1);
    const ty = rand(y, y + h - 1);
    const k = keyOf(tx, ty);
    if (map[k] !== ".") continue;
    if (enemies.some((e) => e.x === tx && e.y === ty)) continue;
    if (lootAtKey(k) || trapAtKey(k)) continue;
    map[k] = it.symbol;
    setLootAtKey(k, it);
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

  // 6% chance for a shrine room (cleanses one curse).
  if (rollChance(0.06) && eligibleRooms.length > 0) {
    const idx = rand(0, eligibleRooms.length - 1);
    if (eligibleRooms[idx].type === "enemy") {
      eligibleRooms[idx].type = "shrine";
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
      if (lootAtKey(key)) continue;
      if (enemies.some((e) => e.x === x && e.y === y)) continue;

      setTrapAtKey(key, { ...trap, hidden });
      if (hidden) hiddenTrapCount++;
      else map[key] = "~";
      placed = true;
      break;
    }

    if (!placed) continue;
  }
}

function shouldHaveHiddenRoomOnFloor(f) {
  // Hidden rooms are an occasional surprise; no guaranteed floor.
  return rollChance(0.12);
}

function generateHiddenRoom() {
  hiddenArea = null;
  mouse = null;

  if (!shouldHaveHiddenRoomOnFloor(floor)) return;

  const eligibleAnchorRooms = rooms.filter((r) => r.type === "enemy");
  if (!eligibleAnchorRooms.length) return;

  const healthPotion = POTIONS.find((p) => p.name === "Health Potion") || POTIONS[0];
  const hiddenPotion = POTIONS[rand(0, POTIONS.length - 1)] || healthPotion;

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
      if (lootAtKey(k) || trapAtKey(k)) {
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
    setLootAtKey(potionKey, hiddenPotion);

    let trapKey = potionKey;
    for (let t = 0; t < 40 && trapKey === potionKey; t++) {
      trapKey = candidates[rand(0, candidates.length - 1)];
    }
    if (trapKey === potionKey) continue;
    setTrapAtKey(trapKey, makeHiddenTrap());
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
  const trap = trapAtKey(key);
  if (!trap) return false;

  const b = targetKind === "player" && typeof getPlayerBonuses === "function" ? getPlayerBonuses() : { toughness: 0, dmgTakenMult: 1 };
  const toughness = Number(target?.toughness || 0) + (targetKind === "player" ? Number(b.toughness || 0) : 0);
  const raw = Math.max(0, Number(trap.dmg || 0) - toughness);
  const mult = targetKind === "player" ? Math.max(0, Number(settings?.hazardMult || 1)) : 1;
  const takenMult = targetKind === "player" ? Math.max(0.1, Number(b.dmgTakenMult || 1)) : 1;
  const dmg = Math.max(0, Math.floor(raw * mult * takenMult));

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
  if (targetKind === "player" && dmg > 0) {
    try {
      stopAutoMove?.();
    } catch {
      // ignore
    }
    try {
      setLastDamageSource({
        kind: "trap",
        name: trap.hidden ? `Hidden ${trap.type} trap` : `${trap.type} trap`,
        amount: dmg,
        floor,
        extra: { trapType: trap.type, hidden: !!trap.hidden },
      });
      shakeScreen?.(0.75, 140);
      flashGame?.("brightness(1.1) saturate(1.35) hue-rotate(-10deg)");
    } catch {
      // ignore
    }
  }
  if (trap.status?.kind === "burning") {
    addBurning(target, trap.status.turns ?? 3, trap.status.dmgPerTurn ?? 1);
    if (targetKind === "player") {
      addLog("You are burning!", "danger");
    }
  }
  if (trap.type === "poison") {
    addPoisoned(target, 4, 1);
    if (targetKind === "player") {
      addLog("Poisoned!", "danger");
    }
  }
  if (targetKind === "player") floorStats.trapsTriggered++;
  if (targetKind === "player") {
    try {
      runStats.trapsTriggered = Math.max(0, Number(runStats.trapsTriggered || 0) + 1);
    } catch {
      // ignore
    }
  }

  if (trap.hidden) hiddenTrapCount = Math.max(0, hiddenTrapCount - 1);
  clearTrapAtKey(key);
  setTileAtKey(key, TILE.FLOOR);
  return true;
}
