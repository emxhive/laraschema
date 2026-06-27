import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const distIndexPath = path.join(repoRoot, "dist", "index.js");
const distIndexUrl = pathToFileURL(distIndexPath).href;

function field(
  name,
  type,
  {
    kind = "scalar",
    isList = false,
    isRequired = true,
    documentation = null,
    dbName = null,
  } = {},
) {
  return {
    kind,
    name,
    dbName,
    type,
    documentation,
    isList,
    isRequired,
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
      enums: [
        {
          name: "AccountStatus",
          values: [{ name: "active" }, { name: "suspended" }],
          dbName: null,
          documentation: null,
        },
      ],
      models: [
        {
          name: "Account",
          dbName: "accounts",
          documentation: null,
          fields: [
            field("id", "Int"),
            field("status", "AccountStatus", { kind: "enum" }),
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

async function generateWithConfig(root, configBody) {
  const { generateLaravelModels } = await import(distIndexUrl);
  const prismaDir = path.join(root, "prisma");
  const schemaPath = path.join(prismaDir, "schema.prisma");
  const configPath = path.join(prismaDir, "laraschema.config.js");

  await mkdir(prismaDir, { recursive: true });
  await writeFile(schemaPath, "// namespace test schema\n", "utf8");
  await writeFile(configPath, configBody, "utf8");

  return generateLaravelModels({
    dmmf: buildDmmf(),
    generator: {
      config: {},
      sourceFilePath: schemaPath,
    },
    otherGenerators: [],
    schemaPath,
    datasources: [],
    datamodel: "",
    version: "",
  });
}

test("modeler default namespaces are independent from output directories", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "laraschema-default-namespaces-"));

  try {
    const result = await generateWithConfig(
      root,
      `module.exports = {
  rootDir: ${JSON.stringify(root)},
  modeler: {
    outputDir: "generated/custom-model-output",
    outputEnumDir: "generated/custom-enum-output",
    modelStubPath: "stubs/model.stub",
    enumStubPath: "stubs/enum.stub",
  },
};`,
    );

    const model = result.models.find((item) => item.className === "Account");
    const enumDef = result.enums.find((item) => item.name === "AccountStatus");

    assert.equal(model?.namespace, "App\\Models");
    assert.equal(enumDef?.namespace, "App\\Enums");

    const modelPhp = await readFile(
      path.join(root, "generated", "custom-model-output", "Account.php"),
      "utf8",
    );
    const enumPhp = await readFile(
      path.join(root, "generated", "custom-enum-output", "AccountStatus.php"),
      "utf8",
    );

    assert.match(modelPhp, /^namespace App\\Models;$/m);
    assert.match(enumPhp, /^namespace App\\Enums;$/m);
    assert.match(modelPhp, /^use App\\Enums\\AccountStatus;$/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("modeler custom namespaces are full PHP namespaces", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "laraschema-custom-namespaces-"));

  try {
    const result = await generateWithConfig(
      root,
      `module.exports = {
  rootDir: ${JSON.stringify(root)},
  modeler: {
    outputDir: "generated/models",
    outputEnumDir: "generated/enums",
    modelNamespace: "Domain\\\\Generated\\\\Models\\\\",
    enumNamespace: "Domain\\\\Generated\\\\Enums\\\\",
    modelStubPath: "stubs/model.stub",
    enumStubPath: "stubs/enum.stub",
  },
};`,
    );

    const model = result.models.find((item) => item.className === "Account");
    const enumDef = result.enums.find((item) => item.name === "AccountStatus");

    assert.equal(model?.namespace, "Domain\\Generated\\Models");
    assert.equal(enumDef?.namespace, "Domain\\Generated\\Enums");

    const modelPhp = await readFile(
      path.join(root, "generated", "models", "Account.php"),
      "utf8",
    );
    const enumPhp = await readFile(
      path.join(root, "generated", "enums", "AccountStatus.php"),
      "utf8",
    );

    assert.match(modelPhp, /^namespace Domain\\Generated\\Models;$/m);
    assert.match(enumPhp, /^namespace Domain\\Generated\\Enums;$/m);
    assert.match(modelPhp, /^use Domain\\Generated\\Enums\\AccountStatus;$/m);
    assert.doesNotMatch(modelPhp, /namespace Domain\\Generated\\Models\\Models;/);
    assert.doesNotMatch(enumPhp, /namespace Domain\\Generated\\Enums\\Enums;/);
    assert.doesNotMatch(modelPhp, /^use App\\Enums\\AccountStatus;$/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});