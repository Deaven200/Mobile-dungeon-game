/* ===================== PLAYER ===================== */

function handlePlayerDeathIfNeeded() {
  if (player.hp > 0) return false;

  addLog("You died", "death");
  playSound?.("death");

  // Save high score before returning to menu
  const highScore = localStorage.getItem("dungeonHighScore") || 0;
  if (player.score > Number(highScore)) {
    localStorage.setItem("dungeonHighScore", player.score);
    addLog(`NEW HIGH SCORE: ${player.score}!`, "loot");
  }

  // Permadeath: run ends, player wipes, back to main menu.
  // (Saves are disabled in permadeath mode; best-effort clear any existing saves.)
  if (settings?.permadeath) {
    try {
      localStorage.removeItem("dungeonGameSaves");
    } catch {
      // ignore
    }
  }

  // Death card (what killed you) + immediate run end.
  try {
    runStats.endedAt = Date.now();
  } catch {
    // ignore
  }

  const src = lastDamageSource;
  const killerLine = src
    ? `<div style="margin: 6px 0; text-align:center;">
         <div style="opacity:0.9;">Killed by</div>
         <div style="font-weight:700; color: var(--accent);">${escapeHtml(src.name)}</div>
         <div style="opacity:0.8;">(${escapeHtml(src.kind)} • ${Number(src.amount || 0)})</div>
       </div>`
    : `<div style="margin: 6px 0; text-align:center; opacity:0.9;">Cause of death unknown</div>`;

  const durSec =
    runStats?.startedAt ? Math.max(0, Math.floor((Date.now() - Number(runStats.startedAt || 0)) / 1000)) : 0;
  const timeLine = durSec ? `${Math.floor(durSec / 60)}m ${durSec % 60}s` : "—";

  showPromptOverlay(
    "You died",
    `
      ${killerLine}
      <div style="text-align:center; opacity:0.9; margin-top: 10px;">
        Floor: ${floor}<br>
        Score: ${player.score || 0}<br>
        Kills: ${player.kills || 0}<br>
        Time: ${escapeHtml(timeLine)}
      </div>
    `,
    [
      {
        id: "deathRestartBtn",
        label: "New Run",
        onClick: () => {
          const transitionEl = document.getElementById("floorTransition");
          if (transitionEl) transitionEl.style.display = "none";
          gamePaused = false;
          // Go back through the normal main-menu flow for a clean reset.
          returnToMainMenu();
          setTimeout(() => startGame(), 30);
        },
      },
      {
        id: "deathMenuBtn",
        label: "Main Menu",
        subtle: true,
        onClick: () => {
          const transitionEl = document.getElementById("floorTransition");
          if (transitionEl) transitionEl.style.display = "none";
          returnToMainMenu();
        },
      },
    ],
  );
  return true;
}

function endPlayerTurn() {
  moveMouse();
  moveEnemies();
  tickStatusEffects(player, "player");

  // Hunger-based regeneration when out of combat
  tickHungerRegeneration();

  if (handlePlayerDeathIfNeeded()) return;
  draw();
}

function waitTurn() {
  if (gamePaused) return;

  // Waiting should cancel any auto-walk.
  stopAutoMove();

  // Campfire rest (gentle sustain, reduces hunger pressure).
  const hereKey = keyOf(player.x, player.y);
  const hereTile = tileAtKey(hereKey);
  const enemyAdjacent = enemies.some((e) => Math.max(Math.abs(e.x - player.x), Math.abs(e.y - player.y)) <= 1);
  if (hereTile === TILE.CAMPFIRE && !enemyAdjacent) {
    // Small regen and a tiny hunger restoration.
    const oldHp = player.hp;
    player.hp = Math.min(player.maxHp, player.hp + 0.25);
    player.hunger = Math.min(player.maxHunger, player.hunger + 0.2);
    // Reduce burning a bit faster at the campfire.
    const burning = player.statusEffects?.burning;
    if (burning?.turns) burning.turns = Math.max(0, burning.turns - 1);
    if (player.hp > oldHp) addLog("You rest by the campfire (+hp)", "loot");
    // Resting costs less hunger than normal movement.
    tickHunger(HUNGER_COST_MOVE * 0.25);
  } else {
  // Hunger cost for spending a turn.
  tickHunger(HUNGER_COST_MOVE);
  }

  // If we're standing on a trapdoor, allow descending prompt (same as moving onto it).
  const currentTile = tileAt(player.x, player.y);
  if (currentTile === TILE.TRAPDOOR && !enemies.some((e) => e.x === player.x && e.y === player.y)) {
    showFloorTransition();
    return;
  }

  // Courtyard entrance -> enter dungeon.
  if (floor === 0 && currentTile === TILE.ENTRANCE) {
    showEnterDungeonPrompt();
    return;
  }

  // Dungeon upstairs -> exit to courtyard.
  if (floor > 0 && currentTile === TILE.UPSTAIRS) {
    if (autoMove?.mode === "walkout") {
      floor = 0;
      generateFloor();
      return;
    }
    showExitToCourtyardPrompt();
    return;
  }

  // Shop interaction if we're standing on a shop tile.
  const shopKey = keyOf(player.x, player.y);
  if (map[`${shopKey}_shop`]) {
    openShopMenu();
    return;
  }
  endPlayerTurn();
}

function move(dx, dy) {
  if (gamePaused) return;

  const nx = player.x + dx;
  const ny = player.y + dy;
  const nKey = keyOf(nx, ny);
  const tile = tileAtKey(nKey);
  const enemy = enemies.find((e) => e.x === nx && e.y === ny);

  // Optional rule: disallow diagonal melee attacks.
  if (enemy && dx && dy && settings?.diagonalMelee === false) return;

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
  } else if (tile === TILE.WALL) {
    return;
  }

  if (enemy) {
    // Critical hits & misses
    const unarmedMax = 2;
    const weapon = player?.hands?.main && String(player.hands.main.effect || "") === "weapon" ? player.hands.main : null;
    const weaponMax = weapon ? Math.max(1, Math.floor(Number(weapon.maxDamage || 1))) : null;
    const bonus = Math.max(0, Math.floor(Number(player.dmg || 0))); // strength bonus
    const maxDmg = weaponMax != null ? weaponMax + bonus : unarmedMax + bonus;
    let dealt = rollBellInt(0, maxDmg);
    const crit = rollChance(0.1); // 10% crit chance
    const miss = rollChance(0.05); // 5% miss chance
    
    if (miss) {
      dealt = 0;
      addLog(`You miss ${(enemy?.name || "enemy").toLowerCase()}!`, "block");
      playSound?.("miss");
    } else if (crit && dealt > 0) {
      dealt = Math.floor(dealt * 2);
      addLog(`CRITICAL HIT! ${dealt} damage to ${(enemy?.name || "enemy").toLowerCase()}!`, "player");
      playSound?.("crit");
      try {
        shakeScreen?.(0.55, 110);
        flashGame?.("brightness(1.18) contrast(1.15) saturate(1.4)");
      } catch {
        // ignore
      }
    } else {
      addLog(`You hit ${(enemy?.name || "enemy").toLowerCase()} for ${dealt}`, dealt ? "player" : "block");
      if (dealt > 0) playSound?.("hit");
      if (dealt > 0) {
        try {
          shakeScreen?.(0.25, 80);
          flashGame?.("brightness(1.08) saturate(1.12)");
        } catch {
          // ignore
        }
      }
    }
    
    enemy.hp -= dealt;
    
    // Show damage number and track stats
    if (dealt > 0) {
      showDamageNumber(enemy.x, enemy.y, dealt, crit ? "crit" : "player");
      floorStats.damageDealt += dealt;
      lastTarget = {
        name: enemy?.name || "Enemy",
        hp: enemy.hp,
        maxHp: typeof enemy.maxHp === "number" ? enemy.maxHp : undefined,
        x: enemy.x,
        y: enemy.y,
        time: Date.now(),
      };
    }

    if (enemy.hp <= 0) {
      const enemyValue = Math.max(1, enemy.hp + dealt); // original HP before death
      addLog(`${enemy?.name || "Enemy"} dies`, "death");
      playSound?.("loot");
      enemies = enemies.filter((e) => e !== enemy);
      floorStats.enemiesKilled = (floorStats.enemiesKilled || 0) + 1;
      lastTarget = null;
      
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
      const deathKey = keyOf(nx, ny);
      const deathBaseTile = tileAtKey(deathKey);
      // Loot is stored separately via *_loot keys. Only "paint" the map tile on normal terrain,
      // otherwise we risk overwriting special tiles like trapdoors/exits.
      const canPaintLootTile = deathBaseTile === TILE.FLOOR || deathBaseTile === TILE.GRASS;
      if ((enemy?.name || "").toLowerCase().includes("rat") && rollChance(0.2) && !lootAtKey(deathKey)) {
        if (canPaintLootTile) setTileAtKey(deathKey, RAT_MEAT.symbol);
        setLootAtKey(deathKey, RAT_MEAT);
        addLog("Rat dropped meat", "loot");
      } else if (!lootAtKey(deathKey) && (rollChance(0.08) || (player.combo >= 3 && rollChance(0.14)))) {
        // Valuables: meant to be sold after you extract.
        if (Array.isArray(VALUABLES) && VALUABLES.length) {
          const v = VALUABLES[rand(0, VALUABLES.length - 1)];
          if (canPaintLootTile) setTileAtKey(deathKey, v.symbol);
          setLootAtKey(deathKey, v);
          addLog(`${enemy?.name || "Enemy"} dropped ${v.name}`, "loot");
        }
      } else if (!lootAtKey(deathKey) && (rollChance(0.05) || (player.combo >= 3 && rollChance(0.15)))) {
        // Better potion drop rate on combo
        const p = POTIONS[rand(0, POTIONS.length - 1)];
        if (canPaintLootTile) setTileAtKey(deathKey, TILE.POTION);
        setLootAtKey(deathKey, p);
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
  const pKey = keyOf(player.x, player.y);
  const loot = lootAtKey(pKey);
  if (loot) {
    const cap = Math.max(0, Number(player.maxInventory ?? 10));
    if (cap && player.inventory.length >= cap) {
      addLog("Inventory full. Sell or use items.", "block");
      playSound?.("miss");
      vibrate(8);
    } else {
      player.inventory.push(loot);
      const lootName = loot?.name || "item";
      addLog(`Picked up ${lootName}`, "loot");
      playSound?.("loot");
      vibrate(10);
      floorStats.itemsFound++;
      clearLootAtKey(pKey);
      // Only clear the map tile if we actually "painted" it as loot.
      // If loot was dropped on a special tile (trapdoor/upstairs/etc.), we leave the base tile intact.
      const painted = tileAtKey(pKey) === loot.symbol || tileAtKey(pKey) === TILE.POTION;
      if (painted) setTileAtKey(pKey, TILE.FLOOR);
    }
  }

  // Check if we're standing on a trapdoor (either just moved onto it, or killed enemy on it)
  const currentTile = tileAt(player.x, player.y);
  if (currentTile === TILE.TRAPDOOR && !enemies.some((e) => e.x === player.x && e.y === player.y)) {
    showFloorTransition();
    return;
  }

  // Enter/Exit prompts
  if (floor === 0 && currentTile === TILE.ENTRANCE) {
    showEnterDungeonPrompt();
    return;
  }
  if (floor > 0 && currentTile === TILE.UPSTAIRS) {
    if (autoMove?.mode === "walkout") {
      floor = 0;
      generateFloor();
      return;
    }
    showExitToCourtyardPrompt();
    return;
  }
  
  // Shop interaction
  const shopKey = keyOf(player.x, player.y);
  if (map[`${shopKey}_shop`]) {
    openShopMenu();
    return;
  }
  endPlayerTurn();
}
