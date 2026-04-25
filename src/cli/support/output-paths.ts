import { getResolvedRoot, resolveFromRoot } from "@/shared/utils/paths";

export function getOutputPaths(cfg: any) {
   return {
      migrations: resolveFromRoot(cfg, cfg.output?.migrations ?? 'database/migrations'),
      models: resolveFromRoot(cfg, cfg.output?.models ?? 'app/Models'),
      enums: resolveFromRoot(cfg, cfg.modeler?.outputEnumDir ?? cfg.output?.enums ?? 'app/Enums'),
      backups: resolveFromRoot(cfg, '.laraschema/backups'),
      root: getResolvedRoot(cfg),
   };
}
