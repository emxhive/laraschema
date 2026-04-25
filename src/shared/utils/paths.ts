import path from "path";

export const toPosixPath = (p: string) => p.replace(/\\\\/g, "/");
export const resolveFromCwd = (...parts: string[]) => path.resolve(process.cwd(), ...parts);

export function getResolvedRoot(config: { rootDir?: string } | undefined): string {
   return config?.rootDir
      ? path.resolve(process.cwd(), config.rootDir)
      : process.cwd();
}

export function resolveFromRoot(
   config: { rootDir?: string } | undefined,
   target: string
): string {
   return path.resolve(getResolvedRoot(config), target);
}

export function relativeToRoot(
   config: { rootDir?: string } | undefined,
   target: string
): string {
   return path.relative(getResolvedRoot(config), target);
}
