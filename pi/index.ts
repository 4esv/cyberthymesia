// cyberthymesia Pi extension entry. Loads core lazily so a broken or missing core never
// stops Pi from starting: the extension then fails open (native Pi + one notify).
// The core path is resolved from this file's real location, so a symlink from
// ~/.pi/agent/extensions/cyberthymesia -> <repo>/pi still finds <repo>/core.

import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createExtension, type Core, type Pi } from "./src/extension.ts";

function here(): string {
	try { return path.dirname(realpathSync(fileURLToPath(import.meta.url))); }
	catch { return path.dirname(fileURLToPath(import.meta.url)); }
}

export default async function cyberthymesia(pi: Pi): Promise<void> {
	if (process.env.CYTH_DISABLE === "1") return createExtension(pi, {});
	let core: Core | undefined;
	let coreError: unknown;
	try {
		core = (await import(pathToFileURL(path.join(here(), "..", "core", "src", "index.ts")).href)) as Core;
		if (typeof core.openStore !== "function") throw new Error("core/src/index.ts has no openStore");
	} catch (err) {
		core = undefined;
		coreError = err;
	}
	createExtension(pi, { core, coreError });
}
