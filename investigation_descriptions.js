/* Investigation descriptions live here so script.js stays lean. */

(() => {
  "use strict";

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  const TEXTS = {
    player: [
      "You. The hero. The menace. The one clicking things.",
      "That’s you. Try not to step on anything pointy.",
      "Player character detected. Confidence: dangerously high.",
    ],

    floor: [
      "Floor. Reliable. Unambitious. Walkable.",
      "Just a floor tile. It’s doing its best.",
      "A perfectly normal floor. Which is exactly what it wants you to think.",
    ],

    wall: [
      "A wall. It has one job, and it’s nailing it.",
      "Wall. Emotionally unavailable and physically immovable.",
      "Yep, that’s a wall. No, you can’t negotiate with it.",
    ],

    falseWall: [
      "This wall feels… off. Like it’s hiding something. Rude.",
      "A suspicious wall. You know, the kind that lies.",
      "This wall is giving ‘secret passage’ energy.",
    ],

    mouse: [
      "A tiny mouse. It looks like it knows something and refuses to tell you.",
      "Mouse. Professional skitterer. Part-time omen.",
      "A nervous little mouse… it absolutely did not sign up for this dungeon.",
    ],

    enemy: [
      "An enemy. It woke up and chose violence.",
      "Hostile creature detected. Try diplomacy. (It won’t work.)",
      "Enemy spotted. It looks confident. Fix that.",
    ],

    rat: [
      "A rat. Somehow it looks smug.",
      "Rat. Small, angry, and definitely carrying germs *and* grudges.",
      "A rat. If it had a résumé, it would just say ‘biting’.",
    ],

    potion: [
      "A potion. It’s either helpful or a prank. Mostly helpful.",
      "Potion spotted. Drink responsibly. Or don’t. That’s your brand.",
      "A potion. The dungeon’s version of an apology.",
    ],

    potionHealth: [
      "Health potion. Tiny bottle of ‘try again.’",
      "Health potion. Because consequences are exhausting.",
      "A health potion. Your future self says thanks.",
    ],

    potionStrength: [
      "Strength potion. For when ‘bonk harder’ is a strategy.",
      "Strength potion. Taste: regret. Result: power.",
      "A strength potion. Violence, but with better numbers.",
    ],

    potionToughness: [
      "Toughness potion. Now with 30% more stubborn.",
      "Toughness potion. For people who enjoy being hit, apparently.",
      "A toughness potion. The dungeon is about to be mildly disappointed.",
    ],

    trapdoor: [
      "Trapdoor. Because stairs are too mainstream.",
      "A trapdoor leading down. The dungeon says: ‘good luck lol.’",
      "Trapdoor. Progress awaits. Also pain.",
    ],

    trapVisible: [
      "A trap. It’s not even trying to be subtle.",
      "Visible trap. At least it’s honest.",
      "Trap ahead. The floor is in a villain arc.",
    ],

    trapHidden: [
      "This floor tile is lying to you.",
      "Hidden trap vibes. Proceed with caution… or chaos.",
      "Something is *wrong* with that tile. Like, ‘ow’ wrong.",
    ],

    trapFire: [
      "Fire trap. Looks warm. That’s not a compliment.",
      "Fire trap. It’s basically a portable bad decision.",
      "Fire trap. If you hear sizzling, that’s you.",
    ],

    trapPoison: [
      "Poison trap. The slow, petty kind of damage.",
      "Poison trap. The dungeon’s idea of ‘flavor’.",
      "Poison trap. It’s like a hug from a snake.",
    ],

    trapSpike: [
      "Spike trap. Pointy. Unforgiving. Like your ex.",
      "Spike trap. The tile wants blood.",
      "Spike trap. A classic. A classic that hurts.",
    ],

    trapShock: [
      "Shock trap. Very zappy. Very rude.",
      "Shock trap. The dungeon’s attempt at ‘electric personality’.",
      "Shock trap. You’re about to learn what ‘grounding’ means.",
    ],
  };

  function describeTrap(trap) {
    if (!trap) return pick(TEXTS.trapVisible);
    if (trap.hidden) return pick(TEXTS.trapHidden);

    const t = String(trap.type || "").toLowerCase();
    if (t === "fire") return pick(TEXTS.trapFire);
    if (t === "poison") return pick(TEXTS.trapPoison);
    if (t === "spike") return pick(TEXTS.trapSpike);
    if (t === "shock") return pick(TEXTS.trapShock);

    return pick(TEXTS.trapVisible);
  }

  function describePotion(p) {
    const name = String(p?.name || "").toLowerCase();
    if (name.includes("health")) return pick(TEXTS.potionHealth);
    if (name.includes("strength")) return pick(TEXTS.potionStrength);
    if (name.includes("tough")) return pick(TEXTS.potionToughness);
    return pick(TEXTS.potion);
  }

  function describeEnemy(e) {
    const name = String(e?.name || "").toLowerCase();
    const sym = String(e?.symbol || "").toUpperCase();
    if (name.includes("rat") || sym === "R") return pick(TEXTS.rat);
    return pick(TEXTS.enemy);
  }

  // Public API: keep script.js small.
  // info.kind can be: player, wall, falseWall, floor, mouse, enemy, potion, trap, trapdoor
  window.getInvestigationDescription = function getInvestigationDescription(info) {
    const kind = String(info?.kind || "").toLowerCase();

    if (kind === "player") return pick(TEXTS.player);
    if (kind === "falsewall") return pick(TEXTS.falseWall);
    if (kind === "wall") return pick(TEXTS.wall);
    if (kind === "floor") return pick(TEXTS.floor);
    if (kind === "mouse") return pick(TEXTS.mouse);
    if (kind === "trapdoor") return pick(TEXTS.trapdoor);
    if (kind === "potion") return describePotion(info?.potion);
    if (kind === "trap") return describeTrap(info?.trap);
    if (kind === "enemy") return describeEnemy(info?.enemy);

    return "You investigate it thoroughly and learn… very little.";
  };
})();
