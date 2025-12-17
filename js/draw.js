/* ===================== DRAW ===================== */

let measureEl = null;
let cachedCellMetrics = null;
let lastMapHtml = "";

function getMonoCellMetricsPx(testFontPx = 100) {
  // Cache metrics on first call
  if (cachedCellMetrics) return cachedCellMetrics;
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

  cachedCellMetrics = { unitW, unitH };
  return cachedCellMetrics;
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
  const minPx = settings?.largeText ? 14 : 12;
  const maxPx = settings?.largeText ? 56 : 48;
  const clamped = Math.max(minPx, Math.min(maxPx, fontPx));

  gameEl.style.fontSize = `${clamped}px`;
}

function renderMenuHtml() {
  const rarityOutlineCss = (it) => {
    const rid = String(it?.rarity || "");
    const rar = (Array.isArray(RARITIES) ? RARITIES.find((r) => r.id === rid) : null) || null;
    const c = rar?.outline;
    if (!c) return "";
    // Cheap outline with multiple shadows.
    return `text-shadow: -1px 0 ${c}, 1px 0 ${c}, 0 -1px ${c}, 0 1px ${c}, 0 0 6px ${c};`;
  };

  const tabBtn = (tab, label) =>
    `<button type="button" data-tab="${tab}" class="${activeTab === tab ? "is-active" : ""}">${label}</button>`;
  const actionBtn = (action, label) => `<button type="button" data-action="${action}">${label}</button>`;

  let content;

  if (activeTab === "inventory") {
    const cap = Math.max(0, Number(player.maxInventory ?? 0));
    const used = Array.isArray(player.inventory) ? player.inventory.length : 0;
    const items = (Array.isArray(player.inventory) ? player.inventory : []).map((it, idx) => ({ it, idx }));
    const valuables = items.filter(({ it }) => String(it?.effect || "") === "valuable");
    const weapons = items.filter(({ it }) => String(it?.effect || "") === "weapon");
    const consumables = items.filter(({ it }) => {
      const eff = String(it?.effect || "");
      return eff !== "valuable" && eff !== "weapon";
    });

    const btn = (it, idx, subtitle = "") =>
      `<button type="button" data-use-item="${idx}" class="menu-button" style="color:${it?.color || "cyan"};${rarityOutlineCss(it)}" title="${escapeHtml(it?.name || "")}">
        ${escapeHtml(it?.name || "Item")}${subtitle ? `<br><small style="opacity:0.75;">${escapeHtml(subtitle)}</small>` : ""}
      </button>`;

    if (!used) {
      content = `<div class="menu-empty">Inventory empty (${used}/${cap || "∞"})</div>`;
    } else {
      const mainHand = player?.hands?.main;
      const offHand = player?.hands?.off;
      const eqLine = (label, it, handKey) => {
        if (!it) return `<div>${escapeHtml(label)}: <span style="opacity:0.7;">(empty)</span></div>`;
        const meta = it?.effect === "weapon" ? ` 0-${Number(it?.maxDamage || 0)}` : "";
        return `<div>${escapeHtml(label)}: <span style="color:${it?.color || "cyan"};${rarityOutlineCss(it)}">${escapeHtml(it?.name || "Item")}${escapeHtml(
          meta,
        )}</span> <button type="button" data-unequip-hand="${escapeHtml(handKey)}" style="margin-left:8px;">Unequip</button></div>`;
      };

      const top = `<div class="menu-status" style="margin-bottom: 10px;">Inventory: ${used}/${cap || "∞"}</div>`;

      const equipTop = `<div class="menu-status" style="margin-bottom: 10px; text-align:left;">
        <div style="font-weight:700; color: var(--accent); margin-bottom: 6px;">Hands</div>
        ${eqLine("Main hand", mainHand, "main")}
        ${eqLine("Off hand", offHand, "off")}
      </div>`;

      const consHtml = consumables.length
        ? `<div class="menu-status" style="margin: 6px 0 4px; opacity:0.9;">Consumables</div><div class="menu-inventory">${consumables
            .map(({ it, idx }) => btn(it, idx))
            .join("")}</div>`
        : `<div class="menu-empty">No consumables</div>`;

      const wepHtml = weapons.length
        ? `<div class="menu-status" style="margin: 10px 0 4px; opacity:0.9;">Weapons (tap to equip)</div><div class="menu-inventory">${weapons
            .map(({ it, idx }) => {
              const subtitle = `Lv ${Number(it?.level || 1)} • ${String(it?.rarity || "trash")} • 0-${Number(it?.maxDamage || 0)}`;
              return `<button type="button" data-equip-main="${idx}" class="menu-button" style="color:${it?.color || "cyan"};${rarityOutlineCss(it)}" title="${escapeHtml(
                it?.name || "",
              )}">
                ${escapeHtml(it?.name || "Weapon")}<br><small style="opacity:0.75;">${escapeHtml(subtitle)}</small><br><small style="opacity:0.7;">Equip main</small>
              </button>`;
            })
            .join("")}</div>`
        : `<div class="menu-empty">No weapons</div>`;

      const valHtml = valuables.length
        ? `<div class="menu-status" style="margin: 10px 0 4px; opacity:0.9;">Valuables (sell at a shop)</div><div class="menu-inventory">${valuables
            .map(({ it, idx }) => btn(it, idx, `Worth ${Number(it?.value || 0)}`))
            .join("")}</div>`
        : `<div class="menu-empty">No valuables</div>`;

      content = `${top}${equipTop}${wepHtml}${consHtml}${valHtml}`;
    }
  } else if (activeTab === "status") {
    const burning = getBurning(player);
    const statusLines = [];
    if (burning?.turns) {
      statusLines.push(`You are burning -${burning.dmgPerTurn} hp per turn (${burning.turns} turns remaining)`);
    }
    // Show all status effects
    const statusEffects = player.statusEffects || {};
    if (statusEffects.poisoned?.turns) statusLines.push(`Poisoned -${statusEffects.poisoned.dmgPerTurn} hp per turn (${statusEffects.poisoned.turns} turns)`);
    if (statusEffects.speed?.turns) statusLines.push(`Speed boost (${statusEffects.speed.turns} turns)`);
    if (statusEffects.invisibility?.turns) statusLines.push(`Invisible (${statusEffects.invisibility.turns} turns)`);
    if (statusEffects.slow?.turns) statusLines.push(`Slowed (${statusEffects.slow.turns} turns)`);
    if (statusEffects.regeneration?.turns) statusLines.push(`Regenerating (${statusEffects.regeneration.turns} turns)`);
    
    const talentLabel =
      (Array.isArray(TALENTS) ? TALENTS.find((t) => t?.id === player?.talent)?.label : null) || player?.talent || "None";
    const nameLabel = player?.name ? escapeHtml(player.name) : "Unknown";
    content = `<div class="menu-status">
      Name: ${nameLabel}<br>
      Talent: ${escapeHtml(String(talentLabel))}<br><br>
      HP ${player.hp}/${player.maxHp}<br>
      DMG: ${(() => {
        const unarmedMax = 2 + Math.max(0, Math.floor(Number(player.dmg || 0)));
        const w = player?.hands?.main && String(player.hands.main.effect || "") === "weapon" ? player.hands.main : null;
        const wMax = w ? Math.max(1, Math.floor(Number(w.maxDamage || 1))) + Math.max(0, Math.floor(Number(player.dmg || 0))) : null;
        return wMax != null ? `0-${wMax} (armed)` : `0-${unarmedMax} (unarmed)`;
      })()}<br>
      Tough ${player.toughness}<br>
      Inventory ${player.inventory?.length || 0}/${player.maxInventory || "∞"}<br>
      Gold: ${player.gold || 0}<br>
      Permadeath: ${settings?.permadeath ? "ON" : "OFF"}<br>
      Floor ${floor}<br>
      Score: ${player.score || 0}<br>
      Kills: ${player.kills || 0}<br>
      Combo: ${player.combo || 0}x
      ${statusLines.length ? "<br><br>" + statusLines.map(escapeHtml).join("<br>") : ""}
    </div>`;
  } else if (activeTab === "cook") {
    if (!cookingAtCampfire) {
      content = `<div class="menu-empty">No campfire.</div>`;
    } else {
      const cookables = player.inventory
        .map((it, idx) => ({ it, idx }))
        .filter(({ it }) => it?.effect === "food" && !it?.cooked);

      if (!cookables.length) {
        content = `<div class="menu-empty">No raw food to cook</div>`;
      } else {
        const buttons = cookables
          .map(
            ({ it, idx }) =>
              `<button type="button" data-cook-food="${idx}" class="menu-button" style="color:${it.color || "#ffd6a6"};">Cook ${escapeHtml(
                it.name,
              )}</button>`,
          )
          .join("");
        content = `<div class="menu-inventory">${buttons}</div>`;
      }
    }
  } else if (activeTab === "shop") {
    const gold = Number(player.gold || 0);
    const gear = player.gear || { weapon: 0, armor: 0, pack: 0 };

    const sellables = (player.inventory || [])
      .map((it, idx) => ({ it, idx }))
      .map(({ it, idx }) => ({
        it,
        idx,
        sell: typeof getItemSellValue === "function" ? Math.max(0, Math.floor(Number(getItemSellValue(it) || 0))) : 0,
      }));

    const sellAllBtn =
      sellables.some((v) => v.sell > 0)
        ? `<button type="button" data-sell-all="1" class="menu-button" style="color:#ffd700;">Sell All<br><small>+${sellables.reduce(
            (a, v) => a + v.sell,
            0,
          )} gold</small></button>`
        : "";

    const sellButtons = sellables
      .filter((v) => v.sell > 0)
      .map(
        ({ it, idx, sell }) =>
          `<button type="button" data-sell-item="${idx}" class="menu-button" style="color:${it?.color || "#ffd700"};${rarityOutlineCss(it)}${sell <= 0 ? "opacity:0.5;" : ""}">
            ${escapeHtml(it?.name || "Item")}<br><small>+${sell} gold</small>
          </button>`,
      )
      .join("");

    const upgradeBtn = (kind, label, desc) => {
      const price = typeof getUpgradeCost === "function" ? getUpgradeCost(kind) : 999999;
      const dim = gold < price ? "opacity:0.5;" : "";
      return `<button type="button" data-buy-upgrade="${escapeHtml(kind)}" class="menu-button" style="color:var(--accent);${dim}" title="${escapeHtml(
        desc,
      )}">
        ${escapeHtml(label)}<br><small>${price} gold</small>
      </button>`;
    };

    const upgradesHtml = [
      upgradeBtn("weapon", `Weapon Lv ${Number(gear.weapon || 0)}`, "+1 damage"),
      upgradeBtn("armor", `Armor Lv ${Number(gear.armor || 0)}`, "+1 toughness"),
      upgradeBtn("pack", `Pack Lv ${Number(gear.pack || 0)}`, "+2 inventory slots"),
    ].join("");

    const potionItems = [
      ...POTIONS.slice(0, 3).map((p, i) => ({ ...p, price: 25 + i * 15, shopIndex: i })),
      ...POTIONS.slice(3).map((p, i) => ({ ...p, price: 70 + i * 20, shopIndex: i + 3 })),
    ];

    const potionButtons = potionItems
      .map((item) => {
        let desc = "";
        if (item.effect === "fullHeal") desc = " (Heal +1 Max HP)";
        else if (item.effect === "damageBoost") desc = " (+1 Damage)";
        else if (item.effect === "toughnessBoost") desc = " (+1 Toughness)";
        else if (item.effect === "speed") desc = ` (Speed ${item.turns || 10} turns)`;
        else if (item.effect === "invisibility") desc = ` (Invisible ${item.turns || 5} turns)`;
        else if (item.effect === "explosive") desc = " (AOE Damage)";
        return `<button type="button" data-buy-item="${item.shopIndex}" class="menu-button" style="color:${item.color};${gold < item.price ? "opacity:0.5;" : ""}" title="${escapeHtml(
          item.name + desc,
        )}">
          ${escapeHtml(item.name)}${desc ? `<small style="opacity:0.7;">${escapeHtml(desc)}</small>` : ""}<br><small>${item.price} gold</small>
        </button>`;
      })
      .join("");

    content = `<div class="menu-status">
      <div>Gold: ${gold}</div>
      <div style="margin-top: 10px; opacity:0.9;">Sell items:</div>
      <div class="menu-inventory">${sellAllBtn}${sellButtons || `<div class="menu-empty">No items to sell</div>`}</div>
      <div style="margin-top: 10px; opacity:0.9;">Upgrades:</div>
      <div class="menu-inventory">${upgradesHtml}</div>
      <div style="margin-top: 10px; opacity:0.9;">Consumables:</div>
      <div class="menu-inventory">${potionButtons}</div>
    </div>`;
  } else if (activeTab === "help") {
    content = `<div class="menu-log" style="text-align:left;">
      <div class="log-line" style="color: var(--accent); font-weight: bold;">Controls</div>
      <div class="log-line">- Tap a tile to auto-walk there (pathfinding).</div>
      <div class="log-line">- Menu → Walkout: auto-walk to the exit (you can still be attacked).</div>
      <div class="log-line">- Tap <b>●</b> to open/close the menu (pauses).</div>
      <div class="log-line">- Tap <b>?</b> to arm Investigate, then tap a tile to inspect it.</div>
      <div class="log-line">- Pinch with 2 fingers to zoom the view in/out.</div>
      <div class="log-line" style="color: var(--accent); font-weight: bold; margin-top:6px;">Keyboard (desktop)</div>
      <div class="log-line">- Move: WASD / Arrow keys</div>
      <div class="log-line">- Diagonals: Q/E/Z/C</div>
      <div class="log-line">- Menu: M, Inventory: I, Close: Escape</div>
      <div class="log-line" style="color: var(--accent); font-weight: bold; margin-top:6px;">Tips</div>
      <div class="log-line">- Hidden traps flash briefly—watch the floor.</div>
      <div class="log-line">- If a mouse panics, it may be hinting at a false wall.</div>
      <div class="log-line">- You can cook raw food at campfires.</div>
    </div>`;
  } else if (activeTab === "settings") {
    const highScore = localStorage.getItem("dungeonHighScore") || 0;
    content = `<div class="menu-status">
      <div style="margin-bottom: 15px; text-align: center; padding: 10px; background: rgba(0, 0, 0, 0.5); border-radius: 8px;">
        <div style="margin: 5px 0;">High Score: ${highScore}</div>
        <div style="margin: 5px 0;">Current Score: ${player.score || 0}</div>
      </div>
      <div style="margin-bottom: 15px;">
        <label style="display: flex; align-items: center; gap: 10px; margin: 8px 0; padding: 8px; background: rgba(0, 0, 0, 0.3); border-radius: 6px;">
          <input type="checkbox" ${settings.showDamageNumbers ? "checked" : ""} data-setting="showDamageNumbers" style="width: 20px; height: 20px;">
          Show Damage Numbers
        </label>
        <label style="display: flex; align-items: center; gap: 10px; margin: 8px 0; padding: 8px; background: rgba(0, 0, 0, 0.3); border-radius: 6px;">
          <input type="checkbox" ${settings.showEnemyHealth ? "checked" : ""} data-setting="showEnemyHealth" style="width: 20px; height: 20px;">
          Show Enemy Health
        </label>
        <label style="display: flex; align-items: center; gap: 10px; margin: 8px 0; padding: 8px; background: rgba(0, 0, 0, 0.3); border-radius: 6px;">
          <input type="checkbox" ${settings.soundEnabled ? "checked" : ""} data-setting="soundEnabled" style="width: 20px; height: 20px;">
          Sound
        </label>
        <label style="display: flex; align-items: center; gap: 10px; margin: 8px 0; padding: 8px; background: rgba(0, 0, 0, 0.3); border-radius: 6px;">
          <input type="checkbox" ${settings.largeText ? "checked" : ""} data-setting="largeText" style="width: 20px; height: 20px;">
          Large Text
        </label>
        <label style="display: flex; align-items: center; gap: 10px; margin: 8px 0; padding: 8px; background: rgba(0, 0, 0, 0.3); border-radius: 6px;">
          <input type="checkbox" ${settings.highContrast ? "checked" : ""} data-setting="highContrast" style="width: 20px; height: 20px;">
          High Contrast
        </label>
        <label style="display: flex; align-items: center; gap: 10px; margin: 8px 0; padding: 8px; background: rgba(0, 0, 0, 0.3); border-radius: 6px;">
          <input type="checkbox" ${settings.reducedMotion ? "checked" : ""} data-setting="reducedMotion" style="width: 20px; height: 20px;">
          Reduced Motion
        </label>
        <label style="display: flex; align-items: center; gap: 10px; margin: 8px 0; padding: 8px; background: rgba(0, 0, 0, 0.3); border-radius: 6px;">
          <input type="checkbox" ${settings.reducedFlashing ? "checked" : ""} data-setting="reducedFlashing" style="width: 20px; height: 20px;">
          Reduced Flashing
        </label>
        <label style="display: flex; align-items: center; gap: 10px; margin: 8px 0; padding: 8px; background: rgba(0, 0, 0, 0.3); border-radius: 6px;">
          <input type="checkbox" ${settings.hitFlash ? "checked" : ""} data-setting="hitFlash" style="width: 20px; height: 20px;">
          Hit Flash
        </label>
        <label style="display: flex; align-items: center; gap: 10px; margin: 8px 0; padding: 8px; background: rgba(0, 0, 0, 0.3); border-radius: 6px;">
          <input type="checkbox" ${settings.screenShake ? "checked" : ""} data-setting="screenShake" style="width: 20px; height: 20px;">
          Screen Shake
        </label>
        <label style="display: flex; align-items: center; gap: 10px; margin: 8px 0; padding: 8px; background: rgba(0, 0, 0, 0.3); border-radius: 6px;">
          <input type="checkbox" ${settings.diagonalMelee ? "checked" : ""} data-setting="diagonalMelee" style="width: 20px; height: 20px;">
          Diagonal Melee
        </label>
        <label style="display: flex; align-items: center; gap: 10px; margin: 8px 0; padding: 8px; background: rgba(0, 0, 0, 0.3); border-radius: 6px;">
          <input type="checkbox" ${settings.autoSave ? "checked" : ""} data-setting="autoSave" style="width: 20px; height: 20px;">
          Auto-Save
        </label>
        <label style="display: flex; align-items: center; gap: 10px; margin: 8px 0; padding: 8px; background: rgba(0, 0, 0, 0.3); border-radius: 6px;">
          <input type="checkbox" ${settings.haptics ? "checked" : ""} data-setting="haptics" style="width: 20px; height: 20px;">
          Haptics (vibration)
        </label>
        <label style="display: flex; align-items: center; gap: 10px; margin: 8px 0; padding: 8px; background: rgba(0, 0, 0, 0.3); border-radius: 6px;">
          <input type="checkbox" ${settings.confirmDescend ? "checked" : ""} data-setting="confirmDescend" style="width: 20px; height: 20px;">
          Confirm descend on trapdoor
        </label>
      </div>
      <div style="margin-top: 15px;">
        <button type="button" data-action="save-game" class="menu-button" style="width: 100%; margin: 5px 0;">Save Game</button>
      </div>
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
        ${cookingAtCampfire ? tabBtn("cook", "Cook") : ""}
        ${atShop ? tabBtn("shop", "Shop") : ""}
        ${tabBtn("help", "Help")}
        ${tabBtn("settings", "Settings")}
        ${tabBtn("log", "Log")}
        ${actionBtn("walkout", "Walkout")}
        ${actionBtn("quit-to-menu", "Quit to Menu")}
        ${actionBtn("close-menu", "Close")}
      </div>
      <div class="menu-content">${content}</div>
    </div>
  `;
}

function draw() {
  if (!gameEl || inMainMenu) return;

  // Live log
  renderLiveLog();
  updateHud();
  updateDamageNumbers();

  if (menuOpen) {
    activeTab = activeTab || "inventory";
    gameEl.innerHTML = renderMenuHtml();
    lastMapHtml = "";
    return;
  }

  const enemyByPos = new Map();
  for (const e of enemies) enemyByPos.set(`${e.x},${e.y}`, e);

  // Auto-walk preview path (remaining steps).
  const pathKeys = new Set();
  if (autoMove?.path?.length) {
    let px = player.x;
    let py = player.y;
    for (const step of autoMove.path) {
      px += step.dx;
      py += step.dy;
      pathKeys.add(keyOf(px, py));
    }
  }

  const dimCss = "opacity:0.5;";
  const popCss = "font-weight:700;";
  const burningOutlineCss = "text-shadow: 0 0 3px orange, 0 0 6px orange;";
  const reducedFlashing = !!settings?.reducedFlashing;
  const trapPeriod = reducedFlashing ? HIDDEN_TRAP_FLASH_PERIOD_MS * 2.5 : HIDDEN_TRAP_FLASH_PERIOD_MS;
  const trapPulse = reducedFlashing ? Math.max(120, Math.floor(HIDDEN_TRAP_FLASH_PULSE_MS * 0.6)) : HIDDEN_TRAP_FLASH_PULSE_MS;
  const hiddenFlashOn = Date.now() % trapPeriod < trapPulse;
  const mouseWallPulseOn = Date.now() % (reducedFlashing ? 420 : 240) < (reducedFlashing ? 140 : 120);

  const viewRadius = getViewRadius();
  const vis = computeVisibility();

  // Map draw - center on player
  let out = "";
  let runStyle = null;
  let runText = "";
  const flush = () => {
    if (!runText) return;
    if (runStyle) out += `<span style="${runStyle}">${escapeHtml(runText)}</span>`;
    else out += escapeHtml(runText);
    runText = "";
  };
  const pushCell = (ch, style) => {
    if (style !== runStyle) {
      flush();
      runStyle = style;
    }
    runText += ch;
  };

  for (let y = -viewRadius; y <= viewRadius; y++) {
    for (let x = -viewRadius; x <= viewRadius; x++) {
      const tx = player.x + x;
      const ty = player.y + y;
      const key = `${tx},${ty}`;
      const dist = Math.max(Math.abs(x), Math.abs(y)); // square distance

      // Fog-of-war:
      // - Outside BASE_VIEW_RADIUS: show explored terrain only.
      // - Inside BASE_VIEW_RADIUS but not currently visible (LoS blocked): also show explored terrain only.
      const currentlyVisible = vis?.has?.(key);
      if (dist > BASE_VIEW_RADIUS || !currentlyVisible) {
        if (!explored.has(key)) {
          pushCell(" ", null);
          continue;
        }

        // Hidden hallway/room stays hidden as walls until revealed.
        const hiddenAsWall = hiddenArea && !hiddenArea.revealed && hiddenArea.tiles?.has(key);
        const ch = hiddenAsWall ? "#" : map[key] || "#";
        const t = ch === "#" ? "#" : ".";
        pushCell(t === "#" ? "#" : ".", `color:${t === "#" ? "lime" : "#555"};${dimCss}`);
        continue;
      }

      const terrainOnly = dist > FULL_SIGHT_RADIUS;

      // Terrain-only ring: show walls/floors only (no enemies, items, traps, mouse, trapdoor).
      if (terrainOnly) {
        // Hidden hallway/room stays hidden as walls until revealed.
        if (hiddenArea && !hiddenArea.revealed && hiddenArea.tiles?.has(key)) {
          const isFalseWall = hiddenArea.falseWalls?.has(key);
          const flash = isFalseWall && Date.now() < (hiddenArea.mouseFlashUntil || 0);
          const color = isFalseWall ? (flash ? (mouseWallPulseOn ? "#0a0" : "#070") : "#0a0") : "lime";
          pushCell("#", `color:${color};${dimCss}`);
        } else {
          const ch = map[key] || "#";
          // Only terrain: walls and floors. Everything else renders as floor.
          const t = ch === "#" ? "#" : ".";
          pushCell(
            t === "#" ? "#" : ".",
            `color:${t === "#" ? "lime" : "#555"};${dimCss}`,
          );
        }
        continue;
      }

      if (tx === player.x && ty === player.y) {
        const extra = `${popCss}${getBurning(player)?.turns ? burningOutlineCss : ""}`;
        pushCell("@", `color:cyan;${extra}`);
      } else if (enemyByPos.has(key)) {
        const e = enemyByPos.get(key);
        const hitFlash = lastTarget && lastTarget.x === e.x && lastTarget.y === e.y && Date.now() - (lastTarget.time || 0) < 220;
        const flashCss = hitFlash ? "text-shadow: 0 0 6px rgba(255,255,255,0.9), 0 0 10px rgba(255,255,255,0.35);" : "";
        const extra = `${popCss}${getBurning(e)?.turns ? burningOutlineCss : ""}${flashCss}`;
        pushCell(e.symbol || "E", `color:${e.color || "red"};${extra}`);
      } else if (mouse && tx === mouse.x && ty === mouse.y) {
        pushCell("m", `color:#eee;${popCss}`);
      } else if (hiddenArea && !hiddenArea.revealed && hiddenArea.tiles?.has(key)) {
        // Hidden hallway/room are drawn as walls until revealed.
        const isFalseWall = hiddenArea.falseWalls?.has(key);
        const flash = isFalseWall && Date.now() < (hiddenArea.mouseFlashUntil || 0);
        const color = isFalseWall ? (flash ? (mouseWallPulseOn ? "#0a0" : "#070") : "#0a0") : "lime";
        pushCell("#", `color:${color};`);
      } else if (lootAtKey(key)) {
        const p = lootAtKey(key);
        const rid = String(p?.rarity || "");
        const rar = (Array.isArray(RARITIES) ? RARITIES.find((r) => r.id === rid) : null) || null;
        const outline = rar?.outline
          ? `text-shadow: -1px 0 ${rar.outline}, 1px 0 ${rar.outline}, 0 -1px ${rar.outline}, 0 1px ${rar.outline}, 0 0 6px ${rar.outline};`
          : "";
        pushCell(p.symbol, `color:${p.color || "cyan"};${popCss}${outline}`);
      } else {
        const ch = tileAtKey(key);
        const trap = trapAtKey(key);
        if (trap) {
          if (trap.hidden) {
            // Hidden traps look like floor, but flash orange every few seconds.
            pushCell(".", `color:${hiddenFlashOn ? "orange" : "#555"};`);
          } else {
            pushCell("~", `color:${trap.color || "orange"};`);
          }
        } else if (ch === TILE.FLOOR) {
          // floor (optionally show auto-walk path preview)
          if (pathKeys.has(key)) pushCell(".", "color:#0ff;text-shadow: 0 0 4px rgba(0,255,255,0.35);");
          else pushCell(".", "color:#555;");
        } // floor
        else if (ch === TILE.GRASS) pushCell(",", "color:#1fbf3a;"); // grass
        else if (ch === TILE.TRAP_VISIBLE) pushCell("~", "color:orange;"); // fallback
        else if (ch === TILE.WALL) pushCell("#", "color:lime;"); // wall
        else if (ch === TILE.ENTRANCE) pushCell("D", `color:var(--accent);${popCss}`); // dungeon entrance
        else if (ch === TILE.UPSTAIRS) pushCell("U", `color:#8ff;${popCss}`); // exit upstairs
        else if (ch === TILE.TRAPDOOR) {
          // Only show trapdoor if no enemy is on it
          if (!enemyByPos.has(key)) {
            pushCell("T", `color:#00ff3a;${popCss}`); // trapdoor
          } else {
            // Enemy is on trapdoor, show enemy instead
            const e = enemyByPos.get(key);
            const extra = `${popCss}${getBurning(e)?.turns ? burningOutlineCss : ""}`;
            const isBoss = e.symbol && e.symbol === e.symbol.toUpperCase() && e.symbol !== e.symbol.toLowerCase();
            const bossGlow = isBoss ? "text-shadow: 0 0 4px #ff0000, 0 0 8px #ff0000;" : "";
            pushCell(e.symbol || "E", `color:${e.color || "red"};${extra}${bossGlow}`);
          }
        } else if (ch === TILE.CAMPFIRE) pushCell("C", `color:orange;${popCss}`); // campfire
        else if (ch === TILE.SHOP) pushCell("$", `color:#ffd700;${popCss}`); // shop
        else pushCell(ch, "color:white;");
      }
    }
    flush();
    runStyle = null;
    out += "\n";
  }
  flush();

  if (out !== lastMapHtml) {
    gameEl.innerHTML = out;
    lastMapHtml = out;
  }
  updateMapFontSize();
}
