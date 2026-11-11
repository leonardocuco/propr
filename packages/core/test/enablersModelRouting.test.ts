import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import type { AgentConfig } from '../src/agents/types.js';

// AgentRegistry must be mocked before importing the module under test:
// the real registry's import chain evaluates the GitHub auth configuration,
// which calls process.exit(1) when no auth is configured (the state every
// unit test runs in).
let agents: AgentLike[] = [];
let defaultAgent: AgentLike | undefined;

await mock.module('../src/agents/AgentRegistry.js', {
  namedExports: {
    AgentRegistry: class {
      static getInstance() {
        return {
          ensureInitialized: async () => {},
          getAllAgents: () => agents,
          getDefaultAgent: () => defaultAgent,
        };
      }
    },
  },
});

const { ENABLERS_MODELS, CLAUDE_MODELS } = await import('@propr/shared');
const { resolveLlmLabel } = await import('../src/config/modelLabelResolution.js');

interface AgentLike {
    config: AgentConfig;
}

function claudeConfig(overrides: Partial<AgentConfig> & { alias: string; supportedModels: string[] }): AgentConfig {
    return {
        type: 'claude',
        enabled: true,
        ...overrides,
    } as AgentConfig;
}

function withAgents(nextAgents: AgentLike[], nextDefaultAgent?: AgentLike): void {
    agents = nextAgents;
    defaultAgent = nextDefaultAgent;
}

test('Enablers github labels resolve to the enabled claude-type agent that lists the model', async () => {
    const native = claudeConfig({ alias: 'claude', supportedModels: CLAUDE_MODELS.map(m => m.id) });
    const enablers = claudeConfig({ alias: 'claude-enablers', supportedModels: ENABLERS_MODELS.map(m => m.id) });
    withAgents([{ config: native }, { config: enablers }]);

    for (const model of ENABLERS_MODELS) {
        const label = model.githubLabel.replace(/^llm-/, '');
        assert.deepEqual(await resolveLlmLabel(label), { agentAlias: 'claude-enablers', model: model.id });
    }
});

test('a codex agent listing an Enablers id cannot win its github label', async () => {
    const codex = {
        config: { type: 'codex', enabled: true, alias: 'codex', supportedModels: ['d3'] } as unknown as AgentConfig,
    };
    withAgents([codex]);

    // The label must not route to the codex agent; resolution yields no
    // catalog-backed match (falls through to the default-agent fallback).
    const resolution = await resolveLlmLabel('enablers-d3');
    assert.notEqual(resolution.agentAlias, 'codex');
});

test('a disabled listing agent resolves to no serving agent instead of the native claude default', async () => {
    const native = claudeConfig({ alias: 'claude', supportedModels: CLAUDE_MODELS.map(m => m.id) });
    const disabledEnablers = claudeConfig({
        alias: 'claude-enablers',
        enabled: false,
        supportedModels: ENABLERS_MODELS.map(m => m.id),
    });
    withAgents([{ config: native }, { config: disabledEnablers }], { config: native });

    const resolution = await resolveLlmLabel('enablers-xl');
    // The native claude agent's config cannot serve the id; the resolution must
    // never pair its alias with the catalog model id — downstream validation
    // then reports a clean "no agent" instead of a guaranteed run failure.
    assert.notDeepEqual(resolution, { agentAlias: 'claude', model: 'enablers/xlarge' });
});

test('dynamic per-alias labels for Enablers models resolve through the explicit agent:model path', async () => {
    const enablers = claudeConfig({ alias: 'claude-enablers', supportedModels: ENABLERS_MODELS.map(m => m.id) });
    withAgents([{ config: enablers }]);

    // buildAgentModelLlmLabel('claude', 'claude-enablers', enablers/large)
    // produces this dynamic label form (alias~modelId).
    const resolution = await resolveLlmLabel('claude-enablers~enablers/large');
    assert.deepEqual(resolution, { agentAlias: 'claude-enablers', model: 'enablers/large' });
});
