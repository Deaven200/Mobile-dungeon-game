/* ===================== SPRITES (optional PNG overlay) ===================== */
// This module lets the renderer replace ASCII glyphs with PNG sprites *incrementally*.
// Rule: if a sprite PNG is missing or fails to load, we fall back to ASCII automatically.

// Conventions-first:
// Put PNGs in /sprites and name them like:
// - sprites/floor.png, sprites/wall.png, sprites/grass.png
// - sprites/player.png
// - sprites/rat.png, sprites/goblin.png, sprites/bat.png, sprites/skeleton.png, sprites/orc.png
// - sprites/trap.png, sprites/trapdoor.png
// - sprites/campfire.png, sprites/shop.png, sprites/blacksmith.png, sprites/shrine.png, sprites/bounty.png
// - sprites/entrance.png, sprites/upstairs.png
// - sprites/potion.png, sprites/valuable.png, sprites/sword.png, sprites/trinket.png, sprites/material.png
// - sprites/meat.png, sprites/mushroom.png, sprites/berry.png
// - sprites/crate.png, sprites/barrel.png
//
// Optional override map (glyph -> URL). If present, it wins over conventions.
window.SPRITE_BY_GLYPH = window.SPRITE_BY_GLYPH || {};
// Optional: change the base folder. Default is "sprites".
window.SPRITE_BASE_PATH = window.SPRITE_BASE_PATH || "sprites";

function _spritePath(filename) {
  const base = String(window.SPRITE_BASE_PATH || "sprites").replace(/\/+$/, "");
  const fn = String(filename || "").replace(/^\/+/, "");
  return fn ? `${base}/${fn}` : "";
}

function defaultSpriteSrcForGlyph(glyph) {
  const g = String(glyph || "");

  // Terrain
  // Stone dungeon floor
  if (g === ".") return _spritePath("stonefloor.png");
  if (g === "#") return _spritePath("wall.png");
  if (g === ",") return _spritePath("grass.png");

  // Player
  if (g === "@") return _spritePath("player.png");

  // Enemies (bosses use uppercase symbols; if you don't author boss sprites, they'll just fall back to ASCII)
  if (g === "r") return _spritePath("rat.png");
  if (g === "g") return _spritePath("goblin.png");
  if (g === "b") return _spritePath("bat.png");
  if (g === "s") return _spritePath("skeleton.png");
  if (g === "o") return _spritePath("orc.png");
  if (g === "R") return _spritePath("boss_rat.png");
  if (g === "G") return _spritePath("boss_goblin.png");
  if (g === "B") return _spritePath("boss_bat.png");
  if (g === "S") return _spritePath("boss_skeleton.png");
  if (g === "O") return _spritePath("boss_orc.png");

  // Traps
  if (g === "~") return _spritePath("trap.png");
  if (g === "T") return _spritePath("trapdoor.png");

  // Interactables / POIs
  if (g === "C") return _spritePath("campfire.png");
  if (g === "$") return _spritePath("shop.png");
  if (g === "K") return _spritePath("blacksmith.png");
  if (g === "&") return _spritePath("shrine.png");
  if (g === "!") return _spritePath("bounty.png");
  if (g === "D") return _spritePath("entrance.png");
  if (g === "U") return _spritePath("upstairs.png");

  // Loot-ish glyphs (one sprite per glyph keeps it simple at first)
  if (g === "P") return _spritePath("potion.png");
  if (g === "*") return _spritePath("valuable.png");
  if (g === "/") return _spritePath("sword.png");
  if (g === "t") return _spritePath("trinket.png");
  if (g === "m") return _spritePath("material.png");
  if (g === "M") return _spritePath("meat.png");
  if (g === "f") return _spritePath("mushroom.png");
  if (g === "y") return _spritePath("berry.png");

  // Props
  if (g === "X") return _spritePath("crate.png");
  if (g === "O") return _spritePath("barrel.png");

  // No default sprite for this glyph.
  return "";
}

window.SpriteAtlas = (() => {
  const stateBySrc = new Map(); // src -> { img, loaded, error }
  const glyphState = new Map(); // glyph -> { chosenSrc: string, exhausted: bool, candidates: string[], idx: number }

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

  function _capitalize(s) {
    const str = String(s || "");
    if (!str) return "";
    return str[0].toUpperCase() + str.slice(1);
  }

  function _candidateSrcsForGlyph(glyph) {
    const g = String(glyph || "");
    // Explicit overrides win (and should be exact paths).
    const map = window.SPRITE_BY_GLYPH || {};
    if (map[g]) return [String(map[g])];

    const src = defaultSpriteSrcForGlyph(g);
    if (!src) return [];

    // If the default src isn't inside SPRITE_BASE_PATH, just try it as-is.
    const base = String(window.SPRITE_BASE_PATH || "sprites").replace(/\/+$/, "");
    if (!src.startsWith(`${base}/`)) return [src];

    // Convention-based sprites: tolerate common casing differences on Linux.
    // Example: sprites/grass.png should also accept sprites/Grass.png, sprites/GRASS.png, and PNG extension casing.
    const rel = src.slice(base.length + 1); // strip "sprites/"
    const m = rel.match(/^(.+)\.(png)$/i);
    if (!m) return [src];
    const name = m[1];

    const nameVariants = Array.from(
      new Set([name, _capitalize(name), name.toUpperCase()]),
    );
    const extVariants = ["png", "PNG"];

    const out = [];
    for (const nv of nameVariants) {
      for (const ev of extVariants) out.push(`${base}/${nv}.${ev}`);
    }
    return out;
  }

  function _getGlyphState(glyph) {
    const g = String(glyph || "");
    const existing = glyphState.get(g);
    if (existing) return existing;
    const st = { chosenSrc: "", exhausted: false, candidates: _candidateSrcsForGlyph(g), idx: 0 };
    glyphState.set(g, st);
    return st;
  }

  function preloadAll() {
    try {
      const map = window.SPRITE_BY_GLYPH || {};
      // Only preload explicit overrides (avoid spamming 404s). Convention sprites will load lazily.
      for (const src of Object.values(map)) _ensure(String(src || ""));
    } catch {
      // ignore
    }
  }

  function isReadyForGlyph(glyph) {
    return !!getReadySrcForGlyph(glyph);
  }

  function getReadySrcForGlyph(glyph) {
    const gs = _getGlyphState(glyph);
    if (gs.exhausted) return "";
    if (gs.chosenSrc) {
      const chosen = _ensure(gs.chosenSrc);
      return chosen && chosen.loaded && !chosen.error ? gs.chosenSrc : "";
    }

    // Walk candidate list. Only advance on *known* errors.
    while (gs.idx < gs.candidates.length) {
      const src = gs.candidates[gs.idx];
      const st = _ensure(src);
      if (!st) {
        gs.idx += 1;
        continue;
      }
      if (st.loaded && !st.error) {
        gs.chosenSrc = src;
        return src;
      }
      if (st.error) {
        gs.idx += 1;
        continue;
      }
      // Still loading.
      return "";
    }

    gs.exhausted = true;
    return "";
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

