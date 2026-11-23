# Vision

## Mission

Every change a coding agent writes reaches production or is rejected
without waiting on a person. People decide only what needs a person's
judgment, and they write the policy for everything else.

## The shift

Agents now write most new code. A team that used to open 20 pull
requests a week opens 500. Review, merge, deploy, and rollback still run
at the speed of the people who used to write the code, so the queue of
open pull requests grows every day.

Most decisions in that queue follow rules a person can write down: is
this dependency bump safe, are the manual checks done, is this change
reversible, did CI test what changed, who must look at this one. Each of
these decisions belongs to software.

## What comes next

Six changes follow from agents writing most code. Each one creates a
decision the suite owns.

1. **Trust is earned per agent, not granted per repo.** An agent is a
   specific model, prompt, toolset, and config. Each has a track record:
   pull requests merged, reverted, and caused incidents. A new agent
   starts with every pull request reviewed by a person and earns
   auto-merge on a change type once its revert rate on that type proves
   it. An agent whose revert rate rises loses autonomy automatically.
2. **The author never approves its own work.** When an agent writes a
   change and the same vendor's model grades it, nobody independent
   approved it. Auditors will require separation of duties between
   author and approver, the same rule that already applies to people.
   The suite is the independent approver: a different model, a recorded
   policy, and no stake in the author.
3. **Review becomes checking evidence, not reading diffs.** No person
   reads 500 diffs a week. An agent submits its change with evidence:
   tests that fail before and pass after, a browser recording of the
   test plan, performance numbers, the runtime trace of the new path.
   Apps check that the evidence exists, is real, and covers the change.
   Diffs are read by models, and only when the evidence is missing.
4. **Coordination replaces conflict resolution.** Fifty agents working
   in one repo collide on the same files. Resolving conflicts after the
   fact wastes the work of every losing agent. Agents claim the files
   they will edit before they start, and the suite grants or refuses the
   claim. The suite also measures which files every change touches and
   says which to split.
5. **Policy is the code people write.** People stop reviewing changes
   and start reviewing the rules that approve changes. A policy change
   is always a one-way door and always goes to a person. The policy file
   is the most reviewed file in the repo.
6. **Production closes the loop.** An error spike opens an issue, an
   agent fixes it, the suite grades, merges, deploys, and watches the
   fix. People set the error budgets and service-level objectives. The
   loop runs on its own inside them.

## End state

- **90% of pull requests merge with no person involved**, across every
  repo that installs the suite.
- **Auto-merged changes are reverted less often than human-reviewed
  ones**, and the suite publishes both numbers.
- **Every agent has a public track record**: revert rate and incident
  rate by change type, language, and framework.
- **A critical CVE is patched in every repo of an organization within
  one hour** of the advisory, with no person in the loop.
- **Auditors accept the decision log as change-management evidence.**
  A SOC 2 or SOX change-control review is an export.

## Principles

1. **One app, one decision.** An app that grows a second decision becomes
   two apps. A repo installs exactly the decisions it wants automated.
2. **Policy lives in the repo.** Every rule comes from a config file or a
   label. An organization sets one policy for all its repos and each repo
   narrows it.
3. **A person can always take over.** Every app has an off switch that
   leaves the pull request mergeable by hand. A disabled app never blocks
   a merge.
4. **Irreversible changes go to a person.** An app auto-merges a change
   only when a revert undoes it.
5. **The approver is independent of the author.** No app approves a
   change using the same model and vendor that wrote it.
6. **Code first, model second.** Fixed rules run as code. A model is
   called only for judgment, with its input, output, and confidence
   recorded.
7. **Every decision is recorded.** What the app saw, what it decided, and
   what happened in production afterward.

## The suite

One app per decision, from the issue that asks for a change to the
production metrics that judge it.

### Intake and coordination

| App | Decision |
| --- | --- |
| Issue Triage | Is this issue specific enough for an agent? If so, assign it to the agent with the best record on this kind of change. |
| Task Splitter | Is this issue too large for one pull request? Split it into issues that each are not. |
| Lease Keeper | May this agent edit these files now, or is another agent already changing them? |
| Hotspot Report | Which files does every change touch, and how should they split? |

### Evidence and review

| App | Decision |
| --- | --- |
| merge-warden *(shipped)* | Is this pull request low risk and reversible enough to merge? |
| task-list-completed *(shipped)* | Are the manual checks on this pull request done? |
| Evidence Check | Does this pull request carry evidence that covers the change: failing-then-passing tests, a recording, a trace? |
| Scope Fence | Does this pull request touch only the files its task covers? |
| Reviewer Router | Who must review this one-way-door or high-risk pull request? |

### Trust

| App | Decision |
| --- | --- |
| Trust Ledger | What may this agent auto-merge, given its record on this change type? |
| Policy Gate | Does this change edit a policy file, CODEOWNERS, or CI? Send it to a person. |
| Dependency Vetter | Does this new dependency exist, have a real maintainer history, and match what the agent meant to install? |

### Merge and CI

| App | Decision |
| --- | --- |
| dependabot-shepherd *(shipped)* | Is this dependency update inside policy, and is it current? |
| Test Selector | Which tests does this change need? Run those, not the full suite. |
| Flake Quarantine | Is this failing check flaky? Retry it, and quarantine it if it keeps failing. |
| Stack Lander | In what order do these dependent pull requests merge, across repos? |

### Deploy, recover, maintain

| App | Decision |
| --- | --- |
| Rollout Gate | Is this deploy healthy enough to widen from 1% to 100%? |
| Revert Marshal | Did an auto-merged change raise errors after deploy? If so, merge the revert. |
| Incident Bisector | Which merged pull request caused this production incident? |
| CVE Responder | Which repos are exposed to this advisory? Open, grade, and merge the fix in each. |
| Migration Runner | Has this framework or API migration landed in every repo it applies to? |

## The decision record

Every install adds to one record: each change, the agent that wrote it,
the evidence it carried, the decision each app made, and what happened in
production afterward. Across thousands of repos this is the largest
dataset of which changes, from which agents, break production.

That record drives five things:

1. **A risk model trained on outcomes.** merge-warden grades from what
   reverted and caused incidents across every install. Each install makes
   every other install's grades more accurate.
2. **Agent track records.** Trust Ledger's autonomy decisions come from
   the record, not from a vendor's claims about its model.
3. **A published benchmark.** Revert and incident rates by agent, change
   type, language, and framework, every quarter. It is the number the
   industry cites for which agents to trust with what.
4. **A merge warranty.** Every auto-merge that causes a production
   incident earns the customer a credit. The suite prices its own risk
   because it measures it.
5. **Compliance evidence.** Every change has an independent approver (an
   app with a policy, or a person), the evidence it decided on, and the
   outcome. That is the change-management control auditors test.

## Fleets

An organization runs the suite across every repo from one policy, and
sees for the whole organization:

- Pull requests opened, auto-merged, sent to a person, and reverted.
- Time from issue opened to change in production, per repo.
- Every agent in use, with its autonomy level and record.
- Every repo still exposed to each open advisory or missing a migration.

A platform team changes one policy file and every repo follows it the
next time an app reads it.

## Beyond the pull request

The pull request is a form built for people reading each other's code.
When agents write and apps approve, the unit of work becomes a change
with its intent, its evidence, and its approver. Some of those changes
land as pull requests on GitHub. Others land directly on trunk from an
agent's sandbox, or on GitLab, or in a forge that does not exist yet.

The suite makes its decisions on the change, not the pull request. The
GitHub App is the first place it runs.

## Business

1. **Free apps that run fixed rules** (task-list-completed,
   dependabot-shepherd, Flake Quarantine, Policy Gate, Hotspot Report)
   bring installs and feed the decision record.
2. **Paid apps that call a model or the record** (merge-warden, Evidence
   Check, Scope Fence, Trust Ledger, Incident Bisector, and the rest).
3. **Price per change landed.** Agents are not seats. Charging per change
   follows the cost of each decision and the value of each merge.
4. **A fleet tier** for organizations: one policy, organization-wide
   reporting, compliance export, and the merge warranty.
5. **Agent certification** for agent vendors: their agents measured
   against the benchmark, with a published track record their customers
   check before granting autonomy.

## Milestones

| Stage | Proof |
| --- | --- |
| One repo | The suite merges 90% of one owner's pull requests with a revert rate under 2%. |
| 1,000 repos | Outside repos install it unprompted, and the record trains the first risk model and the first agent track records. |
| Fleets | An organization runs every repo from one policy and closes a critical CVE everywhere in under an hour. |
| Standard | Agent vendors publish their benchmark scores, and auditors accept the decision log by default. |

## Risks

- **GitHub ships the same decisions** in its own agent or merge queue.
  GitHub is also an agent vendor, so it cannot be the independent
  approver of its own agent's work. The suite supports every agent and
  every forge, keeps policy in plain files, and owns outcome data across
  all of them.
- **A bad auto-merge reaches production.** One-way doors never
  auto-merge, Trust Ledger limits each agent to change types it has
  proven, Rollout Gate limits exposure, Revert Marshal undoes the
  change, and the warranty pays for it.
- **Agents learn to game the checks.** An agent optimized to pass the
  suite fabricates evidence or splits a risky change into small changes
  that each look safe. Evidence Check verifies evidence against CI and runtime
  data it collects itself, and the risk model grades the sequence of
  changes, not each one alone.
- **Model cost exceeds price** on large diffs. Fixed rules run first,
  the trained risk model replaces general-purpose prompts, and pricing
  is per change.

## Non-goals

- Writing code. The suite decides what happens to changes. Agents write
  them.
- Running CI. The apps read check results and choose which tests run.
- Style review. Other tools cover that.
