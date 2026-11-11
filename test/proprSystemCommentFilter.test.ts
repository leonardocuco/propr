import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isProprSystemCommentBody } from '../packages/core/dist/utils/commentFilters.js';

test('flags every ProPR marker family as a system comment', () => {
    assert.equal(isProprSystemCommentBody('<!-- propr-followup-handoff:owner/repo:3:uuid -->\nbody'), true);
    assert.equal(isProprSystemCommentBody('<!-- propr-followup-handoff-delivery:normal-completion -->'), true);
    assert.equal(isProprSystemCommentBody('🔄 **Starting work on follow-up changes**\n<!-- propr:work-evidence phase=started trigger-comment-ids=1 -->'), true);
    assert.equal(isProprSystemCommentBody('<!-- propr:accepted-request comment-id=1 body-sha256=abc -->'), true);
});

test('never flags human comments, including ones mentioning ProPR in prose', () => {
    assert.equal(isProprSystemCommentBody('/review please'), false);
    assert.equal(isProprSystemCommentBody('!propr fix the build'), false);
    assert.equal(isProprSystemCommentBody(' propr is a nice tool'), false);
    assert.equal(isProprSystemCommentBody('<!-- not-propr-marker -->'), false);
    assert.equal(isProprSystemCommentBody(''), false);
    assert.equal(isProprSystemCommentBody(null), false);
    assert.equal(isProprSystemCommentBody(undefined), false);
});
