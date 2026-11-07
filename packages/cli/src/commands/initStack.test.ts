import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  materializePackagedRuntimeMode,
  materializeSystemTaskSecret,
  pinCredentialEncryptionKey,
  scaffoldStack,
} from "./initStack.js";

function mode(targetPath: string): number {
  return lstatSync(targetPath).mode & 0o777;
}

test("stack scaffolding tightens existing secrets and local state directories", async () => {
  if (process.platform === "win32") return;
  const root = mkdtempSync(join(tmpdir(), "propr-private-stack-"));
  try {
    writeFileSync(join(root, ".env"), "SESSION_SECRET=secret\n", { mode: 0o644 });
    for (const subdir of ["data", "logs", "repos"]) {
      mkdirSync(join(root, subdir), { mode: 0o755 });
    }
    let persistedRoot: string | undefined;
    const result = await scaffoldStack(
      { root },
      { persistStackRoot: async value => { persistedRoot = value; } },
    );

    // The .env has no SYSTEM_TASK_SECRET line, so it is seeded in place
    // (with a .bak backup) while staying otherwise user-managed.
    assert.equal(result.systemTaskSecretGenerated, true);
    assert.equal(result.envCreated, false);
    assert.equal(result.envBackedUp, true);
    assert.equal(existsSync(join(root, ".env.bak")), true);
    assert.match(readFileSync(join(root, ".env"), "utf-8"), /^SESSION_SECRET=secret$/m);
    assert.match(readFileSync(join(root, ".env"), "utf-8"), /^SYSTEM_TASK_SECRET=[0-9a-f]{64}$/m);
    assert.equal(persistedRoot, root);
    assert.equal(mode(root), 0o700);
    assert.equal(mode(join(root, ".env")), 0o600);
    for (const subdir of ["data", "logs", "repos"]) {
      assert.equal(mode(join(root, subdir)), 0o700);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stack scaffolding does not change the chosen project root mode", async () => {
  if (process.platform === "win32") return;
  const root = mkdtempSync(join(tmpdir(), "propr-private-stack-"));
  try {
    chmodSync(root, 0o755);
    writeFileSync(join(root, ".env"), "SESSION_SECRET=secret\n", { mode: 0o600 });
    await scaffoldStack({ root }, { persistStackRoot: async () => undefined });

    assert.equal(mode(root), 0o755);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stack generation remains operational and publishes its environment and identity", async () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "propr-private-stack-")));
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), "propr-private-home-")));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  try {
    mkdirSync(join(home, ".claude"));
    process.env.HOME = home;
    process.env.USERPROFILE = home;

    const result = await scaffoldStack(
      { root },
      { persistStackRoot: async () => undefined },
    );

    assert.equal(result.envCreated, true);
    assert.equal(result.credentialsAppended, true);
    const envLines = readFileSync(join(root, ".env"), "utf-8").split(/\r?\n/);
    assert.ok(envLines.includes("NODE_ENV=production"));
    assert.ok(!envLines.includes("NODE_ENV=development"));
    assert.ok(envLines.includes(`HOST_CLAUDE_DIR=${join(home, ".claude")}`));
    assert.match(
      readFileSync(join(root, "data", "public-instance-identity.json"), "utf-8"),
      /"publicInstanceIdentity"/,
    );
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("Windows stack scaffolding does not require discovery authority", async () => {
  if (process.platform !== "win32") return;
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "propr-windows-stack-")));
  try {
    writeFileSync(join(root, ".env"), "SESSION_SECRET=existing\nNODE_ENV=production\n");
    const result = await scaffoldStack(
      { root },
      { persistStackRoot: async () => undefined },
    );

    assert.equal(result.envSkipped, true);
    assert.deepEqual(result.dirsCreated.filter((name) => ["data", "logs", "repos"].includes(name)), [
      "data", "logs", "repos",
    ]);
    assert.match(
      readFileSync(join(root, "data", "public-instance-identity.json"), "utf-8"),
      /"publicInstanceIdentity"/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("packaged runtime materialization leaves the source template reusable", () => {
  const sourceTemplate = "LOG_LEVEL=debug\nNODE_ENV=development\n";

  assert.equal(
    materializePackagedRuntimeMode(sourceTemplate),
    "LOG_LEVEL=debug\nNODE_ENV=production\n",
  );
  assert.equal(sourceTemplate, "LOG_LEVEL=debug\nNODE_ENV=development\n");
  assert.throws(
    () => materializePackagedRuntimeMode("LOG_LEVEL=debug\n"),
    /does not define NODE_ENV/,
  );
});

test("stack scaffolding preserves an existing runtime mode and surfaces upgrade guidance", async () => {
  const root = mkdtempSync(join(tmpdir(), "propr-private-stack-"));
  try {
    const existing = "SESSION_SECRET=user-managed\nNODE_ENV=development\n";
    writeFileSync(join(root, ".env"), existing);

    const result = await scaffoldStack(
      { root },
      { persistStackRoot: async () => undefined },
    );

    // A preserved .env without a SYSTEM_TASK_SECRET line gets the secret
    // seeded (appended); every other line and the runtime-mode guidance stay.
    assert.equal(result.systemTaskSecretGenerated, true);
    assert.equal(result.envCreated, false);
    assert.equal(result.envBackedUp, true);
    const updated = readFileSync(join(root, ".env"), "utf-8");
    assert.match(updated, /^SESSION_SECRET=user-managed$/m);
    assert.match(updated, /^NODE_ENV=development$/m);
    assert.match(updated, /^SYSTEM_TASK_SECRET=[0-9a-f]{64}$/m);
    assert.equal(readFileSync(join(root, ".env.bak"), "utf-8"), existing);
    assert.match(result.runtimeModeWarning ?? "", /change it manually before starting/);
    assert.match(result.runtimeModeWarning ?? "", /NODE_ENV=development/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stack scaffolding pins the credential-encryption key when seeding a preserved .env", async () => {
  const root = mkdtempSync(join(tmpdir(), "propr-private-stack-"));
  try {
    // No SYSTEM_TASK_SECRET line and no explicit encryption key: the effective
    // key was SESSION_SECRET, so seeding SYSTEM_TASK_SECRET must pin it.
    const existing = "SESSION_SECRET=keep-me-decryptable\nNODE_ENV=production\n";
    writeFileSync(join(root, ".env"), existing);

    const result = await scaffoldStack(
      { root },
      { persistStackRoot: async () => undefined },
    );

    assert.equal(result.systemTaskSecretGenerated, true);
    const updated = readFileSync(join(root, ".env"), "utf-8");
    assert.match(updated, /^PROPR_CREDENTIAL_ENCRYPTION_KEY=keep-me-decryptable$/m);
    assert.match(updated, /^SYSTEM_TASK_SECRET=[0-9a-f]{64}$/m);
    assert.doesNotMatch(updated, /HOST_CLAUDE_DIR=/);
    assert.equal(result.credentialsAppended, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stack scaffolding does not pin the encryption key when one is already explicit", async () => {
  const root = mkdtempSync(join(tmpdir(), "propr-private-stack-"));
  try {
    const existing = "PROPR_CREDENTIAL_ENCRYPTION_KEY=explicit-key\nSESSION_SECRET=session\nSYSTEM_TASK_SECRET=\n";
    writeFileSync(join(root, ".env"), existing);

    const result = await scaffoldStack(
      { root },
      { persistStackRoot: async () => undefined },
    );

    assert.equal(result.systemTaskSecretGenerated, true);
    const updated = readFileSync(join(root, ".env"), "utf-8");
    assert.match(updated, /^PROPR_CREDENTIAL_ENCRYPTION_KEY=explicit-key$/m);
    assert.match(updated, /^SYSTEM_TASK_SECRET=[0-9a-f]{64}$/m);
    assert.equal(updated.match(/^PROPR_CREDENTIAL_ENCRYPTION_KEY=/gm)?.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stack scaffolding keeps a preserved .env fully untouched when nothing needs seeding", async () => {
  const root = mkdtempSync(join(tmpdir(), "propr-private-stack-"));
  try {
    const existing = "SESSION_SECRET=user-managed\nSYSTEM_TASK_SECRET=already-set\nNODE_ENV=production\n";
    writeFileSync(join(root, ".env"), existing);

    const result = await scaffoldStack(
      { root },
      { persistStackRoot: async () => undefined },
    );

    assert.equal(result.envSkipped, true);
    assert.equal(result.systemTaskSecretGenerated, undefined);
    assert.equal(result.envBackedUp, false);
    assert.equal(existsSync(join(root, ".env.bak")), false);
    assert.equal(readFileSync(join(root, ".env"), "utf-8"), existing);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stack scaffolding rejects symlinked secrets and state directories", async () => {
  if (process.platform === "win32") return;
  const root = mkdtempSync(join(tmpdir(), "propr-private-stack-"));
  const external = mkdtempSync(join(tmpdir(), "propr-private-stack-external-"));
  try {
    writeFileSync(join(external, "env"), "SESSION_SECRET=secret\n");
    symlinkSync(join(external, "env"), join(root, ".env"));
    await assert.rejects(
      scaffoldStack({ root }, { persistStackRoot: async () => undefined }),
      /symbolic-link file/,
    );

    rmSync(join(root, ".env"));
    rmSync(join(root, "data"), { recursive: true });
    symlinkSync(external, join(root, "data"));
    await assert.rejects(
      scaffoldStack({ root }, { persistStackRoot: async () => undefined }),
      /symbolic-link directory/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});

test("materializeSystemTaskSecret fills every empty shape and appends a missing line", () => {
  const secret = materializeSystemTaskSecret("SYSTEM_TASK_SECRET=", "s3cret");
  assert.equal(secret, "SYSTEM_TASK_SECRET=s3cret");
  assert.equal(materializeSystemTaskSecret('SYSTEM_TASK_SECRET=""', "s3cret"), "SYSTEM_TASK_SECRET=s3cret");
  assert.equal(materializeSystemTaskSecret("SYSTEM_TASK_SECRET=\r\nOTHER=1", "s3cret"), "SYSTEM_TASK_SECRET=s3cret\nOTHER=1");
  assert.equal(
    materializeSystemTaskSecret("SESSION_SECRET=x\nOTHER=1", "s3cret"),
    "SESSION_SECRET=x\nOTHER=1\nSYSTEM_TASK_SECRET=s3cret\n",
  );
  // A configured value is never overwritten.
  assert.equal(materializeSystemTaskSecret("SYSTEM_TASK_SECRET=configured", "s3cret"), "SYSTEM_TASK_SECRET=configured");
  assert.equal(materializeSystemTaskSecret('SYSTEM_TASK_SECRET="configured"', "s3cret"), 'SYSTEM_TASK_SECRET="configured"');
});

test("pinCredentialEncryptionKey only pins when the effective key would rotate", () => {
  // No explicit key: SESSION_SECRET was the effective key and must be pinned.
  assert.equal(
    pinCredentialEncryptionKey("SESSION_SECRET=old\nSYSTEM_TASK_SECRET=new\n"),
    "SESSION_SECRET=old\nSYSTEM_TASK_SECRET=new\nPROPR_CREDENTIAL_ENCRYPTION_KEY=old\n",
  );
  // An empty explicit-key line is filled instead of appended.
  assert.equal(
    pinCredentialEncryptionKey("SESSION_SECRET=old\nPROPR_CREDENTIAL_ENCRYPTION_KEY=\n"),
    "SESSION_SECRET=old\nPROPR_CREDENTIAL_ENCRYPTION_KEY=old\n",
  );
  // Explicit key set: nothing to do.
  assert.equal(
    pinCredentialEncryptionKey("PROPR_CREDENTIAL_ENCRYPTION_KEY=explicit\nSESSION_SECRET=old\n"),
    "PROPR_CREDENTIAL_ENCRYPTION_KEY=explicit\nSESSION_SECRET=old\n",
  );
  // No SESSION_SECRET: the chain could never encrypt anything, so no pin.
  assert.equal(pinCredentialEncryptionKey("SYSTEM_TASK_SECRET=new\n"), "SYSTEM_TASK_SECRET=new\n");
});
