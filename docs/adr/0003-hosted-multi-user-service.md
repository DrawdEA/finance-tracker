# One hosted, multi-user service; every row belongs to a user

The tracker is a single public deployment that anyone can sign up to with GitHub or Google and use out of the box from claude.ai, not a template each person deploys for themselves. Every stored row carries the internal user id it belongs to, and each user has their own currency and timezone. We chose this over deploy-your-own because asking people to create a Cloudflare account, an OAuth app and secrets just to log their spending kills adoption; the cost is that we hold other people's financial data, so privacy, account deletion, abuse limits and a paid plan come with opening up.

## Consequences

- Users are keyed by an internal id; GitHub and Google sign-ins are separate users, never linked automatically by email.
- Timezone and currency are per user (set during onboarding, defaulting to PHP and Asia/Manila), not per deployment.
- No claude.ai Skill: all guidance lives in tool descriptions and `next` hints in tool results, so nothing has to be installed beyond the connector.
- Before opening sign-up: per-user rate limits and storage caps, a privacy note, account deletion, and Workers Paid.
