export const userInfoQuery = `
  query {
    viewer {
      login
      id
    }
  }
`;

export type RepositoryScope = 'repositories' | 'repositoriesContributedTo';

export const createRepositoryQuery = (username: string, scope: RepositoryScope, after: string | null) => `
  query {
    user(login: ${JSON.stringify(username)}) {
      ${scope}(first: 100, after: ${JSON.stringify(after)}, ${
        scope === 'repositories' ? 'ownerAffiliations: [OWNER]' : 'includeUserRepositories: true'
      }) {
        nodes {
          name
          owner { login }
          defaultBranchRef { target { oid } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

// Pin the branch head observed during enumeration, so a push between pages
// cannot change which history the remaining cursors describe.
export const createCommittedDateQuery = (
  id: string,
  name: string,
  owner: string,
  head: string,
  after: string | null,
) => `
  query {
    repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
      object(oid: ${JSON.stringify(head)}) {
        ... on Commit {
          history(first: 100, after: ${JSON.stringify(after)}, author: { id: ${JSON.stringify(id)} }) {
            nodes { oid committedDate }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    }
  }
`;
