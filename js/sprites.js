/* ===================== SPRITES (optional PNG overlay) ===================== */
// This module lets the renderer replace ASCII glyphs with PNG sprites *incrementally*.
// Rule: if a sprite PNG is missing or fails to load, we fall back to ASCII automatically.

// Map from rendered glyph -> sprite URL.
// Add PNGs over time in /sprites and update these mappings as you go.
// Example: SPRITE_BY_GLYPH["."] = "sprites/floor.png"
window.SPRITE_BY_GLYPH = window.SPRITE_BY_GLYPH || {
  // Terrain
  // ".": "sprites/floor.png",
  // "#": "sprites/wall.png",
  // ",": "sprites/grass.png",

  // Player / enemies
  // "@": "sprites/player.png",
  // "r": "sprites/rat.png",
  // "g": "sprites/goblin.png",
  // "b": "sprites/bat.png",
  // "s": "sprites/skeleton.png",
  // "o": "sprites/orc.png",

  // Interactables
  // "T": "sprites/trapdoor.png",
  // "C": "sprites/campfire.png",
  // "$": "sprites/shop.png",
  // "K": "sprites/blacksmith.png",
  // "&": "sprites/shrine.png",
  // "!": "sprites/bounty.png",
  // "D": "sprites/entrance.png",
  // "U": "sprites/upstairs.png",

  // Loot glyphs (keep it simple: one sprite per glyph at first)
  // "P": "sprites/potion.png",
  // "*": "sprites/valuable.png",
  // "/": "sprites/sword.png",
  // "t": "sprites/trinket.png",
  // "m": "sprites/material.png",
  // "M": "sprites/meat.png",
  // "f": "sprites/mushroom.png",
  // "y": "sprites/berry.png",
};

window.SpriteAtlas = (() => {
  const stateBySrc = new Map(); // src -> { img, loaded, error }

  function _ensure(src) {
    if (!src) return null;
    const existing = stateBySrc.get(src);
    if (existing) return existing;

    const st = { img: null, loaded: false, error: false };
    const img = new Image();
    st.img = img;

    img.onload = () => {
      st.loaded = true;
      st.error = false;
    };
    img.onerror = () => {
      st.loaded = false;
      st.error = true;
    };

    // Trigger fetch. If it 404s, onerror will keep us in ASCII fallback.
    img.src = src;

    stateBySrc.set(src, st);
    return st;
  }

  function preloadAll() {
    try {
      const map = window.SPRITE_BY_GLYPH || {};
      for (const src of Object.values(map)) _ensure(String(src || ""));
    } catch {
      // ignore
    }
  }

  function getSrcForGlyph(glyph) {
    const g = String(glyph || "");
    const map = window.SPRITE_BY_GLYPH || {};
    const src = map[g];
    return src ? String(src) : "";
  }

  function isReadyForGlyph(glyph) {
    const src = getSrcForGlyph(glyph);
    if (!src) return false;
    const st = _ensure(src);
    return !!(st && st.loaded && !st.error);
  }

  function getReadySrcForGlyph(glyph) {
    const src = getSrcForGlyph(glyph);
    if (!src) return "";
    const st = _ensure(src);
    if (!st || !st.loaded || st.error) return "";
    return src;
  }

  // Expose a tiny API.
  return {
    preloadAll,
    isReadyForGlyph,
    getReadySrcForGlyph,
  };
})();

// Best-effort preload once the page is ready.
try {
  window.addEventListener("load", () => {
    window.SpriteAtlas?.preloadAll?.();
  });
} catch {
  // ignore
}

