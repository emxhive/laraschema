import { Command } from 'commander';
import fs from 'fs/promises';
import { existsSync, readdirSync } from 'fs';
import path from 'path';
import { loadConfig } from '@/core/config/load-config';
import { runGenerators } from './generate';
import { getOutputPaths } from '../support/output-paths';

export function registerCleanCommand(cli: Command) {
   cli
      .command('clean')
      .description('Delete generated files & backups (driven by .bak), then re-run generate.')
      .option('--config <path>', 'Path to laraschema config file')
      .option('--types <list>', 'Comma-separated: migration,model,enum', (v: string) => v.split(',').map((s) => s.trim().toLowerCase()))
      .option('--names <list>', 'Comma-separated base names (tables/models/enums)', (v: string) => v.split(',').map((s) => s.trim()))
      .option('--skipGenerate', 'Do not re-run generation after cleanup')
      .option('--dry-run', 'Show what would be removed, but do not delete anything')
      .action(async (opts: { config?: string; types?: string[]; names?: string[]; skipGenerate?: boolean; dryRun?: boolean; }) => {
         const configPath = opts.config
            ? path.resolve(process.cwd(), opts.config)
            : path.resolve(process.cwd(), 'laraschema.config.js');

         if (!existsSync(configPath)) {
            console.error(`Config file not found: ${configPath}`);
            process.exit(1);
         }

         const cfgMod = await loadConfig(configPath);
         const cfg = (cfgMod as any).default ?? cfgMod;
         const out = getOutputPaths(cfg);

         const want = new Set((opts.types?.length ? opts.types : ['migration', 'model', 'enum']) as ('migration' | 'model' | 'enum')[]);
         const names = new Set((opts.names ?? []).map((s) => s.toLowerCase()));
         const dry = !!opts.dryRun;

         const rmIfExists = async (p: string): Promise<boolean> => {
            if (!p || !existsSync(p)) return false;
            try {
               await fs.unlink(p);
               return true;
            } catch {
               return false;
            }
         };

         const listRecursive = async (dir: string): Promise<string[]> => {
            if (!existsSync(dir)) return [];
            const outFiles: string[] = [];
            const stack: string[] = [dir];
            while (stack.length) {
               const d = stack.pop()!;
               for (const entry of readdirSync(d, { withFileTypes: true }) as any) {
                  const full = path.join(d, entry.name);
                  if (entry.isDirectory()) stack.push(full);
                  else outFiles.push(full);
               }
            }
            return outFiles;
         };

         const pruneEmptyDirs = async (root: string) => {
            if (!existsSync(root)) return;
            const walk = async (dir: string): Promise<boolean> => {
               const entries = readdirSync(dir, { withFileTypes: true }) as any[];
               let allRemoved = true;
               for (const e of entries) {
                  const full = path.join(dir, e.name);
                  if (e.isDirectory()) {
                     const removed = await walk(full);
                     if (!removed) allRemoved = false;
                  } else {
                     allRemoved = false;
                  }
               }
               if (allRemoved) {
                  try {
                     await fs.rmdir(dir);
                     return true;
                  } catch {
                     return false;
                  }
               }
               return false;
            };
            await walk(root);
         };

         const isBak = (f: string) => f.endsWith('.bak');
         const stripBak = (p: string) => p.replace(/\.bak$/i, '');

         const matchMig = (basenameGenerated: string) => {
            if (!names.size) return true;
            const m = /_create_(.+?)_table\.php$/.exec(basenameGenerated);
            const table = (m?.[1] ?? '').toLowerCase();
            return !!table && names.has(table);
         };
         const matchModelOrEnum = (basenameGenerated: string) => {
            if (!names.size) return true;
            return names.has(basenameGenerated.replace(/\.php$/i, '').toLowerCase());
         };

         async function cleanByType(kind: 'migration' | 'model' | 'enum', outDir: string, matcher: (basenameGenerated: string) => boolean) {
            const bakDir = path.join(out.backups, path.relative(out.root, outDir));
            const bakFiles = (await listRecursive(bakDir)).filter(isBak);

            if (!bakFiles.length) {
               console.log(`(no .bak backups found for ${kind} in ${bakDir})`);
               return;
            }

            const plan = bakFiles
               .map((bakPath) => {
                  const relWithBak = path.relative(bakDir, bakPath);
                  const relGen = stripBak(relWithBak);
                  const genPath = path.join(outDir, relGen);
                  return { bakPath, genPath, baseGen: path.basename(relGen) };
               })
               .filter((item) => matcher(item.baseGen));

            if (!plan.length) {
               console.log(`(nothing to remove for ${kind}${names.size ? ' with current filters' : ''})`);
               return;
            }

            let removed = 0;
            for (const { bakPath, genPath } of plan) {
               if (dry) {
                  console.log(`[dry-run] rm ${genPath}`);
                  console.log(`[dry-run] rm ${bakPath}`);
                  continue;
               }
               const genRemoved = await rmIfExists(genPath);
               await rmIfExists(bakPath);
               if (genRemoved) removed++;
            }

            console.log(`Removed ${removed} ${kind}${removed === 1 ? '' : 's'}${names.size ? ' (filtered)' : ''}`);
         }

         if (want.has('migration')) await cleanByType('migration', out.migrations, matchMig);
         if (want.has('model')) await cleanByType('model', out.models, matchModelOrEnum);
         if (want.has('enum')) await cleanByType('enum', out.enums, matchModelOrEnum);

         if (!dry) await pruneEmptyDirs(out.backups);

         if (!opts.skipGenerate) {
            try {
               await runGenerators(configPath, false);
               console.log('Regenerated.');
            } catch (e: any) {
               console.error('Regenerate failed:', e?.message ?? e);
               process.exit(1);
            }
         }
      });
}
