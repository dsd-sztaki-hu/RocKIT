# RO-Crate MCP Server

`@arpproject/rocrate-mcp-server` is an [MCP server](https://www.dreamfactory.com/use-cases/mcp-server/) for [RO-Crate](https://www.researchobject.org/ro-crate/) editing, validation, and profile-aware constraints following the best practices of the ARP project (https://researchdata.hu/). It is designed to be used with MCP-compatible AI assistants such as Codex, Claude Code. It can be used with the schemas and profiles offered by the ARP Schema Registry (https://cedar.schema.researchdata.hu/)

Copyright 2026, SZTAKI DSD, (https://dsd.sztaki.hu/). Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0

## Quick start

`@arpproject/rocrate-mcp-server` makes it easy to create RO-Crate packages using MCP-compatible AI assistants and subsequently upload them to the ARP system.

To use it, you need an MCP-compatible AI assistant, such as Codex, Claude Code, OpenCode, Kilo Code, Roo Code, Gemini CLI, or Qwen Code.

Node.js 18 or newer is required for installation:

```bash
npm install -g @arpproject/rocrate-mcp-server
```

To configure it for a particular AI assistant, use the interactive installer:

```bash
rocrate-mcp-server -i
```

Select the AI assistant you want to use, and the installer will automatically create the required configuration.

The selection screen supports the up/down arrow keys as well as entering an
agent number. Before asking for confirmation, the installer displays the exact
complete contents it will write and the destination file. Press Enter to accept
the default `Y`, or use an explicit agent ID when preferred:

```bash
rocrate-mcp-server -i codex
```

Supported IDs are `codex`, `claude`, `opencode`, `kilo`, `roo`, `gemini`, and
`qwen`. The generated configuration launches the standalone server through the
shared per-user RockIT socket (`~/.rockit/rocrate-mcp-server.sock`).

You can verify that the installation was successful by starting the AI assistant and listing the configured MCP servers. This is typically done using the `/mcp` command (for example, in Codex and Claude Code) or `/mcps` (for example, in OpenCode). The list should contain an MCP server named `rocrate` that runs the `rocrate-mcp-server` command.

To use `rocrate-mcp-server`, start your AI assistant in the directory where you want to create or edit the RO-Crate. Give the assistant the appropriate instructions for creating the RO-Crate package, and it will automatically start using `rocrate-mcp-server` and follow the workflows provided by the server.

At the end of the workflow, the completed RO-Crate package (the `ro-crate-metadata.json` file) can be opened in the ARP AROMA software. The assistant will usually offer to do this automatically. If it does not, simply ask it to
```
 "Open the dataset in AROMA".
```
The assistant will provide a URL that opens AROMA in a browser with the RO-Crate package you are currently editing.

If you place the AI assistant and the AROMA browser window side by side, changes made to the RO-Crate through the assistant will immediately appear in AROMA, where they can be reviewed and also edited directly.

`rocrate-mcp-server` can also upload the dataset to ARP Dataverse; simply ask your assistant to do so. For uploads to work, set the `DATAVERSE_API_KEY` environment variable. You can get it from https://repo.researchdata.hu/dataverseuser.xhtml?selectTab=apiTokenTab. The assistant will also ask for this value if they have not been configured.

## Első lépések

Az `@arpproject/rocrate-mcp-server` segítségével MCP-kompatibilis AI-asszisztenseket használva egyszerűen hozhatók létre RO-Crate csomagok, amelyeket aztán az ARP rendszerébe is fel lehet tölteni.

A használatához szükség van egy MCP-kompatibilis AI-asszisztensre, például Codex, Claude Code, OpenCode, Kilo Code, Roo Code, Gemini CLI vagy Qwen Code.

A telepítéshez Node.js 18 vagy újabb szükséges:

```bash
npm install -g @arpproject/rocrate-mcp-server
```

Egy adott AI-asszisztenshez való konfiguráláshoz használja az interaktív telepítőt:

```bash
rocrate-mcp-server -i
```

Itt válassza ki a használni kívánt AI-asszisztenst, és a telepítő automatikusan beállítja a szükséges konfigurációt.

A választóképernyőn a fel/le nyilakkal és a sorszám megadásával is
navigálhat. A telepítő a megerősítés előtt megmutatja a teljes, pontosan
kiírandó konfigurációt és a célfájlt. Az Enter az alapértelmezett `Y` választ
fogadja el. Egy adott asszisztens közvetlen kiválasztásához használható például:

```bash
rocrate-mcp-server -i codex
```

Az elérhető azonosítók: `codex`, `claude`, `opencode`, `kilo`, `roo`, `gemini`
és `qwen`. A létrehozott konfiguráció a standalone szervert a közös,
felhasználónkénti RockIT socketen (`~/.rockit/rocrate-mcp-server.sock`) keresztül
indítja.

A sikeres telepítést úgy ellenőrizheti, hogy elindítja az AI-asszisztenst, és listázza a beállított MCP-szervereket. Ehhez tipikusan az `/mcp` (például Codex és Claude Code esetében) vagy az `/mcps` (például OpenCode esetében) parancsot kell kiadni. A listában meg kell jelennie a `rocrate` nevű MCP-szervernek, amely a `rocrate-mcp-server` parancsot futtatja.

A `rocrate-mcp-server` használatához az AI-asszisztenst abban a könyvtárban indítsa el, ahol a RO-Crate-et létre szeretné hozni vagy szerkeszteni. Adja meg az RO-Crate csomag létrehozásához a megfelelő utasítást, és az asszisztens automatikusan elkezdi használni a `rocrate-mcp-server`-t, követve az abban meghatározott munkafolyamatokat.

A munkafolyamat végén az elkészült RO-Crate csomag (a `ro-crate-metadata.json` fájl) megnyitható az ARP AROMA szoftverben. Ezt általában automatikusan felajánlja az asszisztens. Ha nem, akkor csak kérje meg:
```
„   Nyisd meg az adatcsomagot az AROMA-ban”.
```

Ennek hatására az asszisztens ad egy URL-t, amelyre kattintva a böngészőben megnyílik az AROMA az éppen szerkesztett RO-Crate csomaggal.

Ha az AI-asszisztenst és a megnyitott AROMA böngészőablakot egymás mellé helyezi, akkor az asszisztenssel végzett módosítások azonnal megjelennek az AROMA-ban is, ahol ellenőrizhetők, illetve közvetlenül szerkeszthetők.

A `rocrate-mcp-server` használatával az adatcsomag az ARP Dataverse-be is feltölthető; ehhez csak kérje meg az asszisztenst. A feltöltéshez állítsa be a `DATAVERSE_API_KEY` környezeti változót. Ezt a https://repo.researchdata.hu/dataverseuser.xhtml?selectTab=apiTokenTab oldalon tudja beszerezbi. Ha nincs ez a környezeti változó beállítba asszisztens is bekérheti.
