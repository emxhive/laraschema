import fs from "fs";
import path from "path";
import { Migration } from "@/generators/migrations/generator";
import { formatStub } from "@/core/stubs/format-stub";
import { resolveStub } from "@/core/stubs/resolve-stub";
import type { StubConfig } from "@/core/stubs/stub-config.types";
import { decorate } from "@/shared/naming/decorate";
import { sortMigrations } from "@/shared/sorting/sort-migrations";

export interface PrinterNameOpts {
   tablePrefix?: string;
   tableSuffix?: string;
}

export class StubMigrationPrinter {
   #currentStubPath = "";
   #currentMode: 'create' | 'update' = 'create';
   private tmplFn!: (
      tableName: string,
      columns: string,
      definitions: Migration["definitions"]
   ) => string;

   private static textCache = new Map<string, string>();

   constructor(
      /** base config for per-table stub resolution */
      private cfg: StubConfig & PrinterNameOpts,
      /** optional global override: if set, always use this stub */
      private globalStubPath?: string,
      /** optional update-mode override */
      private globalUpdateStubPath?: string
   ) { }

   /** Switch to the correct stub for this table (or reuse the last one) */
   private ensureStub(tableName: string, mode: 'create' | 'update') {
      /* 1) choose stub path */
      const resolved = resolveStub(this.cfg, "migration", tableName, mode);
      const stubPath = resolved
         ? resolved
         : mode === 'update' && this.globalUpdateStubPath
            ? path.resolve(process.cwd(), this.globalUpdateStubPath)
            : this.globalStubPath
               ? path.resolve(process.cwd(), this.globalStubPath)
               : (() => {
                  throw new Error(`No stub found for migration '${tableName}'`);
               })();
      if (stubPath === this.#currentStubPath && mode === this.#currentMode) return;

      /* 2) compile template */
      let raw = StubMigrationPrinter.textCache.get(stubPath);

      if (!raw) {
         raw = fs.readFileSync(stubPath, "utf-8");
         StubMigrationPrinter.textCache.set(stubPath, raw);
      }

      this.tmplFn = new Function(
         "tableName",
         "columns",
         "definitions",
         `return \`${formatStub(raw)}\`;`
      ) as typeof this.tmplFn;

      this.#currentStubPath = stubPath;
      this.#currentMode = mode;
   }

   /**
    * Render a single migration.
    * Returns both the full file and the raw column block.
    */
   public printMigration(mig: Migration) {
      const mode = mig.mode ?? 'create';
      this.ensureStub(mig.tableName, mode);

      const columns = mig.statements
         .map((l) => "            " + l)
         .join("\n");

      /* apply prefix/suffix when inserting into the stub */
      const physicalTable = decorate(mig.tableName, this.cfg);

      const fullContent = this.tmplFn(
         physicalTable,
         columns,
         mig.definitions
      );

      return { fullContent, columns };
   }

   /** Render all migrations, sorted */
   public printAll(migs: Migration[]): string {
      return sortMigrations(migs)
         .map((m) => this.printMigration(m).fullContent)
         .join("\n\n");
   }
}
