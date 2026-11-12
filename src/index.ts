import { Octokit } from '@octokit/rest';
import { config } from 'dotenv';

import { collectCommits, summarizeCommits } from './collectCommits.js';
import generateBarChart from './generateBarChart.js';
import githubQuery from './githubQuery.js';
import { userInfoQuery } from './queries.js';
/**
 * get environment variable
 */
config({ path: ['.env'] });

(async () => {
  const userResponse = await githubQuery(userInfoQuery);
  const { login: username, id } = userResponse?.data?.viewer ?? {};
  if (!username || !id) throw new Error('GitHub did not return the authenticated user.');

  const { commits, repositoryCount } = await collectCommits(username, id, githubQuery);
  const [morning, daytime, evening, night] = summarizeCommits(commits, process.env.TIMEZONE);
  console.log(`Collected ${commits.length} unique authored commits from ${repositoryCount} repositories.`);

  /**
   * Next, generate diagram
   */
  const sum = morning + daytime + evening + night;
  if (!sum) return;

  const oneDay = [
    { label: '🌞 Morning', commits: morning },
    { label: '🌆 Daytime', commits: daytime },
    { label: '🌃 Evening', commits: evening },
    { label: '🌙 Night', commits: night },
  ];

  const lines = oneDay.reduce((prev, cur) => {
    const percent = (cur.commits / sum) * 100;
    const line = [
      `${cur.label}`.padEnd(10),
      `${cur.commits.toString().padStart(5)} commits`.padEnd(14),
      generateBarChart(percent, 21),
      String(percent.toFixed(1)).padStart(5) + '%',
    ];

    return [...prev, line.join(' ')];
  }, [] as string[]);

  /**
   * Finally, write into gist
   */
  const octokit = new Octokit({ auth: `token ${process.env.GH_TOKEN}` });
  const gist = await octokit.gists
    .get({
      gist_id: `${process.env.GIST_ID}`,
    })
    .catch((error) => console.error(`Unable to update gist\n${error}`));
  if (!gist) return;

  if (!gist.data.files) {
    console.error('No file found in the gist');
    return;
  }

  const filename = Object.keys(gist.data.files)[0];
  await octokit.gists.update({
    gist_id: `${process.env.GIST_ID}`,
    files: {
      [filename]: {
        filename: morning + daytime > evening + night ? "I'm an early 🐤" : "I'm a night 🦉",
        content: lines.join('\n'),
      },
    },
  });

  console.log('Success to update the gist 🎉');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
