// src/shared/clean/clean-generated.ts

import {getConfig} from "@/core/config/config-store";
import {stripCustomDirectives} from "@/shared/directives/strip-custom-directives";
import type {CustomDirectiveRegistry} from "@/shared/directives/custom-directive.types";

const BUILT_IN_DIRECTIVES = [
    // model fields
    "fillable",
    "hidden",
    "guarded",
    "cast",
    "type",

    // model/class customization
    "with",
    "trait",
    "use",
    "extend",
    "abstract",
    "implements",
    "observer",
    "factory",
    "touch",
    "appends",

    // generation control
    "local",
    "silent",
    "ignore",

    // migrations
    "unsigned",
    "update",

    // relation / pivot / morph
    "morph",
    "pivot",
    "entity",
    "withTimestamps",
    "pivotAlias",
];

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripNamedDirective(doc: string, name: string): string {
    const escaped = escapeRegex(name);

    return doc
        // @name(...)
        .replace(new RegExp(`\\s*@${escaped}\\s*\\([^)]*\\)`, "g"), "")
        // @name{...}
        .replace(new RegExp(`\\s*@${escaped}\\s*\\{[^}]*\\}`, "g"), "")
        // @name: ...
        .replace(new RegExp(`\\s*@${escaped}\\s*:\\s*[^@\\r\\n]+`, "g"), "")
        // @name
        .replace(new RegExp(`\\s*@${escaped}(?![\\w-])`, "g"), "");
}

function cleanDocLines(doc: string): string | undefined {
    const cleaned = doc
        .split(/\r?\n/)
        .map((line) => line.replace(/[ \t]+$/g, ""))
        .filter((line) => {
            const body = line.replace(/^\s*\/\/\/\s?/, "").trim();
            return body.length > 0;
        })
        .join("\n")
        .trim();

    return cleaned || undefined;
}

export function stripDirectives(
    doc: string | undefined | null,
    customDirectives?: CustomDirectiveRegistry,
): string | undefined {
    if (!doc) return undefined;

    let cleaned = doc;

    for (const directive of BUILT_IN_DIRECTIVES) {
        cleaned = stripNamedDirective(cleaned, directive);
    }

    const registry =
        customDirectives ??
        (getConfig("model", "directives") as CustomDirectiveRegistry | undefined);

    cleaned = stripCustomDirectives(cleaned, registry);

    return cleanDocLines(cleaned);
}
