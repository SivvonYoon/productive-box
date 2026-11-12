import assert from 'node:assert/strict';
import { test } from 'node:test';

import { collectCommits, summarizeCommits } from '../dist/collectCommits.js';
import githubQuery from '../dist/githubQuery.js';

const page = (nodes, next = null) => ({ nodes, pageInfo: { hasNextPage: next !== null, endCursor: next } });
const repo = (name, head = 'fixed-head') => ({ name, owner: { login: 'test' }, defaultBranchRef: head ? { target: { oid: head } } : null });
const commit = (oid, committedDate = '2026-11-11T00:00:00Z') => ({ oid, committedDate });
const response = (scope, value) => ({ data: { user: { [scope]: value } } });
const history = (value) => ({ data: { repository: { object: { history: value } } } });

function queryFor(repositories, contributed, readHistory) {
  return async (document) => {
    if (document.includes('repositoriesContributedTo(')) return response('repositoriesContributedTo', contributed(document));
    if (document.includes('repositories(')) return response('repositories', repositories(document));
    return history(await readHistory(document));
  };
}

test('reads beyond 300 commits, using a fixed head and all cursor pages', async () => {
  let calls = 0;
  const query = queryFor(() => page([repo('private-repository')]), () => page([]), (document) => {
    assert.ok(document.includes('object(oid: "fixed-head")'));
    assert.ok(document.includes('author: { id: "user-id" }'));
    const index = calls++;
    assert.ok(document.includes(`after: ${index ? `"cursor-${index}"` : 'null'}`));
    const nodes = Array.from({ length: index < 3 ? 100 : 51 }, (_, i) => commit(`oid-${index * 100 + i}`));
    return page(nodes, index < 3 ? `cursor-${index + 1}` : null);
  });
  const result = await collectCommits('test', 'user-id', query);
  assert.equal(result.commits.length, 351);
  assert.equal(calls, 4);
});

test('pages both repository lists, includes old owned repositories and skips empty ones', async () => {
  let owned = 0;
  let contributed = 0;
  const read = (counter) => (document) => {
    const first = counter() === 0;
    assert.ok(document.includes(`after: ${first ? 'null' : '"next"'}`));
    return page([repo(first ? 'old-owned' : 'second', first ? null : 'head')], first ? 'next' : null);
  };
  const query = queryFor(read(() => owned++), read(() => contributed++), () => page([commit('one')]));
  const result = await collectCommits('test', 'user-id', query);
  assert.equal(owned, 2);
  assert.equal(contributed, 2);
  assert.equal(result.repositoryCount, 2);
  assert.equal(result.commits.length, 1);
});

test('deduplicates repositories and commit hashes shared by forks', async () => {
  let calls = 0;
  const query = queryFor(() => page([repo('upstream'), repo('fork')]), () => page([repo('upstream')]), () => {
    calls++;
    return page([commit('shared'), commit('shared')]);
  });
  const result = await collectCommits('test', 'user-id', query);
  assert.equal(result.repositoryCount, 2);
  assert.equal(calls, 2);
  assert.deepEqual(result.commits, [commit('shared')]);
});

test('does not return partial counts when a later commit page fails', async () => {
  let calls = 0;
  const query = queryFor(() => page([repo('a')]), () => page([]), () => {
    if (calls++ === 0) return page([commit('first')], 'next');
    throw new Error('page failed');
  });
  await assert.rejects(collectCommits('test', 'id', query), /page failed/);
});

test('rejects repeated cursors rather than looping indefinitely', async () => {
  const query = queryFor(() => page([repo('a')]), () => page([]), () => page([commit('one')], 'stuck'));
  await assert.rejects(collectCommits('test', 'id', query), /pagination did not advance/);
});

test('rejects a missing next cursor and malformed pages', async () => {
  for (const invalid of [undefined, {}, { nodes: [], pageInfo: { hasNextPage: true, endCursor: null } }]) {
    const query = queryFor(() => page([repo('a')]), () => page([]), () => invalid);
    await assert.rejects(collectCommits('test', 'id', query));
  }
});

test('rejects invalid commit dates', async () => {
  const query = queryFor(() => page([repo('a')]), () => page([]), () => page([commit('one', 'invalid')]));
  await assert.rejects(collectCommits('test', 'id', query), /invalid commit/);
});

test('empty account yields no fabricated commits', async () => {
  const query = queryFor(() => page([]), () => page([]), () => { throw new Error('unexpected history request'); });
  assert.deepEqual(await collectCommits('test', 'id', query), { commits: [], repositoryCount: 0 });
});

test('Korean midnight and each bucket boundary are counted exactly once', () => {
  const instants = ['2026-11-10T15:00:00Z', '2026-11-10T20:59:59Z', '2026-11-10T21:00:00Z',
    '2026-11-11T02:59:59Z', '2026-11-11T03:00:00Z', '2026-11-11T08:59:59Z',
    '2026-11-11T09:00:00Z', '2026-11-11T14:59:59Z'];
  assert.deepEqual(summarizeCommits(instants.map((d, i) => commit(String(i), d)), 'Asia/Seoul'), [2, 2, 2, 2]);
});

test('HTTP and GraphQL failures are surfaced before any Gist update', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: false, status: 403 });
    await assert.rejects(githubQuery('query {}'), /HTTP 403/);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: {}, errors: [{ message: 'permission denied' }] }) });
    await assert.rejects(githubQuery('query {}'), /permission denied/);
  } finally {
    globalThis.fetch = original;
  }
});
