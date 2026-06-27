import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "fs";
import path from "path";
import crypto from "crypto";
import * as diff3 from "node-diff3";
import { backupPathFor } from "./backup-path.js";
import { prettify } from "../formatting/pretty.js";
import { getConfig } from '@/core/config/config-store';
import { getResolvedRoot } from "@/shared/utils/paths";

interface ManifestFileEntry {
  type: string;
  hash: string;
  updatedAt: string;
}

interface Manifest {
  version: number;
  files: Record<string, ManifestFileEntry>;
}

function getManifestPath(typeCfg?: any): string {
  const root = getResolvedRoot(typeCfg);
  return path.join(root, ".laraschema", "generated-manifest.json");
}

function readManifest(typeCfg?: any): Manifest {
  const p = getManifestPath(typeCfg);
  if (existsSync(p)) {
    try {
      return JSON.parse(readFileSync(p, "utf-8"));
    } catch {
      // ignore
    }
  }
  return { version: 1, files: {} };
}

function writeManifest(typeCfg: any, manifest: Manifest) {
  const p = getManifestPath(typeCfg);
  const dir = path.dirname(p);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(p, JSON.stringify(manifest, null, 2), "utf-8");
}

function canonicalizeGeneratedContent(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trimEnd() + "\n";
}

function getSha256(content: string): string {
  const canonical = canonicalizeGeneratedContent(content);
  return "sha256:" + crypto.createHash("sha256").update(canonical, "utf-8").digest("hex");
}

function updateManifest(typeCfg: any, filePath: string, content: string, type: string) {
  const root = getResolvedRoot(typeCfg);
  const relPath = path.relative(root, filePath).replace(/\\/g, "/");
  const manifest = readManifest(typeCfg);
  manifest.files[relPath] = {
    type,
    hash: getSha256(content),
    updatedAt: new Date().toISOString(),
  };
  writeManifest(typeCfg, manifest);
}

/**
 * Git-style 3-way merge writer that supports moving outputs.
 *
 * @param filePath      NEW destination file (after sort/repath)
 * @param theirs        Freshly-generated FULL text
 * @param type          'migrator' | 'model' | 'ts'  (selects prettier section)
 * @param overwrite     Skip writing when false & file exists at NEW path
 * @param currentPath   OPTIONAL: existing/OLD file path to merge from. If omitted, uses filePath.
 * @param removeOld     After success, delete old file if path moved (default true)
 */
export async function writeWithMerge(
   filePath: string,
   theirs: string,
   type: "migrator" | "model" | "typescript",
   overwrite = true,
   currentPath?: string | null,
   removeOld = true
) {
   const readPath = currentPath ?? filePath; // source for mine/base
   if (!overwrite && existsSync(filePath)) return;

   const typeCfg = getConfig(type);
   const usePrettier = !!typeCfg?.prettier;

   const doFormat = (code: string | null | undefined) => {
      if (!usePrettier || !code) return code;

      const parser: "php" | "typescript" = type == 'typescript' ? "typescript" : "php";

      return prettify(code, {
         parser,
         filepathHint: filePath,
      });
   };

   // Format the new generated content (theirs) first
   theirs = (await doFormat(theirs)) as string;

   // Get configurable writer options
   const writerConfig = typeCfg?.writer;
   const tracking = writerConfig?.tracking ?? "snapshot";
   const conflictStrategy = writerConfig?.conflictStrategy ?? "merge";

   const bakOld = backupPathFor(readPath);
   const bakNew = backupPathFor(filePath);

   const mineRaw = existsSync(readPath) ? readFileSync(readPath, "utf-8") : null;
   const mineFormatted = await doFormat(mineRaw);

   const baseRaw = existsSync(bakOld) ? readFileSync(bakOld, "utf-8") : null;
   const baseFormatted = await doFormat(baseRaw);

   const moved = readPath !== filePath;

   // helper to clean old artifacts when path moved
   const cleanupOld = () => {
      if (moved && existsSync(bakOld)) safeUnlink(bakOld);
      if (moved && removeOld && existsSync(readPath)) safeUnlink(readPath);
   };

   if (conflictStrategy === "overwrite") {
      writeFileSync(filePath, theirs, "utf-8");
      writeFileSync(bakNew, theirs, "utf-8");
      if (tracking === "hash") {
         updateManifest(typeCfg, filePath, theirs, type);
      }
      cleanupOld();
      return;
   }

   // Check if there is a conflict
   let hasConflict = false;

   if (mineFormatted !== null && mineFormatted !== undefined && mineFormatted !== theirs) {
      if (tracking === "hash") {
         const root = getResolvedRoot(typeCfg as any);
         const relPath = path.relative(root, filePath).replace(/\\/g, "/");
         const manifest = readManifest(typeCfg);
         const manifestEntry = manifest.files[relPath];
         if (manifestEntry) {
            const mineHash = getSha256(mineFormatted);
            if (mineHash !== manifestEntry.hash) {
               hasConflict = true;
            }
         } else {
            // Not tracked in manifest, but file exists and differs from theirs
            hasConflict = true;
         }
      } else {
         // tracking === "snapshot"
         // Conflict if real divergence: mine !== base and theirs !== base
         if (mineFormatted !== baseFormatted && theirs !== baseFormatted) {
            hasConflict = true;
         }
      }
   }

   // Act on conflict
   if (hasConflict) {
      if (conflictStrategy === "fail") {
         const errorPath = path.relative(process.cwd(), filePath).replace(/\\/g, "/");
         throw new Error(
            `Generated file conflict: ${errorPath}.\n` +
            `Current file differs from the last generated output. Resolve manually, use writer.conflictStrategy = "overwrite", or run an explicit clean/fresh generation.`
         );
      } else if (conflictStrategy === "skip") {
         const skipPath = path.relative(process.cwd(), filePath).replace(/\\/g, "/");
         console.log(`[laraschema] Skipped writing conflicting file: ${skipPath}`);
         return;
      } else {
         // conflictStrategy === "merge"
         // Real divergence: diff3 merge (be null-safe on mine/base)
         const mergedLines = diff3.merge(
            (mineFormatted ?? "").split(/\r?\n/),
            (baseFormatted ?? "").split(/\r?\n/),
            theirs.split(/\r?\n/),
            { stringSeparator: "\n" }
         ).result;

         const mergedText = mergedLines.join("\n");

         if (/^(<{7}|={7}|>{7})/m.test(mergedText)) {
            console.warn(
               `⚠️  Merge conflicts in ${path.relative(
                  process.cwd(),
                  filePath
               )} — resolve <<< >>> markers.`
            );
         }

         writeFileSync(filePath, mergedText, "utf-8");
         writeFileSync(bakNew, theirs, "utf-8");
         if (tracking === "hash") {
            updateManifest(typeCfg, filePath, theirs, type);
         }
         cleanupOld();
         return;
      }
   }

    // ----------------- No conflict -----------------
    if (tracking === "hash") {
       // 1) First run: no existing file
       if (mineFormatted == null) {
          writeFileSync(filePath, theirs, "utf-8");
          writeFileSync(bakNew, theirs, "utf-8");
          updateManifest(typeCfg, filePath, theirs, type);
          cleanupOld();
          return;
       }

       // 2) Up-to-date
       if (mineFormatted === theirs) {
          if (moved) writeFileSync(filePath, mineFormatted, "utf-8");
          writeFileSync(bakNew, theirs, "utf-8");
          updateManifest(typeCfg, filePath, theirs, type);
          cleanupOld();
          return;
       }

       // 3) Generator update, user untouched (hasConflict was false, meaning mineHash matches manifestEntry)
       writeFileSync(filePath, theirs, "utf-8");
       writeFileSync(bakNew, theirs, "utf-8");
       updateManifest(typeCfg, filePath, theirs, type);
       cleanupOld();
       return;
   } else {
      // tracking === "snapshot"
      // 1) First run: no existing file
      if (mineFormatted == null) {
         writeFileSync(filePath, theirs, "utf-8");
         writeFileSync(bakNew, theirs, "utf-8");
         cleanupOld();
         return;
      }

      // 2) Up-to-date
      if (mineFormatted === theirs) {
         if (moved) writeFileSync(filePath, mineFormatted, "utf-8");
         writeFileSync(bakNew, theirs, "utf-8");
         cleanupOld();
         return;
      }

      // 3) Generator unchanged, user edited
      if (theirs === baseFormatted) {
         const destMissing = !existsSync(filePath);
         if (moved || destMissing) writeFileSync(filePath, mineFormatted ?? theirs, "utf-8");
         writeFileSync(bakNew, theirs, "utf-8");
         cleanupOld();
         return;
      }

      // 4) User untouched, generator updated
      if (mineFormatted === baseFormatted) {
         writeFileSync(filePath, theirs, "utf-8");
         writeFileSync(bakNew, theirs, "utf-8");
         cleanupOld();
         return;
      }

      // 5) Fallback (should be covered by hasConflict check, but just in case)
      const mergedLines = diff3.merge(
         (mineFormatted ?? "").split(/\r?\n/),
         (baseFormatted ?? "").split(/\r?\n/),
         theirs.split(/\r?\n/),
         { stringSeparator: "\n" }
      ).result;

      const mergedText = mergedLines.join("\n");

      if (/^(<{7}|={7}|>{7})/m.test(mergedText)) {
         console.warn(
            `⚠️  Merge conflicts in ${path.relative(
               process.cwd(),
               filePath
            )} — resolve <<< >>> markers.`
         );
      }

      writeFileSync(filePath, mergedText, "utf-8");
      writeFileSync(bakNew, theirs, "utf-8");
      cleanupOld();
   }
}

/* ---------------- helpers ---------------- */
function safeUnlink(p: string) {
   try {
      unlinkSync(p);
   } catch {
      // ignore
   }
}