# How far claude.ai and Claude mobile honor MCP server guidance

Research for [#3](https://github.com/DrawdEA/finance-tracker/issues/3). Checked 2026-10-29.

**Question:** which MCP server guidance actually reaches the model in Claude chat (claude.ai web, Desktop chat, iOS and Android): server `instructions`, tool descriptions, prompts, resources? Can Claude's behaviour (confirmation style, Category mapping, Catch-up script) live entirely in the server, or does it need a claude.ai Skill as backup?

**Labels:** **[Doc]** = Anthropic or MCP docs say so. **[Report]** = public bug report or wire probe in Anthropic's `claude-ai-mcp` tracker, not official policy. **[Inference]** = my reasoning from the above.

## Answer

The server **cannot** be the only home for behaviour. Server `instructions` are dropped in chat. Tool descriptions often reach the model only after a tool search, and in Auto mode the model may never search. Prompts and resources need the user to pick them by hand, and prompts from custom connectors may not show up at all. Put per-tool rules in tool descriptions and tool results. Put the cross-tool behaviour (confirmation style, Category mapping, Catch-up script) in a claude.ai Skill, a Project, or account-wide instructions. Skills load on mobile.

## Findings

### 1. Server `instructions`: dropped in claude.ai, Desktop chat and (likely) mobile

- **[Doc]** The MCP spec makes it optional for the client to use them. `instructions` is "natural-language guidance describing the server... This *can be used* by clients to improve an LLM's understanding of available tools (e.g., by including it in a system prompt)." Source: [MCP schema, DiscoverResult.instructions](https://modelcontextprotocol.io/specification/latest/schema) and [2025-06-18 lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle) (`InitializeResult.instructions`).
- **[Doc]** Anthropic's connector docs never say chat supports `instructions`. The supported list covers only tools, prompts, resources, and text/image results. Source: [Build an MCP server for Claude](https://claude.com/docs/connectors/building.md).
- **[Report]** The field does not reach the model on claude.ai web or Desktop chat. A canary-token probe in [claude-ai-mcp#93](https://github.com/anthropics/claude-ai-mcp/issues/93) (2026-07-29) checked this. The field was present on the wire and the same server worked in Claude Code. Chat **discards** the field: a token at character 60 never came back, so this is not truncation. Later reports confirm the same on the `2026-07-28` `server/discover` path (2026-10-09) and on 2026-10-15. Labels on the issue: `enhancement, triaged, backlog`. An Anthropic collaborator said "We're tracking this in our backlog" ([#131](https://github.com/anthropics/claude-ai-mcp/issues/131)). Nobody has given a timeline.
- **[Inference]** Mobile uses the same connector infrastructure ([docs](https://claude.com/docs/connectors/building.md): "the same connector infrastructure backs all of them"), so assume mobile drops the field too. No one has tested mobile directly.
- Claude Code *does* pass the field to the model. This doesn't help us, since v1 is used from phone and desktop chat.

### 2. Tool descriptions: they reach the model, but often only after a tool search

- **[Doc]** claude.ai has per-conversation **tool access modes** on web, Desktop, Cowork, and iOS/Android. Source: [Manage Claude's tool access](https://support.claude.com/en/articles/13730515-manage-claude-s-tool-access).
  - **Auto (default):** "Claude decides dynamically which connectors to load."
  - **Always available:** "All your connectors are loaded at the start of every conversation."
  - **On demand:** "Connectors aren't loaded until Claude searches for the right one."
- **[Report]** In chat, a custom connector's tools reach the model as **bare deferred names** (`mcp__<connector-uuid>__<tool>`), with no description, no schema and no connector display name, until the model calls tool search. `_meta["anthropic/alwaysLoad"]` is ignored in chat but honored in Claude Code. When the user didn't mention the connector, the model sometimes answered from its own knowledge and never called it. Source: [#1105](https://github.com/anthropics/claude-ai-mcp/issues/1105), 2026-10-03, confirmed by a directory connector author. The reporter says this happened even with the "tools already loaded" mode. That conflicts with the help-center wording for "Always available", so it's unconfirmed.
- **[Report]** Once loaded, descriptions arrive whole. A 1,770-character description came back verbatim on claude.ai web ([#93 probe](https://github.com/anthropics/claude-ai-mcp/issues/93)). That disproves an earlier claim of a ~500-character cap. Claude Code cuts descriptions at 2,048 characters (same thread). chat has no documented limit.
- **[Doc]** Directory review rules ask descriptions to "describe what the tool does, and don't tell Claude how to behave." These rules apply only to directory listings, not to our private custom connector. Source: [review criteria](https://claude.com/docs/connectors/building/review-criteria.md).
- **[Report]** Mobile has open bugs where custom OAuth connectors don't show their tools in iOS chat even though they work on web ([#893](https://github.com/anthropics/claude-ai-mcp/issues/893), 2026-08). Small connectors on the same device worked.

### 3. MCP prompts: you pick them by hand, and custom-connector prompts may not appear at all

- **[Doc]** The spec makes prompts **user-controlled**: "the user being able to explicitly select them," typically as slash commands. The model can't call them itself. Source: [MCP prompts](https://modelcontextprotocol.io/specification/latest/server/prompts).
- **[Doc]** Anthropic says a server *can expose* prompts ([build docs](https://claude.com/docs/connectors/building.md)). No current Anthropic doc says where they show up in chat.
- **[Report]** An Anthropic collaborator said: "we do support resources and prompts from Claude.ai UI - a user can choose to add those from the UI," and added that the model can't access them on its own, with no near-term plans to change that ([#23](https://github.com/anthropics/claude-ai-mcp/issues/23)).
- **[Report]** Prompts from **custom** connectors stopped showing in the chat UI around 2026-05-13 to 2026-05-21. They're missing from the "+" menu and the "/" popup, while Atlassian's directory-connector prompts still appear. `prompts/list` is still called and still succeeds. It still reproduced on 2026-08-24 on web and Desktop ([#333](https://github.com/anthropics/claude-ai-mcp/issues/333)).
- **[Inference]** Don't rely on a prompt to start Catch-up. Even when prompts do show, the user has to remember to pick one, and nothing documents prompts on mobile.

### 4. Resources: you attach them by hand, and the model can't read them on its own

- **[Doc]** Chat supports text and binary resources. Resource subscriptions are not supported ([build docs](https://claude.com/docs/connectors/building.md)). The spec calls resources "application-driven" ([MCP resources](https://modelcontextprotocol.io/specification/latest/server/resources)).
- **[Report]** In chat, the user attaches a resource through **"+" > "Add from <server>"**. The model can't read resources by itself ([#23](https://github.com/anthropics/claude-ai-mcp/issues/23), [#1160](https://github.com/anthropics/claude-ai-mcp/issues/1160), 2026-10-16). Chat also doesn't support the Skills-over-MCP extension (SEP-2640), which serves skills as resources (#1160).

### 5. Size and time limits (claude.ai and Desktop) **[Doc]**

| Limit | Value |
|---|---|
| Tool result size | ~150,000 characters |
| Tool call timeout | 240 s |
| Custom connectors on Free | 1 |
| Skill `description` | 1,024 characters; `name` up to 64 |

Sources: [build docs](https://claude.com/docs/connectors/building.md), [Get started with custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), [Create custom skills](https://claude.com/docs/skills/how-to.md). There's no documented limit for tool descriptions or `instructions` in chat.

### 6. Is a claude.ai Skill a workable backup on mobile? Yes, with limits

- **[Doc]** Skills, connectors and plugins added in claude.ai "are saved to your account, so you have them in chat on the web, desktop, and mobile" ([extend overview](https://claude.com/docs/extend/overview.md)). The plugin support table's "Chat" column includes the mobile apps, and skills show "Loads" there ([platform support](https://claude.com/docs/plugins/platform-support.md)).
- **[Doc]** Requirements: Pro, Max, Team or Enterprise, with **Code execution and file creation** turned on ([skills overview](https://claude.com/docs/skills/overview.md)). Upload it as a ZIP from web or Desktop ([how-to](https://claude.com/docs/skills/how-to.md)).
- **[Doc]** Skills load on demand. Claude sees only the name and description until a request matches, and you can force one with `/` ([overview](https://claude.com/docs/skills/overview.md)). Anthropic's own pattern for a product connector is to bundle it with a skill that holds "the sequence, the defaults, and what good output looks like" ([plugins/build](https://claude.com/docs/plugins/build.md)). That's our case.
- **[Doc]** For rules that must apply to **every** conversation, Anthropic points to personal preferences or project instructions instead of a skill ([how-to](https://claude.com/docs/skills/how-to.md); [personalization](https://support.claude.com/en/articles/10185728-understanding-claude-s-personalization-features): account-wide instructions "will be applied to all of your conversations"). **[Inference]** Projects and preferences sync to mobile, but the article doesn't say so.

## What this means for v1 [Inference]

1. **Tool descriptions:** put per-tool rules here, such as when to call the tool, argument meaning, the Category list and confirmation format. They're the one channel that reliably reaches the model once a tool loads. Give tools plain, searchable names (for example `log_transaction`, `start_catch_up`) so tool search finds them, since names are all the model sees before loading.
2. **Tool results:** put behaviour that has to follow every call here. The confirmation text, the next Catch-up step, and the "did you mean Category X?" prompt can all come back in the result. A result always reaches the model, so this channel is the most robust.
3. **A claude.ai Skill** (for example `finance-tracker`) holds the cross-tool script: Catch-up flow, confirmation style, loose-input rules. Its description should list the trigger phrases ("spent", "paid", "got paid", "catch up", "balance"), so it loads, and loading it also makes Claude use the connector. If my plan lacks Skills, use account-wide instructions or a "Finance" Project.
4. **Server `instructions`:** still set them, since Claude Code honors them and chat may later, but treat them as a duplicate copy, not the source of truth.
5. **Prompts/resources:** none in v1. They're unreliable for custom connectors and need a manual pick.
6. **Throwaway deploy** (#7) should check on the phone that the custom connector's tools appear in iOS chat (#893) and whether Auto mode finds them without the connector being named.

## Not settled

- Mobile was never tested directly for `instructions`, prompts or resources. The mobile points are inferred from the shared infrastructure.
- It's unclear whether "Always available" really loads full tool schemas for custom connectors (#1105 says no, the help center implies yes).
- It's unclear whether custom-connector prompts are back in the UI after #333 (last confirmed missing 2026-08-24).
- Whether account-wide instructions and Projects apply on mobile isn't written down. That's an inference.
