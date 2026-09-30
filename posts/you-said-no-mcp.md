---
title: "“You Said No MCP!”"
description: Pi now supports MCP. Why we changed our minds, what changed in MCP and in Pi, and what Codemode is.
template: updates
aria_label: Earendil posts
from: Earendil Engineering <rfc@earendil.com>
to: You
date: Tue, 29 Sep 2026 19:30:00 +0200
subject: "“You Said No MCP!”"
---

If you went to pi.dev in the past, you found a proud declaration that Pi does
not support [MCP](https://en.wikipedia.org/wiki/Model_Context_Protocol). If you listen to podcasts where we talked about Pi, you will
have found more than one dismissive statement about MCP from us. Including [a
post by Mario about
it](https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/).  And
yet, if you upgrade to Pi you will find MCP is now a supported piece of
functionality. What happened?

## Things Change

The first thing to remember is that [the world is not
static](https://lucumr.pocoo.org/2016/11/5/be-careful-about-what-you-dislike/).
We have been paying attention to MCP over the last year and the MCP of today is
not the MCP of yesteryear. That alone would not be much of a reason to put it
into the core, however. As you know, Pi has a great ecosystem of extensions,
surely MCP could have been an extension? Maybe even an Earendil endorsed
extension. And yes you are indeed correct in that MCP could have been an
extension, [as it was](https://github.com/nicobailon/pi-mcp-adapter). That MCP
is now part of the core is a result of us putting our heads together and
rethinking it.

## What Exactly Changed?

The reason we brought MCP into the core is not just about how MCP has changed,
but also because we found that the changes it would require were generally
useful. For example, the changes we have made to MCP also enable the use of Jev
more easily within Pi. Ultimately what Pi needs is quite similar to what MCP
needs: a sandbox to play with in the form of an interpreter.

While a lot of things have improved about MCP, quite a few have not. The biggest
issue with MCP continues to be that it’s hard to compose. Even with codemode,
which is just a neat little sandbox to allow composing of tool calls, MCP
doesn’t fully deliver on this. But that at this point is less the problem of MCP
but the MCP servers out there and different approaches of harnesses to work with
them.

Many MCP servers are still built for harnesses that just dump tools into the
context and are trying to optimize on their side for token efficiency by
returning text. The way we like to think about MCP at this point is that it
should be much closer to OpenAPI with intelligent tool discovery. That means
tools should return structured data and tools should be discoverable by their
documentation and description.

The reason CLIs are so functional is that the agent and model just wire stuff
together with efficient bashisms. But there is no fundamental reason why you
can’t do that with MCP either. MCP in Pi is just built on exposing those tools
to a JavaScript sandbox like other harnesses like Codex do too.

## MCP in a Modern LLM

This will raise the question why we didn’t just do Codemode without MCP. Part of
the answer to this has to do with how tools are expressed in Pi today. We did a
lot of work in recent months to allow Pi to make sense with new models that
allow deferred tool loading, mid-conversation system messages and reasoning
level changes. However we did not yet upgrade our tool loadout to better scale
to these new capabilities.

In a Codemode world one needs to decide if the tool is available to the LLM or
only the codemode part of the LLM. A normal MCP extension does not have enough
metadata available from Pi’s tool loadout to make that experience work well. So
we needed to ensure that tools can be configured to just be deferred or be a
Codemode specific thing.

And while we could have just wired up the metadata to enable better MCP
extensions, we also think that MCP with Codemode solves quite a few of the
issues that it traditionally had. We believe the best way to positively
influence something is to embrace it. And while we think that modern MCP is in a
much better spot than MCP ever was, the servers and patterns still leave room
for improvement. So we want to be part of that conversation and help shape it to
work well in small harnesses instead of standing on the sidelines and just
watching.

## What Is Codemode?

Now we talked so much about Codemode, it might be worth explaining what that
even is. When a harness executes tools, for the most part it has two sides: it
can do it where bash runs, or it can do it where the harness agent loop runs.
The trust level on both sides is very different. The harness loop quite often
runs in an environment that is trusted, whereas the tools it executes often run
within a sandbox that is not really all that trusted.

Codemode is special in that it runs where the harness runs. It’s best understood
as a mechanism to orchestrate and coordinate tool calls. It’s a sandbox that
allows an agent to issue those tool calls in a way that gives it more
flexibility about in which order it should do it, and it allows it to use
JavaScript to combine them together. Because Codemode also runs on the harness
side, its state is also maintained as part of the session transcript instead of
the file system.

Now in theory any language could do, but JavaScript is quite attractive as small
versions of JavaScript can be shipped as WASM binaries and allow reasonable
levels of protection.

In Pi, Codemode is automatically loaded when MCP is configured, or it can be
added to the configuration as a default tool. Just ask pi to reconfigure itself
to enable codemode!  You can then use it for quite interesting things, not just
MCP. For instance when you are logged in with a provider that provides “Jev” you
can do things like this:

> Use typesafe/jev via codemode to find the 20 most frustrated commenters on our issue tracker

And it will cleverly combine things like the Linear MCP and Jev to do that
analysis, right from within Pi, without wasting any context at all.

<figure class="post-figure pi-replay" data-pi-replay="/static/posts/you-said-no-mcp/codemode-replay.json">
<pre class="pi-replay__fallback">&gt; Use typesafe/jev via codemode to find the most frustrated people on our issue tracker

I'll pull the open issues from Linear and let Jev rate the tone of each thread, four at a time.

codemode
const { issues } = await tools.mcp__linear__list_issues({
  team: "Pi", state: "open", limit: 250,
});
const jev = await models.getModelOfType(
  "classifier", "cloudflare-workers-ai", "typesafe/jev",
);
const questions = {
  frustration: {
    type: "choice",
    instructions: "Judge ONLY the emotional tone of the people writing. " +
      "Ignore how severe the bug is.",
    criteria: {
      none: "Neutral, factual, or friendly, even about a serious bug",
      mild: "Explicit annoyance, impatience, or disappointment",
      high: "Clearly angry, exasperated, sarcastic, or fed up",
    },
  },
};

const results = [];
let next = 0;
async function worker() {
  while (next &lt; issues.length) {
    const issue = issues[next++];
    const { comments } = await tools.mcp__linear__list_comments({
      issueId: issue.identifier,
    });
    const c = await models.classify(jev, { state: { ...issue, comments }, questions });
    results.push({ id: issue.identifier, title: issue.title, ...c.answers.frustration });
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
store("frustration", results);

const score = (r) =&gt; r.probabilities.mild * 0.5 + r.probabilities.high;
const counts = {};
for (const r of results) counts[r.choice] = (counts[r.choice] ?? 0) + 1;
const flagged = results.filter((r) =&gt; r.choice !== "none");
flagged.sort((a, b) =&gt; score(b) - score(a));
return {
  total: results.length,
  counts,
  flagged: flagged.map((r) =&gt; `${r.id} ${r.title}`),
};

... (331 earlier calls)
✓ mcp__linear__list_comments {"issueId":"PI-4714"} 255ms
✓ mcp__linear__list_comments {"issueId":"PI-3200"} 354ms
✓ models.classify cloudflare-workers-ai/typesafe/jev 756ms
✓ models.classify cloudflare-workers-ai/typesafe/jev 750ms

{
  "total": 167,
  "counts": {
    "none": 156,
    "mild": 11
  },
  "flagged": [
    "PI-7740 TUI after /reload does not follows custom tool's re…",
    "PI-9566 context size defaults to 128k despite the real size…",
    "PI-10031 Pi sporadically stuck in \"Working...\" when thinking…",
    "PI-4714 [feature] /update TUI command instead of pi update",
    "PI-5916 Support provider extensions with model aliases and…",
    "PI-7547 [Windows] [sink-thread] How do you use Pi on window…",
    "PI-6907 Add an Installation section to the README",
    "PI-6212 Proposal: Bedrock path should honor `compat.forceAd…",
    "PI-9932 before_agent_start: forced system prompt keeps tool…",
    "PI-7730 High CPU usage on Mac OS with long session",
    "PI-6600 pi update --extensions and npm scripts: npm 11.16.0…"
  ]
}

Most of the tracker is calm. Jev rated 156 of the 167 open issues as neutral, 11
as mildly frustrated and none as highly frustrated.

The clearest cases:

- PI-6907 no installation section in the README (“It's frustrating”) - PI-10031
Pi gets stuck on “Working...” after pressing Esc during thinking - PI-4714 a
/update command request (“a pain in the butt”) - PI-7730 high CPU usage on macOS
in long sessions

The per-issue verdicts are stored in codemode under frustration, so I can dig
into any of them without fetching the issues again.</pre> <figcaption>A
condensed replay of such a session in Pi.</figcaption> </figure>

We will have more to say about things like Jev and Codemode later, but we hope
this post serves as an example of how we continue to adapt and update Pi
thoughtfully as the world continues to evolve.
