import * as vscode from "vscode";
import { GitHubTokenProvider } from "./avatar";

// `repo` is needed to read commits of private repositories.
const GITHUB_SCOPES = ["repo"];
const DONT_ASK_KEY = "gitGlance.avatarSignIn.dontAsk";

/** Auth provider id VS Code uses for `host`, or null when it isn't a GitHub host VS Code knows. */
function authProviderFor(host: string): string | null {
  if (host === "github.com") {
    return "github";
  }
  const enterpriseUri = vscode.workspace
    .getConfiguration("github-enterprise")
    .get<string>("uri");
  if (enterpriseUri) {
    try {
      if (new URL(enterpriseUri).hostname.toLowerCase() === host) {
        return "github-enterprise";
      }
    } catch {
      // invalid setting
    }
  }
  return null;
}

/** Asks VS Code to sign in to GitHub (or reuse an account) for Git Glance. */
export async function signInToGitHub(providerId = "github"): Promise<boolean> {
  try {
    await vscode.authentication.getSession(providerId, GITHUB_SCOPES, {
      createIfNone: true,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Finds a GitHub token without asking: VS Code's GitHub sign-in first, then the
 * token git already uses for HTTPS (`readStoredToken`). Only when both are empty
 * and a private repository needs one is the user asked, once per host per session.
 */
export function createGitHubTokenProvider(
  globalState: vscode.Memento,
  readStoredToken?: (host: string) => Promise<string | null>,
): GitHubTokenProvider {
  const requested = new Set<string>();
  const storedTokens = new Map<string, Promise<string | null>>();

  return async (host, requestSignIn) => {
    const providerId = authProviderFor(host);
    if (requestSignIn) {
      if (
        providerId === null ||
        requested.has(providerId) ||
        globalState.get<boolean>(DONT_ASK_KEY)
      ) {
        return null;
      }
      requested.add(providerId);
      void askToSignIn(providerId, globalState);
      return null;
    }
    if (providerId !== null) {
      try {
        const session = await vscode.authentication.getSession(
          providerId,
          GITHUB_SCOPES,
          { silent: true },
        );
        if (session !== undefined) {
          return session.accessToken;
        }
      } catch {
        // fall through to git's credentials
      }
    }
    if (readStoredToken === undefined) {
      return null;
    }
    let stored = storedTokens.get(host);
    if (stored === undefined) {
      stored = readStoredToken(host);
      storedTokens.set(host, stored);
    }
    return stored;
  };
}

async function askToSignIn(providerId: string, globalState: vscode.Memento) {
  const choice = await vscode.window.showInformationMessage(
    "Git Glance: sign in to GitHub to show your teammates' photos. GitHub needs it for private repositories and to lift its hourly limit.",
    "Sign in",
    "Don't Ask Again",
  );
  if (choice === "Sign in") {
    await signInToGitHub(providerId);
  } else if (choice === "Don't Ask Again") {
    await globalState.update(DONT_ASK_KEY, true);
  }
}
