# VibeARP MCP Server

`@arpproject/vibarp-mcp` is an [MCP server](https://www.dreamfactory.com/use-cases/mcp-server/) for [RO-Crate](https://www.researchobject.org/ro-crate/) editing, validation, and profile-aware constraints following the best practices of the ARP project (https://researchdata.hu/). It is designed for MCP-compatible AI assistants such as Codex and Claude Code. It can use metadata profiles and remote CEDAR templates offered by the ARP profile repository (https://cedar.schema.researchdata.hu/).

[Quick start](#quick-start) · [Első lépések](#első-lépések)

## Quick start

`@arpproject/vibearp-mcp` makes it easy to create RO-Crate packages using MCP-compatible AI assistants and subsequently upload them to the ARP system.

To use it, you need an MCP-compatible AI assistant, such as Codex, Claude Code, OpenCode, Kilo Code, Roo Code, Gemini CLI, or Qwen Code.

Node.js 18 or newer is required for installation:

```bash
npm install -g @arpproject/vibearp-mcp
```

Note: when upgrading an existing installation, the package first asks the
shared RO-Crate MCP daemon to shut down gracefully through its socket (or
Windows named pipe). Restart any AI  assistant that already has an MCP connection 
after the upgrade.

To configure it for a particular AI assistant, use the interactive installer:

```bash
rocrate-mcp-server -i
```

Select the AI assistant you want to use, and the installer will automatically create the required configuration.

The selection screen supports the up/down arrow keys as well as entering an
agent number. Before asking for confirmation, the installer displays the exact
MCP section it will write and the destination file. Press Enter to accept, or use an explicit 
agent ID when preferred:

```bash
rocrate-mcp-server -i codex
```

Supported IDs are `codex`, `claude`, `opencode`, `kilo`, `roo`, `gemini`, and
`qwen`. The generated configuration launches the standalone server through the
shared per-user RockIT socket (`~/.rockit/rocrate-mcp-server.sock`).

The standalone server and RocKIT share the same per-user profile and schema
storage by default: `~/.rockit`. Set `ROCKIT_ROOT_PATH` to use another shared
root, and use the `ROCKIT_*` profile environment variables for filename and
provider-storage overrides.

You can verify that the installation was successful by starting the AI assistant and listing the configured MCP servers. This is typically done using the `/mcp` command (for example, in Codex and Claude Code) or `/mcps` (for example, in OpenCode). The list should contain an MCP server named `rocrate` that runs the `rocrate-mcp-server` command.

To use `rocrate-mcp-server`, start your AI assistant in the directory where you want to create or edit the RO-Crate. Give the assistant the appropriate instructions for creating the RO-Crate package, and it will automatically start using `rocrate-mcp-server` and follow the workflows provided by the server.If RO-Crate editing is not using the MCP server automatically, you can explcitily ask the assistant to "Use the RO-Crate MCP server" to start using it.

At the end of the workflow, the completed RO-Crate package (the `ro-crate-metadata.json` file) can be opened in the ARP AROMA software. The assistant will usually offer to do this automatically. If it does not, simply ask it to
```
 "Open the dataset in AROMA".
```

The assistant will provide a URL that opens AROMA in a browser with the RO-Crate package you are currently editing, or in case of a more intelligent agent, it may even open the browser automatically.

If you place the AI assistant and the AROMA browser window side by side, changes made to the RO-Crate through the assistant will immediately appear in AROMA, where they can be reviewed and also edited directly. It is also to a good experience to work in a desktop app, like ChatGPT dekstop, and have the AROMA browser window open inside the app. The built-in browser can also be used to perform tasks, whichrequire interactive browser access, ie. "browser use"

The server also provides a local dashboard at `http://127.0.0.1:9393` for
monitoring MCP activity and configure various values.

`rocrate-mcp-server` can also upload the dataset to ARP Dataverse; simply ask your assistant to do so. For uploads to work, set the `DATAVERSE_API_KEY` environment variable. You can get it from https://repo.researchdata.hu/dataverseuser.xhtml?selectTab=apiTokenTab. The assistant will also ask for this value if they have not been configured.

The dashboard Settings page lets you enter or override the `TAVILY_API_KEY`,
`DATAVERSE_BASE_URL`, and `DATAVERSE_API_KEY` values for the running MCP
process, and controls whether successful Dataverse uploads keep their generated
RO-Crate ZIP files. Environment variables remain the defaults; dashboard
settings are saved in `~/.rockit/rocrate-mcp-settings.json`. 
API-key overrides can be cleared from Settings to restore the
environment fallback. The file contains configured API keys in plaintext and
uses user-only permissions where supported.

## Első lépések

Az `@arpproject/vibearp-mcp` segítségével MCP-kompatibilis AI-asszisztenseket használva egyszerűen hozhatók létre RO-Crate csomagok, amelyeket aztán az ARP rendszerébe is fel lehet tölteni.

A használatához szükség van egy MCP-kompatibilis AI-asszisztensre, például Codex, Claude Code, OpenCode, Kilo Code, Roo Code, Gemini CLI vagy Qwen Code.

A telepítéshez Node.js 18 vagy újabb szükséges:

```bash
npm install -g @arpproject/vibearp-mcp
```

Megjegyzés: meglévő telepítés frissítésekor a csomag először szabályosan
leállítja a közös RO-Crate MCP démont a socketen (Windowson named pipe-on)
keresztül. A frissítés után indítsd újra azt az AI-asszisztenst, amely már
az új szervert fogja elindítani és használni.

Egy adott AI-asszisztenshez való konfiguráláshoz használd az interaktív telepítőt:

```bash
rocrate-mcp-server -i
```

Itt válaszd ki a használni kívánt AI-asszisztenst, és a telepítő automatikusan beállítja a szükséges konfigurációt.

A választóképernyőn a fel/le nyilakkal és a sorszám megadásával is
navigálhatsz. A telepítő a megerősítés előtt megmutatja a pontosan kiírandó MCP
szekciót és a célfájlt. Az elfogadáshoz nyomd meg az Enter billentyűt. Ha adott ágenshez akarod közvetlenül telepíteni, add meg az asszisztens azonosítóját:

```bash
rocrate-mcp-server -i codex
```

Az elérhető azonosítók: `codex`, `claude`, `opencode`, `kilo`, `roo`, `gemini`
és `qwen`. A létrehozott konfiguráció a standalone szervert a közös,
felhasználónkénti RockIT socketen (`~/.rockit/rocrate-mcp-server.sock`) keresztül
indítja.

A standalone szerver és a RocKIT alapértelmezés szerint ugyanazt a
felhasználónkénti profil- és séma-tárolót használja: `~/.rockit`. Másik közös
gyökérhez állítsd be a `ROCKIT_ROOT_PATH` változót; a fájlnév- és szolgáltató-
felülírásokhoz használd a `ROCKIT_*` profil-környezeti változókat.

A sikeres telepítést úgy ellenőrizheted, hogy elindítod az AI-asszisztenst, és listázod a beállított MCP-szervereket. Ehhez tipikusan az `/mcp` (például Codex és Claude Code esetében) vagy az `/mcps` (például OpenCode esetében) parancsot kell kiadni. A listában meg kell jelennie a `rocrate` nevű MCP-szervernek, amely a `rocrate-mcp-server` parancsot futtatja.

A `rocrate-mcp-server` használatához az AI-asszisztenst abban a könyvtárban indítsd el, ahol a RO-Crate-et létre szeretnéd hozni vagy szerkeszteni. Add meg az RO-Crate csomag létrehozásához a megfelelő utasítást, és az asszisztens automatikusan elkezdi használni a `rocrate-mcp-server`-t, követve az abban meghatározott munkafolyamatokat. Ha a RO-Crate szerkesztésekor az MCP-szerver nem indul el automatikusan, kérd meg kifejezetten az asszisztenst a következőre: „Használd az RO-Crate MCP-t!”.

A munkafolyamat végén az elkészült RO-Crate csomag (a `ro-crate-metadata.json` fájl) megnyitható az ARP AROMA szoftverben. Ezt általában automatikusan felajánlja az asszisztens. Ha nem, akkor csak kérd meg:
```
„   Nyisd meg az adatcsomagot az AROMA-ban”.
```

Ennek hatására az asszisztens ad egy URL-t, amelyre kattintva a böngészőben megnyílik az AROMA az éppen szerkesztett RO-Crate csomaggal, intelligensebb ügynök esetén pedig akár automatikusan meg is nyithatja a böngészőt.

Ha az AI-asszisztenst és a megnyitott AROMA böngészőablakot egymás mellé helyezed, akkor az asszisztenssel végzett módosítások azonnal megjelennek az AROMA-ban is, ahol ellenőrizhetők, illetve közvetlenül szerkeszthetők. Jó megoldás lehet egy asztali alkalmazásban, például a ChatGPT asztali alkalmazásában dolgozni, és az AROMA böngészőablakát az alkalmazáson belül megnyitni. A beépített böngésző olyan feladatok elvégzésére is használható, amelyek interaktív böngésző-hozzáférést igényelnek, például a „browser use”.

A szerver helyi vezérlőpultot is biztosít a MCP-tevékenység megfigyeléséhez a
`http://127.0.0.1:9393` címen, ahol különböző értékek is beállíthatók.

A `rocrate-mcp-server` használatával az adatcsomag az ARP Dataverse-be is feltölthető; ehhez csak kérd meg az asszisztenst. A feltöltéshez állítsd be a `DATAVERSE_API_KEY` környezeti változót. Ezt a https://repo.researchdata.hu/dataverseuser.xhtml?selectTab=apiTokenTab oldalon tudod beszerezni. Ha nincs ez a környezeti változó beállítva, az asszisztens is bekérheti.

A vezérlőpult Beállítások oldala lehetővé teszi a `TAVILY_API_KEY`,
`DATAVERSE_BASE_URL` és `DATAVERSE_API_KEY` értékek megadását vagy felülírását
az éppen futó MCP-folyamatban, valamint a sikeres Dataverse-feltöltések során
keletkező RO-Crate ZIP-fájlok megtartásának beállítását. Alapértelmezés szerint
a környezeti változók használatosak; a vezérlőpult beállításai a
`~/.rockit/rocrate-mcp-settings.json` fájlba kerülnek. Az API-kulcsok felülírásai a Beállítások oldalán törölhetők
a környezeti változók visszaállításához. A fájl a beállított API-kulcsokat
egyszerű szövegként tartalmazza, és ahol támogatott, csak a felhasználó számára
engedélyezett hozzáféréssel rendelkezik.

## Authorship

This package is maintained by SZTAKI, Department of Distributed Systems
(<https://dsd.sztaki.hu>).

Individual contributors are listed in `package.json`.

## License

This package is licensed under the Apache License, Version 2.0. See
[LICENSE.md](./LICENSE.md) for details.
