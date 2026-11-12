import { createCommittedDateQuery, createRepositoryQuery } from './queries.js';

interface Page<T> {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

interface Repository {
  name: string;
  owner: { login: string };
  defaultBranchRef: { target: { oid: string } } | null;
}

export interface Commit {
  oid: string;
  committedDate: string;
}

interface Response {
  data: {
    user?: {
      repositories?: Page<Repository>;
      repositoriesContributedTo?: Page<Repository>;
    };
    repository?: { object: { history: Page<Commit> } | null };
  };
}

export type Query = (document: string) => Promise<Response>;

async function readPages<T>(read: (after: string | null) => Promise<Page<T> | undefined>): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let after: string | null = null;
  while (true) {
    const page = await read(after);
    if (!page || !Array.isArray(page.nodes) || !page.pageInfo || typeof page.pageInfo.hasNextPage !== 'boolean') {
      throw new Error('GitHub returned an incomplete page; statistics were not updated.');
    }
    items.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) return items;
    const next = page.pageInfo.endCursor;
    if (!next || seen.has(next)) throw new Error('GitHub pagination did not advance; statistics were not updated.');
    seen.add(next);
    after = next;
  }
}

export async function collectCommits(username: string, id: string, query: Query) {
  const repositories = new Map<string, Repository>();
  // Include owned repositories even if they have no recent contribution activity.
  for (const scope of ['repositories', 'repositoriesContributedTo'] as const) {
    const repos = await readPages<Repository>(async (after) => {
      const response = await query(createRepositoryQuery(username, scope, after));
      return response.data?.user?.[scope];
    });
    for (const repo of repos) {
      const key = `${repo.owner.login}/${repo.name}`;
      if (!repositories.has(key)) repositories.set(key, repo);
    }
  }

  const commits = new Map<string, Commit>();
  for (const repo of repositories.values()) {
    const head = repo.defaultBranchRef?.target.oid;
    if (!head) continue; // An empty repository has no default-branch history.
    const history = await readPages<Commit>(async (after) => {
      const response = await query(createCommittedDateQuery(id, repo.name, repo.owner.login, head, after));
      return response.data?.repository?.object?.history;
    });
    for (const commit of history) {
      if (!commit.oid || !Number.isFinite(Date.parse(commit.committedDate))) {
        throw new Error('GitHub returned an invalid commit; statistics were not updated.');
      }
      // The same authored commit may appear in an owned fork and its upstream.
      commits.set(commit.oid, commit);
    }
  }
  return { commits: [...commits.values()], repositoryCount: repositories.size };
}

export function summarizeCommits(commits: Commit[], timeZone: string | undefined): number[] {
  const counts = [0, 0, 0, 0]; // Morning, Daytime, Evening, Night.
  const hours = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' });
  for (const commit of commits) {
    const hour = Number(hours.format(new Date(commit.committedDate)));
    const bucket = hour < 6 ? 3 : hour < 12 ? 0 : hour < 18 ? 1 : 2;
    counts[bucket]++;
  }
  return counts;
}
