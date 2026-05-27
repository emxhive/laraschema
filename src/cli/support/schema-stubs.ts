import path from 'path';
import { existsSync } from 'fs';

export function resolveStubIndex(
   stubRoot: string,
   kind: 'enum' | 'model' | 'migration' | 'ts',
   dirname: string,
   updateMode = false
): string {
   const userPath = path.join(stubRoot, kind, updateMode && kind === 'migration' ? 'index.update.stub' : 'index.stub');
   const fallbackPath = path.resolve(
      dirname,
      '../../stubs',
      updateMode && kind === 'migration' ? 'migration.update.stub' : `${kind}.stub`
   );

   if (existsSync(userPath)) return userPath;
   if (existsSync(fallbackPath)) return fallbackPath;

   throw new Error(`Missing both user and fallback index stub for kind "${kind}"`);
}
