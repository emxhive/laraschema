export enum GenTarget {
   None = 0,
   Model = 1 << 0,
   Migrator = 1 << 1,
}

export const isForModel = (t: GenTarget) => (t & GenTarget.Model) !== 0;
export const isForMigrator = (t: GenTarget) => (t & GenTarget.Migrator) !== 0;

export function parseTargetDirective(
   tag: "local" | "silent",
   doc?: string,
   defaultFlags: GenTarget = GenTarget.Model
): GenTarget {
   if (!doc) return GenTarget.None;

   const sawTag = new RegExp(`@${tag}(?![\\w])`, "i").test(doc);
   if (!sawTag) return GenTarget.None;

   const parts = listFrom(doc, tag)
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);

   if (parts.length === 0) return defaultFlags;

   let flags = GenTarget.None;
   for (const p of parts) {
      if (p === "model" || p === "models" || p === "modeler") {
         flags |= GenTarget.Model;
      } else if (p === "migrator" || p === "migration" || p === "migrations") {
         flags |= GenTarget.Migrator;
      } else if (p === "both" || p === "all" || p === "*") {
         flags |= GenTarget.Model | GenTarget.Migrator;
      }
   }

   return flags === GenTarget.None ? defaultFlags : flags;
}

export const parseLocalDirective = (doc?: string) =>
   parseTargetDirective('local', doc, GenTarget.Model);

export const parseSilentDirective = (doc?: string) =>
   parseTargetDirective('silent', doc, GenTarget.Model | GenTarget.Migrator);

export const parseUpdateDirective = (doc?: string): string[] => {
   if (!doc) return [];
   const sawTag = /@update(?![\w])/i.test(doc);
   if (!sawTag) return [];
   return listFrom(doc, "update");
};

export const listFrom = (doc: string, tag: string): string[] => {
   const out: string[] = [];

   const braceRe = new RegExp(`@${tag}\\{([\\s\\S]*?)\\}`, "gi");
   for (let m; (m = braceRe.exec(doc));) out.push(...m[1].split(","));

   const parenRe = new RegExp(`@${tag}\\(([^)]*)\\)`, "gi");
   for (let m; (m = parenRe.exec(doc));) out.push(...m[1].split(","));

   const colonRe = new RegExp(`@${tag}\\s*:\\s*([^\\r\\n]+)`, "gi");
   for (let m; (m = colonRe.exec(doc));) out.push(...m[1].split(","));

   const seen = new Set<string>();
   const cleaned: string[] = [];
   for (const s of out.map(x => x.trim()).filter(Boolean)) {
      if (!seen.has(s)) { seen.add(s); cleaned.push(s); }
   }
   return cleaned;
};
