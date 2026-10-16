---
title: Pi Durable on Cloudflare
description: Running Pi Durable on Cloudflare.
template: updates
aria_label: Earendil posts
from: Earendil Engineering <rfc@earendil.com>
to: You
date: Thu, 16 Oct 2026 13:45:00 +0100
subject: Pi Durable on Cloudflare
---

Many AI agents respond to user requests or other external events, do their work and then sit idle for long periods. Keeping a machine running around the clock wastes compute and quickly gets expensive.

Pi Durable is a harness designed for long-running agents. Read the [announcement](/posts/pi-durable/) explaining its concepts and storage model in detail. And Cloudflare Durable Objects offer a stateful objects that shut down when idle and start up again when a request, WebSocket message, or alarm arrives.

In this post we will build a chat agent that stores every session in its own Durable Object, manages multiple conversations per session, survives hibernation, wakes up for scheduled work, and uses a subagent to search across conversations.

We’ll run with 90s vibes for the interface but make it multiplayer because it’s 2026: multiple participants connected to the same chat session.

<figure class="post-figure post-video">
<video controls muted playsinline preload="metadata" width="1520" height="988" poster="/static/posts/pi-durable-on-cloudflare/multiplayer-poster.webp" aria-describedby="multiplayer-demo-caption" style="display:block;width:100%;max-width:100%;height:auto;margin-inline:auto">
<source src="/static/posts/pi-durable-on-cloudflare/multiplayer.mp4" type="video/mp4">
<source src="/static/posts/pi-durable-on-cloudflare/multiplayer.webm" type="video/webm">
<a href="/static/posts/pi-durable-on-cloudflare/multiplayer.mp4">Download the multiplayer demonstration.</a>
</video>
<figcaption id="multiplayer-demo-caption">Multiplayer chat agent built with Pi Durable. Both conversation events and application-defined presence updates share the same WebSockets.</figcaption>
</figure>

## One Pi session per Durable Object

A Pi Durable harness is scoped to one session. That maps naturally to one Durable Object instance addressed by the session ID. Its SQLite-backed storage persists session data, the Durable Object can hibernate while idle, and its alarm can wake it for pending work.

```
React client
    │ PartySocket
    ▼
Worker
    │ route by session ID
    ▼
SQLite-backed Durable Object instance
    ├── Hibernatable WebSockets
    ├── embedded SQLite database
    │       └── conversations and tasks
    └── Pi Durable Harness ──▶ Model provider

```

The Worker creates a session ID and returns a shareable URL that clients connect to over WebSockets. Everyone who opens the same session URL reaches the same object. Different session IDs address different objects with isolated state.

## Persist Pi session data in Durable Object storage

Pi Durable makes no assumption about where sessions are stored. You can bring your own storage backend if the built-in memory, JSONL or SQLite support is not exactly what you need. The SQLite implementation defines a runtime-neutral, asynchronous database interface and includes an adapter for Node.js, as well as an adapter for Cloudflare Durable Objects using the synchronous storage `SqlStorage` API through `ctx.storage.sql`.

```ts
await openDurableObjectSqliteStorage(ctx.storage)
```

If your requires rolling your own SQLite adapter or a different storage backend, use Pi Durable’s conformance suite to check that it behaves correctly. It works with any Vitest- or Jest-compatible test runner. For a Durable Object, use it with the [Cloudflare Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/):

```ts
registerStorageConformance(
  { describe, expect, it },
  "Cloudflare Durable Object SQLite",
  async (use) => {
    const stub = env.SESSIONS.get(env.SESSIONS.newUniqueId());
    await runInDurableObject(stub, async (_instance, state) => {
      await use(await openDurableObjectSqliteStorage(state.storage));
    });
  },
);
```

## Open Pi when the Durable Object starts

The harness gets initialized with the `Session` Durable Object. Cloudflare runs the constructor every time the object starts: when it gets first created, and again after hibernation or eviction when a request, alarm, or WebSocket message arrives. All events are held back until the initialization is complete.

```ts
export class Session extends DurableObject<Env> {
  #harness!: Harness;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(() => this.#initialize());
  }

  async #initialize(): Promise<void> {
    const storage = await openDurableObjectSqliteStorage(this.ctx.storage);
    const chatOptions = createChatHarnessOptions((timestamp) =>
      this.#setAlarmNoLaterThan(timestamp),
    );
    const harness = await Harness.open(
      storage,
      {
        ...chatOptions,
        onReport: (error) => reportError("Harness background task failed",
 error),
      },
      BACKGROUND_CONTEXT,
    );

    // A storage error closes the harness. Reset the object so the next event reopens it.
    void harness.closed.then((end) => {
      if (end.reason === "failed") this.ctx.abort("Harness failed");
    });

    try {
      this.#harness = harness;
      await this.#restoreEventStreams();
      await this.#refreshAlarm();
    } catch (error) {
      await harness.close(BACKGROUND_CONTEXT);
      throw error;
    }
  }
}
```

This is the minimum integration of the harness. The full implementation also streams live task activity to clients and tells them when a subagent conversation is created.

## Run multiple conversations in one shared session

The session is the durable boundary, but it is not one giant transcript. Chat participants can create independent conversations within the same session, or fork them from a committed user or assistant entry.

<figure class="post-figure post-video">
<video controls muted playsinline preload="metadata" width="1520" height="1282" poster="/static/posts/pi-durable-on-cloudflare/fork-poster.webp" aria-describedby="fork-demo-caption" style="display:block;width:100%;max-width:100%;height:auto;margin-inline:auto;border-radius:2.6% / 3.1%">
<source src="/static/posts/pi-durable-on-cloudflare/fork.mp4" type="video/mp4">
<source src="/static/posts/pi-durable-on-cloudflare/fork.webm" type="video/webm">
<a href="/static/posts/pi-durable-on-cloudflare/fork.mp4">Download the conversation forking demonstration.</a>
</video>
<figcaption id="fork-demo-caption">A session can contain independent conversations and forks that share history up to a selected message.</figcaption>
</figure>

To avoid creating duplicates, for instance after dropping the WebSocket connection, the harness stores a receipt with the request ID in the same commit that creates the conversation:

```ts
const conversationId = await this.#harness.commit(async (tx) => {
  const doc = await tx.doc(ConversationCommandReceipts, requestId, null);
  if (doc.receipt !== undefined) return doc.receipt.conversationId;

  const conversation = await tx.createConversation({ ownership: { kind: "ownerless" } });
  doc.receipt = { command: "conversation.create", conversationId: conversation.id };
  return conversation.id;
}, BACKGROUND_CONTEXT);
```

Creating a fork is similar, only that it receives the parent's history up to the selected entry:

```ts
const fork = await tx.forkConversation(parentConversationId, entryId, {
  ownership: { kind: "ownerless" },
});
```

When a chat participant sends a message, the session attributes it with the display name and submits it as a follow-up prompt.

```ts
const conversation = await this.#harness.conversation(conversationId, BACKGROUND_CONTEXT);
await conversation?.submit(
  {
    type: "input",
    content: attributedPrompt(username, content),
    requestId,
    whenBusy: "followUp",
  },
  BACKGROUND_CONTEXT,
);
```

If several people send messages while the model or a tool is running, the messages enter Pi's durable inbox and are answered in order.

### Stream durable conversation state

For each connected client, the session opens Pi's event stream for the selected conversation. The stream begins with an atomic snapshot and then emits events for committed transcript changes, streaming output, tools, compaction, resets, and inbox changes.

```ts
const stream = await watchEvents(
  this.#harness,
  conversationId,
  BACKGROUND_CONTEXT,
);

socket.serializeAttachment({ username, conversationId });
socket.send(JSON.stringify({
  type: "conversation.events",
  conversationId,
  events: [stream.snapshot],
}));

stream.start((events) => {
  socket.send(JSON.stringify({
    type: "conversation.events",
    conversationId,
    events,
  }));
});
```

The React client updates its selected conversation state with these events and uses a separate session snapshot to populate the sidebar.

## Resume after hibernation and wake for work

Persisting messages is only one part of durability. The application must also reconstruct live views, recover interrupted Pi tasks, and wake at future deadlines.

Cloudflare keeps the WebSockets open while the object sleeps. Each socket stores the participant's name and selected conversation, so when the object wakes, it reopens the matching Pi event streams. If a connection drops, the client resends anything the server hasn't confirmed under the same request ID, so nothing runs twice.

After restoring the live views, the session inspects the persisted task set. Future deadlines are projected onto the Durable Object alarm. For tasks that can run immediately, `waitForTask()` enables Pi’s scheduler and watches for settlement, after which the session recalculates its next alarm.

### Map Pi deadlines to the Durable Object alarm

This agent is given a `schedule` tool for it to act later, for example to check the weather after a couple of minutes. Behind the scenes, this is turned into a durable Pi task that sleeps until the task deadline.

<figure class="post-figure post-video">
<video controls muted playsinline preload="metadata" width="1520" height="1284" poster="/static/posts/pi-durable-on-cloudflare/schedule-poster.webp" aria-describedby="schedule-demo-caption" style="display:block;width:100%;max-width:100%;height:auto;margin-inline:auto;border-radius:2.6% / 3.1%">
<source src="/static/posts/pi-durable-on-cloudflare/schedule.mp4" type="video/mp4">
<source src="/static/posts/pi-durable-on-cloudflare/schedule.webm" type="video/webm">
<a href="/static/posts/pi-durable-on-cloudflare/schedule.mp4">Download the scheduled task demonstration.</a>
</video>
<figcaption id="schedule-demo-caption">A scheduled instruction is persisted and later resumed through the Durable Object alarm.</figcaption>
</figure>

Pi can track any number of deadlines, but a Durable Object has only one alarm. A newly scheduled task brings the alarm forward if its deadline comes first. Each time the object wakes, it rebuilds the alarm from Pi's tasks. Work still in progress gets a short recovery alarm, so an evicted object comes back to finish it:

```ts

override async alarm(): Promise<void> {
  await this.#refreshAlarm();
}

#refreshAlarm(): Promise<void> {
  return this.#serializeAlarmUpdate(async () => {
    const { tasks } = await this.#harness.inspect(BACKGROUND_CONTEXT);
    const now = Date.now();
    let nextAlarm: number | undefined;
    const tasksToResume: TaskId[] = [];

    for (const task of tasks) {
      if (task.state.kind === "blocked") continue;
      const scheduled = scheduledDeadline(task);
      const waitsForFuture =
        scheduled !== undefined && scheduled > now && !task.record.abortRequested;
      const deadline = waitsForFuture ? scheduled : now + RECOVERY_ALARM_DELAY_MS;
      nextAlarm = nextAlarm === undefined ? deadline : Math.min(nextAlarm, deadline);
      if (!waitsForFuture) tasksToResume.push(task.record.id);
    }

    await this.#replaceAlarm(nextAlarm);
    // waitForTask starts the scheduler, so persist its recovery alarm first.
    for (const taskId of tasksToResume) this.#refreshAlarmWhenTaskSettles(taskId);
  });
}
```

Because alarms have at-least-once execution, the handler must be idempotent. `#refreshAlarm()` recalculates everything from the stored tasks, and the stable schedule request ID stops the instruction from being submitted twice.

## Search conversation history with a durable subagent

With several conversations in one session, a participant may ask about something outside the selected conversation’s context. Rather than loading every transcript into the parent conversation, the `search_history` tool delegates retrieval to a subagent. In Pi Durable, a subagent is an ordinary conversation owned by the tool task that created it.

It searches user and assistant messages from top-level conversations, including earlier messages in the conversation that initiated the search. It cannot search its own conversation or messages created by previous searches, preventing generated search results from becoming evidence for future searches.

```
Parent conversation
    │ search_history(question)
    ▼
Durable tool task
    │ owns
    ▼
Child conversation
    │ search_conversations
    ▼
Final answer returned to parent
```

<figure class="post-figure post-video">
<video controls muted playsinline preload="metadata" width="1520" height="1284" poster="/static/posts/pi-durable-on-cloudflare/search-poster.webp" aria-describedby="search-demo-caption" style="display:block;width:100%;max-width:100%;height:auto;margin-inline:auto;border-radius:2.6% / 3.1%">
<source src="/static/posts/pi-durable-on-cloudflare/search.mp4" type="video/mp4">
<source src="/static/posts/pi-durable-on-cloudflare/search.webm" type="video/webm">
<a href="/static/posts/pi-durable-on-cloudflare/search.mp4">Download the conversation search demonstration.</a>
</video>
<figcaption id="search-demo-caption">A subagent gets its own conversation and searches across all other conversations within the session.</figcaption>
</figure>

The tool is marked as replay-safe, so if the Durable Object is evicted mid-call, Pi reruns it on the next start instead of reporting it as interrupted:

```ts
const childId = await api.commit(async (tx) => {
  // Reuse the original child if this tool task is replayed.
  const existing = (
    await tx.scanConversations(
      { ownerTaskId: api.taskId },
      1,
    )
  ).items[0];

  if (existing !== undefined) return existing.id;

  const child = await tx.createConversation({
    ownership: {
      kind: "task",
      taskId: api.taskId,
    },
  });

  await configure(tx, child.id, {
    extensions: [conversationSearchExtension],
    tools: [searchConversationsTool],
  });

  return child.id;
}, context);

// Let the interface link from the parent tool call to its subagent.
await api.details({ conversationId: childId }, context);

const child = await api.conversation(childId, context);
if (child === undefined) {
  throw new Error(`Search conversation ${childId} is missing`);
}

const submission = await child.submit(
  {
    type: "input",
    content:
      `Answer this question using search_conversations: ${question}\n\n` +
      "Try a few relevant terms. Reply briefly, cite conversation IDs, " +
      "and say so if nothing relevant was found.",
    requestId: `search-history:${api.taskId}`,
  },
  context,
);

const settled = await submission.wait(context);
if (settled.status !== "done" || settled.type !== "input") {
  throw new Error(`History search did not answer: ${settled.status}`);
}

const answer = await api.commit(
  (tx) => tx.entry(AssistantEntry, settled.answer),
  context,
);

return {
  output: [{
    type: "text",
    text: messageText(answer?.model?.[0]),
  }],
  details: { conversationId: childId },
};
```

Ownership gives the child a durable identity. If the tool is interrupted and replayed, it finds the conversation created by the original task and continues.

The `search_conversations` tool, the only tool given to the subagent, uses a deliberately simple substring search in this sample implementation. Raw matches and intermediate tool calls remain isolated in the subagent conversation. The parent conversation receives only the final answer.

## Run locally

You need Node.js 22.19 or newer, pnpm 11, and an OpenAI API key. Clone the sample repository, install its dependencies, and copy the example environment file:

```sh
git clone https://github.com/earendil-works/pi-durable-cloudflare.git
cd pi-durable-cloudflare
pnpm install
cp .dev.vars.example .dev.vars
OPENAI_API_KEY=your-key
pnpm dev
```

Create a session, open its URL in a second browser, and try this sequence: 

1. In the first conversation, say: “We decided to use PostgreSQL for the event store.”  
2. Create another conversation.  
3. Ask: “What did we decide about the event store?”  
4. Open the search subagent from the sidebar and inspect its searches.  
5. Ask the agent to check the weather in two minutes, then close the browser and return after the deadline.

Note that the demo intentionally has no authentication.

## Build with Pi Durable

This example is deliberately small, but it shows the key capabilities of Pi Durable: durable sessions, pluggable storage, long-running and scheduled work, and subagents.

Start building your agents on Pi Durable. We’d love to hear what you think and how you use it.

- [Sample repository](https://github.com/earendil-works/pi-durable-cloudflare)  
- [Introducing Pi Durable](/posts/pi-durable/)  
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)  
- [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)  
- [WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)

