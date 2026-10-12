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
 * Shortens text to `maxLength` characters (code points, so emoji aren't split),
 * ending with "…". A limit of 0 or less disables truncation.
 */
export function truncateText(text: string, maxLength: number): string {
  if (maxLength <= 0) {
    return text;
  }
  const chars = Array.from(text);
  if (chars.length <= maxLength) {
    return text;
  }
  return chars.slice(0, Math.max(1, maxLength - 1)).join("").trimEnd() + "…";
}

/**
 * Formats the inline blame string according to active preset and user configuration.
 */
export function formatInlineText(
  blame: BlameInfo,
  config: GitGlanceConfig,
): string {
  // settings.json can hold a value outside the enum
  const preset = Object.prototype.hasOwnProperty.call(
    PRESET_DEFINITIONS,
    config.preset,
  )
    ? PRESET_DEFINITIONS[config.preset]
    : PRESET_DEFINITIONS.default;
  const isCustom = config.preset === "custom";

  const time = formatDateByStyle(blame.authorDate, config.dateStyle);
  const date = formatShortDate(blame.authorDate);
  const isoDate = formatAbsoluteDate(blame.authorDate);
  const message = truncateText(blame.summary, config.maxMessageLength);

  if (blame.isUncommitted) {
    const uncommittedTemplate = isCustom
      ? config.uncommittedFormat
      : preset.uncommittedFormat;

    const uncommittedTokens: Record<string, string> = {
      "${prefix}": config.prefix,
      "${author}": blame.author,
      "${message}": message,
      "${time}": time,
      "${date}": date,
      "${isoDate}": isoDate,
    };

    return uncommittedTemplate.replace(
      /\$\{(prefix|author|message|time|date|isoDate)\}/g,
      (match) => uncommittedTokens[match],
    );
  }

  const template = isCustom ? config.format : preset.format;

  const tokens: Record<string, string> = {
    "${prefix}": config.prefix,
    "${author}": blame.isCurrentUser ? "You" : blame.author,
    "${time}": time,
    "${date}": date,
    "${isoDate}": isoDate,
    "${message}": message,
    "${hash}": blame.shortSha,
    "${shortHash}": blame.shortSha,
    "${fullHash}": blame.sha,
    "${email}": blame.authorEmail ? `<${blame.authorEmail}>` : "",
    "${authorEmail}": blame.authorEmail,
  };

  return template.replace(
    /\$\{(prefix|author|time|date|isoDate|message|hash|shortHash|fullHash|email|authorEmail)\}/g,
    (match) => tokens[match],
  );
}

/**
 * Escapes characters that have special meaning in markdown, plus `<`, `>` and `&`
 * so text can't open an HTML tag, autolink, or entity.
 */
export function escapeMarkdown(text: string): string {
  if (!text) {
    return "";
  }
  return text.replace(/([\\`*_{}[\]()#+\-.!|<>&])/g, "\\$1");
}
