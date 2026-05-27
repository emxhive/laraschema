import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { CustomizeOptions, StubType } from '../support/command-types';
import { resolveStubIndex } from '../support/schema-stubs';

export function registerCustomizeCommand(cli: Command) {
   cli
      .command('customize')
      .alias('c')
      .description('Scaffold per-table stub files from index.stub')
      .option('-s, --schema <path>', 'Prisma schema file', 'prisma/schema.prisma')
      .option('-t, --types <list>', 'Comma-separated: migration,model,enum,ts', (val: string) => val.split(',').map((s) => s.trim().toLowerCase()), [])
      .option('-n, --names <list>', 'Comma-separated base names', (val: string) => val.split(',').map((s) => s.trim()), [])
      .option('--update', 'Scaffold update migration stubs (*.update.stub) for migration type')
      .action(async (opts: CustomizeOptions) => {
         const want = opts.types as StubType[];
         const bases = opts.names;
         const updateMode = !!opts.update;

         if (!want.length) throw new Error('Specify at least one type with -t');
         if (!bases.length) throw new Error('Specify at least one name with -n');
         if (want.includes('enum') && want.length > 1) {
            throw new Error('`enum` cannot be combined with other types');
         }
         if (updateMode && !want.includes('migration')) {
            throw new Error('`--update` can only be used when `migration` is included in --types');
         }

         const __dirname = path.dirname(fileURLToPath(import.meta.url));
         const schemaDir = path.dirname(path.resolve(process.cwd(), opts.schema));
         const stubRoot = path.join(schemaDir, 'stubs');
         const doBoth = want.includes('migration') && want.includes('model');

         for (const t of want) {
            if (t === 'enum') {
               const dir = path.join(stubRoot, 'enum');
               const idx = resolveStubIndex(stubRoot, 'enum', __dirname);
               await fs.mkdir(dir, { recursive: true });

               for (const name of bases) {
                  const dst = path.join(dir, `${name}.stub`);
                  try {
                     await fs.access(dst);
                     console.log(`Skip enum/${name}.stub`);
                  } catch {
                     await fs.copyFile(idx, dst);
                     console.log(`Created enum/${name}.stub`);
                  }
               }
               continue;
            }

            if (t === 'ts') {
               const dir = path.join(stubRoot, 'ts');
               const idx = resolveStubIndex(stubRoot, 'ts', __dirname);
               await fs.mkdir(dir, { recursive: true });

               for (const base of bases) {
                  const dst = path.join(dir, `${base}.stub`);
                  try {
                     await fs.access(dst);
                     console.log(`Skip ts/${base}.stub`);
                  } catch {
                     await fs.copyFile(idx, dst);
                     console.log(`Created ts/${base}.stub`);
                  }
               }
               continue;
            }

            for (const kind of doBoth ? ['migration', 'model'] : [t]) {
               const dir = path.join(stubRoot, kind);
               const shouldUseUpdateStub = kind === 'migration' && updateMode;
               const idx = resolveStubIndex(
                  stubRoot,
                  kind as 'migration' | 'model',
                  __dirname,
                  shouldUseUpdateStub
               );
               await fs.mkdir(dir, { recursive: true });

               for (const base of bases) {
                  const fileName = shouldUseUpdateStub ? `${base}.update.stub` : `${base}.stub`;
                  const dst = path.join(dir, fileName);
                  try {
                     await fs.access(dst);
                     console.log(`Skip ${kind}/${fileName}`);
                  } catch {
                     await fs.copyFile(idx, dst);
                     console.log(`Created ${kind}/${fileName}`);
                  }
               }
            }
         }

         console.log('Customize complete!');
      });
}
