import assert from 'node:assert/strict';
import { test } from 'node:test';
import { manifestPlatforms, selectSetupImagePlatform, inspectSetupImagePlatform } from './imagePlatform.js';
import type { OrchestratorModule } from '../../orchestrator/index.js';

test('selects actual manifest platforms and keeps the agent explicitly AMD64', () => {
  const platforms = manifestPlatforms([
    { Descriptor: { platform: { os: 'linux', architecture: 'arm64' } } },
    { Descriptor: { platform: { os: 'linux', architecture: 'amd64' } } },
    { Descriptor: { platform: { os: 'unknown', architecture: 'unknown' } } },
  ]);
  assert.equal(selectSetupImagePlatform(platforms, 'aarch64', false), 'linux/arm64');
  assert.equal(selectSetupImagePlatform(platforms, 'aarch64', true), 'linux/amd64');
  assert.equal(selectSetupImagePlatform(platforms, 'x86_64', false), 'linux/amd64');
  // Fork policy: an ARM64 engine falls back to the published AMD64 core image
  // under emulation instead of failing setup (upstream hard-fails here).
  assert.equal(selectSetupImagePlatform(['linux/amd64'], 'arm64', false), 'linux/amd64');
  assert.throws(() => selectSetupImagePlatform(['linux/arm64'], 'arm64', true), /required linux\/amd64/);
  assert.throws(() => selectSetupImagePlatform(platforms, 's390x', false), /Unsupported/);
});

test('source-built images are inspected locally and cancellation reaches both probes', async () => {
  const signal = new AbortController().signal;
  const calls: string[][] = [];
  const orch = { dockerAsync: async (args: string[], options: { signal?: AbortSignal }) => {
    calls.push(args);
    assert.equal(options.signal, signal);
    return { status: 0, stdout: args[0] === 'info' ? 'aarch64\n' : JSON.stringify({ Os: 'linux', Architecture: 'arm64' }) };
  } } as unknown as OrchestratorModule;
  assert.equal(await inspectSetupImagePlatform(orch, 'local/app:source', false, true, signal), 'linux/arm64');
  assert.equal(calls[1][0], 'image');
  assert.equal(calls[1].includes('manifest'), false);
});


test('platform inspection stops at awaited cancellation boundaries', async () => {
  for (const abortOn of ['info', 'image']) {
    const controller = new AbortController();
    const calls: string[] = [];
    const orch = { dockerAsync: async (args: string[]) => {
      calls.push(args[0]);
      if (args[0] === abortOn) controller.abort();
      return { status: 0, stdout: args[0] === 'info' ? 'arm64' : '{"Os":"linux","Architecture":"arm64"}' };
    } } as unknown as OrchestratorModule;
    await assert.rejects(inspectSetupImagePlatform(orch, 'local/app', false, true, controller.signal), { name: 'AbortError' });
    assert.deepEqual(calls, abortOn === 'info' ? ['info'] : ['info', 'image']);
  }
});

test('arm64 engine falls back to the published amd64 core image when no arm64 variant exists', () => {
    assert.equal(selectSetupImagePlatform(['linux/amd64'], 'aarch64', false), 'linux/amd64');
});

test('arm64 engine still prefers a native arm64 core image when declared', () => {
    assert.equal(selectSetupImagePlatform(['linux/amd64', 'linux/arm64'], 'aarch64', false), 'linux/arm64');
});

test('agent images keep the strict amd64 requirement on arm64 engines', () => {
    assert.throws(() => selectSetupImagePlatform(['linux/arm64'], 'aarch64', true));
    assert.equal(selectSetupImagePlatform(['linux/amd64'], 'aarch64', true), 'linux/amd64');
});

test('amd64 engine is unaffected by the fallback', () => {
    assert.equal(selectSetupImagePlatform(['linux/amd64'], 'x86_64', false), 'linux/amd64');
    assert.throws(() => selectSetupImagePlatform(['linux/arm64'], 'x86_64', false));
});
