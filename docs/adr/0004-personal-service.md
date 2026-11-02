# A personal server for its owner only

The tracker runs as one private deployment for its owner: GitHub sign-in limited to the owner's numeric id, with no sign-up. This reverses ADR 0003's public multi-user service. Holding other people's financial data turned out to bring more than a hobby project should carry: privacy obligations, account deletion, abuse limits, a paid plan, and liability if anything leaked or was lost.

## Consequences

- No Google sign-in, open sign-up, rate limits, storage caps, privacy page or account deletion; they were built for the public launch and removed.
- Rows still carry `user_id` and everything is scoped by it: it costs nothing and keeps the option open.
- Still no claude.ai Skill: guidance stays in tool descriptions and results (from ADR 0003).
- The repository stays open source as code to read and fork, not a hosted or supported service.
