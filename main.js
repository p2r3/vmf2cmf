const { $ } = require("bun");
const vmfparser = require("./vmfparser/src/index");

// Get input/output file paths from command line
const inputFilePath = process.argv[2];
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
    if (isNaN(x)) throw "x component is not a number";
    this.x = Number(x);
    if (isNaN(y)) throw "y component is not a number";
    this.y = Number(y);
    if (isNaN(z)) throw "z component is not a number";
    this.z = Number(z);
  }

  static fromString (str) {
    return new Vector(...str.split(" ").map(Number));
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

  toString () {
    return `${this.x} ${this.y} ${this.z}`;
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

  if (entity.targetname === "@entry_door") {
    /**
     * The entry door is the spawnpoint, to avoid elevators.
     * This should likely be a looser check? Decompiled maps won't contain
     * the original instance's name verbatim.
     */
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
  } else if (entity.targetname === "@exit_door") {
    /**
     * The exit door maps to `level_end`. See `parseEditorEntity` for
     * notes about orientation.
     */
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

// Iterates through all solids and adds them to the output map string
for (const solid of json.world.solid) {
  if (!solid.side) continue;

  /**
   * For now, we're treating ALL solids as `collidable_geometry`. This is
   * not only unoptimal, but also causes some weird bugs, and doesn't
   * allow for side-specific portalability. It's by far the simplest
   * approach, but ideally this would be replaced with literally anything
   * else. Even 6 `func_wall`s would do better in most cases.
   */
  output += `{\n"classname" "collidable_geometry"\n`;

  // Whether the solid is portalable and/or seethrough
  let portalable = false, seethrough = false;
  // String containing constructed definitions for all sides of this solid
  let sidesOutput = "";

  // Iterate through each side, converting it from VMF format to MAP
  for (const side of solid.side) {

    // The plane could be copied verbatim, but we have to scale it first
    // csg.exe also applies semantic significance to whitespace, we adjust for that
    let plane = "";
    const planePoints = side.plane.split("(").slice(1).map(c => c.split(")")[0].trim());
    for (let i = 0; i < 3; i ++) {
      plane += `( ${planePoints[i].split(" ").map(c => parseFloat(c) * unitScale).join(" ")} )`;
      if (i !== 2) plane += " ";
    }

    // Reorder the u/v coordinates and scale parameters
    // We're also adjusting for the previously mentioned semantic whitespace
    const upos = side.uaxis.slice(1).split("]")[0].replaceAll("  ", " ");
    const vpos = side.vaxis.slice(1).split("]")[0].replaceAll("  ", " ");
    // Textures are scaled by unitScale, too
    const uscale = parseFloat(side.uaxis.split("] ")[1].trim()) * unitScale;
    const vscale = parseFloat(side.vaxis.split("] ")[1].trim()) * unitScale;

    // Convert to Narbacular Drop texture, assign properties based on it
    const texture = convertMaterial(side.material);
    if (texture.startsWith("ROCK_")) portalable = true;
    if (texture === "CHAINLINK") seethrough = true;

    // Add constructed string to string of all sides
    sidesOutput += `${plane} ${texture} [ ${upos} ] [ ${vpos} ] ${side.rotation} ${uscale.toFixed(3)} ${vscale.toFixed(3)} \n`;

  }

  // Complete the solid definition - set portalability and transparency
  if (!portalable) output += `"sfx_type" "1"\n`;
  if (seethrough) output += `"spawnflags" "1"\n`;
  output += `{\n`;
  output += sidesOutput;
  output += `}\n}\n`;

}

/**
 * The map file output starts with a basic `worldspawn` header, points to
 * the local WAD, and then follows the output string built earlier.
 */
output = `{
"classname" "worldspawn"
"mapversion" "220"
"wad" "${__dirname}/narbaculardrop.wad"
}
${output}`;

// Write out the .map file and parse it with csg.exe
const mapFilePath = inputFilePath.replace(".vmf", "") + ".map";
await Bun.write(mapFilePath, output);
await $`wine "${__dirname}/csg.exe" "${mapFilePath}" "${outputFilePath}"`;
