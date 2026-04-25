import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { generatorBlock } from '../support/generator-block';
import { StubType } from '../support/command-types';

export function registerInitCommand(cli: Command) {
   cli
      .command('init')
      .description('Inject generators into schema.prisma and scaffold stubs/')
      .option('-s, --schema <path>', 'Prisma schema file', 'prisma/schema.prisma')
      .action(async (opts) => {
         const schemaPath = path.resolve(process.cwd(), opts.schema);
         const schemaDir = path.dirname(schemaPath);
         const userStubs = path.join(schemaDir, 'stubs');
         const stubDirRel = './' + path.relative(process.cwd(), userStubs).replace(/\\/g, '/');

         const __dirname = path.dirname(fileURLToPath(import.meta.url));
         const pkgStubs = path.resolve(__dirname, '../../../stubs');

         let schema = await fs.readFile(schemaPath, 'utf-8');

         const hasGenBlock = (name: string) =>
            new RegExp(`generator\\s+${name}\\s*\\{`).test(schema);

         const hasMigrationsGen = hasGenBlock('migrations');
         const hasModelsGen = hasGenBlock('models');
         const hasTypesGen = hasGenBlock('types');

         if (!hasMigrationsGen) {
            schema += generatorBlock('migration', stubDirRel, ['outputDir = "database/migrations"']);
            console.log('Added migrations generator');
         }

         if (!hasModelsGen) {
            schema += generatorBlock('model', stubDirRel, [
               'outputDir     = "app/Models"',
               'outputEnumDir = "app/Enums"',
            ]);
            console.log('Added models generator');
         }

         if (!hasTypesGen) {
            schema += `
generator types {
  provider = "laraschema-types"
}
`;
            console.log('Added types generator');
         }

         await fs.writeFile(schemaPath, schema, 'utf-8');
         console.log(`Updated ${schemaPath}`);

         const stubTypes: StubType[] = ['migration', 'model', 'enum'];

         for (const type of stubTypes) {
            const targetDir = path.join(userStubs, type);
            await fs.mkdir(targetDir, { recursive: true });

            const src = path.join(pkgStubs, `${type}.stub`);
            const dst = path.join(targetDir, 'index.stub');
            try {
               await fs.access(dst);
            } catch {
               await fs.copyFile(src, dst);
               console.log(`Copied ${type}.stub -> stubs/${type}/index.stub`);
            }
         }

         const cfgPath = path.join(schemaDir, 'laraschema.config.js');
         try {
            await fs.access(cfgPath);
         } catch {
            const cfgTemplate = `
module.exports = {
  // Optional Laravel app root.
  // Useful when LaraSchema is run from a schema/package folder but writes into a Laravel app.
  // rootDir: "../laravel-app",

  tablePrefix: "",
  tableSuffix: "",
  stubDir:     "${stubDirRel}",
  modeler: {
    // castMaps: {
    //   Json: "'array'",
    //   BigInt: ({ isList }) =>
    //     isList
    //       ? "Illuminate\\\\Database\\\\Eloquent\\\\Casts\\\\AsCollection::class"
    //       : "'string'",
    // },
  },
};
`;
            await fs.writeFile(cfgPath, cfgTemplate.trimStart(), 'utf-8');
            console.log('Created laraschema.config.js');
         }

         console.log('Initialization complete!');
      });
}
