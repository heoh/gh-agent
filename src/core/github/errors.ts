export class GitHubAuthError extends Error {}

export class GitHubRuntimeError extends Error {}

export class GitHubConfigError extends Error {}

export class GitHubBootstrapError extends Error {
  constructor(
    message: string,
    readonly stage: 'create_project' | 'load_project' | 'bootstrap_fields',
  ) {
    super(message);
  }
}
