/* ===================== INPUTS ===================== */

function bindInputs() {
  if (controlsEl) {
    // Use pointerdown for snappy mobile controls.
    controlsEl.addEventListener("pointerdown", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;

      e.preventDefault();

      const action = btn.dataset.action;
      if (action === "menu") {
        if (inMainMenu) return;
        toggleMenu();
        return;
      }
      if (action === "investigate") {
        if (menuOpen || gamePaused || inMainMenu) return;
        setInvestigateArmed(!investigateArmed);
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

      if (investigateArmed) {
        e.preventDefault();
        setInvestigateArmed(false);
        investigateAt(tx, ty);
        return;
      }

      startAutoMoveTo(tx, ty);
    });

    mapContainerEl.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "touch") return;
      if (!touchPointers.has(e.pointerId)) return;

      touchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

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

      if (btn.dataset.tab) {
        setTab(btn.dataset.tab);
        return;
      }

      if (btn.dataset.usePotion != null) {
        usePotion(Number(btn.dataset.usePotion));
        return;
      }

      if (btn.dataset.cookFood != null) {
        cookFood(Number(btn.dataset.cookFood));
        return;
      }

      if (btn.dataset.buyItem != null) {
        buyShopItem(Number(btn.dataset.buyItem));
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
    }
  });
}
