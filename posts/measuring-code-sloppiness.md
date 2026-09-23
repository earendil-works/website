---
title: Measuring the Sloppiness of Code
description: Exploring how to measure code sloppiness, why correct code can still erode a codebase, and why human intuition and taste still matter.
template: updates
aria_label: Earendil posts
from: Earendil <rfc@earendil.com>
to: You
date: Thu, 10 Sep 2026 17:46:39 +0200
subject: Measuring the Sloppiness of Code
---

LLMs have become almost perfect at generating code, but that isn’t the end of the story. Just because the code is formally correct doesn’t mean that it is not introducing unnecessary abstractions, creating duplicates, or just making bad decisions overall. This is not a groundbreaking observation, most people who have vibe-coded a project, have realized that each additional feature can sometimes lead to an explosion of lines of code (LOC).

This results in a loss of human agency, because in projects that are adding millions of LOC per month, it is hard for humans to keep up.[^1] Some people might say that that is not an issue at all, because they trust their agents to deal with it. I have bad news for you, agents can't really deal with the slop either.

Coming from a physics background, I always had an experimental/quantitative approach to solving problems. When I started at Earendil, with the task of figuring out how to measure code sloppiness, my natural instinct was to first take a deep dive into the literature and then check what other companies were doing.

To be frank, with the exception of a few insightful research papers, I was disappointed at how “vibes based” the industry seems at the moment. In my research and on X, I was constantly bombarded with messages such as “End-to-end coding agents”, “AI that doesn't just suggest code—it ships it” or “Human-level evaluation without human-level cost”. Which like all good tales, have a grain of truth in them.

LLMs are able to write **almost** perfectly correct code. This is because of the scalability and the verifiability of code. It is pretty straightforward to let LLMs generate code and then let that code be checked by hidden tests, which results in a clear reward signal. In stark contrast to that, checking the ‘sloppiness’ of this code often requires human intuition and taste, and is an extremely difficult task in general. I think the best way to illustrate why that is, is by going through possible ways of measuring slop.

**AI as a judge:** This is probably the most common way of evaluating code quality in the industry and from my observations it rarely works. The most naive way of doing it, namely asking the models how good the code is on a scale from 1-10, is basically equivalent to a random number generator. The more sophisticated approach, namely trying to give the judge model two solutions A and B, and then letting it decide which solution it prefers, has the downside of the model [changing its preference](https://arxiv.org/pdf/2604.16790), when you rename the solutions. I am being a bit facetious here and the effect isn’t as pronounced with larger models, but the main point still stands. Asking LLMs to judge the code they write is not a substitute for a proper evaluation. Even though there are some interesting approaches with rubrics or the LLMs writing tests, they are still a far shot from actually getting rid of the slop.

**Human judges the AI:** If we ignore the fact that there is huge diversity in the quality of software-engineers, this would be the best solution to assure that the code stays human readable. With the downside being that this is not scalable for training AI or having large benchmarks with multiple model providers and harnesses.[^2]

**The simplest method:** In my research and tests simply taking the change in the number of LOCs has been a surprisingly effective metric for sloppiness, with the ironic caveat that if we started optimizing for it, it would [cease to be a meaningful measure](https://en.wikipedia.org/wiki/Goodhart%27s_law).

The next two measures were introduced to me by the paper [SlopCodeBench](https://arxiv.org/html/2603.24755v1#A7), and seemed promising because they were able to separate legacy code bases from LLM-slop quite well.

**Verbosity:** Tries to measure the amount of duplicated and unnecessary verbose lines.[^3]

$$
\mathrm{Verbosity}=\frac{|\text{AST-Grep flagged lines}\cup\text{clone lines}|}{\mathrm{LOC}}
$$

**Erosion:** Tries to measure how much of a codebase's mass is concentrated in a few large and complex functions.

$$
\mathrm{mass}(f)=CC(f)\sqrt{\mathrm{SLOC}(f)}
$$

Here f is the function, SLOC is the source lines of code and CC(f) is the [cyclomatic complexity](https://ieeexplore.ieee.org/document/1702388) of the function.

$$
\mathrm{Erosion}=\frac{\sum_{f:\,CC(f)>10}\mathrm{mass}(f)}{\sum_f\mathrm{mass}(f)}
$$

The erosion is then simply the fraction between the mass of the functions with a cyclomatic complexity larger than 10, by the mass of all functions.

If we look at the average verbosity and erosion of the code generated during the SlopCodeBench evaluation and compare that to a set of established repos there is a stark difference between them. On average the verbosity in the repos is 0.15 ± 0.06 and in the agents code is 0.33 ± 0.10. For erosion the repos achieve 0.31 ± 0.17 and the agents 0.68 ± 0.20. The agent's code is on average roughly twice as verbose and eroded as human code. I then investigated some vibe coded projects of my own and a lot of them had a verbosity of up to 0.4 and erosion as high as 0.75, so these results probably weren't just an artifact of the evaluation.[^4]

To come back to the point of why agents can’t (really) deal with the slop themselves, we need to look at the evaluation of SlopCodeBench. In contrast to other coding benchmarks, which give the agent a complete list of instructions at the start and then have a set of hidden tests the program needs to pass, they do the opposite. They create multiple rounds of instruction and test iterations, where in between checkpoints the context of the models is erased. Thereby mimicking much more closely an iterative process, like how coding agents are actually used by humans. The result of that is that bad coding decisions accumulate over time and for the strict solve rate, where all tests have to be passed at all checkpoints, even state of the art models achieve 0% pass rate.[^5] Which should be a warning sign to everyone who happily adds tens of thousands or even hundreds of thousands of LOC a day. Obviously there are the usual caveats about too strict of tests or one or the other slightly ambiguous problem statement, but the general trend holds.

In exploring these metrics I hope you now have a clearer picture of why it is challenging to evaluate code sloppiness and why human intuition and taste are still either implicitly or explicitly baked into the evaluation.

There are some promising other directions I want to explore, such as coupledness of functions, code churn, cohesion and so on. If you are working on evals and would like to talk, I would be happy to do that: [sebastian@earendil.com](mailto:sebastian@earendil.com)

[^1]: This reminds me of the saying: “Measuring programming progress by lines of code is like measuring aircraft building progress by weight.”

[^2]: I wouldn't want to force anyone to review millions of LOC just to get an ever changing ranking of model providers.

[^3]: The rules for this are a set of handcrafted heuristics implemented via [AST-Grep](https://ast-grep.github.io/), which again goes to show the human aspect of it all.

[^4]: Though a notoriously vibey, open project didn’t score too high on either metric, probably coming from really high coupledness of functions and/or just the sheer mass of unrelated functions reducing the averages.

[^5]: Not tested on Fable 5.1 or Astra yet, but on GPT 5.6 sol xhigh etc.
