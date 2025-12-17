/* ===================== INPUTS ===================== */

function bindInputs() {
  const waitHold = { timeoutId: null, intervalId: null, pointerId: null, btn: null };
  const mapPress = { pointerId: null, tx: null, ty: null, timeoutId: null, fired: false, startX: 0, startY: 0 };

  const stopWaitHold = () => {
    if (waitHold.timeoutId) window.clearTimeout(waitHold.timeoutId);
    if (waitHold.intervalId) window.clearInterval(waitHold.intervalId);
    waitHold.timeoutId = null;
    waitHold.intervalId = null;
    waitHold.pointerId = null;
    if (waitHold.btn) waitHold.btn.classList.remove("is-holding");
    waitHold.btn = null;
  };

  // Make sure a hold can't get "stuck" (release outside button, tab switch, etc.).
  window.addEventListener("pointerup", (e) => {
    if (waitHold.pointerId != null && e.pointerId === waitHold.pointerId) stopWaitHold();
  });
  window.addEventListener("pointercancel", (e) => {
    if (waitHold.pointerId != null && e.pointerId === waitHold.pointerId) stopWaitHold();
  });
  window.addEventListener("blur", stopWaitHold);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopWaitHold();
  });

  if (controlsEl) {
    // Use pointerdown for snappy mobile controls.
    controlsEl.addEventListener("pointerdown", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;

      e.preventDefault();

      if (btn.dataset.hotbarUse != null) {
        if (menuOpen || gamePaused || inMainMenu) return;
        useHotbarSlot(Number(btn.dataset.hotbarUse));
        return;
      }

      const action = btn.dataset.action;
      if (action === "menu") {
        stopWaitHold();
        if (inMainMenu) return;
        playSound?.("menu");
        toggleMenu();
        return;
      }
      if (action === "investigate") {
        stopWaitHold();
        if (menuOpen || gamePaused || inMainMenu) return;
        setInvestigateArmed(!investigateArmed);
        return;
      }
      if (action === "wait") {
        if (menuOpen || gamePaused || inMainMenu) return;
        if (investigateArmed) setInvestigateArmed(false);
        stopWaitHold();

        // Capture the pointer so releasing outside the button still stops the hold.
        try {
          btn.setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }

        btn.classList.add("is-holding");
        waitHold.pointerId = e.pointerId;
        waitHold.btn = btn;

        // One turn immediately.
        waitTurn();

        // If still valid, start repeating after a short delay.
        waitHold.timeoutId = window.setTimeout(() => {
          if (menuOpen || gamePaused || inMainMenu) {
            stopWaitHold();
            return;
          }
          waitHold.intervalId = window.setInterval(() => {
            if (menuOpen || gamePaused || inMainMenu) {
              stopWaitHold();
              return;
            }
            waitTurn();
          }, 300);
        }, 300);
        return;
      }
    });
  }

  // Tap-to-move on the map: tap a tile to auto-walk to it (step-by-step).
  if (mapContainerEl) {
    mapContainerEl.addEventListener("pointerdown", (e) => {
      if (menuOpen || gamePaused || inMainMenu) return;
      // Don't treat button taps as movement (menu button lives outside, but be safe).
      if (e.target.closest("button")) return;

      // Pinch zoom (touch): track pointers and, when 2 fingers are down, zoom instead of moving.
      if (e.pointerType === "touch") {
        touchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        try {
          mapContainerEl.setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }

        if (touchPointers.size >= 2) {
          pinch.active = true;
          const pts = getTwoTouchPoints();
          pinch.startDist = pts ? Math.max(1, touchDist(pts[0], pts[1])) : 1;
          pinch.startZoom = zoomScale;
          stopAutoMove(); // cancel any tap-to-move started by the first finger
          if (investigateArmed) setInvestigateArmed(false);
          e.preventDefault();
          return;
        }
      }

      if (pinch.active) return;

      e.preventDefault();

      const viewRadius = getViewRadius();
      const cols = viewRadius * 2 + 1;
      const rows = viewRadius * 2 + 1;
      const gRect = gameEl?.getBoundingClientRect?.();
      if (!gRect) return;

      const inGrid =
        e.clientX >= gRect.left && e.clientX <= gRect.right && e.clientY >= gRect.top && e.clientY <= gRect.bottom;
      if (!inGrid) return;

      const fontPx = Number.parseFloat(window.getComputedStyle(gameEl).fontSize || "16");
      const { unitW, unitH } = getMonoCellMetricsPx(120);
      const cellW = unitW * fontPx;
      const cellH = unitH * fontPx;
      if (!cellW || !cellH) return;

      const col = Math.floor((e.clientX - gRect.left) / cellW);
      const row = Math.floor((e.clientY - gRect.top) / cellH);
      if (col < 0 || col >= cols || row < 0 || row >= rows) return;

      const tx = player.x + (col - viewRadius);
      const ty = player.y + (row - viewRadius);
      const tappedKey = keyOf(tx, ty);
      const tappedTile = map[tappedKey] || "#";

      // Campfire: tap to open cooking menu when adjacent/on it.
      if (tappedTile === "C") {
        const d = chebDist(player.x, player.y, tx, ty);
        if (d <= 1) {
          openCampfireMenu();
          return;
        }
        // If it's far, keep normal behavior: walk to it.
      }
      
      // Shop: tap to open shop menu when adjacent/on it.
      if (tappedTile === "$") {
        const d = chebDist(player.x, player.y, tx, ty);
        if (d <= 1) {
          openShopMenu();
          return;
        }
      }
      
      // Blacksmith
      if (tappedTile === "K") {
        const d = chebDist(player.x, player.y, tx, ty);
        if (d <= 1) {
          openBlacksmithMenu();
          return;
        }
      }
      
      // Shrine
      if (tappedTile === TILE.SHRINE) {
        const d = chebDist(player.x, player.y, tx, ty);
        if (d <= 1) {
          openShrineMenuAt?.(tx, ty);
          return;
        }
      }

      // Bounty board
      if (tappedTile === "!") {
        const d = chebDist(player.x, player.y, tx, ty);
        if (d <= 1) {
          openBountyBoardMenu();
          return;
        }
      }

      // Courtyard entrance / dungeon exit: tapping adjacent can trigger the prompt
      // (same UX as shop/campfire).
      if (tappedTile === "D") {
        const d = chebDist(player.x, player.y, tx, ty);
        if (d <= 1 && floor === 0) {
          showEnterDungeonPrompt();
          return;
        }
      }
      if (tappedTile === "U") {
        const d = chebDist(player.x, player.y, tx, ty);
        if (d <= 1 && floor > 0) {
          showExitToCourtyardPrompt();
          return;
        }
      }

      if (investigateArmed) {
        e.preventDefault();
        setInvestigateArmed(false);
        investigateAt(tx, ty);
        return;
      }

      // Long-press (touch) to Investigate without arming.
      if (e.pointerType === "touch") {
        // Clear any prior press.
        if (mapPress.timeoutId) window.clearTimeout(mapPress.timeoutId);
        mapPress.pointerId = e.pointerId;
        mapPress.tx = tx;
        mapPress.ty = ty;
        mapPress.fired = false;
        mapPress.startX = e.clientX;
        mapPress.startY = e.clientY;
        mapPress.timeoutId = window.setTimeout(() => {
          if (menuOpen || gamePaused || inMainMenu) return;
          if (pinch.active) return;
          // If finger drifted a lot, don't treat as long-press.
          const cur = touchPointers.get(e.pointerId);
          const cx = cur?.x ?? mapPress.startX;
          const cy = cur?.y ?? mapPress.startY;
          if (Math.hypot(cx - mapPress.startX, cy - mapPress.startY) > 12) return;
          mapPress.fired = true;
          investigateAt(mapPress.tx, mapPress.ty);
        }, 450);
        return;
      }

      // Mouse / pen: immediate.
      startAutoMoveTo(tx, ty);
    });

    mapContainerEl.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "touch") return;
      if (!touchPointers.has(e.pointerId)) return;

      touchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // Cancel long-press investigate if finger drifts.
      if (mapPress.pointerId === e.pointerId && mapPress.timeoutId && !mapPress.fired) {
        if (Math.hypot(e.clientX - mapPress.startX, e.clientY - mapPress.startY) > 12) {
          window.clearTimeout(mapPress.timeoutId);
          mapPress.timeoutId = null;
        }
      }

      if (touchPointers.size !== 2) return;
      if (!pinch.active) {
        pinch.active = true;
        const pts = getTwoTouchPoints();
        pinch.startDist = pts ? Math.max(1, touchDist(pts[0], pts[1])) : 1;
        pinch.startZoom = zoomScale;
      }

      const pts = getTwoTouchPoints();
      if (!pts) return;

      const dist = Math.max(1, touchDist(pts[0], pts[1]));
      const minZoom = MIN_VIEW_RADIUS / BASE_VIEW_RADIUS;
      const maxZoom = MAX_VIEW_RADIUS / BASE_VIEW_RADIUS;
      // Invert pinch behavior: pinch OUT => zoom IN (show fewer tiles), pinch IN => zoom OUT.
      zoomScale = clamp(pinch.startZoom * (pinch.startDist / dist), minZoom, maxZoom);
      draw();
      e.preventDefault();
    });

    const endTouch = (e) => {
      if (e.pointerType !== "touch") return;

      // If this touch was a tap and long-press didn't fire, treat as tap-to-move on release.
      if (mapPress.pointerId === e.pointerId) {
        if (mapPress.timeoutId) window.clearTimeout(mapPress.timeoutId);
        const fired = !!mapPress.fired;
        const tx = mapPress.tx;
        const ty = mapPress.ty;
        mapPress.pointerId = null;
        mapPress.tx = null;
        mapPress.ty = null;
        mapPress.timeoutId = null;
        mapPress.fired = false;
        if (!fired && Number.isFinite(tx) && Number.isFinite(ty) && !pinch.active) {
          startAutoMoveTo(tx, ty);
        }
      }

      touchPointers.delete(e.pointerId);
      if (touchPointers.size < 2) pinch.active = false;
    };

    mapContainerEl.addEventListener("pointerup", endTouch);
    mapContainerEl.addEventListener("pointercancel", endTouch);
  }

  if (gameEl) {
    // Menu click handling via event delegation.
    gameEl.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      if (!menuOpen) return;

      // Inventory UI: filter + selection (kept lightweight; draw() re-renders).
      if (btn.dataset.invFilter != null) {
        menuInvFilter = String(btn.dataset.invFilter || "all");
        // If the selected item is not in the new filter, render() will auto-pick.
        playSound?.("menu");
        draw();
        return;
      }
      if (btn.dataset.selectInv != null) {
        const iid = String(btn.dataset.selectInv || "");
        const same = String(menuSelectedInvIid || "") === iid;
        menuSelectedInvIid = iid;
        // Toggle overlay if you tap the same item; otherwise open it.
        menuInvActionOpen = same ? !menuInvActionOpen : true;
        if (!menuInvActionOpen) menuInvAssignOpen = false;
        else menuInvAssignOpen = false;
        playSound?.("menu");
        draw();
        return;
      }
      if (btn.dataset.invOverlayClose != null) {
        menuInvActionOpen = false;
        menuInvAssignOpen = false;
        playSound?.("menu");
        draw();
        return;
      }
      if (btn.dataset.codexSection != null) {
        menuCodexSection = String(btn.dataset.codexSection || "items");
        // Reset selection when switching sections; draw() will auto-pick.
        menuCodexSelectedKey = null;
        playSound?.("menu");
        draw();
        return;
      }
      if (btn.dataset.codexSort != null) {
        menuCodexSort = String(btn.dataset.codexSort || "name");
        playSound?.("menu");
        draw();
        return;
      }
      if (btn.dataset.codexSelect != null) {
        menuCodexSelectedKey = String(btn.dataset.codexSelect || "");
        playSound?.("menu");
        draw();
        return;
      }

      if (btn.dataset.action === "close-menu") {
        toggleMenu();
        return;
      }

      if (btn.dataset.action === "quit-to-menu") {
        quitToMenu();
        return;
      }

      if (btn.dataset.action === "save-game") {
        saveGame();
        draw();
        return;
      }
      
      if (btn.dataset.action === "walkout") {
        startWalkout();
        return;
      }

      if (btn.dataset.tab) {
        setTab(btn.dataset.tab);
        return;
      }

      if (btn.dataset.useItem != null) {
        menuInvActionOpen = false;
        menuInvAssignOpen = false;
        useInventoryItem(Number(btn.dataset.useItem));
        return;
      }

      if (btn.dataset.dropItem != null) {
        menuInvActionOpen = false;
        menuInvAssignOpen = false;
        dropInventoryItem?.(Number(btn.dataset.dropItem));
        return;
      }

      if (btn.dataset.openAssignHotbar != null) {
        // Overlay stays open; this only toggles the submenu inside it.
        menuInvAssignOpen = !menuInvAssignOpen;
        playSound?.("menu");
        draw();
        return;
      }

      if (btn.dataset.cookFood != null) {
        menuInvActionOpen = false;
        menuInvAssignOpen = false;
        cookFood(Number(btn.dataset.cookFood));
        return;
      }

      if (btn.dataset.sellAll != null) {
        sellAllValuables();
        return;
      }

      if (btn.dataset.sellItem != null) {
        sellInventoryItem(Number(btn.dataset.sellItem));
        return;
      }

      if (btn.dataset.buyUpgrade != null) {
        buyUpgrade(btn.dataset.buyUpgrade);
        return;
      }

      if (btn.dataset.equipMain != null) {
        equipToHand("main", Number(btn.dataset.equipMain));
        return;
      }
      if (btn.dataset.equipOff != null) {
        equipToHand("off", Number(btn.dataset.equipOff));
        return;
      }

      if (btn.dataset.unequipHand != null) {
        unequipHand(btn.dataset.unequipHand);
        return;
      }

      if (btn.dataset.buyItem != null) {
        buyShopItem(Number(btn.dataset.buyItem));
        return;
      }

      if (btn.dataset.sortInv != null) {
        setInventorySort(btn.dataset.sortInv);
        return;
      }

      if (btn.dataset.clearHotbar != null) {
        clearHotbarSlot(Number(btn.dataset.clearHotbar));
        return;
      }

      if (btn.dataset.assignHotbar != null) {
        const parts = String(btn.dataset.assignHotbar).split(":");
        const slot = Number(parts[0]);
        const idx = Number(parts[1]);
        menuInvAssignOpen = false;
        menuInvActionOpen = false;
        assignHotbarSlot(slot, idx);
        return;
      }

      if (btn.dataset.equipTrinketA != null) {
        equipTrinketToSlot?.("a", Number(btn.dataset.equipTrinketA));
        return;
      }
      if (btn.dataset.equipTrinketB != null) {
        equipTrinketToSlot?.("b", Number(btn.dataset.equipTrinketB));
        return;
      }
      if (btn.dataset.unequipTrinket != null) {
        unequipTrinket?.(btn.dataset.unequipTrinket);
        return;
      }
      if (btn.dataset.blacksmithUpgrade != null) {
        blacksmithUpgrade?.();
        return;
      }
      if (btn.dataset.cleanseRef != null) {
        cleanseCurseByRef?.(btn.dataset.cleanseRef);
        return;
      }
      if (btn.dataset.bountyAccept != null) {
        acceptBounty?.(btn.dataset.bountyAccept);
        return;
      }
      if (btn.dataset.bountyClaim != null) {
        claimBounty?.(btn.dataset.bountyClaim);
        return;
      }

      if (btn.dataset.diffPreset != null) {
        applyDifficultyPreset(btn.dataset.diffPreset);
        try {
          localStorage.setItem("dungeonGameSettings", JSON.stringify(settings));
        } catch {
          // ignore
        }
        draw();
        return;
      }

    });

    // Settings toggles in the in-game menu are <input type="checkbox"> elements.
    gameEl.addEventListener("change", (e) => {
      if (!menuOpen) return;
      const input = e.target.closest?.("input[data-setting]");
      if (!input) return;
      const key = input.dataset.setting;
      if (!key) return;

      settings[key] = !!input.checked;
      window.gameSettings = settings; // Update global reference
      try {
        localStorage.setItem("dungeonGameSettings", JSON.stringify(settings));
      } catch {
        // ignore
      }

      // Apply accessibility changes immediately.
      window.applyAccessibilitySettings?.();

      if (settings.autoSave && key !== "autoSave") {
        setTimeout(() => saveGame("Auto-save"), 100);
      }
      draw();
    });
  }

  window.addEventListener("resize", () => updateMapFontSize());
  
  // Keyboard shortcuts (for desktop testing)
  window.addEventListener("keydown", (e) => {
    if (inMainMenu) return;
    if (menuOpen && e.key === "Escape") {
      toggleMenu();
      e.preventDefault();
      return;
    }
    if (gamePaused || menuOpen) return;
    
    // Arrow keys / WASD for movement
    if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
      stopAutoMove();
      move(0, -1);
      e.preventDefault();
    } else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
      stopAutoMove();
      move(0, 1);
      e.preventDefault();
    } else if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
      stopAutoMove();
      move(-1, 0);
      e.preventDefault();
    } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
      stopAutoMove();
      move(1, 0);
      e.preventDefault();
    } else if (e.key === "q" || e.key === "Q" || e.key === "e" || e.key === "E") {
      // Diagonal movement
      stopAutoMove();
      if (e.key === "q" || e.key === "Q") move(-1, -1);
      else move(1, -1);
      e.preventDefault();
    } else if (e.key === "z" || e.key === "Z" || e.key === "c" || e.key === "C") {
      stopAutoMove();
      if (e.key === "z" || e.key === "Z") move(-1, 1);
      else move(1, 1);
      e.preventDefault();
    } else if (e.key === "i" || e.key === "I") {
      toggleMenu();
      setTab("inventory");
      e.preventDefault();
    } else if (e.key === "m" || e.key === "M") {
      toggleMenu();
      e.preventDefault();
    } else if (e.key === "Escape") {
      stopAutoMove();
      e.preventDefault();
    } else if (e.key === "1" || e.key === "2" || e.key === "3" || e.key === "4") {
      stopAutoMove();
      useHotbarSlot(Number(e.key) - 1);
      e.preventDefault();
    }
  });
}
