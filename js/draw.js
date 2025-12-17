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
  const rarityBadge = (it) => {
    const rid = String(it?.rarity || "");
    if (!rid) return "";
    if (rid === "trash") return "·";
    if (rid === "common") return "◇";
    if (rid === "uncommon") return "◆";
    if (rid === "rare") return "✦";
    if (rid === "epic") return "✷";
    if (rid === "legendary") return "★";
    return "◇";
  };
  const itemTitle = (it) => {
    if (!it) return "";
    const eff = String(it.effect || "").toLowerCase();
    const lines = [];
    const rid = String(it.rarity || "");
    if (rid) lines.push(`Rarity: ${rid}`);
    if (eff === "weapon") {
      lines.push(`Level: ${Number(it.level || 1)}`);
      lines.push(`Damage: 0-${Number(it.maxDamage || 0)}`);
    } else if (eff === "food") {
      lines.push(`Hunger +${Number(it.hunger || 0)}`);
      if (Number(it.heal || 0)) lines.push(`Heal +${Number(it.heal || 0)}`);
      if (it.cooked) lines.push("Cooked");
    } else if (eff === "valuable") {
      lines.push(`Worth ${Number(it.value || 0)} gold`);
    } else if (eff) {
      lines.push(`Type: ${eff}`);
    }
    const sv = typeof getItemSellValue === "function" ? Math.max(0, Math.floor(Number(getItemSellValue(it) || 0))) : 0;
    if (sv) lines.push(`Sell: ${sv} gold`);
    return lines.join("\n");
  };

  const tabBtn = (tab, label) =>
    `<button type="button" data-tab="${tab}" class="${activeTab === tab ? "is-active" : ""}">${label}</button>`;
  const actionBtn = (action, label) => `<button type="button" data-action="${action}">${label}</button>`;

  let content;

  if (activeTab === "inventory") {
    const cap = Math.max(0, Number(player.maxInventory ?? 0));
    const used = Array.isArray(player.inventory) ? player.inventory.length : 0;
    let items = (Array.isArray(player.inventory) ? player.inventory : []).map((it, idx) => ({ it, idx }));
    const sortMode = String(player.inventorySort || "type").toLowerCase();
    const rarityRank = (rid) => {
      const order = { trash: 0, common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 };
      return order[String(rid || "").toLowerCase()] ?? 0;
    };
    const stable = (cmp) => {
      items = items
        .map((x, i) => ({ ...x, _i: i }))
        .sort((a, b) => {
          const c = cmp(a, b);
          return c || a._i - b._i;
        })
        .map(({ _i, ...rest }) => rest);
    };
    if (sortMode === "name") {
      stable((a, b) => String(a.it?.name || "").localeCompare(String(b.it?.name || "")));
    } else if (sortMode === "value") {
      stable((a, b) => {
        const av = typeof getItemSellValue === "function" ? Number(getItemSellValue(a.it) || 0) : 0;
        const bv = typeof getItemSellValue === "function" ? Number(getItemSellValue(b.it) || 0) : 0;
        return bv - av;
      });
    } else if (sortMode === "rarity") {
      stable((a, b) => rarityRank(b.it?.rarity) - rarityRank(a.it?.rarity));
    } else if (sortMode === "recent") {
      stable((a, b) => Number(b.it?.pickedAt || 0) - Number(a.it?.pickedAt || 0));
    } else {
      // type (default): weapons, consumables, valuables, materials, then name
      const typeRank = (it) => {
        const eff = String(it?.effect || "").toLowerCase();
        if (eff === "weapon") return 0;
        if (eff === "trinket") return 1;
        if (eff === "food" || eff === "fullheal" || eff === "damageboost" || eff === "toughnessboost" || eff === "speed" || eff === "invisibility" || eff === "explosive")
          return 2;
        if (eff === "valuable") return 3;
        if (eff === "material") return 4;
        return 5;
      };
      stable((a, b) => typeRank(a.it) - typeRank(b.it) || String(a.it?.name || "").localeCompare(String(b.it?.name || "")));
    }

    const valuables = items.filter(({ it }) => String(it?.effect || "") === "valuable");
    const weapons = items.filter(({ it }) => String(it?.effect || "") === "weapon");
    const trinkets = items.filter(({ it }) => String(it?.effect || "") === "trinket");
    const materials = items.filter(({ it }) => String(it?.effect || "") === "material");
    const consumables = items.filter(({ it }) => {
      const eff = String(it?.effect || "");
      return eff !== "valuable" && eff !== "weapon" && eff !== "trinket" && eff !== "material";
    });

    const btn = (it, idx, subtitle = "") =>
      `<button type="button" data-use-item="${idx}" class="menu-button" style="color:${it?.color || "cyan"};${rarityOutlineCss(it)}" title="${escapeHtml(itemTitle(it))}">
        ${escapeHtml(`${rarityBadge(it)} ${it?.name || "Item"}`)}${subtitle ? `<br><small style="opacity:0.75;">${escapeHtml(subtitle)}</small>` : ""}
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

      const sortBtn = (id, label) =>
        `<button type="button" data-sort-inv="${escapeHtml(id)}" style="margin: 2px 4px; padding: 6px 10px; border-radius: 10px; border: 1px solid rgba(0,255,255,0.35); background:${sortMode === id ? "rgba(0,255,255,0.12)" : "rgba(0,0,0,0.55)"}; color: var(--accent);">
          ${escapeHtml(label)}
        </button>`;
      const sortRow = `<div style="text-align:center; margin: 6px 0 10px;">
        <div style="opacity:0.85; margin-bottom: 4px;">Sort</div>
        ${sortBtn("type", "Type")}${sortBtn("recent", "Recent")}${sortBtn("name", "Name")}${sortBtn("rarity", "Rarity")}${sortBtn("value", "Value")}
      </div>`;

      const hotbarRow = (() => {
        const slots = Array.isArray(player.hotbar) ? player.hotbar : [null, null, null, null];
        const slotBtn = (s) => {
          const iid = slots[s];
          const idx2 = typeof findInventoryIndexById === "function" && iid ? findInventoryIndexById(iid) : -1;
          const it2 = idx2 >= 0 ? player.inventory?.[idx2] : null;
          const nm = it2?.name ? String(it2.name) : "(empty)";
          return `<button type="button" class="mini-btn" data-clear-hotbar="${s}" title="Tap to clear">
            ${s + 1}: ${escapeHtml(nm)}
          </button>`;
        };
        return `<div style="text-align:center; margin: 6px 0 10px;">
          <div style="opacity:0.85; margin-bottom: 4px;">Hotbar (tap a slot to clear)</div>
          <div class="mini-row">${[0, 1, 2, 3].map(slotBtn).join("")}</div>
          <div style="opacity:0.7; margin-top:4px; font-size:0.9em;">Assign from items below</div>
        </div>`;
      })();

      const top = `<div class="menu-status" style="margin-bottom: 10px;">Inventory: ${used}/${cap || "∞"}</div>${sortRow}${hotbarRow}`;

      const equipTop = `<div class="menu-status" style="margin-bottom: 10px; text-align:left;">
        <div style="font-weight:700; color: var(--accent); margin-bottom: 6px;">Hands</div>
        ${eqLine("Main hand", mainHand, "main")}
        ${eqLine("Off hand", offHand, "off")}
        <div style="font-weight:700; color: var(--accent); margin: 10px 0 6px;">Trinkets</div>
        ${(() => {
          const tr = player?.trinkets || { a: null, b: null };
          const line = (label, it, slot) => {
            if (!it) return `<div>${escapeHtml(label)}: <span style="opacity:0.7;">(empty)</span></div>`;
            return `<div>${escapeHtml(label)}: <span style="color:${it?.color || "cyan"};${rarityOutlineCss(it)}">${escapeHtml(
              `${rarityBadge(it)} ${it?.name || "Trinket"}`,
            )}</span> <button type="button" data-unequip-trinket="${escapeHtml(slot)}" style="margin-left:8px;">Unequip</button></div>`;
          };
          return `${line("Slot A", tr.a, "a")}${line("Slot B", tr.b, "b")}`;
        })()}
      </div>`;

      const consHtml = consumables.length
        ? `<div class="menu-status" style="margin: 6px 0 4px; opacity:0.9;">Consumables</div><div class="menu-inventory">${consumables
            .map(({ it, idx }) => {
              const assign = `<div class="mini-row">
                ${[0, 1, 2, 3].map((s) => `<button type="button" class="mini-btn" data-assign-hotbar="${s}:${idx}">${s + 1}</button>`).join("")}
              </div>`;
              return `<div style="display:flex; flex-direction:column; align-items:center;">${btn(it, idx)}${assign}</div>`;
            })
            .join("")}</div>`
        : `<div class="menu-empty">No consumables</div>`;

      const wepHtml = weapons.length
        ? `<div class="menu-status" style="margin: 10px 0 4px; opacity:0.9;">Weapons (tap to equip)</div><div class="menu-inventory">${weapons
            .map(({ it, idx }) => {
              const main = player?.hands?.main && String(player.hands.main.effect || "") === "weapon" ? player.hands.main : null;
              const bonus = Math.max(0, Math.floor(Number(player.dmg || 0)));
              const wMax = Math.max(1, Math.floor(Number(it?.maxDamage || 1))) + bonus;
              const mMax = main ? Math.max(1, Math.floor(Number(main.maxDamage || 1))) + bonus : null;
              const delta = mMax != null ? wMax - mMax : null;
              const deltaStr = delta == null ? "" : ` • Δ ${delta >= 0 ? "+" : ""}${delta}`;
              const subtitle = `Lv ${Number(it?.level || 1)} • ${String(it?.rarity || "trash")} • 0-${wMax}${deltaStr}`;
              return `<button type="button" data-equip-main="${idx}" class="menu-button" style="color:${it?.color || "cyan"};${rarityOutlineCss(it)}" title="${escapeHtml(
                itemTitle(it),
              )}">
                ${escapeHtml(`${rarityBadge(it)} ${it?.name || "Weapon"}`)}<br><small style="opacity:0.75;">${escapeHtml(subtitle)}</small><br><small style="opacity:0.7;">Equip main</small>
              </button>`;
            })
            .join("")}</div>`
        : `<div class="menu-empty">No weapons</div>`;

      const trinkHtml = trinkets.length
        ? `<div class="menu-status" style="margin: 10px 0 4px; opacity:0.9;">Trinkets</div><div class="menu-inventory">${trinkets
            .map(({ it, idx }) => {
              const subtitle = String(it?.desc || it?.description || "");
              const base = `<button type="button" data-use-item="${idx}" class="menu-button" style="color:${it?.color || "cyan"};${rarityOutlineCss(it)}" title="${escapeHtml(
                itemTitle(it),
              )}">
                ${escapeHtml(`${rarityBadge(it)} ${it?.name || "Trinket"}`)}${subtitle ? `<br><small style="opacity:0.75;">${escapeHtml(subtitle)}</small>` : ""}
              </button>`;
              const equip =
                `<div style="display:flex; gap:6px; justify-content:center; margin-top:4px;">
                  <button type="button" data-equip-trinket-a="${idx}" style="padding:4px 10px; border-radius:10px;">Equip A</button>
                  <button type="button" data-equip-trinket-b="${idx}" style="padding:4px 10px; border-radius:10px;">Equip B</button>
                </div>`;
              return `<div style="display:flex; flex-direction:column; align-items:center;">${base}${equip}</div>`;
            })
            .join("")}</div>`
        : `<div class="menu-empty">No trinkets</div>`;

      const matHtml = materials.length
        ? `<div class="menu-status" style="margin: 10px 0 4px; opacity:0.9;">Materials</div><div class="menu-inventory">${materials
            .map(({ it, idx }) => {
              const q = Math.max(1, Math.floor(Number(it?.qty || 1)));
              return `<button type="button" data-use-item="${idx}" class="menu-button" style="color:${it?.color || "cyan"};${rarityOutlineCss(it)}" title="${escapeHtml(
                itemTitle(it),
              )}">
                ${escapeHtml(`${it?.name || "Material"} x${q}`)}
              </button>`;
            })
            .join("")}</div>`
        : `<div class="menu-empty">No materials</div>`;

      const valHtml = valuables.length
        ? `<div class="menu-status" style="margin: 10px 0 4px; opacity:0.9;">Valuables (sell at a shop)</div><div class="menu-inventory">${valuables
            .map(({ it, idx }) => btn(it, idx, `Worth ${Number(it?.value || 0)}`))
            .join("")}</div>`
        : `<div class="menu-empty">No valuables</div>`;

      content = `${top}${equipTop}${wepHtml}${trinkHtml}${consHtml}${matHtml}${valHtml}`;
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
  } else if (activeTab === "blacksmith") {
    const w = player?.hands?.main && String(player.hands.main.effect || "") === "weapon" ? player.hands.main : null;
    const tier = w ? Math.max(0, Math.floor(Number(w.forged || 0))) : 0;
    const goldCost = 60 + tier * 45;
    const ironCost = 2 + tier;
    const essCost = tier >= 2 ? 1 : 0;
    const ironHave = typeof getMaterialCount === "function" ? getMaterialCount("iron") : 0;
    const essHave = typeof getMaterialCount === "function" ? getMaterialCount("essence") : 0;
    const gold = Number(player.gold || 0);
    const can = !!w && gold >= goldCost && ironHave >= ironCost && (!essCost || essHave >= essCost);
    content = `<div class="menu-status" style="text-align:left;">
      <div style="color: var(--accent); font-weight:700;">Blacksmith</div>
      <div style="opacity:0.9; margin-top: 6px;">Main-hand weapon:</div>
      <div style="margin: 6px 0; padding: 10px; background: rgba(0,0,0,0.35); border-radius: 8px;">
        ${w ? `${escapeHtml(w.name)}<br><span style="opacity:0.8;">Damage 0-${Number(w.maxDamage || 0)} • Forge Tier ${tier}</span>` : `<span style="opacity:0.8;">(none equipped)</span>`}
      </div>
      <div style="opacity:0.9;">Reforge (+1 max damage)</div>
      <div style="opacity:0.8; margin-bottom: 6px;">Cost: ${goldCost} gold • Iron ${ironCost}${essCost ? ` • Dust ${essCost}` : ""}</div>
      <button type="button" data-blacksmith-upgrade="1" style="width: 100%; padding: 12px 14px; border-radius: 12px; border: 2px solid rgba(0,255,255,0.35); background: rgba(0,0,0,0.75); color: var(--accent); ${can ? "" : "opacity:0.5;"}">Reforge</button>
      <div style="opacity:0.75; margin-top: 10px;">Materials: Iron ${ironHave} • Dust ${essHave}</div>
    </div>`;
  } else if (activeTab === "bounties") {
    try {
      ensureBountyOffers?.();
    } catch {
      // ignore
    }
    const offers = player?.bounties?.offers || [];
    const accepted = player?.bounties?.accepted || [];
    const claimed = player?.bounties?.claimed || {};
    const offerHtml =
      offers.length === 0
        ? `<div class="menu-empty">No bounties today</div>`
        : offers
            .map((b) => {
              const already = accepted.some((x) => x.id === b.id);
              const btn = already
                ? `<div style="opacity:0.7; text-align:center;">Accepted</div>`
                : `<button type="button" data-bounty-accept="${escapeHtml(b.id)}" style="margin-top:6px;">Accept</button>`;
              return `<div style="margin: 10px 0; padding: 10px; border: 1px solid rgba(0,255,255,0.25); border-radius: 10px; background: rgba(0,0,0,0.35);">
                <div style="color: var(--accent); font-weight:700;">${escapeHtml(b.title)}</div>
                <div style="opacity:0.9;">${escapeHtml(b.desc)}</div>
                <div style="opacity:0.8; margin-top:4px;">Reward: ${Number(b.rewardGold || 0)}g</div>
                ${btn}
              </div>`;
            })
            .join("");
    const activeHtml =
      accepted.length === 0
        ? `<div class="menu-empty">No active bounties</div>`
        : accepted
            .map((b) => {
              const done = !!b.completed;
              const isClaimed = !!claimed?.[b.id];
              const claimBtn =
                done && !isClaimed
                  ? `<button type="button" data-bounty-claim="${escapeHtml(b.id)}" style="margin-top:6px;">Claim</button>`
                  : `<div style="opacity:0.8; margin-top:6px;">${isClaimed ? "Claimed" : done ? "Complete" : "In progress"}</div>`;
              return `<div style="margin: 10px 0; padding: 10px; border: 1px solid rgba(255,255,255,0.22); border-radius: 10px; background: rgba(0,0,0,0.25);">
                <div style="font-weight:700;">${escapeHtml(b.title)}</div>
                <div style="opacity:0.85;">${escapeHtml(b.desc)}</div>
                <div style="opacity:0.85; margin-top:4px;">Progress: ${Number(b.progress || 0)}/${Number(b.goal || 0)}</div>
                ${claimBtn}
              </div>`;
            })
            .join("");
    content = `<div class="menu-log" style="text-align:left;">
      <div class="log-line" style="color: var(--accent); font-weight: bold;">Bounty Board</div>
      <div class="log-line" style="opacity:0.85;">Pick up to 2 bounties. Claim rewards here.</div>
      <div style="margin-top: 10px; color: var(--accent); font-weight:700;">Active</div>
      ${activeHtml}
      <div style="margin-top: 14px; color: var(--accent); font-weight:700;">Available</div>
      ${offerHtml}
    </div>`;
  } else if (activeTab === "codex") {
    const c = player?.codex || { enemies: {}, items: {}, trinkets: {}, materials: {}, statuses: {} };
    const section = (title, obj) => {
      const entries = Object.entries(obj || {}).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      if (!entries.length) return `<div class="menu-empty">No ${escapeHtml(title.toLowerCase())} yet</div>`;
      return `<div style="text-align:left; max-width: 680px; margin: 0 auto;">
        <div style="color: var(--accent); font-weight:700; margin: 8px 0 6px;">${escapeHtml(title)}</div>
        ${entries
          .map(([k, v]) => `<div class="log-line" style="opacity:0.95;">${escapeHtml(k)} <span style="opacity:0.7;">(${Number(v || 0)})</span></div>`)
          .join("")}
      </div>`;
    };
    content = `<div class="menu-log" style="text-align:left;">
      <div class="log-line" style="color: var(--accent); font-weight: bold;">Codex</div>
      <div class="log-line" style="opacity:0.85;">Counts track pickups/entries (some are “seen” only).</div>
      ${section("Enemies", c.enemies)}
      ${section("Items", c.items)}
      ${section("Trinkets", c.trinkets)}
      ${section("Materials", c.materials)}
      ${section("Status Effects", c.statuses)}
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
      <div style="margin-top: 10px; padding: 10px; background: rgba(0,0,0,0.35); border-radius: 8px;">
        <div style="color: var(--accent); font-weight: 700; margin-bottom: 8px;">Difficulty</div>
        <div style="opacity:0.85; margin-bottom: 8px;">Preset: ${escapeHtml(String(settings.difficultyPreset || "normal"))}</div>
        <div style="display:flex; gap: 10px; flex-wrap: wrap; justify-content:center;">
          <button type="button" data-diff-preset="easy" class="menu-button" style="color: var(--accent); ${settings.difficultyPreset === "easy" ? "background: rgba(0,255,255,0.12);" : ""}">Easy</button>
          <button type="button" data-diff-preset="normal" class="menu-button" style="color: var(--accent); ${settings.difficultyPreset === "normal" ? "background: rgba(0,255,255,0.12);" : ""}">Normal</button>
          <button type="button" data-diff-preset="hard" class="menu-button" style="color: var(--accent); ${settings.difficultyPreset === "hard" ? "background: rgba(0,255,255,0.12);" : ""}">Hard</button>
        </div>
        <div style="opacity:0.85; margin-top: 10px; text-align:center;">
          Enemy HP x${Number(settings.enemyHpMult || 1).toFixed(2)} • Enemy DMG x${Number(settings.enemyDmgMult || 1).toFixed(2)}<br>
          Loot x${Number(settings.lootMult || 1).toFixed(2)} • Hazards x${Number(settings.hazardMult || 1).toFixed(2)}
        </div>
        <div style="margin-top: 10px; text-align:center; opacity:0.85;">Fine-tune (sets preset to Custom)</div>
        <div style="display:flex; gap: 8px; flex-wrap: wrap; justify-content:center; margin-top:6px;">
          <button type="button" data-diff-adjust="enemyHpMult:-0.05" style="padding:6px 10px; border-radius:10px;">HP-</button>
          <button type="button" data-diff-adjust="enemyHpMult:+0.05" style="padding:6px 10px; border-radius:10px;">HP+</button>
          <button type="button" data-diff-adjust="enemyDmgMult:-0.05" style="padding:6px 10px; border-radius:10px;">DMG-</button>
          <button type="button" data-diff-adjust="enemyDmgMult:+0.05" style="padding:6px 10px; border-radius:10px;">DMG+</button>
          <button type="button" data-diff-adjust="lootMult:-0.05" style="padding:6px 10px; border-radius:10px;">Loot-</button>
          <button type="button" data-diff-adjust="lootMult:+0.05" style="padding:6px 10px; border-radius:10px;">Loot+</button>
          <button type="button" data-diff-adjust="hazardMult:-0.05" style="padding:6px 10px; border-radius:10px;">Haz-</button>
          <button type="button" data-diff-adjust="hazardMult:+0.05" style="padding:6px 10px; border-radius:10px;">Haz+</button>
        </div>
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
        ${tabBtn("codex", "Codex")}
        ${cookingAtCampfire ? tabBtn("cook", "Cook") : ""}
        ${atShop ? tabBtn("shop", "Shop") : ""}
        ${atBlacksmith ? tabBtn("blacksmith", "Blacksmith") : ""}
        ${atBountyBoard ? tabBtn("bounties", "Bounties") : ""}
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
  // Codex discovery: record visible enemies/items.
  try {
    for (const e of enemies || []) {
      const k = `${e.x},${e.y}`;
      if (vis?.has?.(k)) recordCodexEnemy?.(e?.name || "Enemy");
    }
    // Record "seen" items in currently visible tiles.
    for (const k of vis || []) {
      const loot = lootAtKey?.(k);
      if (loot) recordCodexItemSeen?.(loot);
    }
  } catch {
    // ignore
  }

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
      } else if (propAtKey?.(key)) {
        const pr = propAtKey(key);
        const kind = String(pr?.kind || "");
        const ch = kind === "crate" ? TILE.CRATE : TILE.BARREL;
        const c = kind === "crate" ? "#c49a6c" : "#a86f3a";
        pushCell(ch, `color:${c};${popCss}text-shadow: 0 0 4px rgba(0,0,0,0.6);`);
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
        else if (ch === TILE.BLACKSMITH) pushCell("K", `color:#c49a6c;${popCss}text-shadow: 0 0 6px rgba(196,154,108,0.35);`); // blacksmith
        else if (ch === TILE.BOUNTY) pushCell("!", `color:var(--accent);${popCss}text-shadow: 0 0 6px rgba(0,255,255,0.35);`); // bounty board
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
