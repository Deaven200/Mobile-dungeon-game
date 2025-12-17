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

    // Invisibility: enemies can't track you outside melee range.
    if (player.statusEffects?.invisibility?.turns && dist > 1) {
      tickStatusEffects(e, "enemy");
      continue;
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
