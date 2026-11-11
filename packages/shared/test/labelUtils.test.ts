import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAgentModelLlmLabel, buildDynamicLlmLabel } from '../src/labelUtils.js';
import { AGENT_DEFAULTS, AGENT_MODELS, MODEL_INFO_MAP } from '../src/modelDefinitions.js';

test('gateway (Enablers) models get a distinct dynamic label per alias', () => {
  const model = MODEL_INFO_MAP['enablers/large'];
  assert.ok(model);
  const enablersAgent = buildAgentModelLlmLabel('claude', 'claude-enablers', model);
  const nativeAgent = buildAgentModelLlmLabel('claude', 'claude', model);
  // Two claude-type agents must never publish the same shared label...
  assert.notEqual(enablersAgent, nativeAgent);
  assert.notEqual(enablersAgent, model.githubLabel);
  assert.notEqual(nativeAgent, model.githubLabel);
  // ...and each label must be the resolvable dynamic alias~model form.
  assert.equal(enablersAgent, buildDynamicLlmLabel('claude-enablers', 'enablers/large'));
  assert.equal(nativeAgent, buildDynamicLlmLabel('claude', 'enablers/large'));
});

test('static catalog labels for typed agents keep the alias rewrite', () => {
  const opus = MODEL_INFO_MAP['claude-opus-5-5'];
  assert.equal(buildAgentModelLlmLabel('claude', 'claude', opus), 'llm-claude-opus55');
  assert.equal(buildAgentModelLlmLabel('claude', 'mybot', opus), 'llm-mybot-opus55');
});

test('Enablers ids belong to the claude agent family but not its injected defaults', () => {
  const claudeModelIds = AGENT_MODELS.claude.map(m => m.id);
  for (const id of ['enablers/xlarge', 'enablers/large', 'd3']) {
    assert.ok(claudeModelIds.includes(id), `${id} should be attributed to the claude family`);
  }
  // Default-model injection must never add ids a native Anthropic endpoint rejects.
  const defaultIds = AGENT_DEFAULTS.claude.defaultModels;
  for (const id of ['enablers/xlarge', 'enablers/large', 'd3']) {
    assert.ok(!defaultIds.includes(id), `${id} must stay out of the claude default model set`);
  }
});
