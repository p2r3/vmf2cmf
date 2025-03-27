const { $ } = require("bun");
const fs = require("node:fs");
const unzipper = require("unzipper");

// Download Narbacular Drop level creation kit on for first launch
const toolsPath = `${__dirname}/nb_tools`;
if (!fs.existsSync(toolsPath)) {

  console.log("Downloading Narbacular Drop level creation kit...");
  const response = await fetch("https://nuclearmonkeysoftware.com/downloads/narbacular_drop_level_creation_kit.zip");
  if (response.status !== 200) {
    throw "Failed to download level creation kit, HTTP status " + response.status;
  }
  const buffer = await response.arrayBuffer();

  // Create the output directory and file only when the download succeeds
  fs.mkdirSync(toolsPath);
  await Bun.write(`${toolsPath}/kit.zip`, buffer);

  // Extract the archive
  console.log("Extracting...");
  const archive = await unzipper.Open.file(`${toolsPath}/kit.zip`);
  await archive.extract({ path: toolsPath });

  // Remove unnecessary files
  await $`rm "${toolsPath}/kit.zip"`.quiet();
  await $`rm "${toolsPath}/Read Me.txt"`.quiet();
  await $`rm -rf "${toolsPath}/FGDs"`.quiet();
  await $`rm -rf "${toolsPath}/RMF"`.quiet();
  await $`mv "${toolsPath}/WADs/narbaculardrop.wad" "${toolsPath}/narbaculardrop.wad"`.quiet();
  await $`mv "${toolsPath}/Map Parser/csg.exe" "${toolsPath}/csg.exe"`.quiet();
  await $`rm -rf "${toolsPath}/WADs"`.quiet();
  await $`rm -rf "${toolsPath}/Map Parser"`.quiet();

}

// Ideally this would be an npm dependency, but the import seems broken
const vmfParserPath = `${__dirname}/vmfparser`;
if (!fs.existsSync(vmfParserPath)) {

  console.log("Downloading vmfparser (by @leops)...");
  // We need this commit specifically, the TS refactor broke something
  const response = await fetch("https://github.com/leops/vmfparser/archive/79fe5e3af8917eb09cb36566eb3f5a8109d23efa.zip");
  if (response.status !== 200) {
    throw "Failed to download vmfparser, HTTP status " + response.status;
  }
  const buffer = await response.arrayBuffer();

  // Create the output file only when the download succeeds
  await Bun.write(`${__dirname}/vmfparser.zip`, buffer);

  // Extract the archive
  console.log("Extracting...");
  const archive = await unzipper.Open.file(`${__dirname}/vmfparser.zip`);
  await archive.extract({ path: __dirname });
  // The archive extracts to a subdirectory, we rename that
  await $`mv "${__dirname}/vmfparser-79fe5e3af8917eb09cb36566eb3f5a8109d23efa" "${vmfParserPath}"`.quiet();
  // Remove the archive after extracting
  await $`rm "${__dirname}/vmfparser.zip"`;

}
// Include vmfparser library downloaded above
const vmfparser = require(`${vmfParserPath}/src/index`);

// Get input/output file paths from command line
const inputFilePath = process.argv[2];
if (!inputFilePath) throw "Please provide an input VMF path.";
// If no output path was provided, use renamed input path
const outputFilePath = process.argv[3] || (inputFilePath.replace(".vmf", "") + ".cmf");

// Parse the VMF data to JSON
const vmf = await Bun.file(inputFilePath).text();
const json = vmfparser(vmf);

// Check for PTI map - this is not an exhaustive test!!
const isPTI = vmf.includes("instances/p2editor/elevator_exit.vmf");

// Constant by which to scale world, 1.5 is a good default
const unitScale = 1.5;
// Counts the amount of buttons on the map for connecting to exit door
let buttonCount = 0;
// Holds the .map file output string
let output = "";

/**
 * Utility class - a simple Vector3 implementation.
 *
 * Supports converting from a space-delimited vector string via
 * `fromString`, and converts to a similar string when `toString` is invoked.
 */
class Vector {

  constructor (x = 0, y = 0, z = 0) {
    if (isNaN(x)) throw "X component is not a number";
    this.x = Number(x);
    if (isNaN(y)) throw "Y component is not a number";
    this.y = Number(y);
    if (isNaN(z)) throw "Z component is not a number";
    this.z = Number(z);
  }

  static fromString (str) {
    return new Vector(...str.trim().replaceAll("  ", " ").split(" ").map(Number));
  }
  toString () {
    return `${this.x} ${this.y} ${this.z}`;
  }

  static fromAngles (ang) {
    // Convert degrees to radians
    ang = ang.copy().scale(Math.PI / 180.0);
    // Compute sines and cosines of angles
    const cy = Math.cos(ang.y), sy = Math.sin(ang.y);
    const cp = Math.cos(ang.x), sp = Math.sin(ang.x);
    // Calculate and return the forward vector
    return new Vector(cy * cp, sy * cp, -sp);
  }

  copy () {
    return new Vector(this.x, this.y, this.z);
  }

  scale (factor) {
    this.x *= factor;
    this.y *= factor;
    this.z *= factor;
    return this;
  }
  add (other) {
    this.x += other.x;
    this.y += other.y;
    this.z += other.z;
    return this;
  }
  sub (other) {
    this.x -= other.x;
    this.y -= other.y;
    this.z -= other.z;
    return this;
  }
  cross (other) {
    return new Vector(
      this.y * other.z - this.z * other.y,
      this.z * other.x - this.x * other.z,
      this.x * other.y - this.y * other.x
    );
  }
  normalize () {
    const length = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    if (length === 0) throw "Cannot normalize a zero-length vector";
    return this.scale(1.0 / length);
  }

  /**
   * Returns true if both vectors are nearby within a tiny epsilon.
   * Used to combat floating point errors in axis checks.
   */
  near (other) {
    return (
      Math.abs(this.x - other.x) < 0.000001 &&
      Math.abs(this.y - other.y) < 0.000001 &&
      Math.abs(this.z - other.z) < 0.000001
    );
  }

  // Axis vectors for comparison in `getAxis`
  static xVector = new Vector(1, 0, 0);
  static _xVector = new Vector(-1, 0, 0);
  static yVector = new Vector(0, 1, 0);
  static _yVector = new Vector(0, -1, 0);
  static zVector = new Vector(0, 0, 1);
  static _zVector = new Vector(0, 0, -1);

  /**
   * Returns an index representing the axis that this vector is pointing
   * to, or `null` if the vector isn't axis-aligned. Possible values:
   * 0: X (East)
   * 1: -X (West)
   * 2: Y (North)
   * 3: -Y (South)
   * 4: Z (Up)
   * 5: -Z (Down)
   */
  getAxis () {
    if (this.near(Vector.xVector)) return 0;
    if (this.near(Vector._xVector)) return 1;
    if (this.near(Vector.yVector)) return 2;
    if (this.near(Vector._yVector)) return 3;
    if (this.near(Vector.zVector)) return 4;
    if (this.near(Vector._zVector)) return 5;
    return null;
  }

}

/**
 * Defines a brush plane from 3 Vectors - points on the plane.
 *
 * Supports parsing VMF plane strings and outputting MAP file format
 * plane strings when `toString` is invoked.
 */
class Plane {

  constructor (p1, p2, p3) {
    if (!(p1 instanceof Vector)) throw "Point 1 is not a Vector";
    if (!(p2 instanceof Vector)) throw "Point 2 is not a Vector";
    if (!(p3 instanceof Vector)) throw "Point 3 is not a Vector";
    this.points = [p1, p2, p3];
  }

  static fromString (str) {
    return new Plane(...str.replaceAll(")", "").split("(").slice(1).map(Vector.fromString));
  }
  toString () {
    return `( ${this.points[0]} ) ( ${this.points[1]} ) ( ${this.points[2]} )`;
  }

  getNormal () {
    const v1 = this.points[1].copy().sub(this.points[0]);
    const v2 = this.points[2].copy().sub(this.points[0]);
    return v2.cross(v1).normalize();
  }

}

/**
 * Given a Portal 2 material, returns the corresponding ND texture.
 *
 * @param {string} material Portal 2 material path
 * @returns {string} Narbacular Drop texture
 */
function convertMaterial (material) {
  material = material.toLowerCase().replace("\\", "/");
  if (material.startsWith("tile/white_floor_tile")) return "ROCK_FLOOR1";
  if (material.startsWith("tile/white_wall_tile")) return "ROCK_WALL1";
  if (material.startsWith("metal/black_floor_metal")) return "METAL_PANEL2";
  if (material.startsWith("metal/black_wall_metal")) return "METAL_PANEL1";
  if (material === "anim_wp/framework/backpanels_cheap") return "METAL_PANEL3";
  if (material === "anim_wp/framework/squarebeams") return "METAL_PANEL3";
  if (material === "glass/glasswindow007a_less_shiny") return "CHAINLINK";
  if (material === "metal/metalgrate018") return "CHAINLINK";
  if (material.startsWith("tools/")) return "AAATRIGGER";
  /**
   * For unrecognized textures, we return AAATRIGGER on PTI maps, but
   * Hammer maps likely do actually have a solid there, so we return
   * CHAINLINK to indicate an obvious placeholder.
   */
  if (isPTI) return "AAATRIGGER";
  return "CHAINLINK";
}

/**
 * Defines a brush side with `toString`/`fromString` methods for easy
 * conversion from VMF to MAP format.
 */
class Side {

  constructor (plane, uparams, vparams, rotation, material) {
    this.plane = plane;
    this.uparams = uparams;
    this.vparams = vparams;
    this.rotation = rotation;
    this.material = material;
  }

  static fromString (plane, uaxis, vaxis, rotation, material) {
    return new Side(
      Plane.fromString(plane),
      uaxis.replaceAll("[", "").replaceAll("]", "").replaceAll("  ", " ").split(" ").map(Number),
      vaxis.replaceAll("[", "").replaceAll("]", "").replaceAll("  ", " ").split(" ").map(Number),
      rotation || 0,
      material || "AAATRIGGER"
    );
  }
  static fromVMF (side) {
    return Side.fromString(side.plane, side.uaxis, side.vaxis, side.rotation, convertMaterial(side.material));
  }
  toString () {
    return (
      this.plane.toString() + " " +
      this.material + " " +
      `[ ${this.uparams.slice(0, 4).join(" ")} ] ` +
      `[ ${this.vparams.slice(0, 4).join(" ")} ] ` +
      this.rotation + " " +
      this.uparams[4] + " " +
      // The trailing whitespace here is semantically significant
      this.vparams[4] + " "
    );
  }

  scale (factor) {
    for (let i = 0; i < this.plane.points.length; i ++) {
      this.plane.points[i].scale(factor);
    }
    this.uparams[4] *= factor;
    this.vparams[4] *= factor;
    return this;
  }

}

/**
 * Appends data for a point entity to mapfile output.
 *
 * @param {object} keyvalues Table of key/value pairs
 */
function createEntity (keyvalues) {
  output += "{\n"
  for (const key in keyvalues) {
    output += `"${key}" "${keyvalues[key]}"\n`
  }
  output += "}\n";
}

/**
 * Appends data for a brush entity to mapfile output.
 *
 * @param {object} keyvalues Table of key/value pairs
 * @param {Vector} origin Center of brush, after unit scaling
 * @param {Vector} size Half-width of brush on all axis, after unit scaling
 * @param {string} [texture="AAATRIGGER"] Texture used for all brush faces
 */
function createBrush (keyvalues, origin, size, texture = "AAATRIGGER") {

  // Define the entity and its keyvalues
  output += "{\n"
  for (const key in keyvalues) {
    output += `"${key}" "${keyvalues[key]}"\n`
  }

  // Huge prebuilt block for defining the brush planes
  // Actually doing the math for this would've been overkill
  output += `{
( ${-size.x + origin.x} ${size.y + origin.y} ${size.z + origin.z} ) ( ${size.x + origin.x} ${size.y + origin.y} ${size.z + origin.z} ) ( ${size.x + origin.x} ${-size.y + origin.y} ${size.z + origin.z} ) ${texture} [ 1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1 \n\
( ${-size.x + origin.x} ${-size.y + origin.y} ${-size.z + origin.z} ) ( ${size.x + origin.x} ${-size.y + origin.y} ${-size.z + origin.z} ) ( ${size.x + origin.x} ${size.y + origin.y} ${-size.z + origin.z} ) ${texture} [ 1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1 \n\
( ${-size.x + origin.x} ${size.y + origin.y} ${size.z + origin.z} ) ( ${-size.x + origin.x} ${-size.y + origin.y} ${size.z + origin.z} ) ( ${-size.x + origin.x} ${-size.y + origin.y} ${-size.z + origin.z} ) ${texture} [ 0 1 0 0 ] [ 0 0 -1 0 ] 0 1 1 \n\
( ${size.x + origin.x} ${size.y + origin.y} ${-size.z + origin.z} ) ( ${size.x + origin.x} ${-size.y + origin.y} ${-size.z + origin.z} ) ( ${size.x + origin.x} ${-size.y + origin.y} ${size.z + origin.z} ) ${texture} [ 0 1 0 0 ] [ 0 0 -1 0 ] 0 1 1 \n\
( ${size.x + origin.x} ${size.y + origin.y} ${size.z + origin.z} ) ( ${-size.x + origin.x} ${size.y + origin.y} ${size.z + origin.z} ) ( ${-size.x + origin.x} ${size.y + origin.y} ${-size.z + origin.z} ) ${texture} [ 1 0 0 0 ] [ 0 0 -1 0 ] 0 1 1 \n\
( ${size.x + origin.x} ${-size.y + origin.y} ${-size.z + origin.z} ) ( ${-size.x + origin.x} ${-size.y + origin.y} ${-size.z + origin.z} ) ( ${-size.x + origin.x} ${-size.y + origin.y} ${size.z + origin.z} ) ${texture} [ 1 0 0 0 ] [ 0 0 -1 0 ] 0 1 1 \n\
}\n}\n`;

}

/**
 * Given a Source entity from a PTI map, converts it to its equivalent in
 * Narbacular Drop and appends its data to the output string.
 *
 * @param {object} entity An "entity" object from the VMF file
 */
function parseEditorEntity (entity) {

  // PTI uses instances almost exclusively, skip anything that isn't one
  if (entity.classname !== "func_instance" || !entity.file) return;

  // Get the origin as a Vector
  const origin = Vector.fromString(entity.origin);
  origin.scale(unitScale);

  if (entity.file.startsWith("instances/p2editor/door_entrance")) {
    // Entrance doors mark the player's spawn point
    // Elevators are much too complicated and wouldn't work in any way
    createEntity({
      classname: "player_respawn",
      origin
    });
  } else if (entity.file.startsWith("instances/p2editor/door_exit")) {
    /**
     * The exit door gets converted to `level_end`.
     * Narbacular Drop makes all exit doors face south, which is why we
     * always push the door back on +Y. Rotating them isn't possible.
     */
    createEntity({
      classname: "level_end",
      origin: origin.add(new Vector(0, 96 * unitScale, 128)),
      targetname: "exit_door",
      next_level: "Levels/LongHaul.cmf"
    });
  } else if (entity.file.startsWith("instances/p2editor/light_strip")) {
    // Player-placed light strips are converted to point lights
    createEntity({
      classname: "light_point",
      origin,
      _r: 120,
      _g: 120,
      _b: 128,
      _range: 300
    });
  } else if (entity.file.startsWith("instances/p2editor/cube")) {
    /**
     * Cubes are converted to crates, but only if not in a dropper!
     * The weight is set to 150 to allow for emulating cube buttons, as the
     * player weighs 100, which allows us to differentiate between them.
     */
    createEntity({
      classname: "crate",
      origin,
      weight: 150,
      scale: 2.4
    });
  } else if (entity.file.startsWith("instances/p2editor/floor_button")) {
    /**
     * Standard floor buttons become `button_standard`, with a weight
     * tolerance of 100, supporting both the player and cubes. All
     * buttons target `exit_counter`, which is later set up to expect
     * `buttonCount` inputs.
     */
    createEntity({
      classname: "button_standard",
      origin: origin.add(new Vector(0, 0, -64 * unitScale)),
      weight: 100,
      target: "exit_counter"
    });
    buttonCount ++;
  } else if (entity.file.startsWith("instances/p2editor/faith_plate_floor")) {
    /**
     * Faith plates are simulated by placing a boulder with negative speed
     * inside of the hole that the faith plate instance creates. For some
     * reason, when speed is set to -1, the boulder bounces the player
     * much stronger than usual. This might be done on purpose for the
     * art room. Axis is set to -Z, which makes it effectively non-lethal.
     */
    origin.add(new Vector(0, 0, -112 * unitScale));
    createEntity({
      classname: "boulder",
      origin,
      speed: -1,
      axis_choice: 5
    });
  }

}

/**
 * Given a Source entity from an arbitrary (Hammer) map, converts it to its
 * equivalent in Narbacular Drop and appends its data to the output string.
 *
 * @param {object} entity An "entity" object from the VMF file
 */
function parseHammerEntity (entity) {

  // Get the origin as a Vector
  const origin = Vector.fromString(entity.origin);
  origin.scale(unitScale);

  if (entity.targetname === "@entry_door" || entity.targetname === "door_0-testchamber_door") {
    // The entry door is the spawnpoint, to avoid elevators.
    createEntity({
      classname: "player_respawn",
      origin
    });
  } else if (entity.classname === "prop_floor_button") {
    // Floor buttons map directly to `button_standard`
    createEntity({
      classname: "button_standard",
      origin,
      weight: 100,
      target: "exit_counter"
    });
    buttonCount ++;
  } else if (entity.targetname === "@exit_door" || entity.targetname === "@exit_door-testchamber_door") {
    /**
     * The exit door maps to `level_end`. Since the exit cannot be rotated,
     * this is temporarily disabled to prevent severe glitches.
     */
    return;
    createEntity({
      classname: "level_end",
      origin: origin.add(new Vector(0, 96 * unitScale, 128)),
      targetname: "exit_door",
      next_level: "Levels/LongHaul.cmf"
    });
  } else if (entity.classname === "prop_weighted_cube") {
    /**
     * Cubes map to crates. This also includes cubes in droppers, unless
     * the dropper is an instance in an original (non-decompiled) VMF.
     * For more notes, again, see `parseEditorEntity`.
     */
    createEntity({
      classname: "crate",
      origin,
      weight: 150,
      scale: 2.4
    });
  } else if (entity.classname === "light") {
    /**
     * Basic lights are mapped to `light_point`.
     * Colors are inherited directly. Range is hardcoded, because
     * falloff distances are hardly ever specified.
     */
    const _light = entity._light.split(" ").map(Number);
    const brightness = _light[3] / 255;
    createEntity({
      classname: "light_point",
      origin,
      _r: Math.floor(_light[0] * brightness),
      _g: Math.floor(_light[1] * brightness),
      _b: Math.floor(_light[2] * brightness),
      _range: 300
    });
  } else if (entity.classname === "light_spot") {
    /**
     * Nearly direct mapping of `light_spot`, as similar entities exist in
     * both games. Angles are converted to a forward vector.
     */
    const _light = entity._light.split(" ").map(Number);
    const brightness = _light[3] / 255;
    const fvec = Vector.fromAngles(Vector.fromString(entity.angles));
    createEntity({
      classname: "light_point",
      origin,
      _cone1: entity._inner_cone,
      _cone2: entity._cone,
      _r: Math.floor(_light[0] * brightness),
      _g: Math.floor(_light[1] * brightness),
      _b: Math.floor(_light[2] * brightness),
      _range: 500,
      _x: fvec.x,
      _y: fvec.y,
      _z: fvec.z
    });
  } else if (false) {
    // See `parseEditorEntity` for notes about faith plate implementation.
    origin.add(new Vector(0, 0, -64 * unitScale));
    createEntity({
      classname: "boulder",
      origin,
      speed: -1,
      axis_choice: 5
    });
  }

}

// Iterates through all map entities and parses them for conversion
for (const entity of json.entity) {

  /**
   * If a solid is found, this is a brush entity - push it to the world's
   * solids list to be handled later as a regular brush. Narbacular Drop
   * has no support for dynamic brushes, anyway.
   */
  if ("solid" in entity) {
    json.world.solid.push(entity.solid);
    continue;
  }

  // Call the relevant point entity parsing function
  if (isPTI) parseEditorEntity(entity);
  else parseHammerEntity(entity);

}

/**
 * Once we're done spawning all entities (and therefore buttons),
 * create a `counter` linking all buttons to the exit door.
 */
createEntity({
  classname: "counter",
  targetname: "exit_counter",
  target: "exit_door",
  threshold: buttonCount
});

// Iterates through all solids and adds them to the output map string
for (const solid of json.world.solid) {
  // Solids without sides aren't possible in Narbacular Drop
  if (!solid.side) continue;

  /**
   * Whether the solid is portalable and/or seethrough.
   * Used only for `collidable_geometry`.
   */
  let portalable = false, seethrough = false;
  /**
   * Whether this solid is an axis-aligned wall. We start by assuming that
   * it is, and then aim to disprove that as we iterate over all sides.
   * The first disproving factor is if the amount of sides is not exactly 6.
   */
  let isWall = solid.side.length === 6;

  // Array of Side objects, representing the sides of this solid
  const solidSides = solid.side.map(s => Side.fromVMF(s).scale(unitScale));
  // Array of axis indices for each of the sides
  const axes = [];

  for (const side of solidSides) {

    // Determine the facing axis of this side from its normal vector
    const axis = side.plane.getNormal().getAxis();
    axes.push(axis);
    // If this side isn't axis aligned, the solid can't be a wall
    if (axis === null) isWall = false;

    // If at least one of the materials is rock, a collidable_geometry
    // created from this brush would have to be portalable.
    if (side.material.startsWith("ROCK_")) portalable = true;
    // If at least one of the materials is chainlink, this is a seethrough
    // collidable_geometry and therefore also cannot be a wall.
    else if (side.material === "CHAINLINK") {
      seethrough = true;
      isWall = false;
    }

  }

  if (isWall) {
    /**
     * For axis-aligned walls, we create up to 6 brush entities
     * representing each side of the wall. This allows for per-face
     * portalability, and prevents some glitches with collidable_geometry.
     */
    for (let i = 0; i < solidSides.length; i ++) {
      const side = solidSides[i];
      const axis = axes[i];

      // Skip faces that aren't going to be rendered anyway
      if (side.material === "AAATRIGGER") continue;

      // Define the brush entity and add it to the output map file string
      output += `{\n"classname" "func_wall"\n`;
      output += `"axis_choice" "${axis}"\n`;
      output += `"wall_type" "${side.material.startsWith("ROCK_") ? 0 : 1}"\n`;
      output += "{\n";
      output += solidSides.join("\n");
      output += "\n}\n}\n";

    }
  } else {
    /**
     * Complex geometries are ironically much simpler - we simply dump all
     * of the sides into a single `collidable_geometry` entity and set
     * the properties accordingly.
     * The tradeoff is that these are less flexible.
     */
    output += `{\n"classname" "collidable_geometry"\n`;
    if (!portalable) output += `"sfx_type" "1"\n`;
    if (seethrough) output += `"spawnflags" "1"\n`;
    output += `{\n`;
    output += solidSides.join("\n");
    output += `\n}\n}\n`;
  }

}

/**
 * The map file output starts with a basic `worldspawn` header, points to
 * the local WAD, and then follows the output string built earlier.
 */
output = `{
"classname" "worldspawn"
"mapversion" "220"
"wad" "${toolsPath}/narbaculardrop.wad"
}
${output}`;

// Write out the .map file and parse it with csg.exe
const mapFilePath = inputFilePath.replace(".vmf", "") + ".map";
await Bun.write(mapFilePath, output);
// On Linux, run csg.exe with Wine
if (process.platform === "linux") {
  await $`wine "${toolsPath}/csg.exe" "${mapFilePath}" "${outputFilePath}"`;
} else {
  await $`"${toolsPath}/csg.exe" "${mapFilePath}" "${outputFilePath}"`;
}
