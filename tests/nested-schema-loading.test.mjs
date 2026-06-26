import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, rm, writeFile, readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const cliPath = path.join(repoRoot, "dist", "bin", "cli.js");

test("nested schema loading loads files inside prisma/schema/", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "laraschema-nested-"));
  
  const prismaDir = path.join(root, "prisma");
  const schemaDir = path.join(prismaDir, "schema");
  const schemaPath = path.join(prismaDir, "schema.prisma");
  const nestedSchemaPath = path.join(schemaDir, "users.prisma");
  const configPath = path.join(prismaDir, "laraschema.config.js");

  try {
    await mkdir(schemaDir, { recursive: true });

    // 1. Create prisma/schema.prisma with datasource/config-level Prisma content
    await writeFile(
      schemaPath,
      `datasource db {
  provider = "postgresql"
}

generator client {
  provider = "prisma-client-js"
}

generator migrations {
  provider = "laraschema-migrations"
  outputDir = "database/migrations"
}

generator models {
  provider = "laraschema-models"
  outputDir = "app/Models"
  outputEnumDir = "app/Enums"
}
`,
      "utf8"
    );

    // 2. Create prisma/schema/users.prisma with User model
    await writeFile(
      nestedSchemaPath,
      `model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  name  String?

  @@map("users")
}
`,
      "utf8"
    );

    // 3. Create prisma/laraschema.config.js
    await writeFile(
      configPath,
      `module.exports = {
  tablePrefix: "",
  tableSuffix: "",
  stubDir: "./prisma/stubs",
};
`,
      "utf8"
    );

    // 4. Run the built CLI: node dist/bin/cli.js gen --config <configPath> --skipGenerate
    const run = spawnSync(process.execPath, [cliPath, "gen", "--config", configPath, "--skipGenerate"], {
      cwd: root,
      encoding: "utf8",
    });


    // Assert the command exits successfully only after generation sees the nested model.
    assert.equal(run.status, 0, `CLI failed to run successfully: ${run.stderr || run.stdout}`);

    // Assert via generated files, not only console output. Prefer checking that a generated migration references the users table.
    const migrationsDir = path.join(root, "database", "migrations");
    const migrationFiles = await readdir(migrationsDir);
    assert.ok(migrationFiles.length > 0, "No migration files were generated");

    const migrationFile = migrationFiles.find(f => f.includes("_create_users_table.php"));
    assert.ok(migrationFile, "Expected migration file for users table not found");

    const migrationContent = await readFile(path.join(migrationsDir, migrationFile), "utf8");
    assert.match(migrationContent, /Schema::create\('users'/, "Migration content should reference 'users' table");

  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
