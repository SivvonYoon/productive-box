export default async function (query: string): Promise<any> {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${process.env.GH_TOKEN}`,
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`GitHub API returned HTTP ${res.status}`);
  const result = (await res.json()) as { errors?: { message: string }[] };
  if (result.errors?.length) {
    throw new Error(result.errors.map((error: { message: string }) => error.message).join('; '));
  }
  return result;
}
