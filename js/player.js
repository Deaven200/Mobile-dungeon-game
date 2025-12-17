/* ===================== PLAYER ===================== */

function waitTurn() {
  if (gamePaused) return;

  // Waiting should cancel any auto-walk.
  stopAutoMove();

  // Hunger cost for spending a turn.
  tickHunger(HUNGER_COST_MOVE);

  // If we're standing on a trapdoor, allow descending prompt (same as moving onto it).
  const currentTile = map[keyOf(player.x, player.y)] || "#";
  if (currentTile === "T" && !enemies.some((e) => e.x === player.x && e.y === player.y)) {
    showFloorTransition();
    return;
  }

  // Shop interaction if we're standing on a shop tile.
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
