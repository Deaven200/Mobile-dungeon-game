/* Investigation descriptions live here so script.js stays lean. */

(() => {
  "use strict";

  const rand01 = () => (typeof window.rand01 === "function" ? window.rand01() : Math.random());
  const pick = (arr) => arr[Math.floor(rand01() * arr.length)];

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

    goblin: [
      "A goblin. Green, mean, and way too proud of it.",
      "Goblin spotted. It looks like it bites *on purpose*.",
      "A goblin. The kind of creature that thinks ambushes are a personality.",
    ],

    potion: [
      "A potion. It’s either helpful or a prank. Mostly helpful.",
      "Potion spotted. Drink responsibly. Or don’t. That’s your brand.",
      "A potion. The dungeon’s version of an apology.",
    ],
    
    potionSpeed: [
      "Speed potion. Your legs are about to file a complaint.",
      "Speed potion. For when running away is a valid build.",
      "A speed potion. Time to do crimes faster.",
    ],
    
    potionInvisibility: [
      "Invisibility potion. Now you see me… now you absolutely don’t.",
      "Invisibility potion. Perfect for tactical cowardice.",
      "A potion that makes you harder to notice. The dungeon hates this.",
    ],
    
    potionExplosive: [
      "Explosive potion. Handle gently. Or heroically. Same outcome.",
      "Explosive potion. A bottle full of ‘oops’.",
      "An explosive potion. The dungeon just gave you permission.",
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
    
    food: [
      "Food. Technically safer than the floor. Technically.",
      "Something edible! Probably!",
      "Dungeon snacks. Try not to think about where they’ve been.",
    ],
    
    foodMushroom: [
      "A mushroom. It’s either nutrition or a side quest to the ER.",
      "Mushroom. Smells like ‘maybe’ and tastes like ‘regret’.",
      "A mushroom. The dungeon’s produce aisle is… limited.",
    ],
    
    foodBerry: [
      "A berry. Small, bright, and suspiciously optimistic.",
      "Berries! Nature’s candy. Nature is also a liar sometimes.",
      "A berry. Cute. Possibly cursed.",
    ],
    
    foodMeatRaw: [
      "Raw meat. You *can* eat it, but the dungeon will judge you.",
      "Uncooked meat. Bold choice.",
      "Raw meat. It’s giving ‘campfire first’ vibes.",
    ],
    
    foodMeatCooked: [
      "Cooked meat. Warm. Safe-ish. Delicious-ish.",
      "Cooked meat. A rare win in this place.",
      "Cooked meat. Congratulations, you’re basically a chef now.",
    ],
    
    campfire: [
      "A campfire. Cozy. Suspiciously cozy.",
      "Campfire. Where food becomes less of a gamble.",
      "A campfire. Rest your feet… and cook your questionable meats.",
    ],
    
    shop: [
      "A shop. Capitalism survives even the dungeon.",
      "Shop tile detected. Prepare to trade shiny things for survival.",
      "A shop. The prices are probably emotional damage.",
    ],

    trapdoor: [
      "Trapdoor. Because stairs are too mainstream.",
      "A trapdoor leading down. The dungeon says: ‘good luck lol.’",
      "Trapdoor. Progress awaits. Also pain.",
    ],

    entrance: [
      "The dungeon entrance. It’s waiting for you to blink first.",
      "An entrance into the dark. It smells like poor decisions and treasure.",
      "The way in. The hard part is coming back out.",
    ],

    upstairs: [
      "A way back out. It looks safer than it actually is.",
      "Upstairs. Civilization, probably. Or at least fewer rats.",
      "An exit route. The dungeon hates when you leave.",
    ],

 cursor/extraction-game-concept-3720
    grass: [
      "Grass. Soft. Innocent. It will not prepare you for what’s inside.",
      "A patch of grass. Outside still exists. For now.",
      "Green and calm. The last free feeling you’ll get today.",
    ],


 main
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
    if (name.includes("speed")) return pick(TEXTS.potionSpeed);
    if (name.includes("invis")) return pick(TEXTS.potionInvisibility);
    if (name.includes("explos")) return pick(TEXTS.potionExplosive);
    return pick(TEXTS.potion);
  }
  
  function describeFood(f) {
    const name = String(f?.name || "").toLowerCase();
    const cooked = !!f?.cooked;
    
    // Specific items
    if (name.includes("mushroom")) return pick(TEXTS.foodMushroom);
    if (name.includes("berry")) return pick(TEXTS.foodBerry);
    
    // Meat variants
    if (name.includes("meat")) return cooked ? pick(TEXTS.foodMeatCooked) : pick(TEXTS.foodMeatRaw);
    
    return pick(TEXTS.food);
  }

  function describeEnemy(e) {
    const name = String(e?.name || "").toLowerCase();
    const sym = String(e?.symbol || "").toUpperCase();
    let desc = "";
    if (name.includes("rat") || sym === "R") desc = pick(TEXTS.rat);
    else if (name.includes("goblin") || sym === "G") desc = pick(TEXTS.goblin);
    else if (name.includes("bat") || sym === "B") desc = pick(TEXTS.enemy);
    else if (name.includes("skeleton") || sym === "S") desc = pick(TEXTS.enemy);
    else if (name.includes("orc") || sym === "O") desc = pick(TEXTS.enemy);
    else desc = pick(TEXTS.enemy);
    
    // Add HP info if setting is enabled
    const showHealth = window.gameSettings?.showEnemyHealth !== false;
    if (showHealth && e) {
      if (typeof e.hp === "number" && typeof e.maxHp === "number") {
        return `${desc} HP: ${e.hp}/${e.maxHp}`;
      } else if (typeof e.hp === "number") {
        return `${desc} HP: ${e.hp}`;
      }
    }
    return desc;
  }

  // Public API: keep script.js small.
 cursor/extraction-game-concept-3720
  // info.kind can be: player, wall, falseWall, floor, grass, mouse, enemy, potion, food, trap, trapdoor, entrance, upstairs, campfire, shop

  // info.kind can be: player, wall, falseWall, floor, mouse, enemy, potion, food, trap, trapdoor, entrance, upstairs, campfire, shop
 main
  window.getInvestigationDescription = function getInvestigationDescription(info) {
    const kind = String(info?.kind || "").toLowerCase();

    if (kind === "player") return pick(TEXTS.player);
    if (kind === "falsewall") return pick(TEXTS.falseWall);
    if (kind === "wall") return pick(TEXTS.wall);
    if (kind === "floor") return pick(TEXTS.floor);
    if (kind === "grass") return pick(TEXTS.grass);
    if (kind === "mouse") return pick(TEXTS.mouse);
    if (kind === "trapdoor") return pick(TEXTS.trapdoor);
    if (kind === "entrance") return pick(TEXTS.entrance);
    if (kind === "upstairs") return pick(TEXTS.upstairs);
    if (kind === "potion") return describePotion(info?.potion);
    if (kind === "food") return describeFood(info?.food);
    if (kind === "trap") return describeTrap(info?.trap);
    if (kind === "enemy") return describeEnemy(info?.enemy);
    if (kind === "campfire") return pick(TEXTS.campfire);
    if (kind === "shop") return pick(TEXTS.shop);

    return "You investigate it thoroughly and learn… very little.";
  };
})();
