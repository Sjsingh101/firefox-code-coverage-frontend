import settings from '../settings';
import { jsonFetch, plainFetch } from './fetch';
import { queryCacheWithFallback } from './localCache';

const { REPO_NAME, HG_HOST } = settings;

const authorInfo = (author) => {
  const nameRegex = /([^<]*)/i;
  const nameMatch = nameRegex.exec(author);
  const authorName = nameMatch ? nameMatch[1] : null;

  const emailRegex = /[<]([^>]*@[^>]*)[>]/i;
  const emailMatch = emailRegex.exec(author);
  const authorEmail = emailMatch ? emailMatch[1] : null;

  return { authorName, authorEmail };
};

// Depending if information about a changeset is obtained via `json-pushes`
// versus `json-rev` we will have `pushId` and `date` properties OR
// have to set the `pushId` and `changesetIndex` (position within a push)
// in order to facilitate sorting of changesets
const initializedChangeset = (cset, author, pushId, changesetIndex) => ({
  pushId,
  changesetIndex,
  ...authorInfo(author),
  ...cset,
});

export const getDiff = async (node, repoName = REPO_NAME) => {
  const text = await plainFetch(`${HG_HOST}/${repoName}/raw-rev/${node}`);
  return text.text();
};

export const getRawFile = (node, filePath, repoName = REPO_NAME) =>
  plainFetch(`${HG_HOST}/${repoName}/raw-file/${node}/${filePath}`);

export const getChangesetMeta = async (node, repoPath = REPO_NAME) => {
  const meta = await jsonFetch(`${HG_HOST}/${repoPath}/json-rev/${node}`);
  return initializedChangeset(meta, meta.user);
};

export const getJsonPushes = (repoName = REPO_NAME, date = settings.HG_DAYS_AGO) =>
  jsonFetch(`${HG_HOST}/${repoName}/json-pushes?version=2&full=1&startdate=${date}`);

export const hgDiffUrl = (node, repoName = REPO_NAME) =>
  `${HG_HOST}/${repoName}/rev/${node}`;

export const pushlogUrl = (node, repoName = REPO_NAME) =>
  `${HG_HOST}/${repoName}/pushloghtml?changeset=${node}`;

export const rawFile = async (node, filePath, repoName = REPO_NAME) => {
  try {
    const res = await getRawFile(node, filePath, repoName);
    if (res.status !== 200) {
      throw new Error(`HTTP response ${res.status}`);
    }
    return (await res.text()).split('\n');
  } catch (e) {
    throw new Error(`Failed to fetch source for revision: ${node}, filePath: ${filePath}\n${e}`);
  }
};

const ignoreChangeset = ({ desc, author }) => {
  if (
    (author.includes('ffxbld')) ||
    (desc.includes('a=merge') && desc.includes('r=merge')) ||
    (desc.includes('erge') && (desc.includes('to'))) ||
    (desc.includes('ack out')) ||
    (desc.includes('acked out'))) {
    return true;
  }
  return false;
};

export const bzUrl = (description) => {
  const bzUrlRegex = /^bug\s*(\d*)/i;
  const bzUrlMatch = bzUrlRegex.exec(description);
  return bzUrlMatch ? (
    `${settings.BZ_URL}/show_bug.cgi?id=${bzUrlMatch[1]}`) : null;
};

// A push can be composed of multiple changesets
// We want to return an array of changesets
// Some changesets will be ignored
const pushesToCsets = async (pushes) => {
  const filteredCsets = {};
  Object.keys(pushes).forEach((pushId) => {
    // We only consider pushes that have more than 1 changeset
    if (pushes[pushId].changesets.length >= 1) {
      // Re-order csets and filter out those we don't want
      pushes[pushId].changesets
        .filter(c => !ignoreChangeset(c))
        .forEach((cset, changesetIndex) => {
          filteredCsets[cset.node] =
            initializedChangeset(cset, cset.author, pushId, changesetIndex);
        });
    }
  });
  return filteredCsets;
};

export const getChangesets = async (repoName = REPO_NAME) => {
  const fallback = async () => {
    const text = await getJsonPushes(repoName);
    return pushesToCsets(text.pushes);
  };
  return queryCacheWithFallback('changesets', fallback);
};
