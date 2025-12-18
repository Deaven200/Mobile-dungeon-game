/* ===================== DRAW ===================== */

let measureEl = null;
let cachedCellMetrics = null;
let lastMapHtml = "";
let spriteLayerEl = null;

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

function getSpriteLayerEl() {
  if (spriteLayerEl) return spriteLayerEl;
  spriteLayerEl = document.getElementById("spriteLayer");
  return spriteLayerEl;
}

function cssUrl(src) {
  // Safe-ish for inline CSS url(...). Keep it simple: avoid quotes/newlines.
  return String(src || "").replaceAll('"', "%22").replaceAll("\n", "").replaceAll("\r", "");
}

function renderSpriteLayer(spriteCells, viewRadius) {
  const layer = getSpriteLayerEl();
  if (!layer) return;
  if (!gameEl || !mapContainerEl) return;
  if (inMainMenu || menuOpen) {
    if (layer.innerHTML) layer.innerHTML = "";
    return;
  }
  if (!Array.isArray(spriteCells) || spriteCells.length === 0) {
    if (layer.innerHTML) layer.innerHTML = "";
    return;
  }

  const gRect = gameEl.getBoundingClientRect();
  const mRect = mapContainerEl.getBoundingClientRect();
  const fontPx = Number.parseFloat(window.getComputedStyle(gameEl).fontSize || "16");
  const { unitW, unitH } = getMonoCellMetricsPx(120);
  const cellW = unitW * fontPx;
  const cellH = unitH * fontPx;
  if (!cellW || !cellH) return;

  // Cells are positioned relative to the top-left of the ASCII block.
  const baseLeft = gRect.left - mRect.left;
  const baseTop = gRect.top - mRect.top;

  // Only render sprites inside the visible grid.
  const cols = viewRadius * 2 + 1;
  const rows = viewRadius * 2 + 1;

  const html = spriteCells
    .map((s) => {
      const cx = Number(s?.cx);
      const cy = Number(s?.cy);
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) return "";
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return "";
      const src = String(s?.src || "");
      if (!src) return "";
      const opacity = Math.max(0, Math.min(1, Number(s?.opacity ?? 1)));
      const left = baseLeft + cx * cellW;
      const top = baseTop + cy * cellH;
      return `<div class="sprite-tile" style="left:${left}px;top:${top}px;width:${cellW}px;height:${cellH}px;opacity:${opacity};background-image:url(&quot;${cssUrl(
        src,
      )}&quot;);"></div>`;
    })
    .filter(Boolean)
    .join("");

  layer.innerHTML = html;
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
    const inv = Array.isArray(player.inventory) ? player.inventory : [];
    const used = inv.length;

    const displayName = (it) => {
      if (!it) return "";
      const nm = String(it.name || "Item");
      const eff = String(it.effect || "").toLowerCase();
      if (eff === "food" && !it.cooked) {
        const low = nm.toLowerCase();
        if (!low.startsWith("raw ") && !low.startsWith("cooked ")) return `Raw ${nm}`;
      }
      return nm;
    };
    const effectId = (it) => String(it?.effect || "").toLowerCase();
    const itemKind = (it) => {
      const eff = effectId(it);
      if (eff === "weapon") return "weapon";
      if (eff === "trinket") return "trinket";
      if (eff === "material") return "material";
      if (eff === "valuable") return "valuable";
      if (eff === "food") return "consumable";
      // Potions/other consumables (fullHeal/speed/etc.) are also consumables.
      return "consumable";
    };
    const valueGold = (it) =>
      typeof getItemSellValue === "function" ? Math.max(0, Math.floor(Number(getItemSellValue(it) || 0))) : 0;
    const metaLine = (it) => {
      if (!it) return "";
      const eff = effectId(it);
      if (eff === "weapon") return `DMG 0-${Number(it.maxDamage || 0)}`;
      if (eff === "food") {
        const h = Math.max(0, Number(it.hunger || 0));
        const heal = Math.max(0, Number(it.heal || 0));
        return heal ? `Hunger +${h} • Heal +${heal}` : `Hunger +${h}`;
      }
      if (eff === "valuable") return `Worth ${Number(it.value || 0)}g`;
      if (eff === "material") return "Material";
      if (eff === "trinket") return "Trinket";
      return "Consumable";
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
    const qtyLabel = (it) => {
      const q = Math.max(1, Math.floor(Number(it?.qty || 1)));
      return q > 1 ? ` x${q}` : "";
    };
    const hotbarSlotsFor = (it) => {
      try {
        const iid = String(it?.iid || "");
        if (!iid) return [];
        const out = [];
        for (let s = 0; s < 4; s++) {
          if (String(player?.hotbar?.[s] || "") === iid) out.push(s);
        }
        return out;
      } catch {
        return [];
      }
    };
    const isNewItem = (it) => {
      const t = Number(it?.pickedAt || 0);
      if (!Number.isFinite(t) || !t) return false;
      return Date.now() - t < 2 * 60 * 1000; // 2 minutes
    };
    const describeItemLines = (it) => {
      if (!it) return [];
      const eff = effectId(it);
      const rid = String(it.rarity || "");
      const lines = [];
      if (rid) lines.push(`Rarity: ${rid}`);
      if (eff === "weapon") {
        if (Number.isFinite(Number(it.level))) lines.push(`Level: ${Number(it.level || 1)}`);
        lines.push(`Damage: 0-${Number(it.maxDamage || 0)}`);
      } else if (eff === "food") {
        lines.push(`Hunger +${Number(it.hunger || 0)}`);
        if (Number(it.heal || 0)) lines.push(`Heal +${Number(it.heal || 0)}`);
        lines.push(it.cooked ? "Cooked" : "Raw");
      } else if (eff === "valuable") {
        lines.push(`Worth: ${Number(it.value || 0)} gold`);
        lines.push("Can't be used. Sell at a shop.");
      } else if (eff === "material") {
        lines.push("Used for upgrades/crafting.");
      } else {
        // Potions / misc consumables
        if (eff === "fullheal") lines.push("Heals to full and increases max HP.");
        else if (eff === "damageboost") lines.push("Permanently increases damage.");
        else if (eff === "toughnessboost") lines.push("Permanently increases toughness.");
        else if (eff === "speed") lines.push(`Speed boost (${Number(it.turns || 10)} turns).`);
        else if (eff === "invisibility") lines.push(`Invisibility (${Number(it.turns || 5)} turns).`);
        else if (eff === "explosive") lines.push("Explodes, damaging adjacent enemies.");
        else if (eff) lines.push(`Type: ${eff}`);
      }
      const slots = hotbarSlotsFor(it);
      if (slots.length) lines.push(`Hotbar: ${slots.map((s) => `#${s + 1}`).join(", ")}`);
      if (isNewItem(it)) lines.push("New");
      const sv = valueGold(it);
      if (sv) lines.push(`Sell value: ${sv} gold`);
      return lines;
    };

    const matchesFilter = (it) => {
      const f = String(menuInvFilter || "all").toLowerCase();
      if (f === "all") return true;
      const k = itemKind(it);
      if (f === "weapons") return k === "weapon";
      if (f === "trinkets") return k === "trinket";
      if (f === "materials") return k === "material";
      if (f === "valuables") return k === "valuable";
      if (f === "consumables") return k === "consumable";
      return true;
    };
    const rarityRank = (it) => {
      const rid = String(it?.rarity || "");
      const order = ["trash", "common", "uncommon", "rare", "epic", "legendary"];
      const i = order.indexOf(rid);
      return i < 0 ? 1 : i;
    };

    const hasFind = typeof findInventoryIndexById === "function";
    // Work with view rows so filter/sort don't break actions.
    let rows = inv.map((it, idx) => ({ it, idx }));
    rows = rows.filter((r) => r.it && matchesFilter(r.it));

    const sortMode = String(player?.inventorySort || "type").toLowerCase();
    rows.sort((a, b) => {
      const A = a.it;
      const B = b.it;
      if (sortMode === "name") return String(displayName(A)).localeCompare(String(displayName(B)));
      if (sortMode === "value") return valueGold(B) - valueGold(A) || String(displayName(A)).localeCompare(String(displayName(B)));
      if (sortMode === "rarity") return rarityRank(B) - rarityRank(A) || valueGold(B) - valueGold(A);
      if (sortMode === "recent") return Number(B?.pickedAt || 0) - Number(A?.pickedAt || 0);
      // default: type
      return itemKind(A).localeCompare(itemKind(B)) || String(displayName(A)).localeCompare(String(displayName(B)));
    });

    const resolveSelectedRowPos = () => {
      const wanted = String(menuSelectedInvIid || "");
      if (wanted && hasFind) {
        const invIdx = findInventoryIndexById(wanted);
        if (invIdx >= 0) {
          const pos = rows.findIndex((r) => r.idx === invIdx);
          if (pos >= 0) return pos;
        }
      }
      const first = rows[0]?.it?.iid;
      if (first) menuSelectedInvIid = String(first);
      return rows.length ? 0 : -1;
    };
    const selPos = resolveSelectedRowPos();
    const selRow = selPos >= 0 ? rows[selPos] : null;
    const selItem = selRow?.it || null;
    const selInvIdx = Number.isFinite(selRow?.idx) ? selRow.idx : -1;

    const header = `<div class="inv-header">
      <div class="menu-status">Inventory: ${used}/${cap || "∞"}</div>
    </div>`;

    const filterRow = `<div class="inv-toolbar">
      <div class="inv-chip-row">
        ${[
          { id: "all", label: "All" },
          { id: "weapons", label: "Weapons" },
          { id: "consumables", label: "Consumables" },
          { id: "trinkets", label: "Trinkets" },
          { id: "materials", label: "Materials" },
          { id: "valuables", label: "Valuables" },
        ]
          .map(
            (x) =>
              `<button type="button" class="inv-pill ${String(menuInvFilter || "all") === x.id ? "is-active" : ""}" data-inv-filter="${escapeHtml(
                x.id,
              )}">${escapeHtml(x.label)}</button>`,
          )
          .join("")}
      </div>
      <div class="inv-chip-row" style="margin-top:8px;">
        <div style="opacity:0.8; align-self:center; margin-right:6px;">Sort</div>
        ${[
          { id: "type", label: "Type" },
          { id: "name", label: "Name" },
          { id: "value", label: "Value" },
          { id: "rarity", label: "Rarity" },
          { id: "recent", label: "New" },
        ]
          .map(
            (x) =>
              `<button type="button" class="inv-chip ${String(player?.inventorySort || "type") === x.id ? "is-active" : ""}" data-sort-inv="${escapeHtml(
                x.id,
              )}">${escapeHtml(x.label)}</button>`,
          )
          .join("")}
      </div>
    </div>`;

    if (!used) {
      content = `${header}${filterRow}<div class="menu-empty">Inventory empty (${used}/${cap || "∞"})</div>`;
    } else if (!rows.length) {
      content = `${header}${filterRow}<div class="menu-empty">No items match this filter.</div>`;
    } else {
      const gridHtml = `<div class="inv-grid">${rows
        .map(({ it, idx }) => {
          try {
            ensureItemId?.(it);
          } catch {
            // ignore
          }
          const iid = String(it?.iid || "");
          const active = selItem?.iid && iid && selItem.iid === iid;
          const sym = String(it?.symbol || "?");
          const q = Math.max(1, Math.floor(Number(it?.qty || 1)));
          const slots = hotbarSlotsFor(it);
          const badges = [];
          const rb = rarityBadge(it);
          if (rb) badges.push(`<span class="inv-badge inv-badge-rarity" aria-label="Rarity">${escapeHtml(rb)}</span>`);
          if (q > 1) badges.push(`<span class="inv-badge inv-badge-qty">x${q}</span>`);
          if (slots.length)
            badges.push(
              `<span class="inv-badge inv-badge-hotbar">${slots
                .map((s) => `#${s + 1}`)
                .join("")}</span>`,
            );
          if (isNewItem(it)) badges.push(`<span class="inv-badge inv-badge-new">New</span>`);

          return `<button type="button" class="inv-slot ${active ? "is-active" : ""}" data-select-inv="${escapeHtml(iid)}">
            <div class="inv-slot-icon" aria-hidden="true" style="color:${it?.color || "cyan"};${rarityOutlineCss(it)}">${escapeHtml(sym)}</div>
            <div class="inv-slot-main">
              <div class="inv-slot-name" style="color:${it?.color || "cyan"};${rarityOutlineCss(it)}">${escapeHtml(displayName(it))}</div>
              <div class="inv-slot-meta">${escapeHtml(metaLine(it))}</div>
            </div>
            <div class="inv-slot-badges">${badges.join("")}</div>
          </button>`;
        })
        .join("")}</div>`;

      const nearFire = typeof isPlayerNearCampfire === "function" ? isPlayerNearCampfire() : false;
      const canCook = !!(nearFire && selItem && effectId(selItem) === "food" && !selItem.cooked);

      const drawerOpen = !!(menuInvActionOpen && selItem);

      const primaryAction = (() => {
        if (!selItem || selInvIdx < 0) return null;
        const eff = effectId(selItem);
        if (eff === "weapon") return { label: "Equip (Main)", attr: `data-equip-main="${selInvIdx}"` };
        if (eff === "trinket") return { label: "Equip (A)", attr: `data-equip-trinket-a="${selInvIdx}"` };
        if (eff === "food") return { label: "Eat", attr: `data-use-item="${selInvIdx}"` };
        if (eff === "valuable") return null;
        if (eff === "material") return null;
        return { label: "Use", attr: `data-use-item="${selInvIdx}"` };
      })();

      const secondaryAction = (() => {
        if (!selItem || selInvIdx < 0) return null;
        const eff = effectId(selItem);
        if (eff === "weapon") return { label: "Equip (Off)", attr: `data-equip-off="${selInvIdx}"` };
        if (eff === "trinket") return { label: "Equip (B)", attr: `data-equip-trinket-b="${selInvIdx}"` };
        return null;
      })();

      const allowHotbarAssign = (() => {
        const k = itemKind(selItem);
        return k === "weapon" || k === "consumable" || k === "trinket";
      })();

      const actions = [];
      if (primaryAction) actions.push(`<button type="button" class="inv-action-btn" ${primaryAction.attr}>${escapeHtml(primaryAction.label)}</button>`);
      if (secondaryAction) actions.push(`<button type="button" class="inv-action-btn" ${secondaryAction.attr}>${escapeHtml(secondaryAction.label)}</button>`);
      if (canCook) actions.push(`<button type="button" class="inv-action-btn" data-cook-food="${selInvIdx}">Cook</button>`);
      if (allowHotbarAssign) actions.push(`<button type="button" class="inv-action-btn" data-open-assign-hotbar="1">Assign to hotbar</button>`);
      actions.push(`<button type="button" class="inv-action-btn is-danger" data-drop-item="${selInvIdx}">Drop</button>`);

      const assignSlots =
        drawerOpen && menuInvAssignOpen && allowHotbarAssign
          ? `<div class="inv-assign">
              <div class="inv-chip-row">${[0, 1, 2, 3]
                .map((s) => `<button type="button" class="inv-chip" data-assign-hotbar="${s}:${selInvIdx}">#${s + 1}</button>`)
                .join("")}</div>
            </div>`
          : "";

      const descLines = describeItemLines(selItem);
      const drawerHtml = drawerOpen
        ? `<div class="inv-drawer-layer">
            <button type="button" class="inv-drawer-backdrop" data-inv-drawer-close="1" aria-label="Close item"></button>
            <div class="inv-drawer" role="dialog" aria-modal="true" aria-label="Item actions">
              <div class="inv-drawer-top">
                <div class="inv-drawer-title" style="color:${selItem?.color || "cyan"};${rarityOutlineCss(selItem)}">${escapeHtml(
                  displayName(selItem),
                )}${escapeHtml(qtyLabel(selItem))}</div>
                <button type="button" class="inv-drawer-close" data-inv-drawer-close="1" aria-label="Close">✕</button>
              </div>
              <div class="inv-drawer-desc">
                ${descLines.map((l) => `<div>${escapeHtml(l)}</div>`).join("")}
              </div>
              <div class="inv-drawer-actions">
                ${actions.join("")}
              </div>
              ${assignSlots}
            </div>
          </div>`
        : "";

      content = `${header}${filterRow}<div class="inv-pane inv-pane-inventory">
        <div class="inv-section-title">Items</div>
        <div class="inv-grid-wrap">
          ${drawerHtml}
          ${gridHtml}
        </div>
      </div>`;
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
      .map((it, idx) => ({
        it,
        idx,
        sell: typeof getItemSellValue === "function" ? Math.max(0, Math.floor(Number(getItemSellValue(it) || 0))) : 0,
      }))
      .filter((x) => x.it);

    const sellTotal = sellables.reduce((a, v) => a + Math.max(0, Number(v.sell || 0)), 0);
    const sellRows = sellables
      .filter((v) => v.sell > 0)
      .sort((a, b) => b.sell - a.sell)
      .map(({ it, idx, sell }) => {
        return `<div class="shop-row">
          <div class="shop-row-main">
            <div class="shop-row-title" style="color:${it?.color || "#ffd700"};${rarityOutlineCss(it)}">${escapeHtml(it?.name || "Item")}</div>
            <div class="shop-row-sub">Sell value: <b>${sell}g</b></div>
          </div>
          <button type="button" class="shop-action" data-sell-item="${idx}">Sell</button>
        </div>`;
      })
      .join("");

    const upgradeRow = (kind, title, desc) => {
      const price = typeof getUpgradeCost === "function" ? Math.max(0, Number(getUpgradeCost(kind) || 0)) : 999999;
      const can = gold >= price;
      return `<div class="shop-row">
        <div class="shop-row-main">
          <div class="shop-row-title">${escapeHtml(title)}</div>
          <div class="shop-row-sub">${escapeHtml(desc)} • <b>${price}g</b></div>
        </div>
        <button type="button" class="shop-action ${can ? "" : "is-disabled"}" data-buy-upgrade="${escapeHtml(kind)}" ${can ? "" : "aria-disabled=\"true\""}>Buy</button>
      </div>`;
    };

    const upgradesHtml = [
      upgradeRow("weapon", `Weapon Upgrade (Lv ${Number(gear.weapon || 0)})`, "+1 damage"),
      upgradeRow("armor", `Armor Upgrade (Lv ${Number(gear.armor || 0)})`, "+1 toughness"),
      upgradeRow("pack", `Pack Upgrade (Lv ${Number(gear.pack || 0)})`, "+2 inventory slots"),
    ].join("");

    const potionItems = [
      ...POTIONS.slice(0, 3).map((p, i) => ({ ...p, price: 25 + i * 15, shopIndex: i })),
      ...POTIONS.slice(3).map((p, i) => ({ ...p, price: 70 + i * 20, shopIndex: i + 3 })),
    ];

    const potionDesc = (p) => {
      if (!p) return "";
      if (p.effect === "fullHeal") return "Heal +1 Max HP";
      if (p.effect === "damageBoost") return "+1 Damage";
      if (p.effect === "toughnessBoost") return "+1 Toughness";
      if (p.effect === "speed") return `Speed (${p.turns || 10} turns)`;
      if (p.effect === "invisibility") return `Invisible (${p.turns || 5} turns)`;
      if (p.effect === "explosive") return "AOE damage";
      return "";
    };

    const potionsHtml = potionItems
      .map((item) => {
        const can = gold >= Number(item.price || 0);
        const desc = potionDesc(item);
        return `<div class="shop-row">
          <div class="shop-row-main">
            <div class="shop-row-title" style="color:${item.color};">${escapeHtml(item.name)}</div>
            <div class="shop-row-sub">${escapeHtml(desc)} • <b>${Number(item.price || 0)}g</b></div>
          </div>
          <button type="button" class="shop-action ${can ? "" : "is-disabled"}" data-buy-item="${item.shopIndex}" ${can ? "" : "aria-disabled=\"true\""}>Buy</button>
        </div>`;
      })
      .join("");

    const sellAllBtn =
      sellTotal > 0
        ? `<button type="button" class="shop-primary" data-sell-all="1">Sell all valuables (+${sellTotal}g)</button>`
        : `<div class="shop-muted">No items to sell right now.</div>`;

    content = `<div class="shop-wrap">
      <div class="shop-header">
        <div class="shop-title">Shop</div>
        <div class="shop-subtitle">Gold: <b>${gold}</b></div>
      </div>

      <div class="shop-section">
        <div class="shop-section-title">Sell</div>
        ${sellAllBtn}
        ${sellRows ? `<div class="shop-rows">${sellRows}</div>` : ""}
      </div>

      <div class="shop-section">
        <div class="shop-section-title">Upgrades</div>
        <div class="shop-rows">${upgradesHtml}</div>
      </div>

      <div class="shop-section">
        <div class="shop-section-title">Consumables</div>
        <div class="shop-rows">${potionsHtml}</div>
      </div>
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
  } else if (activeTab === "shrine") {
    const cursedInv = (player.inventory || [])
      .map((it, idx) => ({ it, idx }))
      .filter(({ it }) => it && (it.cursed || it.curse));
    const cursedHands = [
      { ref: "hand:main", label: "Main hand", it: player?.hands?.main || null },
      { ref: "hand:off", label: "Off hand", it: player?.hands?.off || null },
    ].filter((x) => x.it && (x.it.cursed || x.it.curse));
    const cursedTrinkets = [
      { ref: "trinket:a", label: "Trinket A", it: player?.trinkets?.a || null },
      { ref: "trinket:b", label: "Trinket B", it: player?.trinkets?.b || null },
    ].filter((x) => x.it && (x.it.cursed || x.it.curse));

    const btn = (ref, label, it) =>
      `<button type="button" class="menu-button" data-cleanse-ref="${escapeHtml(ref)}" style="color:${it?.color || "cyan"};${rarityOutlineCss(it)}" title="Cleanse this curse (consumes the shrine)">
        Cleanse<br><small style="opacity:0.8;">${escapeHtml(label)}: ${escapeHtml(it?.name || "Item")}</small>
      </button>`;

    const blocks = [];
    if (cursedHands.length) blocks.push(`<div style="margin-top: 10px; opacity:0.9;">Equipped weapons:</div><div class="menu-inventory">${cursedHands.map((x) => btn(x.ref, x.label, x.it)).join("")}</div>`);
    if (cursedTrinkets.length) blocks.push(`<div style="margin-top: 10px; opacity:0.9;">Equipped trinkets:</div><div class="menu-inventory">${cursedTrinkets.map((x) => btn(x.ref, x.label, x.it)).join("")}</div>`);
    if (cursedInv.length) blocks.push(`<div style="margin-top: 10px; opacity:0.9;">Inventory:</div><div class="menu-inventory">${cursedInv.map(({ it, idx }) => btn(`inv:${idx}`, "Inventory", it)).join("")}</div>`);

    content = `<div class="menu-log" style="text-align:left;">
      <div class="log-line" style="color: var(--accent); font-weight: bold;">Shrine</div>
      <div class="log-line" style="opacity:0.9;">Cleanse <b>one</b> cursed item. The shrine will fade after use.</div>
      ${blocks.length ? blocks.join("") : `<div class="menu-empty">You have no cursed items.</div>`}
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
    const sections = [
      { id: "enemies", label: "Enemies", obj: c.enemies },
      { id: "items", label: "Items", obj: c.items },
      { id: "trinkets", label: "Trinkets", obj: c.trinkets },
      { id: "materials", label: "Materials", obj: c.materials },
      { id: "statuses", label: "Status", obj: c.statuses },
    ];
    const secId = (() => {
      const want = String(menuCodexSection || "items").toLowerCase();
      return sections.some((s) => s.id === want) ? want : "items";
    })();
    const sec = sections.find((s) => s.id === secId) || sections[1];

    const entriesRaw = Object.entries(sec?.obj || {})
      .map(([name, count]) => ({
        name: String(name || "").trim(),
        count: Math.max(0, Math.floor(Number(count || 0))),
      }))
      .filter((e) => e.name);

    const sortMode = String(menuCodexSort || "name").toLowerCase();
    entriesRaw.sort((a, b) => {
      if (sortMode === "count") return b.count - a.count || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });

    const resolveSelectedKey = () => {
      const wanted = String(menuCodexSelectedKey || "");
      if (wanted && entriesRaw.some((e) => e.name === wanted)) return wanted;
      const first = entriesRaw[0]?.name || "";
      if (first) menuCodexSelectedKey = first;
      return first;
    };
    const selectedKey = resolveSelectedKey();
    const selected = entriesRaw.find((e) => e.name === selectedKey) || null;

    const pill = (id, label) =>
      `<button type="button" class="codex-pill ${secId === id ? "is-active" : ""}" data-codex-section="${escapeHtml(id)}">${escapeHtml(
        label,
      )}</button>`;
    const sortBtn = (id, label) =>
      `<button type="button" class="codex-chip ${sortMode === id ? "is-active" : ""}" data-codex-sort="${escapeHtml(id)}">${escapeHtml(
        label,
      )}</button>`;

    const lookup = (kind, name) => {
      const nm = String(name || "").trim();
      if (!nm) return null;
      const k = String(kind || "").toLowerCase();

      if (k === "enemies") {
        const pool = [
          typeof RAT !== "undefined" ? RAT : null,
          typeof GOBLIN !== "undefined" ? GOBLIN : null,
          typeof BAT !== "undefined" ? BAT : null,
          typeof SKELETON !== "undefined" ? SKELETON : null,
          typeof ORC !== "undefined" ? ORC : null,
        ].filter(Boolean);
        return pool.find((e) => String(e?.name || "") === nm) || null;
      }

      const pools = [
        ...(Array.isArray(POTIONS) ? POTIONS : []),
        ...(Array.isArray(TRINKETS) ? TRINKETS : []),
        ...(Array.isArray(MATERIALS) ? MATERIALS : []),
        ...(Array.isArray(VALUABLES) ? VALUABLES : []),
        typeof RAT_MEAT !== "undefined" ? RAT_MEAT : null,
        typeof COOKED_RAT_MEAT !== "undefined" ? COOKED_RAT_MEAT : null,
        typeof MUSHROOM !== "undefined" ? MUSHROOM : null,
        typeof BERRY !== "undefined" ? BERRY : null,
      ].filter(Boolean);
      return pools.find((it) => String(it?.name || "") === nm) || null;
    };

    const listRow = (e) => {
      const active = selected && e.name === selected.name;
      const isSeenOnly = e.count <= 0;
      const isPickable = secId === "items" || secId === "trinkets" || secId === "materials";
      const badge = isPickable
        ? isSeenOnly
          ? `<span class="codex-badge is-seen">Seen</span>`
          : `<span class="codex-badge is-count">x${e.count}</span>`
        : `<span class="codex-badge is-seen">Seen</span>`;

      return `<button type="button" class="codex-row ${active ? "is-active" : ""} ${isSeenOnly ? "is-muted" : ""}" data-codex-select="${escapeHtml(
        e.name,
      )}">
        <div class="codex-row-main">
          <div class="codex-row-name">${escapeHtml(e.name)}</div>
          ${badge}
        </div>
      </button>`;
    };

    const listHtml =
      entriesRaw.length === 0
        ? `<div class="menu-empty">Nothing discovered here yet</div>`
        : `<div class="codex-list">${entriesRaw.map(listRow).join("")}</div>`;

    const detailsHtml = (() => {
      if (!selected) return `<div class="menu-empty">Select an entry</div>`;

      const def = lookup(secId, selected.name);
      const title = `<div class="codex-details-title">${escapeHtml(selected.name)}</div>`;
      const lines = [];

      const isPickable = secId === "items" || secId === "trinkets" || secId === "materials";
      if (isPickable) lines.push(selected.count > 0 ? `Picked up: ${selected.count}` : `Seen (not picked up yet)`);
      else lines.push("Discovered");

      if (def) {
        const eff = String(def?.effect || "").toLowerCase();
        if (secId === "enemies") {
          if (Number.isFinite(Number(def.hp))) lines.push(`HP: ${Number(def.hp)}`);
          if (Number.isFinite(Number(def.dmg))) lines.push(`Damage: ${Number(def.dmg)}`);
          if (Number.isFinite(Number(def.sight))) lines.push(`Sight: ${Number(def.sight)}`);
          if (Number.isFinite(Number(def.toughness))) lines.push(`Toughness: ${Number(def.toughness)}`);
        } else if (eff) {
          lines.push(`Type: ${eff}`);
          if (eff === "food") {
            lines.push(`Hunger: +${Number(def.hunger || 0)}`);
            if (Number(def.heal || 0)) lines.push(`Heal: +${Number(def.heal || 0)}`);
            if (def.cooked) lines.push("Cooked");
          } else if (eff === "material") {
            if (def.matId) lines.push(`Material: ${String(def.matId)}`);
          } else if (eff === "valuable") {
            if (Number.isFinite(Number(def.baseValue))) lines.push(`Base value: ${Number(def.baseValue)}g`);
          } else if (eff === "weapon") {
            if (Number.isFinite(Number(def.level))) lines.push(`Level: ${Number(def.level)}`);
            if (Number.isFinite(Number(def.maxDamage))) lines.push(`Damage: 0-${Number(def.maxDamage)}`);
          }
        }
        const desc = String(def?.desc || def?.description || "").trim();
        if (desc) lines.push(desc);
      } else {
        lines.push("No additional info yet.");
      }

      return `${title}<div class="codex-details-body">${lines.map((l) => `<div>${escapeHtml(l)}</div>`).join("")}</div>`;
    })();

    content = `<div class="codex-wrap">
      <div class="codex-header">
        <div class="codex-title">Codex</div>
        <div class="codex-subtitle">“Seen” entries are things you’ve noticed but haven’t picked up yet.</div>
        <div class="codex-pills">${sections.map((s) => pill(s.id, s.label)).join("")}</div>
        <div class="codex-tools">
          <div class="codex-tool-title">Sort</div>
          <div class="codex-chip-row">
            ${sortBtn("name", "Name")}
            ${sortBtn("count", secId === "items" || secId === "trinkets" || secId === "materials" ? "Picked" : "Seen")}
          </div>
        </div>
      </div>

      <div class="codex-layout">
        <div class="codex-pane">
          <div class="codex-pane-title">${escapeHtml(sec?.label || "Entries")}</div>
          ${listHtml}
        </div>
        <div class="codex-pane">
          <div class="codex-pane-title">Details</div>
          <div class="codex-details">${detailsHtml}</div>
        </div>
      </div>
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
        <div class="menu-tabs-left">
          ${tabBtn("inventory", "Inventory")}
          ${tabBtn("status", "Status")}
          ${tabBtn("codex", "Codex")}
          ${cookingAtCampfire ? tabBtn("cook", "Cook") : ""}
          ${atShop ? tabBtn("shop", "Shop") : ""}
          ${atBlacksmith ? tabBtn("blacksmith", "Blacksmith") : ""}
          ${atShrine ? tabBtn("shrine", "Shrine") : ""}
          ${atBountyBoard ? tabBtn("bounties", "Bounties") : ""}
          ${tabBtn("help", "Help")}
          ${tabBtn("settings", "Settings")}
          ${tabBtn("log", "Log")}
        </div>
        <div class="menu-tabs-right">
          ${actionBtn("walkout", "Walkout")}
          ${actionBtn("quit-to-menu", "Quit to Menu")}
          ${actionBtn("close-menu", "Close")}
        </div>
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
    // Clear sprite overlay while in menus.
    try {
      const layer = getSpriteLayerEl();
      if (layer && layer.innerHTML) layer.innerHTML = "";
    } catch {
      // ignore
    }
    return;
  }

  // Keep font sizing stable before we place sprite tiles.
  updateMapFontSize();

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
  // Terrain fallback colors when sprites are missing.
  const floorColor = "#777"; // stone gray
  const grassColor = "#1fbf3a"; // readable green
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
  const spriteCells = []; // { cx, cy, src, opacity }
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

  // Current cell coordinate in the visible grid (0..2R).
  let curCx = 0;
  let curCy = 0;

  const paint = (ch, style, opts = null) => {
    const glyph = String(ch || " ");
    const src = window.SpriteAtlas?.getReadySrcForGlyph?.(glyph) || "";
    if (src) {
      const dim = !!(opts && opts.dim);
      const opacity = dim ? 0.5 : 1;
      spriteCells.push({ cx: curCx, cy: curCy, src, opacity });
      // Hide the ASCII glyph when the sprite is present.
      pushCell(" ", null);
      return;
    }
    pushCell(glyph, style);
  };

  for (let y = -viewRadius; y <= viewRadius; y++) {
    for (let x = -viewRadius; x <= viewRadius; x++) {
      curCx = x + viewRadius;
      curCy = y + viewRadius;
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
          paint(" ", null);
          continue;
        }

        // Hidden hallway/room stays hidden as walls until revealed.
        const hiddenAsWall = hiddenArea && !hiddenArea.revealed && hiddenArea.tiles?.has(key);
        const ch = hiddenAsWall ? "#" : map[key] || "#";
        const t = ch === "#" ? "#" : ".";
        paint(t === "#" ? "#" : ".", `color:${t === "#" ? "lime" : floorColor};${dimCss}`, { dim: true });
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
          paint("#", `color:${color};${dimCss}`, { dim: true });
        } else {
          const ch = map[key] || "#";
          // Only terrain: walls and floors. Everything else renders as floor.
          const t = ch === "#" ? "#" : ".";
          paint(
            t === "#" ? "#" : ".",
            `color:${t === "#" ? "lime" : floorColor};${dimCss}`,
            { dim: true },
          );
        }
        continue;
      }

      if (tx === player.x && ty === player.y) {
        const extra = `${popCss}${getBurning(player)?.turns ? burningOutlineCss : ""}`;
        paint("@", `color:cyan;${extra}`);
      } else if (enemyByPos.has(key)) {
        const e = enemyByPos.get(key);
        const hitFlash = lastTarget && lastTarget.x === e.x && lastTarget.y === e.y && Date.now() - (lastTarget.time || 0) < 220;
        const flashCss = hitFlash ? "text-shadow: 0 0 6px rgba(255,255,255,0.9), 0 0 10px rgba(255,255,255,0.35);" : "";
        const extra = `${popCss}${getBurning(e)?.turns ? burningOutlineCss : ""}${flashCss}`;
        paint(e.symbol || "E", `color:${e.color || "red"};${extra}`);
      } else if (mouse && tx === mouse.x && ty === mouse.y) {
        paint("m", `color:#eee;${popCss}`);
      } else if (hiddenArea && !hiddenArea.revealed && hiddenArea.tiles?.has(key)) {
        // Hidden hallway/room are drawn as walls until revealed.
        const isFalseWall = hiddenArea.falseWalls?.has(key);
        const flash = isFalseWall && Date.now() < (hiddenArea.mouseFlashUntil || 0);
        const color = isFalseWall ? (flash ? (mouseWallPulseOn ? "#0a0" : "#070") : "#0a0") : "lime";
        paint("#", `color:${color};`);
      } else if (lootAtKey(key)) {
        const p = lootAtKey(key);
        const rid = String(p?.rarity || "");
        const rar = (Array.isArray(RARITIES) ? RARITIES.find((r) => r.id === rid) : null) || null;
        const outline = rar?.outline
          ? `text-shadow: -1px 0 ${rar.outline}, 1px 0 ${rar.outline}, 0 -1px ${rar.outline}, 0 1px ${rar.outline}, 0 0 6px ${rar.outline};`
          : "";
        paint(p.symbol, `color:${p.color || "cyan"};${popCss}${outline}`);
      } else if (propAtKey?.(key)) {
        const pr = propAtKey(key);
        const kind = String(pr?.kind || "");
        const ch = kind === "crate" ? TILE.CRATE : TILE.BARREL;
        const c = kind === "crate" ? "#c49a6c" : "#a86f3a";
        paint(ch, `color:${c};${popCss}text-shadow: 0 0 4px rgba(0,0,0,0.6);`);
      } else {
        const ch = tileAtKey(key);
        const trap = trapAtKey(key);
        if (trap) {
          if (trap.hidden) {
            // Hidden traps look like floor, but flash orange every few seconds.
            paint(".", `color:${hiddenFlashOn ? "orange" : floorColor};`);
          } else {
            paint("~", `color:${trap.color || "orange"};`);
          }
        } else if (ch === TILE.FLOOR) {
          // floor (optionally show auto-walk path preview)
          if (pathKeys.has(key)) paint(".", "color:#0ff;text-shadow: 0 0 4px rgba(0,255,255,0.35);");
          else paint(".", `color:${floorColor};`);
        } // floor
        else if (ch === TILE.GRASS) paint(",", `color:${grassColor};`); // grass
        else if (ch === TILE.TRAP_VISIBLE) paint("~", "color:orange;"); // fallback
        else if (ch === TILE.WALL) paint("#", "color:lime;"); // wall
        else if (ch === TILE.ENTRANCE) paint("D", `color:var(--accent);${popCss}`); // dungeon entrance
        else if (ch === TILE.UPSTAIRS) paint("U", `color:#8ff;${popCss}`); // exit upstairs
        else if (ch === TILE.SHRINE) paint("&", `color:#ff66ff;${popCss}text-shadow: 0 0 6px rgba(255,102,255,0.35);`); // shrine
        else if (ch === TILE.TRAPDOOR) {
          // Only show trapdoor if no enemy is on it
          if (!enemyByPos.has(key)) {
            paint("T", `color:#00ff3a;${popCss}`); // trapdoor
          } else {
            // Enemy is on trapdoor, show enemy instead
            const e = enemyByPos.get(key);
            const extra = `${popCss}${getBurning(e)?.turns ? burningOutlineCss : ""}`;
            const isBoss = e.symbol && e.symbol === e.symbol.toUpperCase() && e.symbol !== e.symbol.toLowerCase();
            const bossGlow = isBoss ? "text-shadow: 0 0 4px #ff0000, 0 0 8px #ff0000;" : "";
            paint(e.symbol || "E", `color:${e.color || "red"};${extra}${bossGlow}`);
          }
        } else if (ch === TILE.CAMPFIRE) paint("C", `color:orange;${popCss}`); // campfire
        else if (ch === TILE.SHOP) paint("$", `color:#ffd700;${popCss}`); // shop
        else if (ch === TILE.BLACKSMITH) paint("K", `color:#c49a6c;${popCss}text-shadow: 0 0 6px rgba(196,154,108,0.35);`); // blacksmith
        else if (ch === TILE.BOUNTY) paint("!", `color:var(--accent);${popCss}text-shadow: 0 0 6px rgba(0,255,255,0.35);`); // bounty board
        else paint(ch, "color:white;");
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

  // Recompute font size (in case viewport/zoom changed), then position sprites.
  updateMapFontSize();
  renderSpriteLayer(spriteCells, viewRadius);
}
