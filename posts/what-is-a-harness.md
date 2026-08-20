---
title: What is a Harness?
description: An agent harness is a piece of software that provides an environment for an AI model to operate within.
template: updates
aria_label: Earendil posts
from: Earendil Product <rfc@earendil.com>
to: You
date: Thu, 20 Aug 2026 12:03:55 +0200
subject: What is a Harness?
---

**Harness** – definition by the Cambridge Dictionary

*Noun.* a [piece](https://dictionary.cambridge.org/dictionary/english/piece) of [equipment](https://dictionary.cambridge.org/dictionary/english/equipment) with [straps](https://dictionary.cambridge.org/dictionary/english/strap) and [belts](https://dictionary.cambridge.org/dictionary/english/belt), used to [control](https://dictionary.cambridge.org/dictionary/english/control) or [hold](https://dictionary.cambridge.org/dictionary/english/hold) in [place](https://dictionary.cambridge.org/dictionary/english/place) a [person](https://dictionary.cambridge.org/dictionary/english/person), [animal](https://dictionary.cambridge.org/dictionary/english/animal), or [object](https://dictionary.cambridge.org/dictionary/english/object)

*Verb.* to [control](https://dictionary.cambridge.org/dictionary/english/control) something, usually in [order](https://dictionary.cambridge.org/dictionary/english/order) to use [its](https://dictionary.cambridge.org/dictionary/english/its) [power](https://dictionary.cambridge.org/dictionary/english/power)

–

When I think of a harness, I think first of the set of straps and belts that I put on in middle school before scrambling up the walls of my school. I was a mediocre climber at best. 

If you’re main-lining into the AI newsfeed these days however, your archetypal harness may already be  an agent harness. And, this post was not written for you. 

This was written for those who may be curious to know what an agent harness is, but don’t, and have been too embarrassed to ask.

Let’s get back to climbing. 

Why do you strap on a harness when you go climbing? Well, firstly, the harness supports you and keeps you safe. It does that by connecting you to carabiners and ropes that secure you from falls, moderate your pace, and govern your route. You can also attach other tools to your harness like a chalk bag, nut tools and quickdraws. 

And when you go climb different mountains or make different ascents  you can take your harness with you. Depending on the terrain, you can even modify your harness and what goes on your gear loops. Climbing harnesses are adaptable. They are used by acrobats and arborists. The people who own them can make them their own.

There are similarities between climbing harnesses and agent harnesses both in terms of structure and function. 

## Agent Harnesses

Others have written (simplistically) that Agent \= Model \+ Harness. Here the word Harness refers to an Agent Harness. But what is an agent harness? Agent harnesses use AI models to create AI agents, and their first application was for coding. Now, agent harnesses sit at the core of all types of AI agents and understanding how an agent harness works will help you understand what an AI agent is. 

An agent harness is a piece of software that provides an environment for an AI model to operate within. Unlike most AI models, you as an end user can own your own agent harness.

Often, users like software engineers interact directly with harnesses like [Pi](https://pi.dev/) using the Terminal application on their computer. But, harnesses like [OpenClaw](https://openclaw.ai/) also use different user interfaces like iMessage, a chat app, or email. Our harness [Lefos](https://www.lefos.com/about) was built primarily to interact via email. Regardless of the interface, harnesses generally do four things: Firstly, they provide a set of instructions that help govern how the AI model responds. This set of instructions is typically called a “system prompt”. Secondly, they describe and provide a set of tools that are made available to the AI model to use in service of responding to requests from the user. Thirdly, the harness establishes a framework that governs how the model behaves. This framework does a lot of different things, but one of the main things it does is establish the “agentic loop”. Finally, most harnesses provide a crucial translation layer that enables the harness to work with a variety of different AI models. 

### I. System Prompt

Most AI models come with an embedded set of rules and guidelines that has been refined and arrived at during the training process. Most famously, Claude Opus 4.5 had a widely publicized “[soul document](https://gist.github.com/Richard-Weiss/efe157692991535403bd7e7fb20b6695)” that explained to the AI model what it was and how it should act. The System Prompt in an AI harness is similar to this but is less embedded into the model. It’s more like a set of instructions a new employee might get on their first day of a job. It hasn’t internalized the instructions but it knows it should follow them when performing that work. System prompts are injected into the conversation together with every prompt and  play an important role in ensuring that the AI model acts appropriately in the context of that harness.

### II. Tools

Tools are a set of capabilities, written in code, that the model can “call”. The harness describes the tools and also provides the software that is the tool itself. Examples of these tools might include a web search tool, a tool that allows the model to write and execute software code, or a tool that allows the model to compose an email.  Critically, the harness usually does not dictate when and how the AI model should use the tool. Instead, it simply makes the tools available, describes them clearly, and allows the AI model itself to decide when and how it should use them.

### III. Agentic Loops

Now we have an AI model sitting within an agent harness with a set of instructions and a set of tools. Let us assume our harness was built to work within email, had the tools we described above (WebSearch, WriteCode, ComposeEmail), and that the user has asked the agent to compare rankings and test scores of local primary schools and provide recommendations. How will the agent behave? Firstly, it will try to understand the request (or, "prompt"). It will use its pre-training and weights to understand what a "primary school" is, what "the local area" means, and what rankings the user likely cares about. It will then construct web search queries to fetch recent data. What does it do with those results? Sitting within a harness, the AI model can review them in the context of the initial request. It may determine that the first search did not fetch the right information, or enough of it, and on its own, decide to search again. This decision to call the tool again based on its own assessment is the first clear example of the "loop". Now let's assume it collected all the relevant data. The AI model decides to make a spreadsheet using the "write code" tool. All spreadsheets are just code, after all. It can use that tool to do math and format the results so they are intelligible. It then compares the spreadsheet to the original prompt. If the data doesn't satisfy it, it may “loop” and go back and search again. When it decides it has enough, it calls ComposeEmail,  a tool that allows the AI to review its findings, summarize them, write an email, and include attachments like the spreadsheet. The model reviews this final work and decides the job is done. The  "agentic loop" closes. Within seconds, the user gets an email with a summary and recommendations in the body, and a spreadsheet presenting the findings attached.

### IV. Translation Layer

The translation layer is what allows a harness to work with different AI models. In some cases, a harness may decide to use different models within the same agentic loop, because different AI models may excel at different tasks. The translation layer is also a crucial aspect of harnesses because they deliver control to the end user. It means that someone can take their AI harness and use it with a model from Anthropic, or OpenAI, or explore one of the open weight AI models that often deliver great value-for-money (measured by cost-per-task). 

This translation layer helps take power and leverage away from the AI labs and into the hands of end users. If people can own and run their own harnesses locally on their own computers, it means that they retain their agency.  It means that they retain the freedom to make their tools their own, and keep local copies of the sessions that over time will constitute their correspondence with machines. By building a relationship to and using a harness rather than an application published by an AI lab, the user retains freedom and choice. In our example harness above, the user could have sent the same email to a model from OpenAI, a model from Anthropic, and an open weight model. They could then compare the results, the cost of the results, and retain all the answers in one place, rather than having three answers sitting within three apps. 

## Making a Harness Yours

Unlike AI models themselves, you can own and adapt the harness. Like a climbing harness, you can make it your own. People love this about Pi. Pi is a minimal agent harness. Its system prompt is short. It has a minimal set of tools. Out of the box it is designed to get out of the way. But as people use Pi, they extend it and mold it in ways that suit them. They change the system prompt, or design an [extension](https://pi.dev/packages) that fits a workflow. They then share those extensions with others. Pi users have shared more than 5,000 extensions with one another. Pi is also free and open source. It lives on your own laptop. This means that people now have a tool that they own, that lives on their own hardware, that enables them to wield AI. 

## Neutral Open Source Harnesses as Tools of Agency

Recently, harnesses have not been open source or neutral. Popular agent harness, Claude Code, was not built to provide an agnostic AI translation layer but was built as an application to enable coding with Claude models on your local computer. Since then, there has been an encouraging growth of free open source agent harnesses like OpenClaw, OpenCode, Hermes and Pi. At Earendil we are building Pi to be neutral, and to deliver capability choice and freedom to Pi users. We are also exploring how we can make the benefits and agency that harnesses provide to a broader swath of people. 

Many people right now are concerned about the power and influence of bigger and bigger AI companies. Some of those people may choose to avoid AI completely. We at Earendil believe we can strengthen human agency by crafting software and open protocols that bridge division and ignorance and cultivate lasting joy and understanding. We won’t do that by ignoring the technologies that exist today, but by harnessing them with clear eyes and a firm grip; ensuring that we wield the hammer, the hammer does not wield us.

