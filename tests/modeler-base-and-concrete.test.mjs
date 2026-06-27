import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const distIndexPath = path.join(repoRoot, "dist", "index.js");
const distIndexUrl = pathToFileURL(distIndexPath).href;

function scalarField(name, type, options = {}) {
  return {
    kind: options.kind ?? "scalar",
    name,
    dbName: options.dbName ?? null,
    type,
    documentation: options.documentation ?? null,
    isList: options.isList ?? false,
    isRequired: options.isRequired ?? true,
    isUnique: false,
    isId: name === "id",
    isReadOnly: false,
    hasDefaultValue: false,
    relationName: null,
    relationFromFields: [],
    relationToFields: [],
  };
}

function relationField(name, type, options = {}) {
  return {
    ...scalarField(name, type, {
      kind: "object",
      isList: options.isList ?? false,
      isRequired: options.isRequired ?? true,
      documentation: options.documentation ?? null,
      dbName: options.dbName ?? null,
    }),
    relationName: options.relationName,
    relationFromFields: options.relationFromFields ?? [],
    relationToFields: options.relationToFields ?? [],
  };
}

function buildDmmf({ withEnum = false } = {}) {
  return {
    datamodel: {
      enums: withEnum
        ? [
            {
              name: "UserStatus",
              values: [{ name: "active" }, { name: "suspended" }],
              dbName: null,
              documentation: null,
            },
          ]
        : [],
      models: [
        {
          name: "User",
          dbName: "users",
          documentation: null,
          fields: [
            scalarField("id", "Int"),
            scalarField("status", "UserStatus", { kind: "enum" }),
            relationField("posts", "Post", {
              isList: true,
              relationName: "PostToUser",
            }),
          ].filter((field) => withEnum || field.name !== "status"),
          primaryKey: null,
          uniqueFields: [],
          uniqueIndexes: [],
        },
        {
          name: "Post",
          dbName: "posts",
          documentation: null,
          fields: [
            scalarField("id", "Int"),
            scalarField("userId", "Int"),
            relationField("user", "User", {
              relationName: "PostToUser",
              relationFromFields: ["userId"],
              relationToFields: ["id"],
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

async function generateWithConfig(root, modelerConfig, dmmfOptions = {}, generatorConfig = {}) {
  const { generateLaravelModels } = await import(
    `${distIndexUrl}?cache=${Date.now()}-${Math.random()}`
  );
  const prismaDir = path.join(root, "prisma");
  const schemaPath = path.join(prismaDir, "schema.prisma");

  await mkdir(prismaDir, { recursive: true });
  await writeFile(schemaPath, "// base and concrete modeler test schema\n", "utf8");
  await writeFile(
    path.join(prismaDir, "laraschema.config.js"),
    `module.exports = {
  rootDir: ${JSON.stringify(root)},
  modeler: ${modelerConfig},
};`,
    "utf8",
  );

  return generateLaravelModels({
    dmmf: buildDmmf(dmmfOptions),
    generator: {
      config: generatorConfig,
      sourceFilePath: schemaPath,
    },
    otherGenerators: [],
    schemaPath,
    datasources: [],
    datamodel: "",
    version: "",
  });
}

test("direct mode keeps current model output and does not create concrete wrappers", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "laraschema-direct-models-"));

  try {
    await generateWithConfig(root, `{
    modelStubPath: "stubs/model.stub",
    enumStubPath: "stubs/enum.stub",
  }`);

    const userPhp = await readFile(path.join(root, "app", "Models", "User.php"), "utf8");

    assert.match(userPhp, /^namespace App\\Models;$/m);
    assert.doesNotMatch(userPhp, /abstract class User/);
    assert.equal(existsSync(path.join(root, "app", "Models", "Generated", "User.php")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("direct mode ignores concrete config fields", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "laraschema-direct-concrete-ignored-"));

  try {
    await generateWithConfig(root, `{
    modelMode: "direct",
    concreteModelOutputDir: "generated/app-models",
    concreteModelNamespace: "Domain\\\\App\\\\Models",
    concreteModelStubPath: "stubs/concrete-model.stub",
    concreteModelOverwriteExisting: true,
    modelStubPath: "stubs/model.stub",
    enumStubPath: "stubs/enum.stub",
  }`);

    const userPhp = await readFile(path.join(root, "app", "Models", "User.php"), "utf8");

    assert.match(userPhp, /^namespace App\\Models;$/m);
    assert.match(userPhp, /return \$this->hasMany\(Post::class, 'userId', 'id'\);/);
    assert.doesNotMatch(userPhp, /\\Domain\\App\\Models\\Post::class/);
    assert.equal(existsSync(path.join(root, "generated", "app-models", "User.php")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("base-and-concrete minimal config writes abstract base and app model", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "laraschema-base-concrete-default-"));

  try {
    await generateWithConfig(root, `{
    modelMode: "base-and-concrete",
    modelStubPath: "stubs/model.stub",
    enumStubPath: "stubs/enum.stub",
  }`);

    const basePhp = await readFile(path.join(root, "app", "Models", "Generated", "User.php"), "utf8");
    const concretePhp = await readFile(path.join(root, "app", "Models", "User.php"), "utf8");

    assert.match(basePhp, /^namespace App\\Models\\Generated;$/m);
    assert.match(basePhp, /abstract class User extends Model/);
    assert.match(concretePhp, /^namespace App\\Models;$/m);
    assert.match(concretePhp, /^use App\\Models\\Generated\\User as GeneratedUser;$/m);
    assert.match(concretePhp, /class User extends GeneratedUser/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("base-and-concrete ignores legacy generator block app models outputDir", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "laraschema-base-concrete-legacy-output-"));

  try {
    await generateWithConfig(
      root,
      `{
    modelMode: "base-and-concrete",
    modelStubPath: "stubs/model.stub",
    enumStubPath: "stubs/enum.stub",
  }`,
      {},
      { outputDir: "app/Models" },
    );

    const basePhp = await readFile(path.join(root, "app", "Models", "Generated", "User.php"), "utf8");
    const concretePhp = await readFile(path.join(root, "app", "Models", "User.php"), "utf8");

    assert.match(basePhp, /^namespace App\\Models\\Generated;$/m);
    assert.match(concretePhp, /^namespace App\\Models;$/m);
    assert.match(basePhp, /return \$this->hasMany\(\\App\\Models\\Post::class, 'userId', 'id'\);/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("base-and-concrete retargets base relations to concrete models", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "laraschema-base-concrete-relations-"));

  try {
    await generateWithConfig(root, `{
    modelMode: "base-and-concrete",
    modelStubPath: "stubs/model.stub",
    enumStubPath: "stubs/enum.stub",
  }`);

    const basePhp = await readFile(path.join(root, "app", "Models", "Generated", "User.php"), "utf8");

    assert.match(basePhp, /return \$this->hasMany\(\\App\\Models\\Post::class, 'userId', 'id'\);/);
    assert.doesNotMatch(basePhp, /return \$this->hasMany\(Post::class/);
    assert.doesNotMatch(basePhp, /\\App\\Models\\Generated\\Post::class/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("base-and-concrete does not overwrite existing concrete models by default", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "laraschema-base-concrete-overwrite-"));
  const existing = "<?php\n\nnamespace App\\Models;\n\nclass User\n{\n    public function custom() {}\n}\n";

  try {
    await mkdir(path.join(root, "app", "Models"), { recursive: true });
    await writeFile(path.join(root, "app", "Models", "User.php"), existing, "utf8");

    await generateWithConfig(root, `{
    modelMode: "base-and-concrete",
    modelStubPath: "stubs/model.stub",
    enumStubPath: "stubs/enum.stub",
  }`);

    const concretePhp = await readFile(path.join(root, "app", "Models", "User.php"), "utf8");

    assert.equal(concretePhp, existing);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("base-and-concrete keeps enums direct and imports generated enum namespace", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "laraschema-base-concrete-enums-"));

  try {
    await generateWithConfig(
      root,
      `{
    modelMode: "base-and-concrete",
    outputEnumDir: "generated/php-enums",
    enumNamespace: "Domain\\\\Schema\\\\Enums",
    modelStubPath: "stubs/model.stub",
    enumStubPath: "stubs/enum.stub",
  }`,
      { withEnum: true },
    );

    const basePhp = await readFile(path.join(root, "app", "Models", "Generated", "User.php"), "utf8");
    const enumPhp = await readFile(path.join(root, "generated", "php-enums", "UserStatus.php"), "utf8");

    assert.match(enumPhp, /^namespace Domain\\Schema\\Enums;$/m);
    assert.match(basePhp, /^use Domain\\Schema\\Enums\\UserStatus;$/m);
    assert.equal(existsSync(path.join(root, "app", "Models", "UserStatus.php")), false);
    assert.equal(existsSync(path.join(root, "app", "Models", "Generated", "UserStatus.php")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("base-and-concrete rejects generated and concrete namespace collisions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "laraschema-base-concrete-collision-"));

  try {
    await assert.rejects(
      () =>
        generateWithConfig(root, `{
    modelMode: "base-and-concrete",
    modelNamespace: "App\\\\Models\\\\",
    concreteModelNamespace: "App\\\\Models",
    modelStubPath: "stubs/model.stub",
    enumStubPath: "stubs/enum.stub",
  }`),
      /generated base and concrete model namespaces\/directories must be different/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("base-and-concrete supports custom generated concrete and enum namespaces", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "laraschema-base-concrete-custom-"));

  try {
    await generateWithConfig(
      root,
      `{
    modelMode: "base-and-concrete",
    outputDir: "generated/base-models",
    modelNamespace: "Domain\\\\Schema\\\\Base",
    concreteModelOutputDir: "generated/app-models",
    concreteModelNamespace: "Domain\\\\App\\\\Models",
    outputEnumDir: "generated/php-enums",
    enumNamespace: "Domain\\\\Schema\\\\Enums",
    modelStubPath: "stubs/model.stub",
    enumStubPath: "stubs/enum.stub",
  }`,
      { withEnum: true },
    );

    const basePhp = await readFile(path.join(root, "generated", "base-models", "User.php"), "utf8");
    const concretePhp = await readFile(path.join(root, "generated", "app-models", "User.php"), "utf8");
    const enumPhp = await readFile(path.join(root, "generated", "php-enums", "UserStatus.php"), "utf8");

    assert.match(basePhp, /^namespace Domain\\Schema\\Base;$/m);
    assert.match(concretePhp, /^namespace Domain\\App\\Models;$/m);
    assert.match(enumPhp, /^namespace Domain\\Schema\\Enums;$/m);
    assert.match(basePhp, /^use Domain\\Schema\\Enums\\UserStatus;$/m);
    assert.match(basePhp, /return \$this->hasMany\(\\Domain\\App\\Models\\Post::class, 'userId', 'id'\);/);
    assert.match(concretePhp, /^use Domain\\Schema\\Base\\User as GeneratedUser;$/m);
    assert.match(concretePhp, /class User extends GeneratedUser/);
    assert.doesNotMatch(basePhp, /\\Domain\\Schema\\Base\\Post::class/);
    assert.doesNotMatch(basePhp, /return \$this->hasMany\(Post::class/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
