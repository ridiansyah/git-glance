import { BlameInfo, GitGlanceConfig, GlancePreset } from "../types";
import { formatDateByStyle, formatShortDate, formatAbsoluteDate } from "./date";

export interface PresetDefinition {
  format: string;
  uncommittedFormat: string;
}

export const PRESET_DEFINITIONS: Record<GlancePreset, PresetDefinition> = {
  default: {
    format: "${author}, ${time}: ${message}",
    uncommittedFormat: "${author}, ${time}: ${message}",
  },
  minimalist: {
    format: "· ${author}, ${time} — ${message}",
    uncommittedFormat: "· ${author}, ${time} — ${message}",
  },
  playful: {
    format: "👀 ${author}, ${time} • 🚀 ${message}",
    uncommittedFormat: "✨ ${author}, ${time} • 📝 ${message}",
  },
  terminal: {
    format: '// git:${author} @ ${hash} (${time}) "${message}"',
    uncommittedFormat: '// git:${author} (${time}) "${message}"',
  },
  github: {
    format: "@${author}, ${time}: ${message}",
    uncommittedFormat: "@${author}, ${time}: ${message}",
  },
  breadcrumb: {
    format: "› ${author} › ${time} › ${message}",
    uncommittedFormat: "› ${author} › ${time} › ${message}",
  },
  bento: {
    format: "⚡ ${author} │ ⏱️ ${time} │ 💬 ${message}",
    uncommittedFormat: "⚡ ${author} │ ⏱️ ${time} │ 📝 ${message}",
  },
  comment: {
    format: "/* by ${author}, ${time}: ${message} */",
    uncommittedFormat: "/* by ${author}, ${time}: ${message} */",
  },
  custom: {
    format: "${author}, ${time}: ${message}",
    uncommittedFormat: "${author}, ${time}: ${message}",
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

    const time = formatDateByStyle(blame.authorDate, config.dateStyle);
    const date = formatShortDate(blame.authorDate);
    const isoDate = formatAbsoluteDate(blame.authorDate);

    const uncommittedTokens: Record<string, string> = {
      "${prefix}": config.prefix || "",
      "${author}": blame.author || "You",
      "${message}": blame.summary || "Uncommitted changes",
      "${time}": time,
      "${date}": date,
      "${isoDate}": isoDate,
    };

    return uncommittedTemplate.replace(
      /\$\{(prefix|author|message|time|date|isoDate)\}/g,
      (match) => uncommittedTokens[match] ?? match,
    );
  }

  const time = formatDateByStyle(blame.authorDate, config.dateStyle);
  const date = formatShortDate(blame.authorDate);
  const isoDate = formatAbsoluteDate(blame.authorDate);

  const template = config.preset === "custom" ? config.format : preset.format;

  const authorName = blame.isCurrentUser ? "You" : blame.author;

  const tokens: Record<string, string> = {
    "${prefix}": config.prefix || "",
    "${author}": authorName,
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
