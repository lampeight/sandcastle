import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CodexAuthSelectionError,
  prepareCodexAuth,
  prepareHostCodexAuth,
} from "./CodexAuth.js";

const cleanupFns: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanupFns.length > 0) {
    await cleanupFns.pop()?.();
  }
});

const makeAuthDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "sandcastle-codex-auth-test-"));
  cleanupFns.push(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
};

const makeIdToken = (payload: Record<string, unknown>): string => {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.`;
};

describe("prepareCodexAuth", () => {
  it("auto-discovers auth snapshots instead of assuming a fixed user list", async () => {
    const dir = await makeAuthDir();
    await writeFile(join(dir, "auth-alex.json"), '{"user":"alex"}');
    await writeFile(join(dir, "auth-zoe.json"), '{"user":"zoe"}');

    const first = await prepareCodexAuth({ dir });
    cleanupFns.push(first.cleanup);
    const second = await prepareCodexAuth({ dir });
    cleanupFns.push(second.cleanup);
    const third = await prepareCodexAuth({ dir });
    cleanupFns.push(third.cleanup);

    expect(first.user).toBe("alex");
    expect(second.user).toBe("zoe");
    expect(third.user).toBe("alex");
  });

  it("ignores auth-rotation-state.json during snapshot discovery", async () => {
    const dir = await makeAuthDir();
    await writeFile(join(dir, "auth-a.json"), '{"user":"a"}');
    await writeFile(
      join(dir, "auth-rotation-state.json"),
      JSON.stringify({ lastAssignedUser: "a" }),
    );

    const prepared = await prepareCodexAuth({ dir });
    cleanupFns.push(prepared.cleanup);

    expect(prepared.user).toBe("a");
    expect(await readFile(prepared.snapshotPath, "utf-8")).toBe('{"user":"a"}');
  });

  it("can include the current host auth in the cycle via an explicit user list", async () => {
    const dir = await makeAuthDir();
    await writeFile(join(dir, "auth.json"), '{"user":"will-active"}');
    await writeFile(join(dir, "auth-darren.json"), '{"user":"darren"}');
    await writeFile(join(dir, "auth-nick.json"), '{"user":"nick"}');
    await writeFile(
      join(dir, "auth-rotation-state.json"),
      JSON.stringify({ lastAssignedUser: "nick" }),
    );

    const prepared = await prepareCodexAuth({
      dir,
      users: ["will", "darren", "nick"],
    });
    cleanupFns.push(prepared.cleanup);

    expect(prepared.user).toBe("will");
    expect(await readFile(prepared.snapshotPath, "utf-8")).toBe(
      '{"user":"will-active"}',
    );
  });

  it("extracts a human-readable auth user for logging", async () => {
    const dir = await makeAuthDir();
    const idToken = makeIdToken({
      name: "Will Tonna",
      email: "will.tonna@cirrusconnects.com",
    });
    await writeFile(
      join(dir, "auth.json"),
      JSON.stringify({ tokens: { id_token: idToken } }),
    );
    await writeFile(join(dir, "auth-darren.json"), '{"user":"darren"}');
    await writeFile(join(dir, "auth-nick.json"), '{"user":"nick"}');
    await writeFile(
      join(dir, "auth-rotation-state.json"),
      JSON.stringify({ lastAssignedUser: "nick" }),
    );

    const prepared = await prepareCodexAuth({
      dir,
      users: ["will", "darren", "nick"],
    });
    cleanupFns.push(prepared.cleanup);

    expect(prepared.user).toBe("will");
    expect(prepared.displayName).toBe("Will Tonna");
    expect(prepared.email).toBe("will.tonna@cirrusconnects.com");
    expect(prepared.logMessages).toEqual([
      "Codex auth selected by round-robin: will",
      "Codex auth user: Will Tonna (will, will.tonna@cirrusconnects.com)",
    ]);
  });

  it("allows a custom selector to override round-robin choice", async () => {
    const dir = await makeAuthDir();
    await writeFile(join(dir, "auth-alex.json"), '{"user":"alex"}');
    await writeFile(join(dir, "auth-zoe.json"), '{"user":"zoe"}');
    await writeFile(
      join(dir, "auth-rotation-state.json"),
      JSON.stringify({ lastAssignedUser: "alex" }),
    );

    const prepared = await prepareCodexAuth({
      dir,
      selectUser: ({ defaultUser, users, lastAssignedUser }) => {
        expect(defaultUser).toBe("zoe");
        expect(users).toEqual(["alex", "zoe"]);
        expect(lastAssignedUser).toBe("alex");
        return "alex";
      },
    });
    cleanupFns.push(prepared.cleanup);

    expect(prepared.user).toBe("alex");
    expect(prepared.logMessages).toEqual([
      "Codex auth selector chose alex",
      "Codex auth user: alex",
    ]);
  });

  it("falls back to round-robin when a custom selector returns undefined", async () => {
    const dir = await makeAuthDir();
    await writeFile(join(dir, "auth-alex.json"), '{"user":"alex"}');
    await writeFile(join(dir, "auth-zoe.json"), '{"user":"zoe"}');
    await writeFile(
      join(dir, "auth-rotation-state.json"),
      JSON.stringify({ lastAssignedUser: "alex" }),
    );

    const prepared = await prepareCodexAuth({
      dir,
      selectUser: () => undefined,
    });
    cleanupFns.push(prepared.cleanup);

    expect(prepared.user).toBe("zoe");
    expect(prepared.logMessages).toEqual([
      "Codex auth selector returned no user; fell back to round-robin: zoe",
      "Codex auth user: zoe",
    ]);
  });

  it("falls back when a custom selector returns a user outside the candidate set", async () => {
    const dir = await makeAuthDir();
    await writeFile(join(dir, "auth-alex.json"), '{"user":"alex"}');
    await writeFile(join(dir, "auth-zoe.json"), '{"user":"zoe"}');
    await writeFile(
      join(dir, "auth-rotation-state.json"),
      JSON.stringify({ lastAssignedUser: "alex" }),
    );

    const prepared = await prepareCodexAuth({
      dir,
      selectUser: () => "mia",
    });
    cleanupFns.push(prepared.cleanup);

    expect(prepared.user).toBe("zoe");
    expect(prepared.logMessages).toEqual([
      'Codex auth selector returned invalid user "mia"; fell back to round-robin: zoe',
      "Codex auth user: zoe",
    ]);
    expect(await readFile(join(dir, "auth-rotation-state.json"), "utf-8")).toBe(
      JSON.stringify({ lastAssignedUser: "zoe" }),
    );
  });

  it("falls back when a custom selector throws", async () => {
    const dir = await makeAuthDir();
    await writeFile(join(dir, "auth-alex.json"), '{"user":"alex"}');
    await writeFile(join(dir, "auth-zoe.json"), '{"user":"zoe"}');
    await writeFile(
      join(dir, "auth-rotation-state.json"),
      JSON.stringify({ lastAssignedUser: "alex" }),
    );

    const prepared = await prepareCodexAuth({
      dir,
      selectUser: () => {
        throw new Error("usage command failed");
      },
    });
    cleanupFns.push(prepared.cleanup);

    expect(prepared.user).toBe("zoe");
    expect(prepared.logMessages).toEqual([
      "Codex auth selector failed (usage command failed); fell back to round-robin: zoe",
      "Codex auth user: zoe",
    ]);
    expect(await readFile(join(dir, "auth-rotation-state.json"), "utf-8")).toBe(
      JSON.stringify({ lastAssignedUser: "zoe" }),
    );
  });

  it("propagates a hard-fail selector error", async () => {
    const dir = await makeAuthDir();
    await writeFile(join(dir, "auth-alex.json"), '{"user":"alex"}');
    await writeFile(join(dir, "auth-zoe.json"), '{"user":"zoe"}');

    await expect(
      prepareCodexAuth({
        dir,
        selectUser: () => {
          throw new CodexAuthSelectionError(
            "No Codex users have usage-limit headroom; refusing to spill into credits.",
            { fallbackToDefaultUser: false },
          );
        },
      }),
    ).rejects.toThrow(
      "No Codex users have usage-limit headroom; refusing to spill into credits.",
    );
  });

  it("snapshots the current host auth.json without rotation", async () => {
    const dir = await makeAuthDir();
    const idToken = makeIdToken({
      name: "Nick Benzie",
      email: "nick.benzie@cirrusconnects.com",
    });
    const authJson = JSON.stringify({ tokens: { id_token: idToken } });
    await writeFile(join(dir, "auth.json"), authJson);

    const prepared = await prepareHostCodexAuth({
      path: join(dir, "auth.json"),
    });
    cleanupFns.push(prepared.cleanup);

    expect(prepared.user).toBe("host");
    expect(prepared.displayName).toBe("Nick Benzie");
    expect(prepared.email).toBe("nick.benzie@cirrusconnects.com");
    expect(prepared.logMessages).toEqual([
      "Codex auth user: Nick Benzie (nick.benzie@cirrusconnects.com)",
    ]);
    expect(await readFile(prepared.snapshotPath, "utf-8")).toBe(authJson);
  });
});
