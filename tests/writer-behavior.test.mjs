import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import crypto from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const distIndexPath = path.join(repoRoot, "dist", "index.js");
const distIndexUrl = pathToFileURL(distIndexPath).href;

const defaultFields = [
  {
    kind: "scalar",
    name: "id",
    dbName: null,
    type: "Int",
    documentation: null,
    isList: false,
    isRequired: true,
    isUnique: false,
    isId: true,
    isReadOnly: false,
    hasDefaultValue: false,
    relationName: null,
    relationFromFields: [],
    relationToFields: [],
  },
  {
    kind: "scalar",
    name: "name",
    dbName: null,
    type: "String",
    documentation: null,
    isList: false,
    isRequired: true,
    isUnique: false,
    isId: false,
    isReadOnly: false,
    hasDefaultValue: false,
    relationName: null,
    relationFromFields: [],
    relationToFields: [],
  }
];

const modifiedFields = [
  ...defaultFields,
  {
    kind: "scalar",
    name: "email",
    dbName: null,
    type: "String",
    documentation: null,
    isList: false,
    isRequired: true,
    isUnique: false,
    isId: false,
    isReadOnly: false,
    hasDefaultValue: false,
    relationName: null,
    relationFromFields: [],
    relationToFields: [],
  }
];

async function runGeneratorWithConfig(root, writerConfig, otherModelerConfig = {}, fields = defaultFields) {
  const { generateLaravelModels } = await import(
    `${distIndexUrl}?cache=${Date.now()}-${Math.random()}`
  );
  const prismaDir = path.join(root, "prisma");
  const schemaPath = path.join(prismaDir, "schema.prisma");

  await mkdir(prismaDir, { recursive: true });
  await writeFile(schemaPath, "// writer test schema\n", "utf8");

  const configObj = {
    rootDir: root,
    writer: writerConfig,
    modeler: {
      modelStubPath: path.resolve(repoRoot, "stubs", "model.stub"),
      enumStubPath: path.resolve(repoRoot, "stubs", "enum.stub"),
      ...otherModelerConfig,
    }
  };

  await writeFile(
    path.join(prismaDir, "laraschema.config.js"),
    `module.exports = ${JSON.stringify(configObj, null, 2)};`,
    "utf8"
  );

  return generateLaravelModels({
    dmmf: {
      datamodel: {
        enums: [],
        models: [
          {
            name: "User",
            dbName: "users",
            documentation: null,
            fields,
            primaryKey: null,
            uniqueFields: [],
            uniqueIndexes: [],
          }
        ]
      },
      schema: {
        enumTypes: { prisma: [], model: [] },
        inputObjectTypes: { prisma: [] },
        outputObjectTypes: { prisma: [], model: [] },
        fieldRefTypes: { prisma: [] },
      },
      mappings: { modelOperations: [], otherOperations: { read: [], write: [] } }
    },
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

test("writer behavior: default config preserves current merge behavior", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "laraschema-writer-test-"));
  try {
    const file = path.join(root, "app", "Models", "User.php");

    // Write first generation (base)
    await runGeneratorWithConfig(root, undefined, {}, defaultFields);

    // Modify user file manually (mine)
    const customMethod = "\n    public function custom() {}\n";
    let content = await readFile(file, "utf8");
    content = content.replace("}", customMethod + "}");
    await writeFile(file, content, "utf8");

    // Generator changes (theirs)
    await runGeneratorWithConfig(root, undefined, {}, modifiedFields);

    const mergedContent = await readFile(file, "utf8");
    // Should merge correctly without conflict markers because they are distinct lines
    assert.match(mergedContent, /public function custom\(\)/);
    assert.match(mergedContent, /@property string \$email/);
    assert.doesNotMatch(mergedContent, /<<<<<<<|=======|>>>>>>>/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writer behavior: conflictStrategy = 'overwrite' replaces existing generated file", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "laraschema-writer-test-"));
  try {
    const file = path.join(root, "app", "Models", "User.php");

    // First write
    await runGeneratorWithConfig(root, {
      tracking: "snapshot",
      conflictStrategy: "overwrite",
    }, {}, defaultFields);

    // User edits
    await writeFile(file, "<?php\nclass User {\n  // User edited\n}\n", "utf8");

    // Overwrite write
    await runGeneratorWithConfig(root, {
      tracking: "snapshot",
      conflictStrategy: "overwrite",
    }, {}, modifiedFields);

    const content = await readFile(file, "utf8");
    assert.match(content, /@property string \$email/);
    assert.doesNotMatch(content, /User edited/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writer behavior: conflictStrategy = 'fail' does not write conflict markers and leaves existing file unchanged", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "laraschema-writer-test-"));
  try {
    const file = path.join(root, "app", "Models", "User.php");

    // First write
    await runGeneratorWithConfig(root, {
      tracking: "snapshot",
      conflictStrategy: "fail",
    }, {}, defaultFields);

    // User edits
    const editedContent = "<?php\nclass User {\n  // User edited\n}\n";
    await writeFile(file, editedContent, "utf8");

    // Fail write (conflict)
    await assert.rejects(
      async () => {
        await runGeneratorWithConfig(root, {
          tracking: "snapshot",
          conflictStrategy: "fail",
        }, {}, modifiedFields);
      },
      /Generated file conflict:.*User\.php/
    );

    // File remains unchanged
    assert.equal(await readFile(file, "utf8"), editedContent);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writer behavior: conflictStrategy = 'skip' leaves existing file unchanged and generation continues", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "laraschema-writer-test-"));
  try {
    const file = path.join(root, "app", "Models", "User.php");

    // First write
    await runGeneratorWithConfig(root, {
      tracking: "snapshot",
      conflictStrategy: "skip",
    }, {}, defaultFields);

    // User edits
    const editedContent = "<?php\nclass User {\n  // User edited\n}\n";
    await writeFile(file, editedContent, "utf8");

    // Skip write (conflict) - should not throw
    await runGeneratorWithConfig(root, {
      tracking: "snapshot",
      conflictStrategy: "skip",
    }, {}, modifiedFields);

    // File remains unchanged
    assert.equal(await readFile(file, "utf8"), editedContent);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writer behavior: tracking = 'hash' writes/updates manifest and supports overwrite", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "laraschema-writer-test-"));
  try {
    const file = path.join(root, "app", "Models", "User.php");

    // First write
    await runGeneratorWithConfig(root, {
      tracking: "hash",
      conflictStrategy: "overwrite",
    }, {}, defaultFields);

    const manifestPath = path.join(root, ".laraschema", "generated-manifest.json");
    assert.ok(existsSync(manifestPath), "Manifest was created");

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.version, 1);
    const relativeKey = "app/Models/User.php";
    assert.ok(manifest.files[relativeKey]);
    assert.equal(manifest.files[relativeKey].type, "model");
    assert.match(manifest.files[relativeKey].hash, /^sha256:[a-f0-9]{64}$/);
    assert.ok(manifest.files[relativeKey].updatedAt);

    // Overwrite check
    await writeFile(file, "<?php\nclass User {\n  // Edited\n}\n", "utf8");
    await runGeneratorWithConfig(root, {
      tracking: "hash",
      conflictStrategy: "overwrite",
    }, {}, modifiedFields);

    const content = await readFile(file, "utf8");
    assert.match(content, /@property string \$email/);
    assert.doesNotMatch(content, /Edited/);

    const updatedManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.notEqual(updatedManifest.files[relativeKey].hash, manifest.files[relativeKey].hash);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writer behavior: skip and fail do not update the manifest", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "laraschema-writer-test-"));
  try {
    const file = path.join(root, "app", "Models", "User.php");

    // First write (creates manifest entry)
    await runGeneratorWithConfig(root, {
      tracking: "hash",
      conflictStrategy: "skip",
    }, {}, defaultFields);

    const manifestPath = path.join(root, ".laraschema", "generated-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const relativeKey = "app/Models/User.php";
    const initialHash = manifest.files[relativeKey].hash;

    // User edits
    await writeFile(file, "<?php\nclass User {\n  // Edit\n}\n", "utf8");

    // Skip write
    await runGeneratorWithConfig(root, {
      tracking: "hash",
      conflictStrategy: "skip",
    }, {}, modifiedFields);

    // Manifest hash should remain unchanged because file was skipped
    const postSkipManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.equal(postSkipManifest.files[relativeKey].hash, initialHash);

    // Now test with fail strategy
    const root2 = await mkdtemp(path.join(tmpdir(), "laraschema-writer-test-"));
    try {
      const file2 = path.join(root2, "app", "Models", "User.php");
      await runGeneratorWithConfig(root2, {
        tracking: "hash",
        conflictStrategy: "fail",
      }, {}, defaultFields);

      const manifestPath2 = path.join(root2, ".laraschema", "generated-manifest.json");
      const manifest2 = JSON.parse(readFileSync(manifestPath2, "utf8"));
      const relativeKey2 = "app/Models/User.php";
      const initialHash2 = manifest2.files[relativeKey2].hash;

      await writeFile(file2, "<?php\nclass User {\n  // Edit\n}\n", "utf8");

      await assert.rejects(
        async () => {
          await runGeneratorWithConfig(root2, {
            tracking: "hash",
            conflictStrategy: "fail",
          }, {}, modifiedFields);
        },
        /Generated file conflict/
      );

      const postFailManifest = JSON.parse(readFileSync(manifestPath2, "utf8"));
      assert.equal(postFailManifest.files[relativeKey2].hash, initialHash2);
    } finally {
      await rm(root2, { recursive: true, force: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writer behavior: hash tracking canonicalizes line endings, trailing whitespace, and final newlines", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "laraschema-writer-test-"));
  try {
    const file = path.join(root, "app", "Models", "User.php");
    const customStubDir = path.join(root, "custom_stubs");
    await mkdir(customStubDir, { recursive: true });

    const firstStub = "<?php\r\nclass ${model.className} {\t\r\n    public $id;\r\n    public $name;\r\n}\t\r\n\r\n";
    const firstStubPath = path.join(customStubDir, "model.stub");
    await writeFile(firstStubPath, firstStub, "utf8");

    // First write with CRLF and trailing spaces in stub
    await runGeneratorWithConfig(root, {
      tracking: "hash",
      conflictStrategy: "fail",
    }, {
      modelStubPath: firstStubPath,
    }, defaultFields);

    const manifestPath = path.join(root, ".laraschema", "generated-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const relativeKey = "app/Models/User.php";
    const hash = manifest.files[relativeKey].hash;

    // Verify it is the hash of the canonicalized content
    // Expected canonical has trailing space stripped and normalized line endings.
    // Prettier is NOT on in this test, so it only canonicalizes raw text via canonicalizeGeneratedContent()
    const expectedCanonical = "<?php\nclass User {\n    public $id;\n    public $name;\n}\n";
    const expectedHash = "sha256:" + crypto.createHash("sha256").update(expectedCanonical, "utf-8").digest("hex");
    assert.equal(hash, expectedHash);

    // Second write with same logical content but LF line endings and no trailing spaces in the stub
    const secondStub = "<?php\nclass ${model.className} {\n    public $id;\n    public $name;\n}\n";
    await writeFile(firstStubPath, secondStub, "utf8");

    // Should NOT throw a conflict error because the canonicalized contents are identical.
    await runGeneratorWithConfig(root, {
      tracking: "hash",
      conflictStrategy: "fail",
    }, {
      modelStubPath: firstStubPath,
    }, defaultFields);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writer behavior: formatting-equivalent result does not churn hash identity when raw stub whitespace changes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "laraschema-writer-test-"));
  try {
    const file = path.join(root, "app", "Models", "User.php");
    const customStubDir = path.join(root, "custom_stubs");
    await mkdir(customStubDir, { recursive: true });

    const firstStub = "<?php\nclass ${model.className} {\n    public $id;\n    public $name;\n}\n";
    const firstStubPath = path.join(customStubDir, "model.stub");
    await writeFile(firstStubPath, firstStub, "utf8");

    // First write with prettier: true and raw spacing in stub
    await runGeneratorWithConfig(root, {
      tracking: "hash",
      conflictStrategy: "fail",
    }, {
      modelStubPath: firstStubPath,
      prettier: true,
    }, defaultFields);

    const manifestPath = path.join(root, ".laraschema", "generated-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const relativeKey = "app/Models/User.php";
    const hash1 = manifest.files[relativeKey].hash;

    // Second write with slightly different but formatting-equivalent spacing in stub
    const secondStub = "<?php\nclass   ${model.className}   {\n  public   $id  ;\n  public   $name  ;\n}\n";
    await writeFile(firstStubPath, secondStub, "utf8");

    await runGeneratorWithConfig(root, {
      tracking: "hash",
      conflictStrategy: "fail",
    }, {
      modelStubPath: firstStubPath,
      prettier: true,
    }, defaultFields);

    const updatedManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const hash2 = updatedManifest.files[relativeKey].hash;

    // Hashes should be identical because formatting is identical!
    assert.equal(hash1, hash2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writer behavior: snapshot + overwrite replaces a user-edited file even when generated output is unchanged from the backup baseline", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "laraschema-writer-test-"));
  try {
    const file = path.join(root, "app", "Models", "User.php");

    // First write (creates baseline and backup)
    await runGeneratorWithConfig(root, {
      tracking: "snapshot",
      conflictStrategy: "overwrite",
    }, {}, defaultFields);

    const initialContent = await readFile(file, "utf8");

    // Modify user file manually
    await writeFile(file, "<?php\nclass User {\n  // User edits\n}\n", "utf8");

    // Write again with EXACT same content as first write (generator output matches backup baseline)
    await runGeneratorWithConfig(root, {
      tracking: "snapshot",
      conflictStrategy: "overwrite",
    }, {}, defaultFields);

    // File should have been overwritten with the generator output
    assert.equal(await readFile(file, "utf8"), initialContent);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
