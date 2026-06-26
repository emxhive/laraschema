import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const distIndexPath = path.join(repoRoot, "dist", "index.js");
const distIndexUrl = pathToFileURL(distIndexPath).href;
const cliPath = path.join(repoRoot, "dist", "bin", "cli.js");

function scalarField(name, type, { isList = false, documentation = null } = {}) {
  return {
    kind: "scalar",
    name,
    dbName: null,
    type,
    documentation,
    isList,
    isRequired: true,
    isUnique: false,
    isId: name === "id",
    isReadOnly: false,
    hasDefaultValue: false,
    relationName: null,
    relationFromFields: [],
    relationToFields: [],
  };
}

function buildDmmf() {
  return {
    datamodel: {
      enums: [],
      models: [
        {
          name: "Sample",
          dbName: "samples",
          documentation: null,
          fields: [
            scalarField("id", "Int"),
            scalarField("payload", "Json"),
            scalarField("big_count", "BigInt"),
            scalarField("big_items", "BigInt", { isList: true }),
            scalarField("created_at", "DateTime"),
            scalarField("forced", "String", {
              documentation: "@cast{encrypted:array}",
            }),
          ],
          primaryKey: null,
          uniqueFields: [],
          uniqueIndexes: [],
        },
      ],
      types: [],
    },
    schema: {
      enumTypes: { prisma: [], model: [] },
      inputObjectTypes: { prisma: [] },
      outputObjectTypes: { prisma: [], model: [] },
      fieldRefTypes: { prisma: [] },
    },
    mappings: { modelOperations: [], otherOperations: { read: [], write: [] } },
  };
}

test("model castMaps overrides built-ins and preserves @cast directives", async () => {
  const { generateLaravelModels, buildModelContent } = await import(distIndexUrl);
  const root = await mkdtemp(path.join(tmpdir(), "laraschema-castmaps-"));
  const prismaDir = path.join(root, "prisma");
  const schemaPath = path.join(prismaDir, "schema.prisma");
  const configPath = path.join(prismaDir, "laraschema.config.js");

  try {
    await mkdir(prismaDir, { recursive: true });
    await writeFile(schemaPath, "// test schema\n", "utf8");
    await writeFile(
      configPath,
      `module.exports = {
  modeler: {
    modelStubPath: "stubs/model.stub",
    enumStubPath: "stubs/enum.stub",
    castMaps: {
      Json: "'array'",
      BigInt: ({ isList, ignore }) =>
        isList
          ? "Illuminate\\\\Database\\\\Eloquent\\\\Casts\\\\AsCollection::class"
          : ignore?.includes("BigInt")
            ? "'string'"
            : "'int'",
      DateTime: ({ prismaType }) => (prismaType === "DateTime" ? "'datetime'" : "'string'"),
    },
  },
};`,
      "utf8",
    );

    const result = await generateLaravelModels({
      dmmf: buildDmmf(),
      generator: {
        config: {
          noEmit: true,
          outputDir: "app/Models",
          outputEnumDir: "app/Enums",
        },
        sourceFilePath: schemaPath,
      },
      otherGenerators: [],
      schemaPath,
      datasources: [],
      datamodel: "",
      version: "",
    });

    const model = result.models.find((m) => m.className === "Sample");
    assert.ok(model, "Expected generated Sample model definition");

    const payload = model.properties.find((p) => p.name === "payload");
    const bigCount = model.properties.find((p) => p.name === "big_count");
    const bigItems = model.properties.find((p) => p.name === "big_items");
    const createdAt = model.properties.find((p) => p.name === "created_at");
    const forced = model.properties.find((p) => p.name === "forced");

    assert.equal(payload?.phpType, "'array'");
    assert.equal(bigCount?.phpType, "'string'");
    assert.equal(bigItems?.phpType, "AsCollection::class");
    assert.equal(createdAt?.phpType, "'datetime'");
    assert.equal(forced?.cast, "encrypted:array");

    const content = buildModelContent(model);
    assert.match(content, /'payload' => 'array'/);
    assert.match(content, /'big_count' => 'string'/);
    assert.match(content, /'big_items' => AsCollection::class/);
    assert.match(content, /'created_at' => 'datetime'/);
    assert.match(content, /'forced' => 'encrypted:array'/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli bin help lists expected commands", () => {
  const run = spawnSync(process.execPath, [cliPath, "--help"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr || "Expected zero exit code");

  const output = `${run.stdout}\n${run.stderr}`;
  assert.match(output, /\binit\b/);
  assert.match(output, /\bcustomize\b/);
  assert.match(output, /\bgen\b/);
  assert.match(output, /\blist\b/);
  assert.match(output, /\bclean\b/);
});

test("modeler hooks run and receive correct context", async () => {
  const { generateLaravelModels } = await import(distIndexUrl);
  const root = await mkdtemp(path.join(tmpdir(), "laraschema-hooks-"));
  const prismaDir = path.join(root, "prisma");
  const schemaPath = path.join(prismaDir, "schema.prisma");
  const configPath = path.join(prismaDir, "laraschema.config.js");
  const outputPath = path.join(root, "hook-output.json");

  try {
    await mkdir(prismaDir, { recursive: true });
    await writeFile(schemaPath, "// test schema\n", "utf8");
    await writeFile(
      configPath,
      `module.exports = {
  modeler: {
    hooks: [
      async (ctx) => {
        await ctx.writeJson(
          "${outputPath.replace(/\\/g, "/")}",
          {
            hasModels: Array.isArray(ctx.models),
            hasEnums: Array.isArray(ctx.enums),
            configNamespace: ctx.config?.namespace,
          }
        );
      }
    ],
  },
};`,
      "utf8",
    );

    await generateLaravelModels({
      dmmf: buildDmmf(),
      generator: {
        config: {
          noEmit: true,
          outputDir: "app/Models",
          outputEnumDir: "app/Enums",
        },
        sourceFilePath: schemaPath,
      },
      otherGenerators: [],
      schemaPath,
      datasources: [],
      datamodel: "",
      version: "",
    });

    const fileContent = await readFile(outputPath, "utf8");
    const parsed = JSON.parse(fileContent);

    assert.equal(parsed.hasModels, true, "Hook context should have models array");
    assert.equal(parsed.hasEnums, true, "Hook context should have enums array");
    assert.equal(parsed.configNamespace, "App", "Hook context should contain the resolved config");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
