/**
 * Parses and converts Git remote URLs across various Git hosting providers
 * (Bitbucket Cloud, Bitbucket Server / Data Center, GitHub, GitLab, Azure DevOps,
 * Codeberg, Gitea, SourceHut, AWS CodeCommit, etc.) into web commit URLs.
 */

export type GitProvider =
  | "bitbucket-cloud"
  | "bitbucket-server"
  | "github"
  | "gitlab"
  | "azure-devops"
  | "codecommit"
  | "generic";

export interface ParsedRemote {
  /** Target web scheme ('https:' or 'http:') */
  scheme: string;
  /** Normalized web hostname (e.g. 'bitbucket.org' instead of 'altssh.bitbucket.org') */
  host: string;
  /** Web port if non-standard HTTP/HTTPS port, otherwise null */
  port: string | null;
  /** SSH port if specified in ssh:// URL (e.g. 7999 for Bitbucket Server), otherwise null */
  sshPort: string | null;
  /** Normalized path without leading/trailing slashes and without '.git' */
  path: string;
  /** Original protocol used in the remote (e.g. 'ssh:', 'https:', 'scp:') */
  originalProtocol: string;
}

/**
 * Normalizes SSH alias / firewall proxy hostnames to their corresponding web hostnames.
 */
export function normalizeHost(host: string): string {
  const lower = host.toLowerCase();
  if (lower === "altssh.bitbucket.org") {
    return "bitbucket.org";
  }
  if (lower === "ssh.github.com") {
    return "github.com";
  }
  if (lower === "altssh.gitlab.com") {
    return "gitlab.com";
  }
  if (lower === "ssh.dev.azure.com") {
    return "dev.azure.com";
  }
  return lower;
}

/**
 * Percent-encodes each path segment once. Segments that are already encoded
 * (URL-style remotes) are decoded first so they are not encoded twice.
 * Parentheses are escaped too, since they would end a markdown link early.
 */
function encodePath(rawPath: string): string {
  return rawPath
    .split("/")
    .map((segment) => {
      let decoded = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        // Malformed escape: encode the segment as written.
      }
      return encodeURIComponent(decoded).replace(/[()]/g, (c) =>
        c === "(" ? "%28" : "%29",
      );
    })
    .join("/");
}

/**
 * Parses a raw git remote string into normalized components.
 * Returns null if the URL is local (file://, drive letters, relative paths)
 * or invalid.
 */
export function parseRemoteUrl(rawRemote: string): ParsedRemote | null {
  const trimmed = rawRemote.trim();
  if (trimmed.length === 0) {
    return null;
  }

  // Reject local file paths and Windows drive paths
  if (
    trimmed.startsWith("file://") ||
    trimmed.startsWith("/") ||
    /^[a-zA-Z]:[/\\]/.test(trimmed)
  ) {
    return null;
  }

  // 1. Check for SCP-style SSH: [user@]host:path (e.g. git@bitbucket.org:org/repo.git, git@gitlab.com:123/repo.git)
  // Must NOT contain '://' (which indicates an explicit URI scheme)
  // Must have at least 2 host characters before ':' to avoid colliding with Windows drives
  const scpMatch =
    !trimmed.includes("://")
      ? trimmed.match(/^(?:[^@/\s]+@)?([^:/\s]{2,}):(.+)$/)
      : null;
  if (scpMatch) {
    const rawHost = scpMatch[1];
    let rawPath = scpMatch[2].replace(/\\/g, "/");

    // Clean leading/trailing slashes and .git
    rawPath = rawPath.replace(/^\/+|\/+$/g, "");
    if (rawPath.endsWith(".git")) {
      rawPath = rawPath.slice(0, -4).replace(/\/+$/, "");
    }

    if (rawPath.length === 0) {
      return null;
    }

    // Special check for Azure DevOps vs-ssh: org@vs-ssh.visualstudio.com:v3/org/proj/repo
    const lowerHost = rawHost.toLowerCase();
    let finalHost = normalizeHost(lowerHost);
    if (lowerHost === "vs-ssh.visualstudio.com") {
      // Format: v3/{org}/{project}/{repo} -> {org}.visualstudio.com
      const parts = rawPath.split("/");
      if (parts[0] === "v3" && parts.length >= 4) {
        finalHost = `${parts[1].toLowerCase()}.visualstudio.com`;
      }
    }

    return {
      scheme: "https:",
      host: finalHost,
      port: null,
      sshPort: null,
      path: encodePath(rawPath),
      originalProtocol: "scp:",
    };
  }

  // 2. Parse URI format (https://, http://, ssh://, git://, git+ssh://)
  let urlObj: URL;
  try {
    // Normalise git+ssh:// or git:// for URL parser
    let parseable = trimmed;
    if (parseable.startsWith("git+ssh://")) {
      parseable = "ssh://" + parseable.slice(10);
    }
    urlObj = new URL(parseable);
  } catch {
    return null;
  }

  const proto = urlObj.protocol.toLowerCase();
  if (
    proto !== "https:" &&
    proto !== "http:" &&
    proto !== "ssh:" &&
    proto !== "git:"
  ) {
    return null;
  }

  const originalHost = urlObj.hostname;
  if (!originalHost || originalHost.length < 2) {
    return null;
  }

  const normalizedHost = normalizeHost(originalHost);

  // Preserve non-standard ports only for http/https (web ports), discard SSH ports (e.g. 22, 443 on altssh, 7999)
  let webPort: string | null = null;
  let sshPort: string | null = null;
  if (proto === "http:" || proto === "https:") {
    if (urlObj.port && urlObj.port !== "80" && urlObj.port !== "443") {
      webPort = urlObj.port;
    }
  } else if (proto === "ssh:" || proto === "git:") {
    if (urlObj.port && urlObj.port !== "22") {
      sshPort = urlObj.port;
    }
  }

  let cleanPath = urlObj.pathname.replace(/^\/+|\/+$/g, "");
  if (cleanPath.endsWith(".git")) {
    cleanPath = cleanPath.slice(0, -4).replace(/\/+$/, "");
  }

  if (cleanPath.length === 0) {
    return null;
  }

  return {
    scheme: proto === "http:" ? "http:" : "https:",
    host: normalizedHost,
    port: webPort,
    sshPort,
    path: encodePath(cleanPath),
    originalProtocol: proto,
  };
}

/**
 * Detects the Git provider from a parsed remote.
 */
export function detectProvider(parsed: ParsedRemote): GitProvider {
  const host = parsed.host.toLowerCase();
  const path = parsed.path.toLowerCase();

  // 1. AWS CodeCommit
  if (host.startsWith("git-codecommit.") && host.endsWith(".amazonaws.com")) {
    return "codecommit";
  }

  // 2. Azure DevOps / Visual Studio Team Services (strictly based on hostname)
  if (host === "dev.azure.com" || host.endsWith(".visualstudio.com")) {
    return "azure-devops";
  }

  // On-prem Azure DevOps Server / TFS has no known host but always uses /_git/
  if (path.includes("/_git/")) {
    return "azure-devops";
  }

  // 3. Bitbucket Cloud
  if (host === "bitbucket.org") {
    return "bitbucket-cloud";
  }

  // 4. GitLab (cloud or self-hosted with gitlab in domain)
  if (host.includes("gitlab")) {
    return "gitlab";
  }

  // 5. GitHub (cloud or GitHub Enterprise)
  if (host === "github.com" || host.startsWith("github.") || host.includes("github")) {
    return "github";
  }

  // 6. Bitbucket Server / Data Center (on-premise / self-hosted)
  // Indicators on unrecognized hosts:
  // - Hostname explicitly containing 'bitbucket' or 'stash'
  // - Standard Bitbucket Server SSH port 7999
  // - Standard Bitbucket Server HTTP path segment '/scm/' or 'scm/'
  if (
    host.includes("bitbucket") ||
    host.includes("stash") ||
    parsed.sshPort === "7999" ||
    path.startsWith("scm/") ||
    path.includes("/scm/")
  ) {
    return "bitbucket-server";
  }

  return "generic";
}

/**
 * Builds the web commit URL based on detected provider.
 */
export function buildProviderCommitUrl(
  provider: GitProvider,
  parsed: ParsedRemote,
  sha: string,
): string {
  const portSuffix = parsed.port ? `:${parsed.port}` : "";
  const baseUrl = `${parsed.scheme}//${parsed.host}${portSuffix}`;

  switch (provider) {
    case "bitbucket-cloud": {
      return `${baseUrl}/${parsed.path}/commits/${sha}`;
    }

    case "bitbucket-server": {
      // Bitbucket Server / Data Center has two main URL schemas:
      // HTTPS: [contextPath/]scm/{project}/{repo}
      // SSH:   [contextPath/]{project}/{repo}
      // Target Web Commit URL: [contextPath/]projects/{PROJECT}/repos/{REPO}/commits/{sha}
      // Personal repositories start with ~user: users/{user}/repos/{REPO}/commits/{sha}
      const segments = parsed.path.split("/");
      const scmIndex = segments.indexOf("scm");

      let contextPath = "";
      let project = "";
      let repo = "";

      if (scmIndex !== -1 && scmIndex + 2 < segments.length) {
        contextPath = segments.slice(0, scmIndex).join("/");
        project = segments[scmIndex + 1];
        repo = segments[scmIndex + 2];
      } else if (segments.length >= 2) {
        contextPath = segments.slice(0, -2).join("/");
        project = segments[segments.length - 2];
        repo = segments[segments.length - 1];
      } else {
        // Fallback if structure is unusual
        return `${baseUrl}/${parsed.path}/commits/${sha}`;
      }

      const prefix = contextPath.length > 0 ? `/${contextPath}` : "";
      if (project.startsWith("~")) {
        const username = project.slice(1);
        return `${baseUrl}${prefix}/users/${username}/repos/${repo}/commits/${sha}`;
      }

      return `${baseUrl}${prefix}/projects/${project}/repos/${repo}/commits/${sha}`;
    }

    case "gitlab": {
      return `${baseUrl}/${parsed.path}/-/commit/${sha}`;
    }

    case "azure-devops": {
      // SSH format: v3/{org}/{project}/{repo}
      if (parsed.path.startsWith("v3/")) {
        const parts = parsed.path.split("/");
        if (parts.length >= 4) {
          const [, org, project, repo] = parts;
          return `https://dev.azure.com/${org}/${project}/_git/${repo}/commit/${sha}`;
        }
      }

      // HTTPS format on dev.azure.com: {org}/{project}/_git/{repo}
      if (parsed.path.includes("/_git/")) {
        return `${baseUrl}/${parsed.path}/commit/${sha}`;
      }

      // If missing _git segment (e.g. dev.azure.com/org/project/repo)
      const parts = parsed.path.split("/");
      if (parts.length >= 3) {
        const [org, project, repo] = parts;
        return `https://dev.azure.com/${org}/${project}/_git/${repo}/commit/${sha}`;
      }

      return `${baseUrl}/${parsed.path}/commit/${sha}`;
    }

    case "codecommit": {
      // Host: git-codecommit.{region}.amazonaws.com
      // Path: v1/repos/{repo}
      const regionMatch = parsed.host.match(/^git-codecommit\.([^.]+)\.amazonaws\.com$/);
      const region = regionMatch ? regionMatch[1] : "us-east-1";
      const repoName = parsed.path.replace(/^v1\/repos\//, "");
      return `https://${region}.console.aws.amazon.com/codesuite/codecommit/repositories/${repoName}/commit/${sha}?region=${region}`;
    }

    case "github":
    case "generic":
    default: {
      return `${baseUrl}/${parsed.path}/commit/${sha}`;
    }
  }
}

/**
 * Applies a custom URL template configured by the user.
 * Supported tokens: ${host}, ${path}, ${sha}, ${shortSha}, ${project}, ${repo}.
 */
export function applyCommitTemplate(
  template: string,
  parsed: ParsedRemote,
  sha: string,
): string | null {
  const segments = parsed.path.split("/");
  const project = segments.length > 1 ? segments[segments.length - 2] : "";
  const repo = segments[segments.length - 1] ?? "";
  const shortSha = sha.slice(0, 7);

  const replacements: Record<string, string> = {
    host: parsed.host,
    path: parsed.path,
    sha,
    shortSha,
    project,
    repo,
  };

  // Safe single-pass substitution
  const result = template.replace(
    /\$\{(host|path|sha|shortSha|project|repo)\}/g,
    (_, token) => replacements[token] ?? "",
  );

  if (!/^https?:\/\//.test(result)) {
    return null;
  }
  try {
    return new URL(result).toString();
  } catch {
    return null;
  }
}

/**
 * Main entry point: converts a Git remote URL and commit SHA into a web commit URL.
 * Automatically detects Bitbucket Cloud, Bitbucket Server, GitHub, GitLab,
 * Azure DevOps, AWS CodeCommit, Codeberg, Gitea, SourceHut, and others.
 *
 * If `customTemplate` is provided and non-empty, it overrides auto-detection.
 */
export function commitWebUrl(
  remoteUrl: string,
  sha: string,
  customTemplate?: string,
): string | null {
  const parsed = parseRemoteUrl(remoteUrl);
  return parsed === null ? null : commitUrlFromParsed(parsed, sha, customTemplate);
}

/**
 * Same as `commitWebUrl` for a remote that was already parsed, so callers that
 * build many URLs for one remote parse it once.
 */
export function commitUrlFromParsed(
  parsed: ParsedRemote,
  sha: string,
  customTemplate?: string,
): string | null {
  if (!sha || sha.replace(/0/g, "").length === 0) {
    return null;
  }

  if (customTemplate && customTemplate.trim().length > 0) {
    const fromTemplate = applyCommitTemplate(customTemplate.trim(), parsed, sha);
    if (fromTemplate) {
      return fromTemplate;
    }
  }

  const provider = detectProvider(parsed);
  return buildProviderCommitUrl(provider, parsed, sha);
}
