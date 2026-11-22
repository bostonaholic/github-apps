# github-apps

A monorepo of [GitHub Apps](https://docs.github.com/en/apps) for agentic
software engineering.

Coding agents open pull requests faster than a person can review and merge
them. Each app here automates one step of the pull request workflow around
that work: blocking a merge until the checks only a person can do are
ticked off, or merging routine dependency updates with no human review.

## Apps

Each app lives in its own directory with its own README covering setup,
configuration, and deployment.

| App | Description |
| --- | ----------- |
| [dependabot-shepherd](./apps/dependabot-shepherd/) | Approves, merges, and rebases Dependabot PRs per policy. |
| [task-list-completed](./apps/task-list-completed/) | Blocks PR merges until every markdown checkbox on the PR is ticked. |

## Layout

```text
github-apps/
├── apps/<app-name>/   # one directory per app, self-contained
├── scripts/           # shared maintenance scripts
├── .claude/skills/    # agent skills for scaffolding, install, and e2e
└── README.md
```

Apps are independent: separate dependencies, separate deployments. Shared
code stays out of this repo until at least two apps need it.
