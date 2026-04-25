import { Command } from 'commander';
import { existsSync, readdirSync } from 'fs';
import path from 'path';
import { loadConfig } from '@/core/config/load-config';
import { getOutputPaths } from '../support/output-paths';

function orderKey(fname: string): string {
   const mNum = /^(\d{1,})_/.exec(fname);
   if (mNum) return mNum[1].padStart(10, '0') + '_' + fname;

   const mTs = /^(\d{4}_\d{2}_\d{2}_\d{6})_/.exec(fname);
   if (mTs) return mTs[1] + '_' + fname;

   return 'zzz_' + fname;
}

function extractTable(fname: string): string {
   return /_create_(.+?)_table\.php$/.exec(fname)?.[1] ?? fname;
}

export function registerListCommand(cli: Command) {
   cli
      .command('list')
      .description('List generated files. Use --migrations/--models/--enums and --sorted for migration DB order (uses backup baselines).')
      .option('--config <path>', 'Path to laraschema config file')
      .option('--migrations', 'List migrations')
      .option('--models', 'List models')
      .option('--enums', 'List enums')
      .option('--sorted', 'For migrations: show tables in dependency order (requires backups present)')
      .action(async (opts: { config?: string; migrations?: boolean; models?: boolean; enums?: boolean; sorted?: boolean; }) => {
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

         const wantAll = !opts.migrations && !opts.models && !opts.enums;
         const ls = (dir: string, pred: (f: string) => boolean = () => true) => (existsSync(dir) ? readdirSync(dir).filter(pred) : []);

         if (wantAll || opts.migrations) {
            const files = ls(out.migrations, (f) => f.endsWith('.php'));
            console.log('\nMigrations:');
            files.forEach((f) => console.log(' -', f));

            if (opts.sorted) {
               const bakDir = path.join(out.backups, path.relative(out.root, out.migrations));
               const bakFiles = existsSync(bakDir) ? readdirSync(bakDir).filter((f) => f.endsWith('.php')) : [];
               if (!bakFiles.length) {
                  console.log('   (no backups found - cannot show sorted list)');
               } else {
                  const ordered = [...bakFiles].sort((a, b) => orderKey(a).localeCompare(orderKey(b)));
                  console.log('\n   Backup order (by filename):');
                  ordered.forEach((f, i) => console.log(`   ${i + 1}. ${extractTable(f)}  (${f})`));
               }
            }
         }

         if (wantAll || opts.models) {
            const files = ls(out.models, (f) => f.endsWith('.php'));
            console.log('\nModels:');
            files.forEach((f) => console.log(' -', f));
         }

         if (wantAll || opts.enums) {
            const files = ls(out.enums, (f) => f.endsWith('.php'));
            console.log('\nEnums:');
            files.forEach((f) => console.log(' -', f));
         }

         console.log('');
      });
}
