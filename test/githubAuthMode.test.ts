import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveGithubAuthMode } from '../packages/shared/src/githubAuthMode.js';

test('demo mode wins over everything else', () => {
    const { mode } = resolveGithubAuthMode({
        demoMode: true,
        ghAuthMode: 'app',
        relayUrl: 'https://relay.example.test/v1',
        relayToken: 'rly_x',
    });
    assert.equal(mode, 'demo');
});

test('explicit GH_AUTH_MODE overrides inference', () => {
    assert.equal(resolveGithubAuthMode({ ghAuthMode: 'relay' }).mode, 'relay');
    assert.equal(
        resolveGithubAuthMode({
            ghAuthMode: 'app',
            relayUrl: 'https://relay.example.test/v1',
            relayToken: 'rly_x',
        }).mode,
        'app',
    );
});

test('GH_AUTH_MODE=demo maps to demo with a warning', () => {
    const result = resolveGithubAuthMode({ ghAuthMode: 'demo' });
    assert.equal(result.mode, 'demo');
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /PROPR_DEMO_MODE/);
});

test('unrecognized GH_AUTH_MODE warns and falls back to auto-detection', () => {
    const result = resolveGithubAuthMode({
        ghAuthMode: 'bogus',
        appId: '123',
        privateKeyPath: '/key.pem',
        installationId: '456',
    });
    assert.equal(result.mode, 'app');
    assert.match(result.warnings[0], /not a recognized value/);
});

test('relay is inferred only when both URL and token are present', () => {
    assert.equal(
        resolveGithubAuthMode({ relayUrl: 'https://relay.example.test/v1', relayToken: 'rly_x' }).mode,
        'relay',
    );
    // A stray relay URL must not shadow a fully valid GitHub App configuration.
    assert.equal(
        resolveGithubAuthMode({
            relayUrl: 'https://relay.example.test/v1',
            appId: '123',
            privateKeyPath: '/key.pem',
            installationId: '456',
        }).mode,
        'app',
    );
});

test('returns none when nothing is configured', () => {
    assert.equal(resolveGithubAuthMode({}).mode, 'none');
});

test('explicit GH_AUTH_MODE=pat with both tokens resolves pat', () => {
    const result = resolveGithubAuthMode({ ghAuthMode: 'pat', patToken: 'ghp_w', patReadToken: 'ghp_r' });
    assert.equal(result.mode, 'pat');
});

test('explicit GH_AUTH_MODE=pat without GH_PAT_TOKEN warns and falls back', () => {
    const result = resolveGithubAuthMode({ ghAuthMode: 'pat' });
    assert.equal(result.mode, 'none');
    assert.ok(result.warnings.some((w) => /GH_PAT_TOKEN/.test(w)));
});

test('explicit GH_AUTH_MODE=pat without read token still resolves pat with a warning', () => {
    const result = resolveGithubAuthMode({ ghAuthMode: 'pat', patToken: 'ghp_w' });
    assert.equal(result.mode, 'pat');
    assert.ok(result.warnings.some((w) => /GH_PAT_READ_TOKEN/.test(w)));
});

test('both PATs infer pat mode without explicit GH_AUTH_MODE', () => {
    const { mode } = resolveGithubAuthMode({ patToken: 'ghp_w', patReadToken: 'ghp_r' });
    assert.equal(mode, 'pat');
});

test('write PAT alone does not infer pat mode', () => {
    const result = resolveGithubAuthMode({ patToken: 'ghp_w' });
    assert.equal(result.mode, 'none');
    assert.ok(result.warnings.some((w) => /GH_AUTH_MODE=pat/.test(w)));
});
