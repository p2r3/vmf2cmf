# vmf2cmf
[Backports Portal 2 maps to Narbacular Drop.](https://www.youtube.com/watch?v=de_SGq34uPI)

![image](https://github.com/user-attachments/assets/6d43dd2f-5a19-4926-a76d-ae647b27ef15)
![image](https://github.com/user-attachments/assets/1fbd59c4-f43a-4ff5-b12e-d707bc5b7c4a)


## Setup and basic usage
0. This project requires the [Bun runtime](https://bun.sh/) and is designed to run on Linux. It will likely work on Windows with few or no changes, but this has not been tested. Setting up a WSL instance is the simplest option.
1. Clone this repository and use `bun run main.js` to run the program. It should automatically download the Narbacular Drop level creation kit along with one other dependency, and then exit with an error asking you to provide a VMF. Let's do that.
2. Obtain a VMF file by either building a map yourself, or by decompiling an existing one. [BSPSource](https://github.com/ata4/bspsrc/releases) is a good tool for this. See the "Getting map files" section below for more info.
3. Run `bun run main.js mapfile.vmf`, where `mapfile.vmf` is the path to your chosen VMF file. This will create two files next to it - a `.map` file and a `.cmf` file.
4. Create a `levels` folder in your Narbacular Drop game directory, next to the executable. Place the `.cmf` file there.
5. Create a `startup.cfg` file in the Narbacular Drop game directory. In it, write `LoadLevel levels\mapfile.cmf`, where `mapfile.cmf` is the name of the `.cmf` file you moved in the previous step.
6. Launch Narbacular Drop. If everything went well, you should load into a level resembling the map you picked. Currently, the map is using built-in Narbacular Drop assets. To extract the Portal 2 textures and models, read below.

## Extracting assets
To get the backported levels to look more like Portal 2, you will need to extract the textures and models from your copy of the Portal 2 game files. If you're wondering why I don't just provide a ZIP file of everything you'd need, the answer is really quite simple - that would be unethical and illegal. You must own a copy of Portal 2 if you're going to use its resources in any form.

1. Clone the [vpk2wad_nd](https://github.com/p2r3/vpk2wad_nd) repository and follow the instructions there.
2. After running the script, you should see 3 new files (`narbaculardrop.wad`, `noportal.txt`, `seethrough.txt`) and 1 new folder (`video`). Move the 3 new files into the `nd_tools` directory that was created when you first ran `main.js`. If asked to overwrite a file, accept. Move the `videos` folder to your Narbacular Drop game directory, next to the executable.
3. Now, when you attempt to compile a map again, it should automatically switch to using the extracted textures.

## Getting map files
The easiest way to obtain VMF files for converting is to decompile campaign maps. This can be done with tools like [BSPSource](https://github.com/ata4/bspsrc/releases). Get a BSP file from `Portal 2/portal2/maps`, decompile it, then pass the output VMF file to this tool.

If you want to build custom chambers with the Portal 2 in-game level editor, there's no need to decompile anything. In fact, the results are better if you don't. Build your chamber, then preview it. This will create a file at `Portal 2/sdk_content/maps/preview.vmf` - you can feed that directly to this tool.

_Note: if you're on Linux, the level editor is broken in the latest Portal 2 release. Either use the "demo_viewer" beta, or switch to Proton._

## Features and known issues
Below is a list of supported map elements and features. Anything not mentioned here is likely unimplemented.
- **Brushes** - note that per-face surface properties apply only to simple (axis-aligned) geometries.
- **Cubes** - except certain templates and PTI droppers. Use cubes without droppers in the editor.
- **Floor buttons** - except those not mounted on the floor.
- **Chamber doors** - behave as one-way laser fields, remain disabled when opened.
- **Faith plates** - only players get catapulted, launch direction is not consistent.
- **Basic lighting** - note that in PTI, only manually placed light strips emit light.
- **Toxic goo** - all brushes with toxic slime materials are replaced with lava.
- **Laser fields (PTI)** - similarly to doors, these remain disabled when opened.
- **Exit door (PTI)** - always faces South (default orientation), remains open when triggered.

_Note: PTI stands for "Perpetual Testing Initiative", i.e. the Portal 2 in-game level editor._

## Contributing
Contributions for optimizations and features are welcome, but please first open an issue stating what you're planning on doing. This lets me decide whether and how the change you're introducing should be introduced _before_ you've already written the code for it, and also allows for open discussion about implementation details.

Before making commits, _study the codebase_. Imitate its formatting, comments, and commit naming. Yes, we use 2 space indents here. Yes, we put whitespace before braces in function definitions, but not in calls, and no newline before curly brackets. Regardless of what you prefer, please adhere to that. Pull requests with major style discrepencies will not be accepted.

If you find bugs, rest assured I know they're there. You may open an issue, but unless you plan to fix it yourself, it's unlikely that anything will be done about it.
