# LaraSchema

Generate Laravel migrations, Eloquent models, PHP enums, and TypeScript declarations from Prisma schemas.

LaraSchema is designed for Laravel projects that use Prisma as the schema authoring layer, while still needing Laravel-native output files that can be reviewed, customized, committed, and safely regenerated.

It can generate:

* Laravel migration files
* Eloquent model classes
* PHP enum classes
* TypeScript model and enum declarations
* Custom output using project-owned stubs
* Merge-safe updates that preserve manual edits where possible

---

## Contents

* [Overview](#overview)
* [LaraSchema-Specific Additions](#laraschema-specific-additions)
* [Quick Start](#quick-start)
* [Installation](#installation)
* [CLI Commands](#cli-commands)
* [Prisma Generator Blocks](#prisma-generator-blocks)
* [Configuration](#configuration)
* [Output Paths and rootDir](#output-paths-and-rootdir)
* [Stub Customization](#stub-customization)
* [Stub Groups](#stub-groups)
* [Merge-Safe Writing](#merge-safe-writing)
* [Migrations Generator](#migrations-generator)
* [Models and Enums Generator](#models-and-enums-generator)
* [Custom Model Directives](#custom-model-directives)
* [Modeler Hooks](#modeler-hooks)
* [TypeScript Generator](#typescript-generator)
* [Prisma Comment Directives](#prisma-comment-directives)
* [Custom Migration Rules](#custom-migration-rules)
* [Advanced Examples](#advanced-examples)
* [Troubleshooting](#troubleshooting)
* [Package Notes](#package-notes)
* [Migrating from the older Prisma-Laravel package](#migrating-from-the-older-prisma-laravel-package)

---

## Overview

LaraSchema reads your Prisma schema and generates Laravel-friendly source files from it.

The package is useful when you want Prisma to remain the schema design source of truth, but your Laravel application still needs normal Laravel files such as migrations, Eloquent models, enum classes, and frontend TypeScript declarations.

LaraSchema supports three generation paths:

```txt
Prisma schema
  -> Laravel migrations
  -> Eloquent models + PHP enums
  -> TypeScript declarations
```

It also includes a CLI for initialization, generation, stub customization, listing generated files, and cleaning generated outputs.

---

## LaraSchema-Specific Additions

The current LaraSchema package includes several changes from the older Prisma-Laravel package line.

| Area                       | Current LaraSchema behavior                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Command identity           | The package exposes `laraschema` and `lsh` as CLI commands.                                                                  |
| Prisma provider identity   | Generator entrypoints are exposed as `laraschema-migrations`, `laraschema-models`, and `laraschema-types`.                   |
| Config file                | CLI commands default to `laraschema.config.js`.                                                                              |
| Root-aware paths           | `rootDir` can point output and backup resolution at the Laravel app root.                                                    |
| Model casts                | `modeler.castMaps` can override generated `$casts`, including callback-based mappings.                                       |
| Custom model directives    | `modeler.directives` can parse project-specific Prisma comment directives and attach metadata to generated model properties. |
| Modeler hooks              | `modeler.hooks` can run custom functions after model and enum definitions are built.                                         |
| Generated notices          | Built-in stubs include LaraSchema auto-generated file warnings.                                                              |
| TypeScript output controls | `noEmitEnums`, `modelsFileName`, and `enumsFileName` control enum emission and bundle filenames.                             |

---

## Quick Start

Install the package:

```bash
npm install laraschema --save-dev
```

Initialize LaraSchema for a Prisma schema:

```bash
laraschema init --schema=prisma/schema.prisma
```

This injects generator blocks into your Prisma schema, creates a `laraschema.config.js` file beside the schema, and scaffolds default stubs under the schema directory.

Run generation:

```bash
laraschema gen
```

Or use the short alias:

```bash
lsh gen
```

The generated files are written to the configured Laravel output folders.

---

## Installation

```bash
npm install laraschema --save-dev
```

LaraSchema expects Prisma to be available in your project because `laraschema gen` can run `prisma generate` before running the Laravel and TypeScript generators.

```bash
npm install prisma --save-dev
```

---

## CLI Commands

LaraSchema exposes the primary command:

```bash
laraschema
```

And a short alias:

```bash
lsh
```

The package also exposes Prisma generator entrypoints:

```txt
laraschema-migrations
laraschema-models
laraschema-types
```

### `init`

Injects LaraSchema generator blocks into `schema.prisma`, scaffolds default stubs, and creates `laraschema.config.js` if it does not already exist.

```bash
laraschema init --schema=prisma/schema.prisma
```

### `gen`

Runs Prisma generation first, then runs LaraSchema's migrations, models/enums, and TypeScript generators.

```bash
laraschema gen
```

Use a custom config file:

```bash
laraschema gen --config=prisma/laraschema.config.js
```

Skip the `prisma generate` step and only run LaraSchema generators:

```bash
laraschema gen --skipGenerate
```

### `customize`

Creates per-table, per-model, per-enum, or per-TypeScript stub files from the matching `index.stub`.

```bash
laraschema customize -t migration,model -n users,accounts

Create update migration stub overrides:

```bash
laraschema customize -t migration -n users,accounts --update
```
```

Create a PHP enum stub override:

```bash
laraschema customize -t enum -n UserStatus
```

Create a TypeScript stub override:

```bash
laraschema customize -t ts -n User
```

Supported types:

```txt
migration
model
enum
ts
```

`enum` cannot be combined with other types.

### `list`

Lists generated files.

```bash
laraschema list
```

List only migrations:

```bash
laraschema list --migrations
```

List only models:

```bash
laraschema list --models
```

List only enums:

```bash
laraschema list --enums
```

For migrations, show backup order when available:

```bash
laraschema list --migrations --sorted
```

### `clean`

Deletes generated files and their backup baselines, then optionally regenerates.

```bash
laraschema clean
```

Clean only selected output types:

```bash
laraschema clean --types=migration,model
```

Clean selected names:

```bash
laraschema clean --types=model --names=User,Account
```

Preview without deleting:

```bash
laraschema clean --dry-run
```

Clean without regenerating:

```bash
laraschema clean --skipGenerate
```

---

## Prisma Generator Blocks

LaraSchema uses Prisma generator blocks to discover generator-specific options.

A minimal schema setup looks like this:

```prisma
generator migrations {
  provider = "laraschema-migrations"
  stubDir  = "./prisma/stubs"
  outputDir = "database/migrations"
}

generator models {
  provider = "laraschema-models"
  stubDir  = "./prisma/stubs"
  outputDir     = "app/Models"
  outputEnumDir = "app/Enums"
}

generator types {
  provider = "laraschema-types"
  outputDir = "resources/js/types"
}
```

The CLI `init` command can add these blocks for you.

---

## Configuration

LaraSchema loads shared configuration from `laraschema.config.js`.

By default, CLI commands look for:

```txt
laraschema.config.js
```

When `init` is run with `--schema=prisma/schema.prisma`, it creates:

```txt
prisma/laraschema.config.js
```

You can pass a custom config path to commands that support `--config`:

```bash
laraschema gen --config=prisma/laraschema.config.js
```

### Example `laraschema.config.js`

```js
module.exports = {
  // Optional Laravel app root.
  // Useful when LaraSchema is run from a schema/package folder
  // but writes into a Laravel application elsewhere.
  rootDir: "../laravel-app",

  tablePrefix: "",
  tableSuffix: "",

  stubDir: "./prisma/stubs",

  output: {
    migrations: "database/migrations",
    models: "app/Models",
    enums: "app/Enums",
    ts: "resources/js/types",
  },

  migrate: {
    outputDir: "database/migrations",
    prettier: true,
    noEmit: false,
  },

  modeler: {
    outputDir: "app/Models",
    outputEnumDir: "app/Enums",
    prettier: true,
    overwriteExisting: true,

    // Use awobaz/compoships-style relations for composite keys.
    awobaz: false,

    // Extra fields allowed on pivot models.
    allowedPivotExtraFields: ["scope"],

    // Override Eloquent casts by Prisma type.
    castMaps: {
      Json: "Illuminate\\Database\\Eloquent\\Casts\\AsArrayObject::class",
      BigInt: ({ isList }) =>
        isList
          ? "Illuminate\\Database\\Eloquent\\Casts\\AsCollection::class"
          : "'string'",
    },

    // Optional project-specific directives parsed from Prisma comments.
    directives: {
      adminOnly: { style: "flag", targets: ["field"] },
      badge: { style: "parens", targets: ["field"] },
    },

    // Optional hooks run after model and enum definitions are built.
    hooks: ["./prisma/modeler-hooks.js"],
  },

  ts: {
    outputDir: "resources/js/types",
    declaration: false,
    noEmitEnums: false,
    shape: "interface",
    nullableAsOptional: false,
    readonlyArrays: false,
    modelsFileName: "index",
    enumsFileName: "enums",
    scalarMap: {
      BigInt: "bigint",
      Decimal: "string",
      Json: "unknown",
    },
  },
};
```

### Main config keys

| Key                  | Purpose                                                                  |
| -------------------- | ------------------------------------------------------------------------ |
| `rootDir`            | Optional Laravel app root used to resolve generated outputs and backups. |
| `schemaPath`         | Optional Prisma schema path override used by `laraschema gen`.           |
| `tablePrefix`        | Prefix added to generated physical table names.                          |
| `tableSuffix`        | Suffix added to generated physical table names.                          |
| `stubDir`            | Root folder for project-owned stubs.                                     |
| `noEmit`             | Global dry-run switch.                                                   |
| `output.migrations`  | Default migration output folder.                                         |
| `output.models`      | Default Eloquent model output folder.                                    |
| `output.enums`       | Default PHP enum output folder.                                          |
| `output.ts`          | Default TypeScript output folder.                                        |
| `migrate`            | Migration generator overrides.                                           |
| `modeler`            | Model and PHP enum generator overrides.                                  |
| `modeler.castMaps`   | Custom Prisma-type to Eloquent-cast mappings.                            |
| `modeler.directives` | Project-specific comment directive registry for model generation.        |
| `modeler.hooks`      | Hook files or functions run after model/enums are built.                 |
| `ts`                 | TypeScript generator overrides.                                          |

<details>
<summary>Full configuration shape</summary>

```ts
export interface LaravelSharedConfig {
  rootDir?: string;
  schemaPath?: string;

  tablePrefix?: string;
  tableSuffix?: string;

  stubDir?: string;
  noEmit?: boolean;

  output?: {
    migrations?: string;
    models?: string;
    enums?: string;
    ts?: string;
  };

  migrate?: Partial<MigratorConfigOverride>;
  modeler?: Partial<ModelConfigOverride>;
  ts?: Partial<TypesConfigOverride>;
}

export type CastMapContext = {
  prismaType: string;
  isList?: boolean;
  ignore?: string[];
};

export type CastMapValue =
  | string
  | ((ctx: CastMapContext) => string);

export interface MigratorConfigOverride {
  tablePrefix?: string;
  tableSuffix?: string;
  stubDir?: string;
  outputDir?: string;
  overwriteExisting?: boolean;
  prettier?: boolean;
  groups?: string | StubGroupConfig[];
  noEmit?: boolean;
  namespace?: "App\\";
  rules?: string | Rule[];
  stubPath?: string;
  allowUnsigned?: boolean;
  defaultMaps?: DefaultMaps;
}

export interface ModelConfigOverride {
  tablePrefix?: string;
  tableSuffix?: string;
  stubDir?: string;
  outputDir?: string;
  overwriteExisting?: boolean;
  prettier?: boolean;
  groups?: string | StubGroupConfig[];
  noEmit?: boolean;
  namespace?: "App\\";
  modelStubPath?: string;
  enumStubPath?: string;
  outputEnumDir?: string;
  awobaz?: boolean;
  allowedPivotExtraFields?: string[];
  castMaps?: Record<string, CastMapValue>;
  modelNamespace?: string;
  enumNamespace?: string;
  directives?: CustomDirectiveRegistry;
  hooks?: Array<string | ModelerHook>;
}

export interface TypesConfigOverride {
  tablePrefix?: string;
  tableSuffix?: string;
  stubDir?: string;
  outputDir?: string;
  overwriteExisting?: boolean;
  prettier?: boolean;
  groups?: string | StubGroupConfig[];
  noEmit?: boolean;
  namespace?: "App\\";
  declaration?: boolean;
  noEmitEnums?: boolean;
  shape?: "interface" | "type";
  scalarMap?: Record<string, string>;
  nullableAsOptional?: boolean;
  readonlyArrays?: boolean;
  namePrefix?: string;
  nameSuffix?: string;
  moduleName?: string;
  modelsFileName?: string;
  enumsFileName?: string;
}
```

</details>

---

## Output Paths and rootDir

By default, relative output paths are resolved from the current working directory.

If your Prisma schema package is not the Laravel app root, configure `rootDir`:

```js
module.exports = {
  rootDir: "../laravel-app",

  output: {
    migrations: "database/migrations",
    models: "app/Models",
    enums: "app/Enums",
    ts: "resources/js/types",
  },
};
```

With this setup, LaraSchema writes to:

```txt
../laravel-app/database/migrations
../laravel-app/app/Models
../laravel-app/app/Enums
../laravel-app/resources/js/types
```

Backup baselines are also stored under the resolved root:

```txt
<rootDir>/.laraschema/backups
```

This makes generation predictable when your schema and Laravel application live in different folders.

---

## Stub Customization

LaraSchema ships default stubs in the package root `stubs/` folder.

The built-in stubs include an auto-generated notice so generated files are easy to recognize during review. The notice warns that the file was generated by LaraSchema and that direct edits may be overwritten by future generator runs.

Project-owned stubs are usually placed under the Prisma schema folder:

```txt
prisma/
  schema.prisma
  laraschema.config.js
  stubs/
    migration/
      index.stub
    model/
      index.stub
    enum/
      index.stub
    ts/
      index.stub
```

The actual package stub templates remain outside `src/`.

### Stub resolution order

For a generated item, LaraSchema resolves stubs in this order:

```txt
1. Direct item stub
   stubs/<type>/<name>.stub

2. First matching group stub
   stubs/<type>/<group-stub>.stub

3. Default stub
   stubs/<type>/index.stub

For update-mode migrations (`@update`), the resolver uses:

```txt
1. stubs/migration/<table>.update.stub
2. stubs/migration/<table>.stub
3. stubs/migration/index.update.stub
4. stubs/migration/index.stub
```
```

Examples:

```txt
prisma/stubs/migration/users.stub
prisma/stubs/model/User.stub
prisma/stubs/enum/UserStatus.stub
prisma/stubs/ts/User.stub
```

### Create stub overrides with the CLI

```bash
laraschema customize -t migration -n users
laraschema customize -t migration -n users --update
laraschema customize -t model -n User
laraschema customize -t enum -n UserStatus
laraschema customize -t ts -n User

`--update` is migration-only and creates `*.update.stub` files.
```

---

## Stub Groups

Stub groups allow many tables, models, enums, or TS outputs to share a custom stub.

```js
module.exports = {
  migrate: {
    groups: [
      {
        stubFile: "auth.stub",
        tables: ["users", "accounts", "password_resets"],
      },
      {
        stubFile: "audit.stub",
        pattern: /^audit_/,
        exclude: ["audit_archive"],
      },
      {
        stubFile: "catch-all.stub",
        include: "*",
        exclude: ["failed_jobs", "migrations"],
      },
    ],
  },
};
```

Supported selectors:

| Key       | Meaning                                                |
| --------- | ------------------------------------------------------ |
| `tables`  | Exact list of names.                                   |
| `include` | Glob list or `"*"`.                                    |
| `exclude` | Names or globs removed after include/pattern matching. |
| `pattern` | RegExp, glob string, or array of either.               |

---

## Merge-Safe Writing

LaraSchema does not blindly overwrite generated files.

It writes with a git-style 3-way merge:

```txt
base   = last generated baseline stored in .laraschema/backups
yours  = current file on disk
theirs = newly generated file
```

When there are no conflicts, changes are merged automatically.

When there is a real conflict, the file is written with conflict markers:

```txt
<<<<<<<
current file changes
=======
new generator output
>>>>>>>
```

After a successful write, LaraSchema updates the backup baseline.

This applies to:

* migrations
* models
* PHP enums
* TypeScript outputs

---

## Migrations Generator

The migrations generator converts Prisma models into Laravel migration files.

It supports:

* scalar column mapping
* native type mapping
* nullable fields
* defaults
* enums
* UUID and ULID detection
* autoincrement IDs
* unsigned integer inference
* relations and foreign keys
* referential actions
* composite indexes
* composite unique keys
* fulltext indexes
* custom migration rules
* stub customization
* merge-safe updates

Example generator block:

```prisma
generator migrations {
  provider = "laraschema-migrations"
  stubDir  = "./prisma/stubs"
  outputDir = "database/migrations"
}
```

Example output:

```php
Schema::create('users', function (Blueprint $table) {
    $table->id();
    $table->string('name');
    $table->string('email')->unique();
    $table->timestamps();
});
```

### Unsigned handling

LaraSchema infers unsigned integer columns for IDs, generated integer keys, native unsigned integer types, `@unsigned` documentation directives, and foreign keys pointing to unsigned integer references.

Use `allowUnsigned` when needed:

```js
module.exports = {
  migrate: {
    allowUnsigned: true,
  },
};
```

### Silent models

Use `@silent(migrator)` or `@silent` on a model when you want the model parsed but no migration emitted.

```prisma
/// @silent(migrator)
model ExternalAuditLog {
  id Int @id @default(autoincrement())
  message String
}
```

---

## Models and Enums Generator

The model generator creates Eloquent model classes and PHP enum classes.

It supports:

* `$table`
* `$fillable`
* `$hidden`
* `$guarded`
* `$casts`
* enum casts
* custom cast maps
* custom model directives
* modeler hooks
* `$with`
* `$touches`
* `$appends`
* traits
* parent class extension
* implemented interfaces
* observers
* factories
* belongsTo
* hasOne
* hasMany
* belongsToMany
* morphTo
* morphOne
* morphMany
* morphToMany
* morphedByMany
* explicit pivot metadata
* constrained pivot detection with `@entity`
* Compoships-aware relation arguments

Example generator block:

```prisma
generator models {
  provider = "laraschema-models"
  stubDir  = "./prisma/stubs"
  outputDir     = "app/Models"
  outputEnumDir = "app/Enums"
}
```

### Explicit many-to-many pivot detection

LaraSchema has automatic explicit many-to-many detection for models that look like pivot tables.

This is different from Prisma's implicit many-to-many relation. It exists for cases where your Prisma schema has a real model between two other models, and LaraSchema can recognize that model as the pivot table behind a Laravel `belongsToMany(...)` relation.

For example:

```prisma
model User {
  id          Int          @id @default(autoincrement())
  memberships Membership[]
}

model Team {
  id          Int          @id @default(autoincrement())
  memberships Membership[]
}

model Membership {
  user   User @relation(fields: [userId], references: [id])
  userId Int

  team   Team @relation(fields: [teamId], references: [id])
  teamId Int

  role String?

  @@unique([userId, teamId])
}
```

When LaraSchema is generating relations for `User`, it sees that `User.memberships` points to `Membership`. It then asks: “Is `Membership` actually a pivot between `User` and one other model?”

A model is accepted as an explicit pivot candidate only when all of these are true:

1. The candidate model has relation fields that own foreign keys.
2. Exactly one owned relation points back to the model currently being resolved.
3. There is exactly one other relation endpoint.
4. The foreign keys for both sides do not overlap.
5. The union of both foreign-key sets is unique on the candidate model, usually through `@@unique([...])` or a primary key.

If those checks pass, LaraSchema treats the candidate as an explicit pivot and generates a `belongsToMany` relation to the other endpoint instead of treating the candidate model as the final related model.

So, from `User`, the generator may treat `Membership` as a pivot and generate a relation to `Team`.

#### Why `@entity` exists

Sometimes a model looks like a pivot table structurally, but it is actually a real domain model.

For example, `Membership` may have its own lifecycle, status, permissions, billing rules, invitation flow, approval state, or admin page. In that case, you may not want `User.memberships` to turn into a direct `belongsToMany(Team::class, ...)` relationship. You may want it to stay as a normal relation to the `Membership` model.

Use `@entity` to tell LaraSchema:

```txt
This model is a real entity. Do not collapse it into a many-to-many pivot relation.
```

```prisma
/// @entity
model Membership {
  id Int @id @default(autoincrement())

  user   User @relation(fields: [userId], references: [id])
  userId Int

  team   Team @relation(fields: [teamId], references: [id])
  teamId Int

  role String?

  @@unique([userId, teamId])
}
```

With plain `@entity`, LaraSchema will not use `Membership` as an explicit pivot candidate for any owner model. It will behave as a real related model.

#### Scoped `@entity(ModelName)`

`@entity` can also be scoped to specific owner models.

```prisma
/// @entity(User)
model Membership {
  id Int @id @default(autoincrement())

  user   User @relation(fields: [userId], references: [id])
  userId Int

  team   Team @relation(fields: [teamId], references: [id])
  teamId Int

  @@unique([userId, teamId])
}
```

This means:

```txt
When resolving relations for User, do not treat Membership as a pivot.
For other models, LaraSchema may still treat Membership as a pivot if it passes the pivot checks.
```

So the behavior is:

| Directive            | Meaning                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------ |
| No `@entity`         | Candidate can be collapsed into an explicit `belongsToMany` if it passes the pivot checks. |
| `@entity`            | Candidate is never treated as an explicit pivot.                                           |
| `@entity(User)`      | Candidate is not treated as a pivot while resolving `User` relations.                      |
| `@entity(User,Team)` | Candidate is not treated as a pivot while resolving `User` or `Team` relations.            |

#### Syntax forms

`@entity` uses the shared list parser, so these scoped forms are equivalent:

```prisma
/// @entity(User,Team)
/// @entity{User,Team}
/// @entity: User,Team
```

Use plain `@entity` when the model should always stay a real entity.

Use scoped `@entity(ModelName)` when you only want to block pivot collapsing from one side.

#### Important notes

`@entity` only affects explicit pivot detection in the model relationship generator.

It does not:

* remove the model from migrations
* remove the model file
* remove TypeScript types
* act like `@silent`
* act like `@local`
* change the database schema

It only changes whether a relation that points at the candidate model is interpreted as:

```txt
normal relation to the candidate model
```

or collapsed into:

```txt
belongsToMany relation through the candidate model
```

Use `@entity` when the model is conceptually important on its own, even if its foreign keys make it look like a pivot.

### PHP enum output

Prisma enums can be emitted as PHP enum classes.

```prisma
enum UserStatus {
  active
  inactive
  blocked
}
```

Example generated PHP enum:

```php
<?php

namespace App\Enums;

enum UserStatus: string
{
    case active = 'active';
    case inactive = 'inactive';
    case blocked = 'blocked';
}
```

### Cast maps

Use `modeler.castMaps` to override casts by Prisma type.

```js
module.exports = {
  modeler: {
    castMaps: {
      Json: "Illuminate\\Database\\Eloquent\\Casts\\AsArrayObject::class",
      JsonB: "Illuminate\\Database\\Eloquent\\Casts\\AsArrayObject::class",
      BigInt: ({ isList }) =>
        isList
          ? "Illuminate\\Database\\Eloquent\\Casts\\AsCollection::class"
          : "'string'",
    },
  },
};
```

The callback receives runtime context:

```ts
type CastMapContext = {
  prismaType: string;
  isList?: boolean;
  ignore?: string[];
};
```

---

## Custom Model Directives

LaraSchema has built-in directives such as `@fillable`, `@hidden`, `@cast`, `@local`, and `@entity`.

For project-specific metadata, use `modeler.directives`.

Custom directives do not replace the built-in LaraSchema directives. They run beside them, are parsed from Prisma documentation comments, and are attached to generated model/property metadata so your hooks or custom stubs can consume them.

### Define custom directives

```js
module.exports = {
  modeler: {
    directives: {
      adminOnly: {
        style: "flag",
        targets: ["field"],
      },

      badge: {
        style: "parens",
        targets: ["field"],
      },

      ui: {
        style: "braces",
        targets: ["field"],
      },

      panel: {
        style: "colon",
        targets: ["model"],
      },
    },
  },
};
```

### Use custom directives in Prisma comments

```prisma
/// @panel: admin
model User {
  id Int @id @default(autoincrement())

  /// @adminOnly
  email String

  /// @badge(primary,verified)
  status String

  /// @ui{color,icon}
  role String
}
```

### Supported custom directive styles

| Style    | Example                    | Parsed value by default         |
| -------- | -------------------------- | ------------------------------- |
| `flag`   | `@adminOnly`               | `true`                          |
| `parens` | `@badge(primary,verified)` | `['primary', 'verified']`       |
| `braces` | `@ui{color,icon}`          | `['color', 'icon']`             |
| `colon`  | `@panel: admin`            | `'admin'`                       |
| `auto`   | Any supported shape        | Inferred from the syntax used.  |
| `custom` | User-defined               | Whatever your resolver returns. |

Custom directive definitions can restrict valid targets with `targets`:

```txt
model
field
relation
enum
unknown
```

### Custom resolver

Use `resolve(ctx)` when the default value is not enough.

```js
module.exports = {
  modeler: {
    directives: {
      ui: {
        style: "braces",
        targets: ["field"],
        resolve(ctx) {
          return {
            name: ctx.name,
            style: ctx.style,
            target: ctx.target,
            raw: ctx.raw,
            body: ctx.body,
          };
        },
      },
    },
  },
};
```

Custom directive metadata is intended for advanced stubs and hooks. Use built-in directives for built-in LaraSchema behavior, and custom directives for project-specific metadata that LaraSchema should preserve for your own extension layer.

---

## Modeler Hooks

`modeler.hooks` lets you run custom code after LaraSchema has built model and enum definitions.

Hooks are useful when you want side outputs or post-processing without changing the core generator behavior.

```js
module.exports = {
  modeler: {
    hooks: ["./prisma/modeler-hooks.js"],
  },
};
```

A hook file should export a function as the default export, as `hook`, or as the module itself.

```js
export default async function hook(ctx) {
  await ctx.writeJson("storage/laraschema/models.json", {
    models: ctx.models.map((model) => model.className),
    enums: ctx.enums.map((item) => item.name),
  });
}
```

The hook context includes the generated model and enum definitions, the active modeler config, and helper methods:

| Helper                           | Purpose                                            |
| -------------------------------- | -------------------------------------------------- |
| `writeFile(targetPath, content)` | Writes a text file, creating parent folders first. |
| `writeJson(targetPath, value)`   | Writes formatted JSON with a trailing newline.     |

Hook paths are resolved from the current working directory.

Use hooks for side outputs such as JSON manifests, documentation data, UI metadata, or package-specific helper files. Avoid using hooks to mutate generated PHP output unless you are intentionally building a higher-level extension around LaraSchema.

---

## TypeScript Generator

The TypeScript generator creates frontend-friendly model and enum declarations from your Prisma schema.

Example generator block:

```prisma
generator types {
  provider = "laraschema-types"
  outputDir = "resources/js/types"
}
```

Example config:

```js
module.exports = {
  ts: {
    outputDir: "resources/js/types",
    declaration: false,
    noEmitEnums: false,
    shape: "interface",
    nullableAsOptional: false,
    readonlyArrays: false,
    modelsFileName: "index",
    enumsFileName: "enums",
    scalarMap: {
      BigInt: "bigint",
      Decimal: "string",
      Json: "unknown",
    },
  },
};
```

Supported options:

| Key                  | Purpose                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `outputDir`          | Output directory for generated TS files.                                                                       |
| `declaration`        | Controls the enum bundle extension: `.d.ts` when true, `.ts` when false. Models are always emitted as `.d.ts`. |
| `noEmitEnums`        | Skip only the enum bundle; model declarations are still generated unless `noEmit` is true.                     |
| `shape`              | Use `interface` or `type` for model shapes.                                                                    |
| `scalarMap`          | Override Prisma scalar to TS type mapping.                                                                     |
| `nullableAsOptional` | Emit nullable fields as optional properties.                                                                   |
| `readonlyArrays`     | Emit lists as `ReadonlyArray<T>`.                                                                              |
| `namePrefix`         | Prefix generated model names.                                                                                  |
| `nameSuffix`         | Suffix generated model names.                                                                                  |
| `moduleName`         | Optional module wrapper name.                                                                                  |
| `modelsFileName`     | Base filename for the main model declaration bundle. Defaults to `index`, producing `index.d.ts`.              |
| `enumsFileName`      | Base filename for the enum bundle. Defaults to `enums`, producing `enums.ts` or `enums.d.ts`.                  |

---

## Prisma Comment Directives

LaraSchema uses Prisma documentation comments to customize generated Laravel and TypeScript output without changing database semantics.

Directives can be written above a field, inline beside a field, or at model/enum level depending on the directive.

```prisma
model User {
  /// @fillable
  name String

  email String /// @fillable @hidden
}
```

### Directive syntax styles

Some directives support more than one list syntax. This is intentional: the shared directive list parser accepts braces, parentheses, and colon form for supported list-style directives.

These three forms are equivalent for list-style directives:

```prisma
/// @fillable{name,email}
/// @fillable(name,email)
/// @fillable: name,email
```

The same applies to supported list-style directives such as:

```txt
@fillable
@hidden
@guarded
@with
@touch
@pivot
@pivotAlias
@entity
@local
@silent
@update
```

For example, all of these are valid ways to declare eager-loaded relations:

```prisma
/// @with(posts,roles)
/// @with{posts,roles}
/// @with: posts,roles
model User {
  id Int @id @default(autoincrement())
}
```

And all of these are valid ways to declare appended attributes:

```prisma
/// @appends(full_name,avatar_url)
/// @appends{full_name,avatar_url}
/// @appends: full_name,avatar_url
model User {
  id Int @id @default(autoincrement())
}
```

`@appends` also supports optional TypeScript types per entry:

```prisma
/// @appends(full_name:string, meta:Record<string, unknown>)
model User {
  id Int @id @default(autoincrement())
}
```

### Syntax groups

| Syntax group          | Directives                                                                                                     | Supported forms                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Boolean flags         | `@fillable`, `@hidden`, `@guarded`, `@with`, `@pivot`, `@withTimestamps`                                       | Plain presence, for example `/// @fillable`.                                             |
| Flexible lists        | `@fillable`, `@hidden`, `@guarded`, `@with`, `@touch`, `@pivot`, `@pivotAlias`, `@entity`, `@local`, `@silent`, `@update` | `@tag{a,b}`, `@tag(a,b)`, `@tag: a,b`.                                                   |
| Appended attributes   | `@appends`                                                                                                     | `@appends{a,b}`, `@appends(a,b)`, `@appends: a,b`; entries may be `name` or `name:type`. |
| Structured field type | `@type`                                                                                                        | Brace object syntax only: `@type{ import:'...', type:'...' }`.                           |
| Field cast            | `@cast`                                                                                                        | Brace syntax only: `@cast{datetime}` or `@cast{decimal:2}`.                              |
| Class references      | `@trait`, `@use`, `@implements`, `@observer`, `@factory`, `@extend`                                            | Colon syntax only: `@trait:Foo\Bar`, optionally `as Alias` where supported.              |
| Class modifiers       | `@abstract`                                                                                                     | Plain presence, for example `/// @abstract`.                                              |
| Morph relations       | `@morph`                                                                                                       | Parentheses syntax: `@morph(name: commentable, type: many, model: Comment)`.             |

### Directive summary

| Directive          | Scope                        | Purpose                                                                 |
| ------------------ | ---------------------------- | ----------------------------------------------------------------------- |
| `@fillable`        | Field or model               | Adds field(s) to `$fillable`.                                           |
| `@hidden`          | Field or model               | Adds field(s) to `$hidden`.                                             |
| `@guarded`         | Field or model               | Adds field(s) to `$guarded`.                                            |
| `@cast{...}`       | Field                        | Adds a cast entry to `$casts`.                                          |
| `@type{...}`       | Field                        | Provides PHP/interface/TS type metadata.                                |
| `@with`            | Field or model               | Adds relation(s) to `$with`; TS relation becomes non-optional.          |
| `@trait:...`       | Model                        | Adds a trait import/use.                                                |
| `@use:...`         | Model                        | Adds a raw import/use line.                                             |
| `@extend:...`      | Model                        | Changes parent class.                                                   |
| `@abstract`        | Model                        | Emits `abstract class ...` for the generated model.                     |
| `@implements:...`  | Model                        | Adds implemented interface.                                             |
| `@observer:...`    | Model                        | Adds observer metadata.                                                 |
| `@factory:...`     | Model                        | Adds factory metadata.                                                  |
| `@touch{...}`      | Model                        | Adds `$touches`.                                                        |
| `@appends{...}`    | Model                        | Adds `$appends` and TS appended properties.                             |
| `@local`           | Relation field               | Skips a specific relation method and/or FK generation.                  |
| `@silent`          | Model or enum                | Parses but does not emit selected output.                               |
| `@update`          | Model                        | Emits update-style migration names for selected model/table targets.    |
| `@morph(...)`      | Model                        | Declares owner-side polymorphic relations.                              |
| `@pivot`           | Pivot model or pivot field   | Includes extra pivot columns in `withPivot(...)`.                       |
| `@withTimestamps`  | Pivot model                  | Adds `withTimestamps()` to relation chain.                              |
| `@pivotAlias(...)` | Pivot model                  | Adds `as('name')` to relation chain.                                    |
| `@entity`          | Potential pivot/entity model | Prevents or constrains automatic explicit many-to-many pivot detection. |

<details>
<summary>Flexible model-level list directives</summary>

These model-level directives use the shared list parser:

```txt
@fillable
@hidden
@guarded
@with
@touch
```

So each one can use braces, parentheses, or colon form:

```prisma
/// @fillable{name,email}
/// @hidden(password,remember_token)
/// @guarded: id,created_at,updated_at
/// @with(posts,roles)
/// @touch{company,profile}
model User {
  id Int @id @default(autoincrement())
}
```

Field-level boolean forms are still valid:

```prisma
model User {
  name String /// @fillable
  email String /// @hidden
}
```

</details>

<details>
<summary>`@cast` and `@type`</summary>

`@cast` is currently parsed with brace syntax:

```prisma
model User {
  emailVerifiedAt DateTime? /// @cast{datetime}
  balance Decimal /// @cast{decimal:2}
}
```

`@type` is currently parsed with structured brace syntax:

```prisma
model User {
  meta Json? /// @type{ import:'App\\Data\\UserMeta', type:'UserMeta' }
}
```

Use braces for these two directives. Do not write them as colon or parentheses unless the parser is intentionally expanded later.

</details>

<details>
<summary>Class customization directives</summary>

Class/reference directives use colon syntax:

```prisma
/// @trait:Illuminate\\Notifications\\Notifiable
/// @use:App\\Support\\SomeHelper
/// @implements:Illuminate\\Contracts\\Auth\\Authenticatable as AuthenticatableContract
/// @observer:App\\Observers\\UserObserver
/// @factory:Database\\Factories\\UserFactory
/// @extend:Illuminate\\Foundation\\Auth\\User as Authenticatable
/// @abstract
model User {
  id Int @id @default(autoincrement())
}
```

Where supported, `as Alias` controls the imported short name used in the generated model.

</details>

<details>
<summary>`@update`</summary>

Use `@update` on a model to switch migration naming mode from:

```txt
*_create_<table>_table.php
```

to:

```txt
*_update_<table>_table.php
```

Target forms:

```prisma
/// @update
/// @update(User,accounts)
/// @update{User,accounts}
/// @update: User,accounts
model User {
  id Int @id @default(autoincrement())
}
```

Targets may be model names or resolved table names (`dbName`).

</details>

<details>
<summary>`@local`</summary>

Use `@local` on a relation field to skip generation for that relation.

```prisma
model Account {
  id     Int   @id @default(autoincrement())
  user   User? @relation(fields: [userId], references: [id]) /// @local
  userId Int?
}
```

Scoped forms can use parentheses, braces, or colon form:

```prisma
/// @local(model)
/// @local{migrator}
/// @local: model,migrator
```

Supported scope values:

```txt
model
models
modeler
migrator
migration
migrations
both
all
*
```

</details>

<details>
<summary>`@silent`</summary>

Use `@silent` to parse a model or enum but suppress file emission.

```prisma
/// @silent
model AuditTrail {
  id Int @id @default(autoincrement())
  note String
}
```

Scoped forms can use parentheses, braces, or colon form:

```prisma
/// @silent(model)
/// @silent{migrator}
/// @silent: model,migrator
```

Supported scope values:

```txt
model
models
modeler
migrator
migration
migrations
both
all
*
```

</details>

<details>
<summary>`@appends`</summary>

Use `@appends` on a model to add appended attributes.

```prisma
/// @appends(full_name,avatar_url)
model User {
  id Int @id @default(autoincrement())
}
```

The parser accepts parentheses, braces, and colon form:

```prisma
/// @appends(full_name,avatar_url)
/// @appends{full_name,avatar_url}
/// @appends: full_name,avatar_url
```

Each entry may include a TypeScript type after the first colon:

```prisma
/// @appends(full_name:string, stats:Record<string, unknown>)
model User {
  id Int @id @default(autoincrement())
}
```

</details>

<details>
<summary>Polymorphic relations</summary>

Child-side `morphTo` is auto-detected from scalar pairs:

```prisma
model Comment {
  id Int @id @default(autoincrement())
  commentable_id Int
  commentable_type String
}
```

This can generate:

```php
public function commentable()
{
    return $this->morphTo('commentable');
}
```

Owner-side relations can be declared with `@morph(...)`:

```prisma
/// @morph(name: commentable, type: many, model: Comment)
model Post {
  id Int @id @default(autoincrement())
}
```

Supported `type` values:

```txt
one      -> morphOne
many     -> morphMany
to many  -> morphToMany
by many  -> morphedByMany
```

</details>

<details>
<summary>Pivot directives</summary>

Use `@pivot` to include extra pivot columns in generated `withPivot(...)` chains.

Because model-level `@pivot` uses the shared list parser, these forms are accepted:

```prisma
/// @pivot(role,meta)
/// @pivot{role,meta}
/// @pivot: role,meta
model TeamUser {
  teamId Int
  userId Int
  role   String
  meta   Json?
}
```

Field-level flag form is also supported:

```prisma
role String /// @pivot
meta Json?  /// @pivot
```

`@pivotAlias` also uses the shared list parser; the first parsed value is used:

```prisma
/// @pivotAlias(membership)
/// @pivotAlias{membership}
/// @pivotAlias: membership
model TeamUser {
  teamId Int
  userId Int
}
```

`@withTimestamps` is a plain flag:

```prisma
/// @withTimestamps
model TeamUser {
  teamId Int
  userId Int
}
```

</details>

---

## Custom Migration Rules

You can extend migration rendering with custom rules.

```js
module.exports = {
  migrate: {
    rules: "./prisma/custom-rules.js",
  },
};
```

Example `prisma/custom-rules.js`:

```js
module.exports = [
  {
    test(def) {
      return def.name === "archived" && def.migrationType === "boolean";
    },
    render() {
      return {
        column: "archived",
        snippet: ["$table->boolean('archived')->default(false);"],
      };
    },
  },
];
```

Rule execution order:

```txt
1. Built-in rules
2. Custom rules
```

---

## Advanced Examples

<details>
<summary>Model customization directives</summary>

```prisma
/// @trait:Illuminate\\Notifications\\Notifiable
/// @implements:Illuminate\\Contracts\\Auth\\Authenticatable as AuthenticatableContract
/// @observer:App\\Observers\\UserObserver
/// @factory:UserFactory
/// @with(posts,roles)
/// @touch{company,profile}
/// @appends{full_name,avatar_url}
model User {
  id Int @id @default(autoincrement())

  /// @fillable
  name String

  /// @fillable @hidden
  email String

  /// @guarded
  password String

  /// @cast{datetime}
  emailVerifiedAt DateTime?
}
```

</details>

<details>
<summary>TypeScript scalar overrides</summary>

```js
module.exports = {
    ts: {
        scalarMap: {
            BigInt: "bigint",
            Decimal: "string",
            Json: "Record<string, unknown>",
            DateTime: "string",
        },
    },
};
```

</details>

<details>
<summary>Per-model TypeScript stub</summary>

```ts
${imports}

${content(() => ({
    append: `export type ${model.name}Id = ${model.name}["id"];`,
}))}
```

</details>

<details>
<summary>Simple PHP model stub</summary>

```php
<?php

namespace App\Models;

${model.imports}

use Illuminate\Database\Eloquent\Model;

class ${model.className} extends Model
{
    protected $table = '${model.tableName}';

    protected $fillable = [
${model.properties.filter(p => p.fillable).map(p => `        '${p.name}',`).join('\n')}
    ];

    protected $casts = [
${model.properties.filter(p => p.cast).map(p => `        '${p.name}' => ${p.cast},`).join('\n')}
${model.properties.filter(p => p.enumRef).map(p => `        '${p.name}' => ${p.enumRef}::class,`).join('\n')}
    ];

${relationships}

    ${content}
}
```

</details>

---

## Troubleshooting

### `Config file not found`

By default, CLI commands look for:

```txt
laraschema.config.js
```

Pass the config path explicitly if your config is inside `prisma/`:

```bash
laraschema gen --config=prisma/laraschema.config.js
```

### Generated files are written to the wrong folder

Set `rootDir`:

```js
module.exports = {
    rootDir: "../laravel-app",
};
```

### Prisma cannot find the generator provider

Make sure the package is installed and the generator block uses the current provider names:

```prisma
provider = "laraschema-migrations"
provider = "laraschema-models"
provider = "laraschema-types"
```

### Stubs are not being used

Check that `stubDir` points to the folder containing `migration/`, `model/`, `enum/`, and `ts/` folders.

```txt
prisma/stubs/migration/index.stub
prisma/stubs/model/index.stub
prisma/stubs/enum/index.stub
prisma/stubs/ts/index.stub
```

### Merge conflicts appear in generated files

LaraSchema detected real divergence between your edits and the new generated output.

Open the file, resolve:

```txt
<<<<<<<
=======
>>>>>>>
```

Then run generation again.

### TypeScript files are not generated

Check that the `types` generator block exists:

```prisma
generator types {
  provider = "laraschema-types"
  outputDir = "resources/js/types"
}
```

And confirm `ts.noEmit` is not enabled.

---

## Package Notes

The package keeps source and templates separate:

```txt
src/      TypeScript source only
stubs/    Published stub templates
types/    Global type declarations
```

The published package should include:

```txt
dist/
stubs/
README.md
LICENSE
```

The root `stubs/` folder must remain outside `src/` so compiled package code can resolve templates from the package root.

---

## Migrating from the older Prisma-Laravel package

Older documentation and examples may mention names such as:

```txt
prisma-laravel-migrate
prisma-laravel-cli
prisma/laravel.config.js
prisma-laravel-migrations
prisma-laravel-models
prisma-laravel-types
.prisma-laravel/backups
```

Current LaraSchema examples should use:

```txt
laraschema
lsh
laraschema.config.js
laraschema-migrations
laraschema-models
laraschema-types
.laraschema/backups
```

The goal of LaraSchema is the same core workflow: generate Laravel-native files from Prisma schemas while keeping stubs, config, and merge behavior customizable.
