import {Command} from 'commander';
import {existsSync, existsSync as existsSyncFs} from 'fs';
import path from 'path';
import {generateLaravelSchema} from "@/generators/migrations/index.js";
import {generateLaravelModels} from "@/generators/models/index.js";
import {generateTypesFromPrisma} from "@/generators/typescript/index.js";
import {spawn} from "child_process";
import {loadConfig} from "@/core/config/load-config.js";
import {GeneratorOptions} from "@prisma/generator-helper";
import {loadMergedDatamodel} from '@/core/prisma/load-merged-datamodel';
import {getLaravelGeneratorConfigs} from '@/core/prisma/generator-configs';
import {getDMMF} from '@/core/prisma/dmmf';

export function registerGenerateCommand(cli: Command) {
    cli
        .command('gen')
        .description('Run Prisma generate (unless --skipGenerate), then run Laravel + TS generators')
        .option('--config <path>', 'Path to laraschema config file')
        .option('--skipGenerate', 'Only run the Laravel/TS generators (no Prisma generate)')
        .action(async (opts: { config?: string; skipGenerate?: boolean }) => {
            const configPath = opts.config
                ? path.resolve(process.cwd(), opts.config)
                : path.resolve(process.cwd(), 'laraschema.config.js');

            if (!existsSync(configPath)) {
                console.error(`Config file not found: ${configPath}`);
                process.exit(1);
            }

            try {
                await runGenerators(configPath, !!opts.skipGenerate);
                console.log('Generation complete.');
            } catch (e: any) {
                console.error('Gen failed:', e?.message ?? e);
                process.exit(1);
            }
        });
}

export async function runGenerators(configPath: string, skipPrismaGenerate = false) {
    let schemaPrismaPath = path.resolve(process.cwd(), "prisma/schema.prisma");
    if (existsSyncFs(configPath)) {
        const cfgMod = await loadConfig(configPath);
        const cfg = (cfgMod as any).default ?? cfgMod;
        if (cfg?.schemaPath) {
            schemaPrismaPath = path.resolve(process.cwd(), cfg.schemaPath);
        }
    }

    if (!existsSyncFs(schemaPrismaPath)) {
        throw new Error(`Schema not found: ${schemaPrismaPath}`);
    }

    const doRun = async () => {
        const datamodel = await loadMergedDatamodel(schemaPrismaPath);
        const {migCfg, modCfg, tsCfg} = await getLaravelGeneratorConfigs(datamodel);
        const dmmf = await getDMMF(datamodel);

        const config = (conf: any): GeneratorOptions => {
            return {
                dmmf,
                //@ts-ignore
                generator: {config: conf, sourceFilePath: schemaPrismaPath,},
                otherGenerators: [],
                schemaPath: schemaPrismaPath,
                datasources: [],
                datamodel,
                version: "",
            }
        };

        await generateLaravelSchema(config(migCfg));
        await generateLaravelModels(config(modCfg));
        await generateTypesFromPrisma(config(tsCfg));
    };

    if (skipPrismaGenerate) {
        await doRun();
    } else {
        await new Promise<void>((resolve, reject) => {
            const prisma = spawn("npx", ["prisma", "generate"], {
                stdio: "inherit",
                shell: true,
            });
            prisma.on("exit", code => (code !== 0 ? reject(new Error(`prisma generate exited ${code}`)) : resolve()));
        });
        await doRun();
    }
}
