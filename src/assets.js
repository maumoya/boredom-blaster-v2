// Boredom Blaster sprite manifest and loader. Plain script like game.js; the tests load it in Node.
// Every name maps to a file under assets/ (Kenney Space Shooter Redux, CC0). If an image fails to
// load, get() returns null and render.js draws a plain shape instead.
(function (root) {
  const DIR = "assets/";
  const K = "kenney/";

  const MANIFEST = {
    ship: K + "playerShip1_blue.png",
    shipDamage1: K + "Damage/playerShip1_damage1.png",
    shipDamage2: K + "Damage/playerShip1_damage2.png",
    shipDamage3: K + "Damage/playerShip1_damage3.png",
    flame: K + "Effects/fire00.png",
    escort: K + "playerShip3_green.png",
    lifeIcon: K + "UI/playerLife1_blue.png",
    drone: K + "Enemies/enemyBlack1.png",
    wasp: K + "Enemies/enemyBlue2.png",
    viper: K + "Enemies/enemyRed3.png",
    diver: K + "Enemies/enemyGreen4.png",
    splitter: K + "Enemies/enemyBlack5.png",
    splitling: K + "Enemies/enemyRed5.png",
    orbiter: K + "ufoBlue.png",
    dasher: K + "ufoRed.png",
    bullet: K + "Lasers/laserBlue01.png",
    special: K + "Lasers/laserBlue12.png",
    enemyBullet: K + "Lasers/laserRed01.png",
    capsuleBronze: K + "Power-ups/bolt_bronze.png",
    capsuleSilver: K + "Power-ups/shield_silver.png",
    capsuleGold: K + "Power-ups/things_gold.png",
    capsuleRainbow: K + "Power-ups/powerupBlue_star.png",
    shield: K + "Effects/shield1.png",
    spark: K + "Effects/star1.png",
    star1: K + "Effects/star1.png",
    star2: K + "Effects/star2.png",
    star3: K + "Effects/star3.png",
    meteorBig1: K + "Meteors/meteorGrey_big1.png",
    meteorBig2: K + "Meteors/meteorBrown_big1.png",
    meteorMed: K + "Meteors/meteorGrey_med1.png",
    meteorSmall: K + "Meteors/meteorBrown_small1.png",
    meteorTiny: K + "Meteors/meteorGrey_tiny1.png",
    button: K + "UI/buttonBlue.png",
    buttonHot: K + "UI/buttonYellow.png",
  };

  const urlOf = (name) => DIR + MANIFEST[name];

  // makeImage: () => Image-like (browser: () => new Image()). Loads everything up front.
  function createAssets(makeImage) {
    const images = {}, status = {};
    for (const name of Object.keys(MANIFEST)) {
      const img = makeImage();
      status[name] = "loading";
      img.onload = () => { status[name] = "ok"; };
      img.onerror = () => { status[name] = "failed"; };
      img.src = urlOf(name);
      images[name] = img;
    }
    return {
      status,
      get: (name) => (status[name] === "ok" ? images[name] : null),
      failed: () => Object.keys(status).filter((n) => status[n] === "failed"),
    };
  }

  root.BBAssets = { MANIFEST, DIR, urlOf, createAssets };
})(globalThis);
