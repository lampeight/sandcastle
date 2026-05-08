import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareCodexAuth, prepareHostCodexAuth } from "./CodexAuth.js";

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
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
    "base64url",
  );
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.`;
};

describe("prepareCodexAuth", () => {
  it("starts at the next user after the currently active host identity", async () => {
    const dir = await makeAuthDir();
    await writeFile(join(dir, "auth.json"), '{"user":"will-active"}');
    await writeFile(join(dir, "auth-darren.json"), '{"user":"darren"}');
    await writeFile(join(dir, "auth-nick.json"), '{"user":"nick"}');
    await writeFile(join(dir, "auth-ben.json"), '{"user":"ben"}');

    const prepared = await prepareCodexAuth({ dir });
    cleanupFns.push(prepared.cleanup);

    expect(prepared.user).toBe("darren");
    expect(await readFile(prepared.snapshotPath, "utf-8")).toBe(
      '{"user":"darren"}',
    );
  });

  it("persists round-robin state across allocations", async () => {
    const dir = await makeAuthDir();
    await writeFile(join(dir, "auth.json"), '{"user":"will-active"}');
    await writeFile(join(dir, "auth-darren.json"), '{"user":"darren"}');
    await writeFile(join(dir, "auth-nick.json"), '{"user":"nick"}');
    await writeFile(join(dir, "auth-ben.json"), '{"user":"ben"}');

    const first = await prepareCodexAuth({ dir });
    cleanupFns.push(first.cleanup);
    const second = await prepareCodexAuth({ dir });
    cleanupFns.push(second.cleanup);
    const third = await prepareCodexAuth({ dir });
    cleanupFns.push(third.cleanup);

    expect(first.user).toBe("darren");
    expect(second.user).toBe("nick");
    expect(third.user).toBe("ben");
  });

  it("can snapshot the active user when the round robin cycles back to it", async () => {
    const dir = await makeAuthDir();
    await writeFile(join(dir, "auth.json"), '{"user":"will-active"}');
    await writeFile(
      join(dir, "auth-rotation-state.json"),
      JSON.stringify({ lastAssignedUser: "ben" }),
    );
    await writeFile(join(dir, "auth-darren.json"), '{"user":"darren"}');
    await writeFile(join(dir, "auth-nick.json"), '{"user":"nick"}');
    await writeFile(join(dir, "auth-ben.json"), '{"user":"ben"}');

    const prepared = await prepareCodexAuth({ dir });
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
    await writeFile(join(dir, "auth-ben.json"), '{"user":"ben"}');
    await writeFile(
      join(dir, "auth-rotation-state.json"),
      JSON.stringify({ lastAssignedUser: "ben" }),
    );

    const prepared = await prepareCodexAuth({ dir });
    cleanupFns.push(prepared.cleanup);

    expect(prepared.user).toBe("will");
    expect(prepared.displayName).toBe("Will Tonna");
    expect(prepared.email).toBe("will.tonna@cirrusconnects.com");
    expect(prepared.logMessage).toBe(
      "Codex auth user: Will Tonna (will, will.tonna@cirrusconnects.com)",
    );
  });

  it("snapshots the current host auth.json without rotation", async () => {
    const dir = await makeAuthDir();
    const idToken = makeIdToken({
      name: "Nick Benzie",
      email: "nick.benzie@cirrusconnects.com",
    });
    const authJson = JSON.stringify({ tokens: { id_token: idToken } });
    await writeFile(
      join(dir, "auth.json"),
      authJson,
    );

    const prepared = await prepareHostCodexAuth({
      path: join(dir, "auth.json"),
    });
    cleanupFns.push(prepared.cleanup);

    expect(prepared.user).toBe("host");
    expect(prepared.displayName).toBe("Nick Benzie");
    expect(prepared.email).toBe("nick.benzie@cirrusconnects.com");
    expect(prepared.logMessage).toBe(
      "Codex auth user: Nick Benzie (nick.benzie@cirrusconnects.com)",
    );
    expect(await readFile(prepared.snapshotPath, "utf-8")).toBe(authJson);
  });
});
