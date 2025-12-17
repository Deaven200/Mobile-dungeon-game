/* ===================== INVENTORY ===================== */

function useInventoryItem(i) {
  const p = player.inventory[i];
  if (!p) return;

  // Valuables are meant to be sold at a shop.
  if (p.effect === "valuable") {
    addLog("You can't use valuables. Sell them at a shop.", "info");
    playSound?.("menu");
    return;
  }

  if (p.effect === "fullHeal") {
    player.maxHp += p.value;
    player.hp = player.maxHp;
    addLog("You drink a Health Potion", "loot");
    playSound?.("loot");
  }

  if (p.effect === "damageBoost") {
    player.dmg += p.value;
    addLog("You feel stronger", "loot");
    playSound?.("loot");
  }

  if (p.effect === "toughnessBoost") {
    player.toughness += p.value;
    addLog("You feel tougher", "loot");
    playSound?.("loot");
  }

  if (p.effect === "speed") {
    // If already has speed, refresh duration instead of stacking
    if (player.statusEffects?.speed) {
      player.statusEffects.speed.turns = Math.max(player.statusEffects.speed.turns, p.turns || 10);
      addLog(`Speed refreshed! (${player.statusEffects.speed.turns} turns)`, "loot");
    } else {
      addStatus(player, "speed", p.turns || 10, p.value);
      addLog(`You feel faster! (+${p.value} speed for ${p.turns || 10} turns)`, "loot");
      playSound?.("loot");
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
      playSound?.("loot");
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
              
              lastTarget = {
                name: e?.name || "Enemy",
                hp: e.hp,
                maxHp: typeof e.maxHp === "number" ? e.maxHp : undefined,
                x: e.x,
                y: e.y,
                time: Date.now(),
              };
              
              // Show damage number
              showDamageNumber(e.x, e.y, dmg, "player");
              
              if (e.hp <= 0) {
                enemiesToKill.push(e);
                addLog(`${e.name} dies from explosion!`, "death");
                lastTarget = null;
                
                // Award combo and score with adjusted scaling
                player.kills++;
                player.combo++;
                const comboMultiplier = 1 + Math.floor(player.combo / 5);
                player.score += Math.floor(enemyValue) * 8 * comboMultiplier;
                floorStats.enemiesKilled = (floorStats.enemiesKilled || 0) + 1;
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
    if (hit) playSound?.("crit");
  }

  if (p.effect === "food") {
    const hungerGain = Math.max(0, Number(p.hunger || 0));
    const heal = Math.max(0, Number(p.heal || 0));
    player.hunger = Math.min(player.maxHunger, player.hunger + hungerGain);
    player.hp = Math.min(player.maxHp, player.hp + heal);
    addLog(`You eat ${p.name}`, "loot");
    playSound?.("loot");
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
