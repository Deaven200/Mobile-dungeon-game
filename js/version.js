// Single source of truth for the game version.
// Format: MAJOR.MINOR.PATCH[.PATCH...]
// - MAJOR: stable “working game as-is” milestone
// - MINOR: new features
// - PATCH: fixes (can extend: 1.021, 1.0211, etc.)
const GAME_VERSION = "1.063";
window.GAME_VERSION = GAME_VERSION;
