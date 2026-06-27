import {GeneratorConfig, GeneratorOptions} from "@prisma/generator-helper";
import {existsSync, mkdirSync} from "fs";
import path from "path";
import {addToConfig} from '@/core/config/config-store';
import {getStubPath} from '@/core/stubs/get-stub-path';
import type {StubConfig} from '@/core/stubs/stub-config.types';
import {StubModelPrinter} from "@/generators/models/printer/model-printer";
import {PrismaToLaravelModelGenerator} from "./generator.js";
import {EnumDefinition, ModelDefinition} from "./model.types";
import {writeWithMerge} from "@/core/writer/write-with-merge";
import {ModelConfigOverride, StubGroupConfig} from "@/core/config/laravel-config.types.js";
import {loadSharedConfig} from "@/core/config/load-shared-config";
import {buildModelContent} from "@/shared/build/build-model-content";
import {resolveFromRoot} from "@/shared/utils/paths";
import {runModelerHooks} from "@/generators/models/run-hooks";

export interface ModelConfig extends StubConfig, Omit<ModelConfigOverride, 'groups' | 'stubDir'> {
}

const DIRECT_MODEL_OUTPUT_DIR = "app/Models";
const GENERATED_MODEL_OUTPUT_DIR = "app/Models/Generated";
const DIRECT_MODEL_NAMESPACE = "App\\Models";
const GENERATED_MODEL_NAMESPACE = "App\\Models\\Generated";

export async function generateLaravelModels(options: GeneratorOptions) {
    const {dmmf, generator} = options;
    // 0) Pull config values
    // Inside generateLaravelModels()
    /** ---------------- existing logic --------------------- */
    const raw = (generator.config ?? {}) as Record<string, string | undefined>;

    /* load shared cfg (auto-discovers prisma/laravel.config.js) */
    const schemaDir = path.dirname(generator.sourceFilePath ?? path.resolve(options.schemaPath));          // << from GeneratorOptions
    const shared = await loadSharedConfig(schemaDir, 'models');

    /* merge stub groups from block, then shared file (shared wins) */
    let groups: StubGroupConfig[] = [];
    if (raw["groups"]) {
        const groupsModulePath = path.resolve(process.cwd(), raw["groups"]);
        const imported = (await import(groupsModulePath)).default ?? (await import(groupsModulePath));
        if (!Array.isArray(imported)) {
            throw new Error(
                `Custom groups module must export an array, but got ${typeof imported}`
            );
        }
        groups = imported;
    }

    /* helper to prefer shared → per-gen → block */
    const pick = <K extends keyof ModelConfigOverride>(
        key: K,
        fallback?: any
    ): any | undefined =>
        (shared.modeler as any)?.[key] ??
        (shared as any)[key] ??
        raw[key as string] ??
        fallback;

    const modelMode = (pick("modelMode", "direct") as ModelConfigOverride["modelMode"]) ?? "direct";
    const modelOutputDir = resolveModelOutputDir(shared, raw, modelMode);
    const generatedNamespaceFallback = modelMode === "base-and-concrete"
        ? GENERATED_MODEL_NAMESPACE
        : undefined;

    /* -------- merged config -------- */
    const cfg: ModelConfig = {
        modelMode,
        overwriteExisting: pick("overwriteExisting", true),
        outputDir: modelOutputDir,
        outputEnumDir: pick("outputEnumDir"),
        prettier: pick("prettier", false),
        awobaz: pick("awobaz", false),
        stubDir: pick("stubDir")!,          // shared stubDir wins
        groups,
        /* NEW global prefix/suffix made available downstream */
        /* NEW global table decoration */
        tablePrefix: pick('tablePrefix', ''),
        tableSuffix: pick('tableSuffix', ''),
        enumStubPath: pick('enumStubPath'),
        modelStubPath: pick('modelStubPath'),
        noEmit: pick('noEmit', false),
        allowedPivotExtraFields: pick('allowedPivotExtraFields', []),
        castMaps: pick('castMaps'),
        namespace: pick("namespace", "App"),
        modelNamespace: pick("modelNamespace", generatedNamespaceFallback),
        enumNamespace: pick("enumNamespace"),
        concreteModelOutputDir: pick("concreteModelOutputDir", DIRECT_MODEL_OUTPUT_DIR),
        concreteModelNamespace: pick("concreteModelNamespace", DIRECT_MODEL_NAMESPACE),
        concreteModelStubPath: pick("concreteModelStubPath"),
        concreteModelOverwriteExisting: pick("concreteModelOverwriteExisting", false),
        hooks: pick("hooks"),
    };

    const activeConfig = {...cfg, rootDir: shared.rootDir};

    addToConfig('model', activeConfig);

    // 1) Determine and ensure output directories
    const modelsDir = cfg.outputDir
        ? resolveFromRoot(shared, cfg.outputDir)
        : resolveFromRoot(shared, getOutDir(generator));
    const concreteModelsDir = resolveFromRoot(shared, cfg.concreteModelOutputDir ?? DIRECT_MODEL_OUTPUT_DIR);

    if (cfg.modelMode === "base-and-concrete") {
        validateBaseAndConcreteConfig(
            cfg.modelNamespace ?? GENERATED_MODEL_NAMESPACE,
            cfg.concreteModelNamespace ?? DIRECT_MODEL_NAMESPACE,
            modelsDir,
            concreteModelsDir
        );
    }

    if (!existsSync(modelsDir)) {
        mkdirSync(modelsDir, {recursive: true});
    }

    if (cfg.modelMode === "base-and-concrete" && !existsSync(concreteModelsDir)) {
        mkdirSync(concreteModelsDir, {recursive: true});
    }

    const enumsDir = cfg.outputEnumDir
        ? resolveFromRoot(shared, cfg.outputEnumDir)
        : resolveFromRoot(shared, 'app/Enums');

    if (!existsSync(enumsDir)) {
        mkdirSync(enumsDir, {recursive: true});
    }


    // 2) Load stubs (allow overrides)
    const mStub = (shared.output?.models ?? cfg.modelStubPath);
    const modelStub = mStub
        ? path.resolve(process.cwd(), mStub)
        : getStubPath("model.stub");

    const eStub = (shared.output?.enums ?? cfg.enumStubPath);
    const enumStub = eStub
        ? path.resolve(process.cwd(), eStub)
        : getStubPath("enum.stub");

    const concreteModelStub = cfg.concreteModelStubPath
        ? path.resolve(process.cwd(), cfg.concreteModelStubPath)
        : getStubPath("concrete-model.stub");

    const printer = new StubModelPrinter(cfg, modelStub, enumStub, concreteModelStub);

    // 3) Generate definitions
    const schemaGen = new PrismaToLaravelModelGenerator(dmmf);
    const {models, enums}: {
        models: ModelDefinition[];
        enums: EnumDefinition[];
    } = schemaGen.generateAll();

    if (cfg.modelMode === "base-and-concrete") {
        retargetRelationsToConcreteModels(
            models,
            cfg.concreteModelNamespace ?? DIRECT_MODEL_NAMESPACE
        );
        for (const model of models) {
            model.abstract = true;
        }
    }

    // 3b) Run hooks
    await runModelerHooks(activeConfig.hooks, {
        models,
        enums,
        config: activeConfig,
    });

    // 4) Write enum files
    for (const enumDef of enums) {
        const enumPhp = printer.printEnum(enumDef);
        const enumFile = path.join(enumsDir, `${enumDef.name}.php`);
        !cfg.noEmit &&
        await writeWithMerge(
            enumFile,
            enumPhp,
            'model',
            cfg.overwriteExisting ?? true
        );
    }

    // 5) Write model files
    for (const model of models) {
        if (model.isIgnored) continue;
        const enumImports = new Map(enums.map(enumDef => [enumDef.name, enumDef.namespace]));
        let imports = model.properties
            .filter(item => item.enumRef)
            .map(item => `use ${enumImports.get(item.enumRef as string) ?? appendPhpNamespace(cfg.namespace ?? 'App', 'Enums')}\\${item.enumRef};`);
        //----
        if (Array.isArray(model.imports)) model.imports.push(...imports);
        else model.imports = imports;
        //---
        model.imports = Array.from(new Set(model.imports));
        //----
        const content = {
            toString() {
                return buildModelContent(model);
            }
        };
        const modelPhp = printer.printModel(model, enums, content as any);
        const modelFile = path.join(modelsDir, `${model.className}.php`);

        !cfg.noEmit &&
        await writeWithMerge(
            modelFile,
            modelPhp,
            'model',
            cfg.overwriteExisting ?? true
        );

        if (cfg.modelMode === "base-and-concrete") {
            const concreteModel = buildConcreteModelDefinition(
                model,
                cfg.concreteModelNamespace ?? DIRECT_MODEL_NAMESPACE
            );
            const concretePhp = printer.printConcreteModel(concreteModel);
            const concreteFile = path.join(concreteModelsDir, `${model.className}.php`);

            !cfg.noEmit &&
            await writeWithMerge(
                concreteFile,
                concretePhp,
                'model',
                cfg.concreteModelOverwriteExisting ?? false
            );
        }
    }

    return {models, enums};
}

function getOutDir(generator: GeneratorConfig): string {
    return generator.output?.value ?? "app/Models";
}

function resolveModelOutputDir(
    shared: Awaited<ReturnType<typeof loadSharedConfig>>,
    raw: Record<string, string | undefined>,
    modelMode: ModelConfigOverride["modelMode"]
): string | undefined {
    const sharedModelerOutputDir = (shared.modeler as any)?.outputDir;
    if (sharedModelerOutputDir) return sharedModelerOutputDir;

    const sharedOutputDir = (shared as any).outputDir;
    if (sharedOutputDir) return sharedOutputDir;

    const blockOutputDir = raw.outputDir;

    if (modelMode !== "base-and-concrete") return blockOutputDir;
    if (!blockOutputDir) return GENERATED_MODEL_OUTPUT_DIR;

    const blockOutputPath = resolveFromRoot(shared, blockOutputDir);
    const legacyDirectPath = resolveFromRoot(shared, DIRECT_MODEL_OUTPUT_DIR);

    return normalizeResolvedPath(blockOutputPath) === normalizeResolvedPath(legacyDirectPath)
        ? GENERATED_MODEL_OUTPUT_DIR
        : blockOutputDir;
}

function normalizePhpNamespace(value: string): string {
    return value.replace(/\\+$/, "");
}

function appendPhpNamespace(base: string, segment: string): string {
    const normalizedBase = normalizePhpNamespace(base);
    return normalizedBase ? `${normalizedBase}\\${segment}` : segment;
}

function normalizeResolvedPath(value: string): string {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function validateBaseAndConcreteConfig(
    generatedNamespace: string,
    concreteNamespace: string,
    generatedDir: string,
    concreteDir: string
) {
    const normalizedGeneratedNamespace = normalizePhpNamespace(generatedNamespace);
    const normalizedConcreteNamespace = normalizePhpNamespace(concreteNamespace);
    const sameNamespace = normalizedGeneratedNamespace === normalizedConcreteNamespace;
    const sameDir = normalizeResolvedPath(generatedDir) === normalizeResolvedPath(concreteDir);

    if (sameNamespace || sameDir) {
        throw new Error(
            "Generated base and concrete model namespaces/directories must be different in base-and-concrete mode."
        );
    }
}

function retargetRelationsToConcreteModels(models: ModelDefinition[], concreteNamespace: string) {
    const normalizedNamespace = normalizePhpNamespace(concreteNamespace);

    for (const model of models) {
        for (const relation of model.relations) {
            if (!relation.targetModelName) continue;
            relation.modelClass = `\\${appendPhpNamespace(normalizedNamespace, relation.targetModelName)}::class`;
        }
    }
}

function buildConcreteModelDefinition(
    baseModel: ModelDefinition,
    concreteNamespace: string
): ModelDefinition {
    const baseAlias = `Generated${baseModel.className}`;

    return {
        isIgnored: false,
        className: baseModel.className,
        tableName: baseModel.tableName,
        properties: [],
        relations: [],
        enums: [],
        interfaces: {},
        namespace: normalizePhpNamespace(concreteNamespace),
        imports: [`use ${appendPhpNamespace(baseModel.namespace, baseModel.className)} as ${baseAlias};`],
        extends: baseAlias,
        abstract: false,
        traits: [],
        implements: [],
        docblockProps: [],
    };
}
