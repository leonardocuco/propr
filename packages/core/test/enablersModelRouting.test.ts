import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ENABLERS_MODELS, CLAUDE_MODELS } from '@propr/shared';
import { resolveLlmLabel } from '../src/config/modelLabelResolution.js';
import { AgentRegistry } from '../src/agents/AgentRegistry.js';
import type { AgentConfig } from '../src/agents/types.js';

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

function withAgents(agents: AgentLike[], defaultAgent?: AgentLike): void {
    const registry = AgentRegistry.getInstance() as unknown as {
        initialized: boolean;
        ensureInitialized(): Promise<void>;
        getAllAgents(): AgentLike[];
        getDefaultAgent(): AgentLike | undefined;
    };
    registry.initialized = true;
    registry.ensureInitialized = async () => undefined;
    registry.getAllAgents = () => agents;
    registry.getDefaultAgent = () => defaultAgent;
}

test('Enablers github labels resolve to the enabled claude-type agent that lists the model', async () => {
    const native = claudeConfig({ alias: 'claude', supportedModels: CLAUDE_MODELS.map(m => m.id) });
    const enablers = claudeConfig({ alias: 'claude-enablers', supportedModels: ENABLERS_MODELS.map(m => m.id) });
    withAgents([native, enablers]);

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
    withAgents([native, disabledEnablers], native);

    const resolution = await resolveLlmLabel('enablers-xl');
    // The native claude agent's config cannot serve the id; the resolution must
    // never pair its alias with the catalog model id — downstream validation
    // then reports a clean "no agent" instead of a guaranteed run failure.
    assert.notDeepEqual(resolution, { agentAlias: 'claude', model: 'enablers/xlarge' });
});

test('dynamic per-alias labels for Enablers models resolve through the explicit agent:model path', async () => {
    const enablers = claudeConfig({ alias: 'claude-enablers', supportedModels: ENABLERS_MODELS.map(m => m.id) });
    withAgents([enablers]);

    // buildAgentModelLlmLabel('claude', 'claude-enablers', enablers/large)
    // produces this dynamic label form (alias~modelId).
    const resolution = await resolveLlmLabel('claude-enablers~enablers/large');
    assert.deepEqual(resolution, { agentAlias: 'claude-enablers', model: 'enablers/large' });
});
