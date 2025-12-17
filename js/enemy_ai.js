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

function buildMousePathBfs(startX, startY, goalX, goalY) {
  const startKey = keyOf(startX, startY);
  const goalKey = keyOf(goalX, goalY);
  if (startKey === goalKey) return [];

  const prev = new Map();
  prev.set(startKey, null);
  const q = [{ x: startX, y: startY }];
  let qi = 0;

  // Mouse movement is cardinal.
  const dirs = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];

  while (qi < q.length) {
    const cur = q[qi++];
    for (const d of dirs) {
      const nx = cur.x + d.dx;
      const ny = cur.y + d.dy;
      const nk = keyOf(nx, ny);
      if (prev.has(nk)) continue;
      if (!canMouseMoveTo(nx, ny)) continue;

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
    steps.push({ x: cx, y: cy, dx: cx - px, dy: cy - py });
    curKey = parentKey;
  }
  steps.reverse();
  return steps;
}

function buildEnemyPathBfs(startX, startY, goalX, goalY, limit = 22) {
  const startKey = keyOf(startX, startY);
  const goalKey = keyOf(goalX, goalY);
  if (startKey === goalKey) return [];

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
      if (Math.abs(nx - startX) > limit || Math.abs(ny - startY) > limit) continue;
      const nk = keyOf(nx, ny);
      if (prev.has(nk)) continue;
      if (!isStepAllowed(cur.x, cur.y, nx, ny, canEnemyMove)) continue;
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
    steps.push({ x: cx, y: cy, dx: cx - px, dy: cy - py });
    curKey = parentKey;
  }
  steps.reverse();
  return steps;
}

function moveMouse() {
  if (!mouse || !hiddenArea) return;

  // If the hidden area has already been revealed, the mouse just wanders.
  const dist = chebDist(player.x, player.y, mouse.x, mouse.y);
  const panic = !hiddenArea.revealed && dist <= 6;
  const hardPanic = !hiddenArea.revealed && dist <= 4;

  let next = null;

  if (hardPanic) {
    // When the player is close, pathfind to the nearest false wall so we don't get stuck.
    let best = null;
    for (const k of hiddenArea.falseWalls || []) {
      const [xs, ys] = k.split(",");
      const tx = Number(xs);
      const ty = Number(ys);
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) continue;
      const path = buildMousePathBfs(mouse.x, mouse.y, tx, ty);
      if (!path || !path.length) continue;
      if (!best || path.length < best.path.length) best = { x: tx, y: ty, path };
    }
    if (best?.path?.length) {
      next = { x: best.path[0].x, y: best.path[0].y };
    }
  } else if (panic) {
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
  for (let idx = enemies.length - 1; idx >= 0; idx--) {
    const e = enemies[idx];
    const eName = e?.name || "Enemy";
    if (e?.isBoss) e.bossCd = Math.max(0, Number(e.bossCd || 0) - 1);
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const dist = Math.max(Math.abs(dx), Math.abs(dy));

    // Check slow status
    const slow = e.statusEffects?.slow;
    if (slow && slow.turns > 0 && rollChance(0.5)) {
      tickStatusEffects(e, "enemy");
      continue; // Skip turn when slowed
    }

    // Invisibility: enemies can't track you outside melee range.
    if (player.statusEffects?.invisibility?.turns && dist > 1) {
      tickStatusEffects(e, "enemy");
      continue;
    }

    // Boss specials (simple but distinct).
    if (e?.isBoss && dist > 1) {
      // Summon once when below half HP.
      if (!e.bossSummoned && typeof e.maxHp === "number" && e.hp <= e.maxHp * 0.5) {
        e.bossSummoned = true;
        const spawnSpots = shuffleInPlace([
          { x: e.x + 1, y: e.y },
          { x: e.x - 1, y: e.y },
          { x: e.x, y: e.y + 1 },
          { x: e.x, y: e.y - 1 },
          { x: e.x + 1, y: e.y + 1 },
          { x: e.x + 1, y: e.y - 1 },
          { x: e.x - 1, y: e.y + 1 },
          { x: e.x - 1, y: e.y - 1 },
        ]);
        const spot = spawnSpots.find((p) => canEnemyMove(p.x, p.y));
        if (spot) {
          enemies.push({
            ...RAT,
            x: spot.x,
            y: spot.y,
            hp: RAT.hp,
            maxHp: RAT.hp,
            dmg: RAT.dmg,
            toughness: 0,
            speed: 1,
            statusEffects: {},
          });
          addLog(`${eName} summons a rat!`, "danger");
          playSound?.("crit");
        }
      }

      // Ranged slam: occasionally applies slow.
      if (e.bossCd <= 0 && dist <= 3 && rollChance(0.22)) {
        const rolled = Math.max(0, Math.floor((e.dmg || 1) * 0.6));
        const dmg = Math.max(0, rolled - player.toughness);
        if (dmg > 0) {
          player.hp -= dmg;
          try {
            setLastDamageSource({ kind: "enemy", name: eName, amount: dmg, floor, extra: { attack: "slam" } });
            shakeScreen?.(0.9, 140);
            flashGame?.("brightness(1.15) contrast(1.15) saturate(1.25)");
          } catch {
            // ignore
          }
          addLog(`${eName} hurls a crushing blow for ${dmg}`, "enemy");
          showDamageNumber(player.x, player.y, dmg, "enemy");
          playSound?.("hurt");
          vibrate(25);
          floorStats.damageTaken += dmg;
        } else {
          addLog(`${eName}'s crushing blow glances off you`, "block");
        }
        addStatus(player, "slow", 2, 0);
        addLog("You are slowed!", "danger");
        e.bossCd = 3;
        tickStatusEffects(e, "enemy");
        continue;
      }
    }

    const canMeleeDiagonally = settings?.diagonalMelee !== false;
    const isDiagonalAdj = Math.abs(dx) === 1 && Math.abs(dy) === 1;
    if (dist === 1 && (canMeleeDiagonally || !isDiagonalAdj)) {
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

      let rolled = rollBellInt(0, e.dmg);
      const crit = rollChance(0.05);
      if (crit && rolled > 0) {
        rolled = Math.floor(rolled * 1.5);
        addLog(`${eName} CRITICAL HIT! ${rolled} damage!`, "enemy");
      }
      
      const dmg = Math.max(0, rolled - player.toughness);
      player.hp -= dmg;
      if (dmg > 0) {
        try {
          setLastDamageSource({ kind: "enemy", name: eName, amount: dmg, floor, extra: { crit: !!crit } });
          shakeScreen?.(crit ? 0.9 : 0.6, crit ? 150 : 110);
          flashGame?.(crit ? "brightness(1.2) contrast(1.2) saturate(1.35)" : "brightness(1.12) saturate(1.15)");
        } catch {
          // ignore
        }
        addLog(`${eName} hits you for ${dmg}`, "enemy");
        showDamageNumber(player.x, player.y, dmg, "enemy");
        playSound?.("hurt");
        vibrate(20);
        floorStats.damageTaken += dmg;
        player.combo = 0;
      } else {
        addLog(`${eName} hits you for ${dmg}`, "block");
      }
      tickStatusEffects(e, "enemy");
      if (e.hp <= 0) {
        addLog(`${eName} dies`, "death");
        floorStats.enemiesKilled = (floorStats.enemiesKilled || 0) + 1;
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
          if (!isStepAllowed(e.x, e.y, c.x, c.y, canEnemyMove)) continue;
          const d2 = chebDist(c.x, c.y, player.x, player.y);
          if (d2 < bestD) {
            bestD = d2;
            best = c;
          }
        }

        if (best && bestD < currentDist) {
          e.x = best.x;
          e.y = best.y;
        } else {
          // If greedy movement fails (blocked corridors), fall back to bounded BFS.
          const path = buildEnemyPathBfs(e.x, e.y, player.x, player.y, Math.max(10, (e.sight || 5) + 6));
          if (path && path.length) {
            const step = path[0];
            if (isStepAllowed(e.x, e.y, step.x, step.y, canEnemyMove)) {
              e.x = step.x;
              e.y = step.y;
            }
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
          if (tile !== "#" && isStepAllowed(e.x, e.y, nx, ny, canEnemyMove)) {
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
      floorStats.enemiesKilled = (floorStats.enemiesKilled || 0) + 1;
      enemies.splice(idx, 1);
    }
  }
}
