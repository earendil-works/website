---
title: The Session You Cannot Take With You
description: Inference APIs are filling sessions with encrypted reasoning, hidden search results, opaque compaction, and encrypted subagent messages. A growing form of lock-in.
template: updates
aria_label: Earendil posts
from: Earendil Engineering <rfc@earendil.com>
to: You
date: Thu, 30 Jul 2026 00:00:00 +0200
subject: The Session You Cannot Take With You
---

The original promise of an inference API was wonderfully simple: send some
input, receive some output.  If you kept both, you had the conversation.  You
could inspect it, archive it, replay it, or give it to a different model.

That abstraction was never completely true.  For instance [prompt caches
live](/posts/prompt-caching/) on somebody else's GPUs, tokenization differs
between models, and sampling is not reproducible (and quite intentionally so).
But the *semantic record* of a session in the form of a transcript could still
belong to the user.  A transcript should contain the instructions, messages,
tool calls and tool results.  Another sufficiently capable model might not
continue identically, but it could understand what happened and take over.

Inference APIs are frustratingly moving away from that property, at least
somewhat.  They increasingly return a mixture of text and provider-bound state
that is very intentionally non-portable.

* reasoning tokens that are billed to the user but returned only as opaque,
  encrypted blobs, with useless summaries at best
* web searches where the model sees source material the client never sees
* compacted context that only the original provider can decrypt
* subagent instructions and messages hidden from the application running the
  agents in the form of encrypted payloads
* file, vector-store, container, and cache references that cannot be resolved
  anywhere else.
* response and conversation state that is entirely keyed by IDs that are
  stored fully on the provider's servers

Each feature comes with a basic justification that's trivial for a provider to
come up with, along with good arguments for why this is good for the user.  Together
all of these things change the ownership reality of an AI session: the
transcript on your machine is no longer your session but a partial view of a
session whose operational state belongs to an inference provider and not you.

We are not fans of this direction, and we want to talk a bit about what it means
to you, as a user, and what it means to us, as people developing tools in this
space.

## A Practical Test for Session Ownership

By a portable session we do not mean that switching from one model to another
must produce the same next token.  That's a given because models have different
capabilities, trained personalities, context windows, and ways of working with
tools.  And well, it's all quite nondeterministic anyway.  Portability means
something more modest:

```javascript
const transcript = session.export();
revokeCredentials(oldProvider);
session = newProvider.continueFrom(transcript);
```

The archive should contain enough intelligible information for another model to
continue the work.  It should not require the old provider to dereference an ID,
decrypt a blob, remember a search result, or reconstruct a summary.

This gives us five useful tests:

1. **Inspection:** Can the user see what the model saw, what tools did, and what
   agents told each other?
2. **Export:** Is the session self-contained, apart from ordinary artifacts that
   can also be downloaded?
3. **Replay:** Can another implementation reconstruct a semantically equivalent
   context?
4. **Audit:** Can a human explain why the system took an action after the fact?
5. **Deletion:** Can the user identify and remove every server-side copy on which
   the session depends?

A response ID is not a transcript (as the data is stored on the server), a ciphertext is not user-controlled stated (as the user cannot decrypt it), a list of citations is not the evidence that was placed
in the model's context by a search result (as you cannot typically fetch the same data as the model did).

## Encryption for Whom?

The naming and marketing around these features can be misleading.
`encrypted_content` sounds like a privacy feature under the user's control.
Usually it is a capsule that the client cannot read and only the provider can
open.  The provider chooses the keys, decrypts the content for its own models,
and defines where the data can be replayed.

A better term is **provider-sealed state**.

Provider sealing can have a real privacy benefit.  OpenAI, for example, can
return encrypted reasoning to a client using `store: false`, then decrypt it in
memory on the next request without persisting the intermediate state.  That is
better than requiring server-side conversation storage, particularly for Zero
Data Retention customers.  But, remember, there is not really anything that
needs encryption to begin with!

This encryption does not hide the data from the inference
provider but it hides it from you.

## Stored Conversations Turn a Transcript into a Pointer

OpenAI's Responses API stores responses by default.  Its documentation says
response objects are retained for at least 30 days by default.  `store: false` is available
and should be used, as it makes it work more like completions: the data is not
stored on OpenAI's servers.

The new Gemini Interactions API has made a similar choice.  It defaults to
`store: true`.  On the paid tier interactions are retained for 55 days, and on
the free tier for one day.

And obviously, the idea of storing state on the server is quite attractive:

```javascript
const first = responses.create({
  model: "frontier-model",
  input: "Investigate this production failure",
  store: true,
});

const second = responses.create({
  model: "frontier-model",
  previousResponseId: first.id,
  input: "Now implement the fix",
  store: true,
});
```

The application sends less data, the provider can preserve hidden reasoning and
tool state, and cache routing becomes easier.  But if the local application only
records the user messages and final text, `first.id` is now a foreign key into a
database it does not control.

## No Reasoning For You

All major labs claim to have legitimate reasons not to expose raw chain of
thought.  As a result, on non-open-weights models we typically do not see these
tokens.

Raw reasoning is not visible via the API.  With stored responses, prior
reasoning can be recovered through `previous_response_id`.  With `store: false`,
the API returns `encrypted_content`, which the client must preserve and replay.
Persisted reasoning remains opaque even when `reasoning.context: "all_turns"`
lets a later sample use it.

Anthropic returns the encrypted full thinking in a `signature` field.  The
readable thinking text, when enabled, is a summary produced by another model,
not the raw chain of thought.  Thinking blocks must be passed back unchanged
during tool-use turns.  Anthropic's documentation also says thinking blocks are
tied to the model that produced them and should be stripped when switching
models.  So these reasoning traces do not attempt to be portable within
Anthropic.

The same story repeats with all closed-weights models.

These encryption mechanisms permit continuity *inside* an ecosystem but they do
not create a portable transcript that can be taken to another provider's model.
A session archive can contain the blob, but another model cannot use its
meaning:

```json
◊{"type": "reasoning", "encrypted_content": "gAAAAAB..."}
◊{"type": "thinking", "thinking": "", "signature": "EqQBCg..."}
◊{"type": "thought", "summary": [], "signature": "EpoGCp..."}
```

## Hidden Searches

Server-side web search is one of the clearest examples of a transcript having
holes in it hidden from the user.  A client-side search tool behaves like
any other tool:

```javascript
const result = search(query);
record({
  query,
  retrievedAt: now(),
  results: result.map((item) => ({
    url: item.url,
    title: item.title,
    passages: item.passages,
  })),
});
model.send({ toolResult: result });
```

The user can inspect the ranking and passages, refetch the pages, cache a copy,
or provide the same evidence to another model.

With hosted search, the provider performs a private tool loop.  OpenAI, Google
and Anthropic expose search actions, citations, and optionally a list of source
URLs, but not the complete text context used to produce an answer.  A URL is not
a stable replay, instead its contents can change or
have been reduced to a much shorter snippet before the model saw it.

The final answer may be perfectly good.  The problem appears on the next turn:

> Compare the third source with the first one, re-check the disputed number,
> and continue this research using another model.

The new model receives an answer and a few URLs.  It does not receive the result
ranking, extracted passages, filtered-out material, or exact evidence the first
model used.  The old provider is still part of the session even if the next
request goes elsewhere.  Even if you have the citations and you were to re-fetch you cannot reproduce the precise data. 

Hosted search should have a full-fidelity export mode containing queries,
result metadata, retrieved passages, timestamps and retained contents.  Concise citations can remain the user interface but they should not be the
only record.

## Opaque Compaction

Long agent sessions eventually need compaction.  A visible, client-controlled
summary is lossy, but it is at least inspectable and transferable.  The user can
review it, edit it, or ask a different model to produce another one.

OpenAI's server-side compaction instead emits an encrypted compaction item.  The
documentation describes it as "opaque and not intended to be
human-interpretable."  The standalone `/responses/compact` endpoint returns a
"canonical next context window" that clients are instructed to pass on as-is.

Conceptually, the transition looks like this:

```javascript
// Before: expensive but portable
let history = [
  userMessage,
  assistantMessage,
  toolCall,
  fullToolResult,
  // ... 200,000 more tokens of intelligible history
];

// After: cheap to continue only with the original provider
history = [
  {
    type: "compaction",
    encryptedContent: "enc_provider_only_state...",
  },
  ...recentItems,
];
```

OpenAI can continue from the compressed meaning, but a different provider sees an
unreadable string plus a recent suffix (well, would see it, we never pass this
sort of information to another provider).

This is not technically necessary.  Anthropic's server-side compaction returns
a `compaction` block with a readable `content` field.  It lets the client provide
custom summarization instructions, and the resulting summary can be inspected
and passed to another model.  Client-side compaction is also possible with any
provider.

OpenAI's sealed artifact may preserve more model-specific state than a plain
summary and may perform better on the original model.  That is a reasonable
optional optimization but it should be accompanied by a readable handoff summary,
not replace one.  But again, a lot of this has the added benefit of further
locking you into one ecosystem.

## Subagents Come With Hidden Instructions

Multi-agent systems compound the problem because there is no longer one
transcript.  There is a tree of sessions and a stream of messages between them.
Usually they are prompts as if a human wrote them, just now authored by a
machine for another machine.

OpenAI's hosted Responses Multi-agent beta returns three new item types:
`multi_agent_call`, `multi_agent_call_output`, and `agent_message`.  The example
for `spawn_agent` contains an encrypted `message` argument, and inter-agent
messages contain only `encrypted_content`.  Automatic server-side compaction is
implicitly enabled for every agent when Multi-agent is enabled, even if the
client did not request it.  Reasoning summaries are not supported and the API also
injects root and subagent instructions that the developer cannot edit or remove.

This is a bundle of non-transferable state: sealed delegation, sealed agent
messages, separate automatically compacted contexts, hidden reasoning, and
provider-hosted orchestration.

A related change landed in the open-source Codex client in June 2026.  The
commit, titled ["Encrypt multi-agent v2 message
payloads"](https://github.com/openai/codex/commit/5f4d06ef186b896d316620556e561d59206c3ebf),
explains the flow directly:

```json
◊// Parent model's tool call, as persisted by Codex
{
  "name": "spawn_agent",
  "arguments": {
    "task_name": "worker",
    "message": "<ciphertext>"
  }
}

◊// Child model's input
{
  "type": "agent_message",
  "author": "/root",
  "recipient": "/root/worker",
  "content": [{
    "type": "encrypted_content",
    "encrypted_content": "<ciphertext>"
  }]
}
```

The Responses API encrypts the tool argument emitted by the parent, Codex
forwards it, and the API decrypts it internally for the child.  Codex's own
`InterAgentCommunication.content` is empty.  The exact task is absent from its
readable rollout and history.

Presumably this is not merely an abstract model-switching concern.  One could
imagine if the child changes the wrong file, leaks a secret, duplicates another
agent's work, or follows a bad assumption, the user cannot answer the simple
question of *what was that agent asked to do?*

An [open Codex issue](https://github.com/openai/codex/issues/28058) asks for the
encrypted delivery to retain a separate readable audit copy.  That is the
minimum acceptable design.  Better still, plaintext inter-agent messages should
remain the norm.

## “Most People Do Not Switch Models Mid-Session”

Probably not.  Most people do not switch their operating system or phone
provider every week either.  But even if you do not utilize that freedom, it
matters because it changes the relationship you have with the provider and
the provider has with you.

As a user you also may need to move a session because a model is retired, a
service is down, a price changes, a policy blocks the next request (hello
fable), a confidential phase must run locally, or an auditor needs to
reconstruct what happened.  Agents are also making sessions much longer.  A
coding or research session can accumulate days of decisions and evidence and a
personal assistant may accumulate session transcripts going back years
(presumably as we don't have them for that long yet).

The option to leave also creates discipline.  If a provider knows that a user
can continue elsewhere, it has to compete on model quality, price, reliability,
and trust.  If the user's accumulated context can only be interpreted by one
provider, it sets very unfortunate incentives.

## What a Portable Inference API Should Promise

We would like inference providers and agent builders to adopt a small set of
rules.

1. **The local event log is canonical.** Server storage may mirror or accelerate
   it, but the client can reconstruct the session without dereferencing server
   IDs.
2. **Storage is explicit.** `store: false` should be easy, documented, and
   preferably the default.  Features that require retention should say so at the
   point of use.
3. **No opaque item is the sole carrier of meaning.** Encrypted reasoning,
   compaction, and tool signatures may be included for same-provider quality,
   but each has a readable, provider-neutral handoff representation.
4. **Hosted tools have full-fidelity logs.** Record exact inputs, outputs,
   evidence, filtering, provenance, timestamps, and content hashes — not only a
   polished answer and citations.
5. **Subagent communication is auditable.** Persist the exact readable task,
   messages, results, lineage, model, and tool permissions for every agent.
6. **Compaction is inspectable.** Return a readable summary, the instructions
   used to create it, and enough lineage to understand what was discarded.
7. **Artifacts are exportable.** Files, container outputs, search snapshots, and
   generated media can be downloaded into a content-addressed local archive.

## Distillation Is Great Actually

There is a related form of lock-in at the model layer.

Some of the largest closed-weight US labs are increasingly hostile to outside
distillation.  Anthropic's [February 2026
post](https://www.anthropic.com/news/detecting-and-preventing-distillation-attacks)
about alleged campaigns by DeepSeek, Moonshot, and MiniMax calls them
"distillation attacks".  Its commercial terms say customers own their outputs,
but prohibit using the service to train a competing AI model.  At the same time,
Anthropic's own post acknowledges that "distillation is a widely used and
legitimate training method" when frontier labs use it on their own models.

Anthropic uses robots to gather data from the public web for model development
and they famously cut up books to scan them.  OpenAI similarly says it trains on
freely accessible public internet content and has argued that training on
publicly available internet materials is fair use.  Both companies describe
distillation as a normal way to produce smaller models when it happens inside
their own walls.  OpenAI has also offered an explicit [first-party API
distillation workflow](https://openai.com/index/api-model-distillation/) for
using outputs from a stronger OpenAI model to fine-tune a smaller OpenAI model.

The moral asymmetry is still hard to miss.  The labs ask society to accept that
machines may learn from the enormous body of work humans placed on the
internet — often without advance, individual permission — while insisting that other
machines must not learn from outputs the labs generate.  The broadest version of
that principle conveniently allows learning to flow into closed models but not
back out of them.

We think the default attitude toward distillation should move from hostility to
support.  Distillation can turn expensive frontier capability into smaller,
cheaper, faster models that can run locally, offline, on constrained hardware,
or under the user's control.  It can increase competition, preserve capability
when an API disappears, and reduce the compute and energy required for common
tasks.

## The Minimum Freedom

A user should be able to close an account, keep a session, and hand it to another
model.  The new model may disagree, ask questions, or perform worse.  It should
not be staring at ciphertext where the old model saw the user's history,
evidence, plans, and delegated work.

We do not object to providers building better stateful APIs.  We object to
better performance being coupled to less user control.  Stateful storage should
be optional, hosted tools should be observable, compaction should be readable,
agent communication should be auditable and ideally opaque reasoning is not
opaque or at least should have a portable handoff.  Distillation should be a
path by which capability becomes more available, not a taboo used to justify
ever higher walls.
