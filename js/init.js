function vibrate(pattern) {
  if (!settings?.haptics) return;
  const vib = navigator?.vibrate;
  if (typeof vib !== "function") return;
  try {
    vib(pattern);
  } catch {
    // ignore
  }
}

document.addEventListener('DOMContentLoaded', () => {
  /* ===================== INIT ===================== */
  
  
  
  // Load settings from localStorage
  try {
    const savedSettings = localStorage.getItem("dungeonGameSettings");
    if (savedSettings) {
      settings = { ...settings, ...JSON.parse(savedSettings) };
    }
  } catch (e) {
    // Use defaults
  }
  
  // Initialize RNG so gameplay logic is deterministic and safe before starting.
  seedRng(createSeed());
  
  // Expose settings globally for investigation descriptions
  window.gameSettings = settings;
  
  try {
    bindInputs();
    initMainMenu(); // Initialize main menu
    
    // Set initial display state
    const mapContainerEl = document.getElementById("mapContainer");
    const controlsEl = document.getElementById("controls");
    if (mapContainerEl) mapContainerEl.style.display = "none";
    if (controlsEl) controlsEl.style.display = "none";
  
    // Redraw periodically only when timed visual effects are active (saves battery on mobile).
    window.setInterval(() => {
      if (menuOpen || inMainMenu) return;
      const mouseHintActive = !!(hiddenArea && !hiddenArea.revealed && (hiddenArea.mouseFlashUntil || 0) > Date.now());
      if (hiddenTrapCount > 0 || mouseHintActive) draw();
    }, 250);
  } catch (error) {
    console.error("Game initialization error:", error);
    if (gameEl) gameEl.innerHTML = `<div style="color: red; padding: 20px;">Error: ${error.message}<br>Check console for details.</div>`;
  }
  
});
