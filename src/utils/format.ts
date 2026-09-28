import { BlameInfo, GitGlanceConfig, GlancePreset } from "../types";
import { formatDateByStyle, formatShortDate, formatAbsoluteDate } from "./date";

export interface PresetDefinition {
  format: string;
  uncommittedFormat: string;
}

export const PRESET_DEFINITIONS: Record<GlancePreset, PresetDefinition> = {
  default: {
    format: "${author} committed ${time}: ${message}",
    uncommittedFormat: "You: uncommitted changes",
  },
  minimalist: {
    format: "· ${author}, ${time} — ${message}",
    uncommittedFormat: "· You, uncommitted changes",
  },
  playful: {
    format: "👀 ${author}, ${time} • 🚀 ${message}",
    uncommittedFormat: "✨ You • Cooking some changes...",
  },
  terminal: {
    format: '// git:${author} @ ${hash} (${time}) "${message}"',
    uncommittedFormat: "// git:dirty *worktree changes",
  },
  github: {
    format: "@${author} committed ${time}: ${message}",
    uncommittedFormat: "@you: uncommitted changes",
  },
  breadcrumb: {
    format: "› ${author} › ${time} › ${message}",
    uncommittedFormat: "› You › Working Copy",
  },
  bento: {
    format: "⚡ ${author} │ ⏱️ ${time} │ 💬 ${message}",
    uncommittedFormat: "✏️ You │ ⏱️ now │ 📝 Uncommitted draft",
  },
  comment: {
    format: "/* by ${author}, ${time}: ${message} */",
    uncommittedFormat: "/* by You: not committed */",
  },
  custom: {
    format: "${author} committed ${time}: ${message}",
    uncommittedFormat: "You: uncommitted changes",
  },
};

/**
 * Formats the inline blame string according to active preset and user configuration.
 */
export function formatInlineText(
  blame: BlameInfo,
  config: GitGlanceConfig,
): string {
  const presetKey = config.preset || "default";
  const preset = PRESET_DEFINITIONS[presetKey] || PRESET_DEFINITIONS.default;

  if (blame.isUncommitted) {
    const uncommittedTemplate =
      config.preset === "custom"
        ? config.uncommittedFormat
        : preset.uncommittedFormat;

    const uncommittedTokens: Record<string, string> = {
      "${prefix}": config.prefix || "",
      "${author}": "You",
      "${message}": "uncommitted changes",
      "${time}": "now",
    };

    return uncommittedTemplate.replace(
      /\$\{(prefix|author|message|time)\}/g,
      (match) => uncommittedTokens[match] ?? match,
    );
  }

  const time = formatDateByStyle(blame.authorDate, config.dateStyle);
  const date = formatShortDate(blame.authorDate);
  const isoDate = formatAbsoluteDate(blame.authorDate);

  const template = config.preset === "custom" ? config.format : preset.format;

  const tokens: Record<string, string> = {
    "${prefix}": config.prefix || "",
    "${author}": blame.author,
    "${time}": time,
    "${date}": date,
    "${isoDate}": isoDate,
    "${message}": blame.summary,
    "${hash}": blame.shortSha,
    "${shortHash}": blame.shortSha,
    "${fullHash}": blame.sha,
    "${email}": blame.authorEmail ? `<${blame.authorEmail}>` : "",
    "${authorEmail}": blame.authorEmail || "",
  };

  return template.replace(
    /\$\{(prefix|author|time|date|isoDate|message|hash|shortHash|fullHash|email|authorEmail)\}/g,
    (match) => tokens[match] ?? match,
  );
}

/**
 * Escapes characters that have special meaning in markdown.
 */
export function escapeMarkdown(text: string): string {
  if (!text) {
    return "";
  }
  return text.replace(/([\\`*_{}[\]()#+\-.!|])/g, "\\$1");
}
