import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 5_000;

export interface CodexAuthRotationOptions {
  readonly dir?: string;
  readonly stateFile?: string;
  readonly users?: readonly string[];
  readonly selectUser?: CodexAuthUserSelector;
}

export interface CodexAuthSelectionContext {
  readonly users: readonly string[];
  readonly activeUser?: string;
  readonly lastAssignedUser?: string;
  readonly authDir: string;
  readonly stateFile: string;
  readonly defaultUser: string;
}

export type CodexAuthUserSelector = (
  context: CodexAuthSelectionContext,
) => Promise<string | undefined> | string | undefined;

export class CodexAuthSelectionError extends Error {
  readonly fallbackToDefaultUser: boolean;

  constructor(
    message: string,
    options?: { readonly fallbackToDefaultUser?: boolean },
  ) {
    super(message);
    this.name = "CodexAuthSelectionError";
    this.fallbackToDefaultUser = options?.fallbackToDefaultUser ?? true;
  }
}

export interface CodexHostAuthOptions {
  readonly path?: string;
}

export interface PreparedCodexAuth {
  readonly user: string;
  readonly displayName?: string;
  readonly email?: string;
  readonly logMessages: readonly string[];
  readonly snapshotPath: string;
  cleanup(): Promise<void>;
}

interface RotationState {
  readonly lastAssignedUser: string;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const defaultAuthDir = (): string => join(process.env.HOME ?? "~", ".codex");

const defaultAuthPath = (): string => join(defaultAuthDir(), "auth.json");

const authPathForUser = (dir: string, user: string): string =>
  join(dir, `auth-${user}.json`);

const getStateFile = (
  dir: string,
  options?: CodexAuthRotationOptions,
): string => options?.stateFile ?? join(dir, "auth-rotation-state.json");

const discoverUsers = async (dir: string): Promise<readonly string[]> => {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter(
      (name) =>
        name.startsWith("auth-") &&
        name.endsWith(".json") &&
        name !== "auth-rotation-state.json",
    )
    .map((name) => name.slice("auth-".length, -".json".length))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
};

const getUsers = async (
  dir: string,
  options?: CodexAuthRotationOptions,
): Promise<readonly string[]> =>
  options?.users && options.users.length > 0
    ? options.users
    : discoverUsers(dir);

const activeUserFromFiles = async (
  dir: string,
  users: readonly string[],
): Promise<string | undefined> => {
  const auth = join(dir, "auth.json");
  let authExists = true;
  try {
    await readFile(auth);
  } catch {
    authExists = false;
  }
  if (!authExists) return undefined;

  const missingUsers: string[] = [];
  for (const user of users) {
    try {
      await readFile(authPathForUser(dir, user));
    } catch {
      missingUsers.push(user);
    }
  }
  return missingUsers.length === 1 ? missingUsers[0] : undefined;
};

const nextUserInCycle = (
  current: string | undefined,
  users: readonly string[],
): string => {
  if (!current) return users[0]!;
  const index = users.indexOf(current);
  if (index === -1) return users[0]!;
  return users[(index + 1) % users.length]!;
};

interface SelectionResolution {
  readonly user: string;
  readonly logMessage: string;
}

const resolveSelectedUser = async (
  options: CodexAuthRotationOptions | undefined,
  context: CodexAuthSelectionContext,
): Promise<SelectionResolution> => {
  if (!options?.selectUser) {
    return {
      user: context.defaultUser,
      logMessage: `Codex auth selected by round-robin: ${context.defaultUser}`,
    };
  }

  try {
    const selectedUser = await options.selectUser(context);
    if (selectedUser === undefined) {
      return {
        user: context.defaultUser,
        logMessage: `Codex auth selector returned no user; fell back to round-robin: ${context.defaultUser}`,
      };
    }
    if (!context.users.includes(selectedUser)) {
      return {
        user: context.defaultUser,
        logMessage: `Codex auth selector returned invalid user "${selectedUser}"; fell back to round-robin: ${context.defaultUser}`,
      };
    }
    return {
      user: selectedUser,
      logMessage: `Codex auth selector chose ${selectedUser}`,
    };
  } catch (error) {
    if (
      error instanceof CodexAuthSelectionError &&
      !error.fallbackToDefaultUser
    ) {
      throw error;
    }
    return {
      user: context.defaultUser,
      logMessage: `Codex auth selector failed (${error instanceof Error ? error.message : String(error)}); fell back to round-robin: ${context.defaultUser}`,
    };
  }
};

const readRotationState = async (
  stateFile: string,
): Promise<RotationState | undefined> => {
  try {
    const raw = await readFile(stateFile, "utf-8");
    const parsed = JSON.parse(raw) as { lastAssignedUser?: unknown };
    if (typeof parsed.lastAssignedUser === "string") {
      return { lastAssignedUser: parsed.lastAssignedUser };
    }
  } catch {
    // missing/corrupt state falls back to auth file inference
  }
  return undefined;
};

const writeRotationState = async (
  stateFile: string,
  state: RotationState,
): Promise<void> => {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, JSON.stringify(state));
};

const acquireLock = async (lockDir: string): Promise<() => Promise<void>> => {
  const started = Date.now();
  while (true) {
    try {
      await mkdir(lockDir);
      return async () => {
        await rm(lockDir, { recursive: true, force: true });
      };
    } catch (error) {
      if (Date.now() - started >= LOCK_TIMEOUT_MS) {
        throw new Error(
          `Timed out waiting for Codex auth rotation lock at ${lockDir}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      await sleep(LOCK_RETRY_MS);
    }
  }
};

const readSelectedAuthContent = async (
  dir: string,
  selectedUser: string,
  activeUser: string | undefined,
): Promise<{ readonly content: string; readonly sourcePath: string }> => {
  const sourcePath =
    activeUser === selectedUser
      ? join(dir, "auth.json")
      : authPathForUser(dir, selectedUser);
  try {
    return {
      content: await readFile(sourcePath, "utf-8"),
      sourcePath,
    };
  } catch (error) {
    throw new Error(
      `Codex auth snapshot for "${selectedUser}" not found at ${sourcePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

const decodeJwtPayload = (
  token: string,
): Record<string, unknown> | undefined => {
  const parts = token.split(".");
  if (parts.length < 2) return undefined;
  try {
    const payload = parts[1]! + "=".repeat((4 - (parts[1]!.length % 4)) % 4);
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as
      | Record<string, unknown>
      | undefined;
  } catch {
    return undefined;
  }
};

const describeCodexAuth = (
  authContent: string,
  fallbackUser?: string,
): {
  readonly displayName?: string;
  readonly email?: string;
  readonly logMessage: string;
} => {
  try {
    const parsed = JSON.parse(authContent) as {
      tokens?: { id_token?: unknown };
    };
    const idToken = parsed.tokens?.id_token;
    if (typeof idToken === "string") {
      const payload = decodeJwtPayload(idToken);
      const displayName =
        typeof payload?.name === "string" ? payload.name : undefined;
      const email =
        typeof payload?.email === "string" ? payload.email : undefined;
      if (displayName && email) {
        return {
          displayName,
          email,
          logMessage: fallbackUser
            ? `Codex auth user: ${displayName} (${fallbackUser}, ${email})`
            : `Codex auth user: ${displayName} (${email})`,
        };
      }
      if (displayName) {
        return {
          displayName,
          email,
          logMessage: fallbackUser
            ? `Codex auth user: ${displayName} (${fallbackUser})`
            : `Codex auth user: ${displayName}`,
        };
      }
      if (email) {
        return {
          displayName,
          email,
          logMessage: fallbackUser
            ? `Codex auth user: ${fallbackUser} (${email})`
            : `Codex auth user: ${email}`,
        };
      }
    }
  } catch {
    // fall through
  }
  return {
    logMessage: fallbackUser
      ? `Codex auth user: ${fallbackUser}`
      : "Codex auth user: current host auth",
  };
};

export const prepareHostCodexAuth = async (
  options?: CodexHostAuthOptions,
): Promise<PreparedCodexAuth> => {
  const sourcePath = options?.path ?? defaultAuthPath();
  let content: string;
  try {
    content = await readFile(sourcePath, "utf-8");
  } catch (error) {
    throw new Error(
      `Codex host auth not found at ${sourcePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const authDescription = describeCodexAuth(content);
  const snapshotDir = await mkdtemp(join(tmpdir(), "sandcastle-codex-auth-"));
  const snapshotPath = join(snapshotDir, "auth.json");
  await writeFile(snapshotPath, content);

  return {
    user: "host",
    displayName: authDescription.displayName,
    email: authDescription.email,
    logMessages: [authDescription.logMessage],
    snapshotPath,
    cleanup: async () => {
      await rm(snapshotDir, { recursive: true, force: true });
    },
  };
};

export const prepareCodexAuth = async (
  options?: CodexAuthRotationOptions,
): Promise<PreparedCodexAuth> => {
  const dir = options?.dir ?? defaultAuthDir();
  const users = await getUsers(dir, options);
  if (users.length === 0) {
    throw new Error(
      `No Codex auth snapshots found in ${dir}. Expected auth-<user>.json files.`,
    );
  }

  const stateFile = getStateFile(dir, options);
  const lockDir = `${stateFile}.lock`;
  const release = await acquireLock(lockDir);

  try {
    const activeUser = await activeUserFromFiles(dir, users);
    const lastAssignedUser =
      (await readRotationState(stateFile))?.lastAssignedUser ?? activeUser;
    const defaultUser = nextUserInCycle(lastAssignedUser, users);
    const selection = await resolveSelectedUser(options, {
      users,
      activeUser,
      lastAssignedUser,
      authDir: dir,
      stateFile,
      defaultUser,
    });
    const user = selection.user;
    await writeRotationState(stateFile, { lastAssignedUser: user });

    const { content } = await readSelectedAuthContent(dir, user, activeUser);
    const authDescription = describeCodexAuth(content, user);
    const snapshotDir = await mkdtemp(join(tmpdir(), "sandcastle-codex-auth-"));
    const snapshotPath = join(snapshotDir, "auth.json");
    await writeFile(snapshotPath, content);

    return {
      user,
      displayName: authDescription.displayName,
      email: authDescription.email,
      logMessages: [selection.logMessage, authDescription.logMessage],
      snapshotPath,
      cleanup: async () => {
        await rm(snapshotDir, { recursive: true, force: true });
      },
    };
  } finally {
    await release();
  }
};
