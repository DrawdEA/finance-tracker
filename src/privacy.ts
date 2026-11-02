export const PRIVACY_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Finance Tracker · Privacy</title>
<style>
	:root { color-scheme: light dark; }
	body { font: 16px/1.6 system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; }
	h1 { font-size: 1.5rem; } h2 { font-size: 1.1rem; margin-top: 2rem; }
</style>
</head>
<body>
<h1>Privacy</h1>
<p>Finance Tracker is a hobby project: an open-source MCP server you use from Claude to log your money. This page says what it keeps and how to remove it.</p>

<h2>What's stored</h2>
<ul>
	<li>Only what you log: amounts, dates, Account and Category names, notes, and your currency and timezone.</li>
	<li>Your sign-in provider (GitHub or Google) and that provider's numeric user id. Not your name, email or profile.</li>
	<li>Sign-in tokens for your Claude connector, which expire after 90 days without use.</li>
</ul>
<p>It runs on Cloudflare (Workers, D1 and KV). Nothing is sold, shared or used for ads, and no other user can see your data. The maintainer can technically reach the database and only does so to fix problems.</p>

<h2>Claude</h2>
<p>What you tell Claude, and what the tools send back, is handled by Anthropic under your Claude account's terms. This server only sees the tool calls.</p>

<h2>Deleting your data</h2>
<p>In any chat, ask Claude to <strong>delete your finance tracker account</strong>. After you confirm, every row for your account is deleted and your sign-in is revoked. Cloudflare's database point-in-time recovery may keep deleted data for up to 30 days before it's gone for good.</p>

<h2>No warranty</h2>
<p>This is provided as is, with no warranty or uptime promise. Don't rely on it as your only record of anything important.</p>

<h2>Contact</h2>
<p>Questions or problems: <a href="https://github.com/DrawdEA/finance-tracker/issues">github.com/DrawdEA/finance-tracker/issues</a>.</p>
</body>
</html>`;
