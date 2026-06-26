import { readdirSync } from "fs";
import fs from "fs/promises";
import path from "path";

function getPrismaFilesRecursive(dir: string): string[] {
   let results: string[] = [];
   const entries = readdirSync(dir, { withFileTypes: true });
   for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
         results = results.concat(getPrismaFilesRecursive(fullPath));
      } else if (entry.isFile() && entry.name.endsWith(".prisma")) {
         results.push(fullPath);
      }
   }
   return results;
}

// utility: load/merge ALL *.prisma files under prisma/ (schema first, then the rest)
export async function loadMergedDatamodel(schemaPrismaPath: string): Promise<string> {
   const schemaDir = path.dirname(schemaPrismaPath);
   const allFiles = getPrismaFilesRecursive(schemaDir);

   const normalizedSchemaPath = path.resolve(schemaPrismaPath);
   const mainSchemaFile = allFiles.find(f => path.resolve(f) === normalizedSchemaPath);
   
   const otherFiles = allFiles
      .filter(f => path.resolve(f) !== normalizedSchemaPath)
      .sort((a, b) => a.localeCompare(b));

   const order = mainSchemaFile ? [mainSchemaFile, ...otherFiles] : otherFiles;
   const chunks = await Promise.all(order.map(f => fs.readFile(f, "utf-8")));
   return chunks.join("\n\n");
}