import { RedHandedError, invariant } from './errors.js';

export class GitHubClient {
  constructor({ token, api = 'https://api.github.com', fetchImpl = fetch } = {}) {
    invariant(token, 'GITHUB_TOKEN_MISSING', 'GITHUB_TOKEN is required for GitHub writes');
    this.token = token; this.api = api; this.fetch = fetchImpl;
  }
  async request(method, pathname, body, { allow404 = false } = {}) {
    let response;
    try {
      response = await this.fetch(`${this.api}${pathname}`, {
        method, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'redhanded-guard' },
        body: body == null ? undefined : JSON.stringify(body)
      });
    } catch (error) {
      throw new RedHandedError('GITHUB_UNCERTAIN', 'GitHub request outcome is uncertain', { method, pathname, cause: error.message });
    }
    if (allow404 && response.status === 404) return null;
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) throw new RedHandedError('GITHUB_ERROR', `GitHub ${method} ${pathname} returned ${response.status}`, { status: response.status, data });
    return data;
  }
  repoPath(repository, suffix = '') { return `/repos/${repository}${suffix}`; }
  getIssue(repository, issue) { return this.request('GET', this.repoPath(repository, `/issues/${issue}`)); }
  createIssue(repository, report) { return this.request('POST', this.repoPath(repository, '/issues'), report); }
  getRef(repository, branch) { return this.request('GET', this.repoPath(repository, `/git/ref/heads/${encodeURIComponent(branch)}`)); }
  getCommit(repository, sha) { return this.request('GET', this.repoPath(repository, `/git/commits/${sha}`)); }
  createBlob(repository, content) { return this.request('POST', this.repoPath(repository, '/git/blobs'), { content, encoding: 'utf-8' }); }
  createTree(repository, baseTree, tree) { return this.request('POST', this.repoPath(repository, '/git/trees'), { base_tree: baseTree, tree }); }
  createCommit(repository, body) { return this.request('POST', this.repoPath(repository, '/git/commits'), body); }
  createRef(repository, ref, sha) { return this.request('POST', this.repoPath(repository, '/git/refs'), { ref, sha }); }
  getContent(repository, pathname, ref) { return this.request('GET', this.repoPath(repository, `/contents/${pathname}?ref=${encodeURIComponent(ref)}`)); }
  listPulls(repository, head) { return this.request('GET', this.repoPath(repository, `/pulls?state=open&head=${encodeURIComponent(head)}`)); }
  createPull(repository, body) { return this.request('POST', this.repoPath(repository, '/pulls'), body); }
}
