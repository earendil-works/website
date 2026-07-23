---
title: Prompt Caching In Agents
description: How prompt caching shapes the cost, latency, tools, and architecture of coding agents, and what Pi does to keep cache behavior visible.
template: updates
aria_label: Earendil posts
from: Earendil Engineering <rfc@earendil.com>
to: You
date: Wed, 22 Jul 2026 20:25:52 +0200
subject: Prompt Caching In Agents
---

Large language models are often thought of like functions: send in some text,
receive some text.  That is a useful abstraction, but it ignores one of the most
important parts of running a coding agent: most of the input is the same as last
time.  In other words we mostly append to it.

A coding agent sends the model its system prompt, tool definitions, project
instructions, conversation history, tool calls, and tool results.  On the next
turn it sends almost all of that again, plus a small amount of new material.
Once a session has grown to tens or hundreds of thousands of tokens, recomputing
the whole prompt for every turn is slow and expensive.

Prompt caching is what makes this somewhat economic, but it is also quite
fragile.  A changed tool definition, a model switch or a provider routing
decision can turn what one would expect to be a cheap incremental request into a
full replay of the context.

For coding agents, cache behavior is therefore not just an implementation detail or
optimization.  It affects latency, cost, tool design, session design, and even
which product features should be made available.

## What a KV Cache Contains

A transformer processes a prompt in two broad phases.  During **prefill**, it
reads the input tokens and computes attention state for them.  During **decode**,
it produces new tokens one at a time.

At each attention layer, every processed token produces a key and a value. These
are not quite like key-value lookups in a hash table: both are arrays of
numbers, usually floats or lower-precision quantized values.  When processing a
new token, the model compares that token's **query** with the earlier **keys**
to determine how relevant each earlier token is.  It then uses those relevance
scores to form a weighted mixture of the corresponding **values**.  In that
sense, a key is what the model matches against, while a value is the information
it retrieves (but the lookup is fuzzy rather than "returning a single exact
match" like a dictionary lookup.)

Those keys and values are retained so that the next generated token can attend
to everything that came before without recomputing the earlier tokens. This
retained state is the **KV cache**.

Conceptually, a request looks like this:

```text
◊request 1:

◊[system]◊[tools]◊[user]◊[assistant]◊[tool result]◊[user]
◊<--------------------- prefill -------------------->
◊                       |
◊                       K and V tensors per token and layer

◊request 2:

◊[system]◊[tools]◊[user]◊[assistant]◊[tool result]◊[user]◊[new]
◊<---------------- reusable prefix ---------------->◊<--->
◊                                                    |
◊                                                    new work
```

The real representations are more complicated, model-specific, and "quite"
large.  The important property is that they correspond to a particular token
prefix.  Two prompts that mean the same thing but tokenize differently do not
share a KV cache.  If a token changes in the middle, everything after that token
is a different continuation.

Prompt caching extends the lifetime of this state beyond one generation.  When
the next API request from the coding agent begins with the same tokens, the
inference system can reuse the stored work for the matching prefix and prefill
only the new suffix.  So far, the theory.

## Where the Cache Lives

In order for a cache to work it needs to be stored somewhere, and it needs to be
addressable.  There are two broad ways inference systems make KV caches
available to a later request.

The simpler approach is **session affinity**.  It works by keeping the KV cache
on or near the GPU that computed it, and routing the next request back to the same
worker.  A session ID or prompt-cache key becomes a trivial routing hint and so
you can potentially even deal with this problem on the HTTP load balancer level
without having to look into the payload.

```text
◊request(session-42) ◊--> router ◊--> worker 7 ◊--> GPU 7 KV cache
◊next(session-42)    ◊--> router ◊--> worker 7 ◊--> GPU 7 KV cache
```

This avoids moving a very large cache over the network.  It is fast when it
works, but it constrains scheduling.  The selected worker can become overloaded,
restart, or evict the entry.  A router may also decide that balancing the fleet
is more important than preserving one session's cache.  It is however a very
attractive solution because it works with little extra deployed infrastructure
and hardware.

The other approach is to **distribute the cache**.  KV blocks can be stored in
another memory tier or made available across workers, so a request is not tied
as tightly to one GPU.

```text
◊                         +--------------------+
◊request ◊--> scheduler ◊-->| worker 3 / GPU 3   |
◊             |           +--------------------+
◊             |
◊             +----------> distributed KV blocks
◊             |
◊             +----------> worker 9 / GPU 9
```

That improves scheduling flexibility and recovery, but moving, indexing, and
retaining KV blocks is itself a systems problem.  Implementations mix GPU memory,
host memory, local storage, remote storage, prefix-aware routing, and eviction
policies in different ways.

To put KV caches into perspective: they can be large but they are in some ways
smaller than one would assume.  With various tricks, the size of KV caches can
be reduced to a handful of gigabytes, even for long conversations.

## Caches and Prefixes

Pi sessions are trees, not lists.  `/tree` can move the active conversation back
to an earlier point and continue along another branch.  A rewind can discard the
active suffix without deleting it from the session file.  A new branch can share
most of the old context, a little of it, or effectively none of it.  This design
is not unique to Pi, quite a few coding agents have something at least
conceptually similar.  Even if you do not represent the session as a tree,
it's not uncommon for agents to have some form of rewinding.

```text
◊                             +-- E -- F  another branch
◊                             |
◊session S: root ◊-- A ◊-- B ◊-- C ◊-- D  current branch
◊                   |
◊                   +-- Z  branch near the start
```

All three branches can have the same Pi session ID.  From the router's
perspective they are one session.  From the prompt cache's perspective they are
three token sequences with only partial prefix overlap.

If the cache keeps reusable prefix blocks, jumping from `D` to `F` may still
reuse `root -> C`.  If it only retains the hottest continuation, if the shared
blocks were evicted, or if the request is routed elsewhere, the hit can be much
smaller.  Jumping to `Z` may preserve only the system prompt and initial tool
definitions even though it starts from `A`.  The precise cache management
behavior here depends greatly on the providers.

The reverse can also happen. `/fork` or a new session can produce a new session
ID while carrying over a large amount of identical context.  A routing system
that isolates caches by session key may fail to notice that useful overlap.

The reusable prefix determines what work can be cached.  Session identity merely
helps the infrastructure find likely content.  On some systems the routing key
is crucial to manage caches, on others it's merely an optimization.

## Explicit vs Automatic Prefix Caching

Provider APIs expose caching in two main styles.

Anthropic's traditional interface uses explicit `cache_control` points.  The
client marks boundaries after stable parts of the request, such as the system
prompt, tool definitions, or the latest cacheable conversation content.  The
server can then write or look up the prefix ending at those points.  The boundary
is explicit, but reuse still requires the content before it to match.  Not only
are the cache points explicit, so is the pricing.  You pay for cache writes, and
you get to choose for how long which comes at different price points.

Other APIs use automatic prefix caching.  The client sends the request normally,
and the provider finds a reusable prefix without client-placed breakpoints.  A
prompt-cache key or session header may improve routing or grouping, but it does
not make different prefixes equal.

## Why Tool Loadouts Trash Caches

Tool definitions usually appear before the conversation and they are "folded"
into the system prompt internally.  Their names, descriptions, and JSON schemas
are model input just like any other text.  Adding one tool, removing one,
changing its schema, or even serializing the tools in a different order can move
the first mismatch close to the start of the prompt.

```text
◊turn 1: ◊[system]◊[read]◊[write]◊[bash]◊[conversation...........]
◊turn 2: ◊[system]◊[read]◊[write]◊[bash]◊[deploy]◊[conversation...]
◊                                   |
◊                                   old conversation is now
◊                                   after a mismatch
```

This is a common surprise with plugin systems and MCP-style tool catalogs.
Loading a tool only when it becomes relevant sounds efficient because fewer
schemas are sent initially.  On most models, however, the newly expanded loadout
invalidates the cached conversation that follows it.  Saving a few tool-schema
tokens can cause tens of thousands of conversation tokens to be processed again.

Some newer model APIs support **additive tool loading**.  A tool can become
available at a specific tool result inside the transcript instead of being
inserted into the original tool list.  The old prefix remains unchanged:

```text
◊[system]◊[initial tools]◊[conversation]◊[new tool]◊[next turn]
◊<--------- cached prefix ----------->
```

Pi nowadays supports this for models with native deferred-tool mechanisms.  When
an extension makes a purely additive change with `setActiveTools()`, Pi records
the added names on the tool result.  For supported Anthropic models it uses
deferred definitions and a `tool_reference` and for supported OpenAI models it
emits the corresponding tool-search items.  Other models get a safe fallback: Pi
sends the complete active tool list on the next request, which works
functionally but may wipe the prompt cache.

The word **additive** matters as removing tools, replacing one loadout with
another, or changing prompt snippets still changes earlier input.  An extension
that rebuilds the system prompt, shuffles tool order, injects timestamps, or
changes active tools every turn can accidentally defeat caching for the entire
session.

Extensibility means Pi cannot guarantee cache stability on behalf of every
extension.  We can provide cache-friendly mechanisms; extensions still have to
use them and from what we have seen, for many extensions cache efficiency is an
afterthought.  This is, in part, because when you pay on a fixed subscription the
associated cost with cache misses is not quite as obvious.

## Interruptions and TTLs

Some important prompt caches have short default lifetimes.  Anthropic's default
five-minute cache is particularly important because it is shorter than many
normal coding activities.  If you go to sip a coffee when using Fable, and you
come back 10 minutes later, a single "say hi" message will cost you more money
than you expect.

That's because while the user may think of a coding session as continuously
active, the inference provider sees a sequence of isolated requests:

```text
◊model request ◊--> run tests for 7 minutes ◊--> model request
◊                  no cache traffic here
```

A long build, a test suite, lunch, a meeting, or simply stopping to review a
diff can outlive the cache.  The next request contains the same prompt, but the
stored KV state is gone and the prefix is billed again as input.

Since Pi is currently not a permitted harness on Anthropic's subscription we're
following the 5 minute default that Anthropic recommends for API users.  However
from looking at Claude Code's codebase we know that for their own subscription
users, they are increasing that cache timeout to one hour.  The increased cost
of this however often is not worth it, when you need to pay API token prices.

But you can opt into this.  Some providers such as Anthropic expose longer
retention controls.  For supported direct APIs, Pi users can set
`PI_CACHE_RETENTION=long` to request them.  That is still only a request: Pi
cannot force a gateway to retain an entry, prevent eviction under memory
pressure, or keep a cache alive while no model request is being made.

## The Price of a Miss

Providers usually price uncached input, cache writes, and cache reads
differently.  Cache reads are commonly discounted because the expensive prefill
work has already happened.  Cache writes can carry a premium because the provider
is promising to retain state for later use.

Imagine a coding session with 100,000 tokens of history followed by a short new
request as the Fable example above.  When the cache works, almost all of that
history is charged at the lower cache-read price.  Only the small amount of new
material needs to be processed at the regular input price and potentially
written to the cache.

When the cache misses, the provider has to process the entire 100,000-token
history again at the regular input price.  It may also charge to write that
history back into the cache.  This is why a short request such as `continue` can
be surprisingly expensive after a cache expires.  In a long coding session,
re-reading the old input can cost much more than generating the next answer.

Caching also has a chance to create non-obvious incentives.

The user should want high hit rates because they reduce latency and price.  An
inference operator that owns the GPUs should want them too: less prefill work
means more requests served with the same hardware.  A well-designed cached-token
discount can align both sides while leaving the operator with better margins.

A gateway or reseller can have a different incentive.  If it earns revenue from
input tokens billed at the uncached rate, a cache miss can produce a larger
customer invoice than a hit.  Whether that also produces more profit depends on
its upstream costs, contracts, and who operates the cache.  In a badly aligned
stack, the party responsible for routing may not bear the full cost of misses,
while the party billing the user earns more revenue when they happen.

That does not mean providers sabotage caches but it means cache performance
should be observable.  Users should not have to infer that only from a
surprisingly large bill.  Understanding if something odd is going on with caches
can be an important insight.

Strict cache adherence also means less flexibility for a gateway to route you to
the best option in-between turns.  You might want to take a cache hit to continue
with a different model which from that point onwards might be more economical,
or it might be the case that you might be better off load balancing to another
provider.

## Why Pi Does Not Prune Aggressively

Now that you've made it this far, you probably have an idea why Pi does not prune
tool calls.  It is tempting to control cost by continuously deleting old tool
results or rewriting history and sometimes that is necessary, especially near
the context-window limit.  But as we have learned, pruning has a cache cost of
its own.

Deleting content from the middle changes the prefix at the deletion point.  All
surviving conversation after it may need to be processed again.  The immediate
cost of rewriting a long cached context can exceed the future savings from
removing a small number of cheaply cached tokens.

A rough break-even comparison is:

```text
◊one-time rewrite cost
◊    ~= surviving tokens after the edit * (uncached price - cache-read price)

◊future savings per turn
◊    ~= pruned tokens * cache-read price
```

This is not only an accounting question as old tool results often contain the
evidence the model used to make later decisions.  Removing them can degrade
behavior even if a summary preserves the gist.

Pi therefore prefers a stable, append-oriented transcript and does not treat
every old token as waste.  Compaction is available when context pressure
justifies a lossy rewrite.  Because compaction deliberately creates new context
rather than accidentally re-billing an unchanged prompt, Pi treats it as a cache
reset rather than a cache failure in its session statistics.

The goal is not the smallest possible prompt but the best trade-off among model
context, cache reuse, latency, and price.

Simultaneously there can be a case for pruning too.  If you are working with
providers that do not discount you for good cache usage, or it's for whatever
reason not possible to get high cache rates, it might be preferable to prune.
It definitely improves the opportunity for the router to balance between
different backends as caches are not transferable.

## What Pi Can and Cannot Do

Pi works to keep stable inputs stable.  It passes a consistent session ID and
provider-specific cache hints, places explicit cache points for APIs that
require them, records cache-read and cache-write usage, and supports
message-anchored additive tool loading where models allow it.  Its default
transcript behavior also avoids gratuitously rewriting old context.

Pi cannot control every layer after the request leaves the machine.  It cannot
choose a provider's eviction policy, extend a cache beyond what the API permits,
keep a particular GPU alive, or guarantee that a gateway honors affinity.  It
also cannot preserve a prefix that an extension changes.

What it can do is make cache health visible.

The interactive footer shows cumulative cache reads and writes as `R` and `W`,
plus `CH` for the latest request's cache-hit rate.  The `/session` command gives
a fuller view: total cached and uncached input, cumulative hit rate, cost, and
an estimate of tokens and dollars re-billed by [significant cache misses](https://github.com/earendil-works/pi/blob/34f3719a942ecbf3e6d23e67098f47ba2867de0a/packages/coding-agent/src/core/cache-stats.ts#L50-L90).

```
◊Messages
◊Total: 178
◊User: 6
◊Assistant: 58
◊Tools: 114 calls, 114 results

◊Tokens
◊Input: 7,129,883
◊  Cached: 6,776,832 (95.0%)
◊  Uncached: 353,051
◊Output: 30,013
◊Total: 7,159,896

◊Cost
◊Total: $6.054
◊Cache Re-billed: $0.728 (161,744 tokens, 2 misses)
```

Users who want misses called out as they happen can enable **Show cache miss
notices** in `/settings`, corresponding to `showCacheMissNotices` in
`settings.json`.  Pi then inserts a warning after a significant miss, including
the estimated re-billed tokens and cost.  When it can observe a model switch or
an idle gap beyond the usual short TTL, it says so.  For other misses it reports
the fact without pretending to know what happened inside the provider.

## Common Reasons for Worse Cache Performance

When a session's cache-hit rate looks wrong, the usual causes are:

1. **Idling.** A command, review, or conversation pause exceeds the provider's retention window.
2. **Model or provider switches.** KV state is model-specific and generally does not move across providers.
3. **Branch navigation.** `/tree`, rewinds, forks, and alternate branches can change the active token sequence even when the session ID remains the same.
4. **Compaction or manual history rewriting.** These intentionally replace part of the prompt and establish a new prefix.
5. **Tool and reasoning level changes.** Adding, removing, reordering, or editing tool definitions changes an early part of the request unless the model supports message-anchored loading and the change is purely additive. Reasoning level changes usually have the same effect.
6. **Dynamic system prompts.** Timestamps, random values, changing project context, and extension-provided prompt snippets can invalidate everything after them.
7. **Extension context transforms.** An extension that modifies old messages or provider payloads can make an apparently stable Pi transcript unstable on the wire.
8. **Provider routing and eviction.** The prompt can be identical and still miss because the relevant KV blocks are no longer available where the request lands.
