# github-apps

A monorepo of [GitHub Apps](https://docs.github.com/en/apps).

## Apps

Each app lives in its own directory with its own README covering setup,
configuration, and deployment.

| App | Description |
| --- | ----------- |
| [task-list-completed](./task-list-completed/) | Blocks PR merges until every markdown checkbox on the PR is ticked. |

## Layout

```text
github-apps/
├── <app-name>/     # one directory per app, self-contained
└── README.md
```

Apps are independent: separate dependencies, separate deployments. Shared
code stays out of this repo until at least two apps need it.
