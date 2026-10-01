---
title: Pi Durable
description: Pi Durable is a new experimental package for long-running, durable, and malleable agents that can run anywhere. A tour of what we built and why.
template: updates
aria_label: Earendil posts
from: Earendil Engineering <rfc@earendil.com>
to: You
date: Thu, 1 Oct 2026 00:01:00 +0200
subject: Pi Durable
---

Today Earendil and the Pi community [shipped Pi 1.0](/posts/pi-1-0/). This
reflects our belief that after countless hours of hardening, maintenance, and
active development, Pi is now a solid foundation on which to build. Pi also
continues to evolve. Together with Pi 1.0, we are shipping an experimental new
package called Pi Durable. Pi Durable was built specifically for long-running,
durable, and malleable agents that can run anywhere. We would like you to join
in the fun and help us make it the best durable harness there is.

## Why Pi Durable?

Pi the coding agent is built to run on your (remote) machine, inside a terminal,
driven by one person. If the process dies, you look at what happened and tell it
to continue. That is what Pi 1.0 focuses on and excels at, and that is not
changing.

At Earendil, we want to bring this technology to everyone, in whatever form fits
their needs best. For that, we need a harness that runs anywhere, can be reached
from different surfaces, supports infinitely long conversations, survives
catastrophic internal and external failures, and lets multiple humans steer the
same agents.

Pi Durable is that harness. It does not replace the Pi coding agent. It is a
framework for building any agentic application, coding agents included. It
shares not only code with the Pi coding agent, like pi-ai, but also its
principles: minimalism and malleability.

It also lets us explore designs in this space without disrupting Pi the coding
agent. Lessons we learn building agentic applications on Pi Durable will flow
back into Pi the coding agent as they prove themselves valuable.

## What is a harness?

Everybody has their own definition of a harness. We [wrote about this
previously](/posts/what-is-a-harness/), but let us reintroduce the concept of
the harness for Pi Durable.

A harness is storage plus the machinery needed to run one or more conversations
with large language models in parallel. It provides the tools those models call,
and the execution environments the tools run in.

A conversation is an interaction between you and an agent, recorded as a
transcript. The agent is the large language model together with its settings,
like the thinking level, and the tools it can call.

Tools do their work through an execution environment, which can be your laptop,
a remote VM, or an in-memory sandbox. Which tools and which execution
environment an agent gets is up to each conversation.

Everything the harness runs, from calling the model to executing a tool, is a
task.

Like everything in Pi, Pi Durable is built so your agent can understand it. The
entire source code, without tests, is about 15,000 lines, which comes out to
about 150,000 tokens with GPT and about 250,000 with Claude. That's the worst
case. To build on Pi Durable, your agent rarely needs all of it; the storage
backends alone are 3,000 lines it can usually skip.

Now let us give you a little tour of Pi Durable, to illustrate what we built and
why we built it.

## Long runs anywhere

We want agents to run for a long time and to be able to run anywhere, where
anywhere currently means anywhere there is a JavaScript runtime.

In Pi Durable, a harness opens over a storage backend. Pi Durable ships memory,
SQLite, and JSONL storage, plus a conformance suite and benchmarks for your own
backend. The SQLite and JSONL storage code uses no Node APIs, so with a small
adapter it runs on Bun or inside a Cloudflare Durable Object. The storage
interface is small and easy to implement on top of whatever you have, like a
key-value store or Postgres. One process owns a storage at a time, and other
clients attach to that process.

On SQLite, the harness only keeps the working set in memory: the active
transcripts, live tasks, and pending submissions. Everything else stays on disk
until it is needed. Active transcripts are naturally bounded by the model's
context window, because compaction summarizes older messages before they
overflow it. So even a conversation with tens of thousands of messages fits
snugly into memory.

Tools that need files or a shell get them from an execution environment. Pi
Durable ships a Node execution environment, which gives tools access to your
local files. Like storage, the execution environment interface is small and easy
to implement, so you can also expose remote execution environments to your
tools. That allows the harness to run on one machine while its tools run on
another. Your `env` function builds the environment for every tool call, from
the conversation's working directory, so each conversation can run in a
different place.

```typescript
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import {
    openNodeSqliteStorage,
} from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";

const context = BACKGROUND_CONTEXT; // every call takes a context for cancellation
const models = createModels();
models.setProvider(openaiProvider());

const registry = createRegistry();
registry.install(CodingTools); // read, write, edit, bash

const env = ({ cwd }: { cwd?: string }) =>
    new NodeExecutionEnv({ cwd: cwd ?? process.cwd() });
const harness = await Harness.open(
    await openNodeSqliteStorage("./agent.sqlite"),
    { models, registry, env },
    context,
);
// The root conversation: created on first use, and the same one after every
// restart.
const root = await harness.root(context, {
    agent: {
        model: { provider: "openai", modelId: "gpt-6.1-sol" },
        cwd: "/work/repo",
    },
});
```

## Survives crashes

We want an agent to survive its process dying, whether the laptop sleeps, the
container is redeployed, or the machine runs out of memory, and to pick up where
it left off.

In Pi Durable, every step of a run is a task that stores a checkpoint before it
moves on. If the process dies, a new process opens the same storage, finds the
unfinished tasks, and continues each one from its last checkpoint. A model
request that was cut off is sent again; the partial answer stays in the
transcript, marked as aborted. A tool call that was cut off reruns if it is safe
to; otherwise the model is told it was interrupted. Pi Durable has no built-in
subagents, but they take a few lines of code to build, as the triage tool below
shows. A subagent runs in a conversation of its own, so it continues from where
it left off too, and a subagent tool that is safe to rerun finds its subagent
again and waits for its answer. Queued messages are still queued. A `requestId`
makes a submission exactly-once, so a client that retries after a crash gets the
original submission back instead of asking twice.

```typescript
const job = {
    type: "input",
    content: "Fix the flaky login test",
    requestId: "job-42",
} as const;
await root.submit(job, context);
// The process dies here, in the middle of a tool call.

// A new process opens the same storage.
const harness = await Harness.open(
    await openNodeSqliteStorage("./agent.sqlite"),
    { models, registry, env },
    context,
);
harness.resume(); // continue the interrupted run
const root = await harness.root(context);
// the same submission, answered
const settled = await (await root.submit(job, context)).wait(context);
```

## Many conversations at once

We want one harness to run many conversations at the same time, without one
blocking another.

In Pi Durable, one harness runs as many conversations as you need, concurrently,
all with the same guarantees. A conversation starts fresh or forks another one
at any point in its transcript, and sees the parent's history up to that point
without copying it.

Think of a Slack channel where your agent answers mentions from anyone. Then
somebody opens a thread. The channel can be one conversation, and the thread a
fork of it at the message the thread replies to. Both run at the same time and
neither blocks the other.

```typescript
const channel = await harness.root(context);
const question = await channel.submit(
    { type: "input", content: "@agent why did the deploy fail?" },
    context,
);
const answered = await question.wait(context);

// Someone replies to the agent's answer in a thread. Every conversation names
// its owner, which decides what an abort reaches (more on that under Tasks).
// The thread has none.
const thread = await channel.fork(
    answered.answer!,
    { ownership: { kind: "ownerless" } },
    context,
);

// Both conversations work at the same time.
const inThread = await thread.submit(
    { type: "input", content: "@agent can we roll it back?" },
    context,
);
const inChannel = await channel.submit(
    { type: "input", content: "@agent who is on call today?" },
    context,
);
await Promise.all([inThread.wait(context), inChannel.wait(context)]);
```

Each conversation also stores its own agent: the model, the thinking level, the
selected extensions and which of their tools are active, extra instructions, and
the working directory in its execution environment. A reviewer next to the main
agent can use a cheaper model, read-only tools, and its own checkout.

## Extensions

We want everything an agent can do to be pluggable, and every plugged-in piece
to take part in durability.

In Pi Durable, an extension is a named bundle of system prompt sections, tools,
hooks, and tasks. The application installs extensions in a registry. Each
conversation selects which extensions and tools it uses, and stores only their
names.

### System prompt sections

The system prompt is rebuilt from the sections of the conversation's extensions
before every request, so a changed section is picked up by the next request. Pi
Durable records what changed in the transcript, at the position where it
changed, so a restart or a fork sees exactly what the model saw. On models that
support system prompt and tool changes in the middle of a conversation, only the
change is sent, so the prompt cache stays valid.

```typescript
import { defineExtension, section } from "@earendil-works/pi-durable";

const ProjectContext = defineExtension({
    name: "project-context",
    sections: [
        // Read from the conversation's execution environment. The files can be
        // loaded and watched in the background; every request renders the
        // latest state.
        section("agents_md", (input) => agentsMd.latest(input.env)),
        section("skills", (input) => skills.latest(input.env)),
    ],
});
```

### Tools

Every tool call runs as its own durable task, and its intent is stored before it
runs. After a crash, a tool reruns only if it says that is safe. Otherwise the
model is told the call was interrupted, with the output stored so far, and
decides what to do. Each conversation can also get its own set of tools, like
the Slack thread from earlier, which may search but not deploy.

```typescript
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";

const searchIssues = defineTool({
    name: "search_issues",
    description: "Search the issue tracker",
    parameters: Type.Object({ query: Type.String() }),
    replay: "safe", // only reads, so a rerun after a crash is fine
    execute: async (args, api) => {
        // streamed to every client watching
        api.output(`searching for ${args.query}\n`);
        return {
            content: [{ type: "text", text: await tracker.search(args.query) }],
        };
    },
});

const deploy = defineTool({
    name: "deploy",
    description: "Deploy a version to production",
    parameters: Type.Object({ version: Type.String() }),
    // No replay: a deploy interrupted by a crash is reported to the model,
    // never repeated.
    execute: async (args) => ({
        content: [{ type: "text", text: await ci.deploy(args.version) }],
    }),
});

registry.install(defineExtension({ name: "ops", tools: [searchIssues, deploy] }));

// The thread may search, but not deploy.
await thread.configure({ tools: { remove: [deploy] } }, context);
```

A tool gets the harness API for its call: it can commit entries and documents,
start tasks and conversations, and talk to other conversations. That makes a
subagent a few lines of code. A tool creates a conversation it owns, gives it a
smaller model and its own instructions, and waits for its answer. The subagent
is a conversation like any other, so it survives a crash, counts its own cost,
and a UI can show it under the call.

```typescript
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { AssistantEntry, configure } from "@earendil-works/pi-durable";

const triage = defineTool({
    name: "triage",
    description: "Label an incoming issue as bug, feature, or question",
    parameters: Type.Object({ issue: Type.String() }),
    // a rerun after a crash finds the same subagent and the same submission
    replay: "safe",
    execute: async (args, api, context) => {
        const child = await api.commit(async (tx) => {
            const existing = (
                await tx.scanConversations({ ownerTaskId: api.taskId }, 1)
            ).items[0];
            if (existing !== undefined) return existing.id;
            // Owned by this call, so aborting the call aborts the subagent.
            const created = await tx.createConversation({
                ownership: { kind: "task", taskId: api.taskId },
            });
            // It starts as a copy of this conversation's agent. Make it a small
            // model without tools.
            await configure(tx, created.id, {
                model: { provider: "openai", modelId: "gpt-6-luna" },
                tools: [],
                instructions: "Answer with one word: bug, feature, or question.",
            });
            return created.id;
        }, context);
        // lets a UI show the subagent under the call
        await api.details({ conversationId: child }, context);
        const subagent = await api.conversation(child, context);
        const request = {
            type: "input",
            content: args.issue,
            requestId: `triage:${api.taskId}`,
        } as const;
        const settled = await (
            await subagent!.submit(request, context)
        ).wait(context);
        // The answer is an entry in the subagent's transcript. Read it and take
        // its text.
        const entry = await api.commit(
            (tx) => tx.entry(AssistantEntry, settled.answer!),
            context,
        );
        const message = entry?.model?.[0] as AssistantMessage;
        const text = message.content
            .flatMap((content) => (content.type === "text" ? [content.text] : []))
            .join("");
        return { content: [{ type: "text", text }] };
    },
});
```

Extensions can also change other extensions' tools. A tool with the same name in
a later extension replaces the earlier one, for example a bash that runs inside
a Python virtualenv. A wrap decorates whichever tool won, wherever the wrapping
extension is selected.

```typescript
import { wrapTool } from "@earendil-works/pi-durable";
import { createBashTool } from "@earendil-works/pi-durable/tools";

// Times every bash call, whichever bash the conversation ends up with.
const Timing = defineExtension({
    name: "timing",
    wraps: [
        wrapTool(createBashTool(), (bash) => ({
            ...bash,
            execute: async (args, api, context) => {
                const start = Date.now();
                try {
                    return await bash.execute(args, api, context);
                } finally {
                    metrics.record("bash", Date.now() - start);
                }
            },
        })),
    ],
});
```

### Hooks

Hooks let extensions step into tasks, including the built-in tasks for
generating a model response, invoking a tool, or performing compaction. They can
rewrite a request before it goes to the model, block or rewrite a tool call,
replace a result, keep a run going, or write a summary themselves. A hook can
run again after a crash, so a hook that makes a decision stores it in a memo: a
small value stored with the task, where the first write wins.

```typescript
import { hook, ToolTask } from "@earendil-works/pi-durable";

const Approval = defineExtension({
    name: "approval",
    hooks: [
        hook(ToolTask, {
            beforeTool: async (call, api, context) => {
                if (call.name !== "deploy") return undefined;
                // After a restart, the hook finds the stored answer instead of
                // asking again.
                let approved = await api.memo<boolean>(
                    "approval:deploy",
                    context,
                );
                approved ??= await api.memo(
                    "approval:deploy",
                    await askInSlack(call),
                    context,
                );
                return approved
                    ? undefined
                    : { block: "Nobody approved the deploy." };
            },
        }),
    ],
});
```

Several extensions can hook the same thing. Their hooks run as a chain, in the
order the conversation selects the extensions, and each hook defines how its
chain runs. `beforeTool` passes rewritten arguments down the chain, and the
first block stops it. `afterTool` passes the result down the chain. `onYield`
stops at the first hook that keeps the run going. Observers like `afterResponse`
always run them all. A hook that throws is reported, and the chain continues,
except in `beforeTool`, where a throw blocks the call.

### Tasks

The harness runs conversations with built-in tasks: one for each model request,
one for each tool call, and one for compaction. Extensions bring their own tasks
and get the same machinery: a checkpoint after every step, timers that survive
restarts, and waiting on other tasks.

A checkout that splits the bill across several cards charges every card at once.
If one card is declined, the other payments are aborted and refund themselves:

```typescript
import { defineTask, type TaskId } from "@earendil-works/pi-durable";

const Payment = defineTask<{ card: string }, { phase: "charge" }, string>({
    name: "shop.payment",
    version: 1,
    initial: () => ({ phase: "charge" }),
    phases: {
        charge: async (task, runtime, context) => {
            // The key makes the charge idempotent: if a crash reruns this
            // phase, the card is only charged once.
            const charge = await bank.charge(
                task.input.card,
                `payment-${task.id}`,
            );
            await runtime.commit(
                () => ({
                    status: "terminal",
                    outcome: charge.ok
                        ? { status: "completed", result: charge.receipt }
                        : { status: "failed", error: { message: charge.error } },
                }),
                context,
            );
        },
    },
    // Another payment failed, or the checkout was cancelled: undo this one.
    abort: async (task, runtime, context) => {
        await bank.refund(`payment-${task.id}`);
        await runtime.commit(
            () => ({ status: "terminal", outcome: { status: "aborted" } }),
            context,
        );
    },
});

type CheckoutState =
    | { phase: "pay" }
    | { phase: "decide"; payments: TaskId<string>[] };
const Checkout = defineTask<{ cards: string[] }, CheckoutState, string>({
    name: "shop.checkout",
    version: 1,
    initial: () => ({ phase: "pay" }),
    phases: {
        pay: async (task, runtime, context) => {
            await runtime.commit(async (tx) => {
                const payments: TaskId<string>[] = [];
                for (const card of task.input.cards) {
                    payments.push(
                        await tx.createTask(Payment, { card }, {
                            ownership: { kind: "task", taskId: task.id },
                        }),
                    );
                }
                // Run no code until every payment is done. The first failed
                // payment aborts the others.
                return {
                    status: "waiting",
                    checkpoint: { phase: "decide", payments },
                    on: payments,
                    policy: "failFast",
                };
            }, context);
        },
        decide: async (task, runtime, context) => {
            const outcomes = await runtime.outcomes(
                task.state.checkpoint.payments,
                context,
            );
            const paid = outcomes.every(
                (outcome) => outcome.status === "completed",
            );
            await runtime.commit(
                () => ({
                    status: "terminal",
                    outcome: paid
                        ? { status: "completed", result: "Order placed." }
                        : {
                            status: "failed",
                            error: { message: "A payment failed." },
                        },
                }),
                context,
            );
        },
    },
    abort: (_task, runtime, context) =>
        runtime.commit(
            () => ({ status: "terminal", outcome: { status: "aborted" } }),
            context,
        ),
});

// The agent starts a checkout with a tool.
const checkout = defineTool({
    name: "checkout",
    description: "Pay for the cart, split across several cards",
    parameters: Type.Object({ cards: Type.Array(Type.String()) }),
    execute: async (args, api, context) => {
        // Owned by this call: aborting the call aborts the checkout and refunds
        // its payments.
        const owner = {
            ownership: { kind: "task", taskId: api.taskId },
        } as const;
        const id = await api.createTask(
            Checkout,
            { cards: args.cards },
            owner,
            context,
        );
        const { outcome } = (await api.waitForTask(id, context)).state;
        const text =
            outcome.status === "completed" ? outcome.result : outcome.status;
        return { content: [{ type: "text", text }] };
    },
});

registry.install(defineExtension({
    name: "shop",
    tools: [checkout],
    tasks: [Payment, Checkout],
}));
```

Tasks and conversations form one ownership tree. Aborting a task aborts what it
owns, bottom-up, so every task cleans up its own effects first, and a task only
finishes once the work it owns has finished. A subagent is the same pattern: a
conversation owned by the tool call that started it.

Tasks are foreground by default: they are part of the conversation's current
work. The conversation is idle only once they are done, and aborting the
conversation, for example when the user presses Esc, aborts them and everything
they own. A background task belongs to the conversation, but not to its current
work. The conversation goes idle while it runs, and an ordinary abort leaves it
and everything it owns alone. That fits a subagent that should outlive the turn
that started it, or a reminder that fires tomorrow. Aborting the task itself, or
the conversation with `{ background: true }`, still stops it.

```typescript
// Part of the current work: Esc aborts it, and the conversation waits for it.
await api.createTask(
    Checkout,
    input,
    { ownership: { kind: "task", taskId: api.taskId } },
    context,
);

// Side work: the conversation goes idle while it runs, and Esc leaves it alone.
await api.createTask(
    Reminder,
    input,
    { ownership: { kind: "conversation" }, background: true },
    context,
);
```

## Compaction

We want long conversations to keep going without the agent stopping to
summarize.

In Pi Durable, compaction is a task like any other, and it runs while the
conversation keeps going. When the context gets close to the model's limit, a
background compaction summarizes the older messages, and the summary is placed
at the next turn boundary. The conversation only waits for a summary when the
next request would not fit otherwise. If the provider still rejects a request as
too long, the harness compacts and retries once. You can also compact manually
at any time, with your own instructions. The older messages always stay in
storage.

```typescript
const harness = await Harness.open(storage, {
    models,
    registry,
    settings: {
        compaction: {
            // past contextWindow - reserveTokens, the next request waits for a
            // summary
            reserveTokens: 16384,
            // this far before that, a summary starts in the background
            backgroundTokens: 32768,
        },
    },
}, context);

// Manual, also while the agent is working.
await root.compact("Keep the names of the failing tests", context);
```

`reset()` goes further: it starts a new context, optionally from a handoff note,
and a tool can ask for the same by returning `control: { handoff }`. Because
nothing is deleted, a second tool can still search everything before the
handoff. That is all it takes to build an agent that hands off to itself and
looks things up later.

```typescript
const handoff = defineTool({
    name: "handoff",
    description:
        "Start over from a handoff note. " +
        "Older messages stay searchable with search_history.",
    parameters: Type.Object({ note: Type.String() }),
    execute: async (args, api, context) => {
        // Queued behind the handoff, so it starts the next run in the new
        // context.
        const self = await api.conversation(api.conversationId, context);
        await self!.submit(
            {
                type: "input",
                content: "Continue.",
                requestId: `handoff:${api.taskId}`,
            },
            context,
        );
        // Ends this run and starts a new context from the note, like
        // reset(note).
        return {
            content: [{ type: "text", text: "Handing off." }],
            control: { handoff: args.note },
        };
    },
});

const searchHistory = defineTool({
    name: "search_history",
    description: "Search older messages, including those before a handoff",
    parameters: Type.Object({ text: Type.String() }),
    replay: "safe",
    execute: async (args, api, context) => {
        // Tools read records through a transaction too. One that writes
        // nothing stores nothing.
        const page = await api.commit(
            (tx) => tx.scanEntries({ conversationId: api.conversationId }, 200),
            context,
        );
        const hits = page.items.filter((entry) =>
            JSON.stringify(entry.model ?? []).includes(args.text),
        );
        const text = hits.map((entry) => JSON.stringify(entry.model)).join("\n");
        return { content: [{ type: "text", text }] };
    },
});
```

## Durable application state

We want the state of the application built on the agent to be as durable as the
conversation itself.

In Pi Durable, application state, like a todo list, a plan, a ticket, or the
sandbox a conversation runs in, lives in documents. Documents are typed JSON
stored next to the transcript and changed in the same atomic commits, so the
state never disagrees with the transcript that produced it. Each document says
what a fork starts with: the parent's value at the fork point, its current
value, or a fresh one.

```typescript
import { defineDoc } from "@earendil-works/pi-durable";

const Todos = defineDoc<{ items: string[] }>({
    kind: "app.todos",
    version: 1,
    scope: "conversation",
    history: "rewindable",
    fork: "asOf", // a fork starts with the todos its parent had at the fork entry
    initial: () => ({ items: [] }),
});

const Todo = defineExtension({
    name: "todo",
    tools: [
        defineTool({
            name: "todo",
            description: "Add an item to your todo list",
            parameters: Type.Object({ item: Type.String() }),
            execute: async (args, api, context) => {
                await api.commit(async (tx) => {
                    const todos = await tx.doc(Todos, api.conversationId);
                    todos.items.push(args.item);
                }, context);
                const text = `Added ${args.item}`;
                return { content: [{ type: "text", text }] };
            },
        }),
    ],
    // The model sees the list before every request.
    sections: [
        section("todos", async (input, context) => {
            const todos = await input.read.snapshot(
                Todos,
                input.conversationId,
                context,
            );
            return todos?.items.join("\n") || undefined;
        }),
    ],
});

// A UI subscribes to the committed value.
const todos = await harness.documentState(Todos, channel.id, context);
todos?.subscribe((value) => renderTodos(value?.items ?? []));
```

## Malleable

We want to change the code of a running agent without stopping it.

In Pi Durable, the registry can change while conversations run. Installing an
extension under a name that is already installed replaces it in one step. A tool
call that is already running finishes on the code it started with; the next call
uses the new code. Conversations store extension and tool names, never code, so
after a restart they pick up whatever the new process installs.

```typescript
// The extension's file changed on disk.
// same name "ops": replaces the installed one
registry.install(await loadExtension("./ops.ts"));
```

## Multiplayer

We want many people and clients to work with the same conversations at once:
watch them, join late, and steer them.

In Pi Durable, everything a UI needs is committed state, so any number of
clients can attach to any conversation in the harness. A client gets the current
view first: the transcript, the answer being streamed, running tools and their
output, queued messages, the agent, and usage. After that it only gets what
changes. A client that joins late or reconnects starts from the current view.
Any client can steer a running conversation or queue a follow-up.

```typescript
// A second client joins the thread while the agent is working.
const view = await thread.viewState(context);
render(view.value);
view.subscribe((value) => render(value));

// And steers it. The message joins the running work after the current tool
// calls.
await thread.submit(
    { type: "input", content: "Check the staging logs first", whenBusy: "steer" },
    context,
);
```

For a remote client, `thread.watch()` delivers the exact operations of every
commit, small enough to send over a socket. If you prefer the coding agent's
familiar events, `watchEvents()` turns the commits into those, at the cost of
more bytes on the wire.

TBD: Christian's Cloudflare demo video.

## Try it

You can try Pi Durable today. Pi Durable is experimental, and the API might
still change. Point your agent at `packages/durable` in a Pi checkout, have it
read the
[README](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md),
the over thirty
[examples](https://github.com/earendil-works/pi/tree/main/packages/durable/test/examples),
the [small coding agent on Pi
Durable](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/src/experimental/durable),
or this beautiful [vacation planning
agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/src/experimental/vacation),
and get building.

The vacation planner is about 1,300 lines of TypeScript, most of them the TUI.
If it looks like a coding agent, that's only because it borrows its TUI
components from the Pi coding agent.

<figure class="post-figure asciicast" data-asciicast="/static/posts/pi-durable/vacation.cast.json" data-asciicast-poster="0:17">
<ol class="asciicast__chapters">
<li data-start="0:00">A vacation planner with a TUI, built on Pi Durable.</li>
<li data-start="0:17.9">A subagent runs three searches in parallel, each a durable task.</li>
<li data-start="0:23.9">Meanwhile, the main agent is free to chat.</li>
<li data-start="0:38.6">The process dies. Weather and museums are done, trains is not.</li>
<li data-start="0:44.9">Restarted. <code>search</code> is safe to rerun: only trains runs again.</li>
<li data-start="0:48.9">Switch to the subagent and steer it.</li>
<li data-start="1:02.3">Back in main: ask, compact, and steer, all while it works.</li>
<li data-start="1:27">The report arrives as a message; main turns it into a plan.</li>
</ol>
</figure>

To run both demos from a Pi checkout:

```bash
npm install && npm run build
node packages/coding-agent/src/experimental/durable/main.ts
node packages/coding-agent/src/experimental/vacation/main.ts
```

To build on Pi Durable in your own project:

```bash
npm install @earendil-works/pi-durable @earendil-works/pi-ai @earendil-works/chord
```

In the coming weeks, we will talk more about Pi Durable and show you the small
agentic tools we build with it to help us work, like a Slack bot or a GitHub
triage bot. We don't want to spill the beans yet. There is more coming as we use
Pi Durable ourselves, just like we use Pi.

## FAQ

### Why TypeScript again?

Because it is the easiest way to bootstrap this. But as everybody knows by now,
it's very easy to port everything to Rust or assembler. We're not ruling this
out in the future, but at the moment we are focusing on TypeScript.
