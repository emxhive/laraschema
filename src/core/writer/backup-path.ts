import path from "path";
import { mkdirSync, existsSync } from "fs";
import { getConfig } from "@/core/config/config-store";
import { getResolvedRoot } from "@/shared/utils/paths";

function getRootDirConfig(): { rootDir?: string } | undefined {
   const configs = [
      getConfig("migrator") as any,
      getConfig("model") as any,
      getConfig("typescript") as any,
   ].filter(Boolean);

   return configs.find((cfg) => typeof cfg.rootDir === "string") ?? configs[0];
}

/** Returns `<root>/.laraschema/backups/<relative-to-cwd>.bak` */
export function backupPathFor(targetFile: string): string {
   const root = getResolvedRoot(getRootDirConfig());
   const backupRoot = path.join(root, ".laraschema", "backups");
   const rel = path.relative(root, targetFile);
   const full = path.join(backupRoot, rel + ".bak");
   const dir = path.dirname(full);
   if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
   return full;
}
