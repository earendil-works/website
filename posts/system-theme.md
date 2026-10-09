---
title: There are many themes, but this one is yours
description: Pi's new system theme asks your terminal for its colors and builds Pi's theme from them. How it works.
template: updates
aria_label: Earendil posts
from: Earendil <rfc@earendil.com>
to: You
date: Fri, 1 Jan 2100 00:00:00 +0000
subject: There are many themes, but this one is yours
---

At Earendil, we want to build products that respect the choices of the people using them. So when we were refreshing Pi's themes, we wanted a theme that adapts to the terminal it runs in. Most people who spend their day in a terminal have picked their own themes for it. Why not make Pi reflect their choices?

The result is the new system theme, which is now Pi's default. It asks your terminal for its colors and builds Pi's theme from them. In this post we share how it works.

<figure class="post-figure asciicast" data-asciicast="/static/posts/system-theme/demo.cast.json" data-asciicast-themes="/static/posts/system-theme/themes.json" data-asciicast-poster="0:53.2" data-asciicast-loop data-color-eyedropper>
<p class="asciicast__fallback">A Pi session in the terminal. With JavaScript enabled, it plays here and can be shown in 24 terminal themes.</p>
</figure>

## Contrast Survey

Before we get into things, we want to let you know that we are working on our own contrast algorithm, which we will open source. We would love for you to help provide us data that train that algorithm by completing a quick survey here.

## Can you trust the ANSI palette?

Every terminal theme defines 16 ANSI colors, and the simplest way to match your terminal would be to use them directly. But there aren't really any rules to the ANSI palette. The original standard, ECMA-48, was adopted in 1976. Its nearly identical American counterpart from 1979, ANSI X3.64, is where the name comes from. The standard names eight colors (black, red, green, yellow, blue, magenta, cyan and white), but doesn't say what they should look like or how they should relate to the background.

The eight bright variants aren't part of the standard. Quite a few terminals rendered bold text in a brighter color, which effectively gave them eight more colors. The codes to select bright colors directly were added later by IBM's aixterm and adopted by other terminals like xterm.

Since the bright colors started out as bold text, we would assume that "bright" was meant to stand out more. And since early terminals mostly showed light text on a dark screen, brighter also meant more contrast. We looked at the more than 460 themes that come with Ghostty, and today this only sort of holds. In dark themes, the bright variant has more contrast in about 60% of cases. In light themes, it's only about a quarter, since bright usually still means lighter, which on a light background means less contrast. Individual themes don't agree either: in Gruvbox Dark, bright blue has more contrast than blue, in Catppuccin Mocha it has less, and in Tokyo Night they are the same color. The contrast against the background also varies a lot. We measured it with the WCAG 2 contrast ratio, which compares the luminance of two colors and ranges from 1:1 (no contrast) to 21:1 (black on white). Normal text should reach at least 4.5:1, and large text and UI elements 3:1. Bright black, which a lot of software uses for secondary text, doesn't even reach 3:1 in most dark themes.

This isn't a flaw of the themes. The palette was made to color the output of simple applications, like a red error or a green success message, and many themes are designed to look good rather than to meet contrast minimums. But it makes it hard to build an accessible, more complex TUI on top of it. Pi has around 60 color roles, from body text and dim text to panels behind tool calls and red text on a red error panel. We wanted to use your colors and still guarantee that all of them stay readable.

## Contrast is all you need

Contrast is one of the most important aspects of color in user interfaces. If it is too low, people will have a hard time using your product. Contrast is mainly driven by lightness. Saturation affects it a little, but by far the most important factor is how light or dark a color is compared to the color behind it.

RGB, the way we usually write colors, doesn't have a lightness axis. It was made for machines to display colors on a monitor, not for humans to understand them. As a 3D shape, it is a neat cube with one axis per channel. But colors that are close to each other in this cube aren't necessarily colors humans would describe as similar. <span data-select-color="#0000ff">#0000ff</span> and <span data-select-color="#00ff00">#00ff00</span>, for example, both have one channel at full strength, but on white, the blue has a WCAG contrast ratio of 8.6:1 and the green only 1.4:1.

<figure class="post-figure color-space" data-color-space="rgb">
<p class="color-space__fallback">The RGB color space as a cube with one axis per channel: black and white at opposite corners, with red, green, blue and their mixes on the corners in between.</p>
<p class="color-space__help">The RGB color space. Drag to rotate, and pick a color to cut it open there.</p>
</figure>

Perceptual color spaces like OKLCH are built around human perception instead. Colors that are close to each other in OKLCH are also colors humans would describe as similar, and its axes are the ones humans use to describe color: lightness, chroma (how colorful a color is) and hue. Because it follows human perception rather than a monitor's hardware, its shape is a lot weirder than a cube.

<figure class="post-figure color-space" data-color-space="oklch">
<p class="color-space__fallback">The same colors in OKLCH as a landscape: lightness runs from black to white, hue runs front to back, and the height is how much chroma a color of that lightness and hue can have. Every hue peaks at a different lightness: blue close to black, yellow close to white.</p>
<p class="color-space__help">The same colors in OKLCH: lightness from left to right, hue from front to back, and chroma as height. Drag to rotate, and pick a color to cut it open there.</p>
</figure>

With a lightness axis, the idea behind the system theme is simple: Pi decides the lightness of every color based on contrast requirements, and takes the hue and chroma from your terminal's palette.

## Lightness

To figure out what lightness each color needs, we wrote down every place in the UI where two colors meet. Every panel needs enough contrast with the terminal background to read as a separate area, but not so much that it distracts. Every foreground color needs enough contrast on every background it can appear on. An error message, for example, has to be readable on the background, on the selected row and on all three tool panels. In code, this is a list of rules:

```ts
const COLORS = ["accent", "success", "error", "warning"];
const SURFACES = ["background", "selectedBg", ...TOOL_PANELS];

{ token: "text", on: ["background"], level: "text" },
...each(COLORS, SURFACES, "readable"),
{ token: "dim", on: [...SURFACES, "customMessageBg"], level: "subtle" },
```

A contrast algorithm normally takes two colors and returns the contrast between them. Here we need the reverse: we know the background and how much contrast we want, and need the color. I have reversed contrast algorithms before, and you can find implementations for both WCAG and perceptual contrast on GitHub. With a reversed algorithm, calculating the theme becomes a loop: starting with the panels, Pi calculates the lightness each color needs for each of its rules and takes the strictest one.

## The Algorithm

Our first prototype did exactly that, together with a review app in which we tuned the contrast minimums. The app can render Pi with any of the themes that come with Ghostty, so we could check a sample of very different themes to make sure the system holds up beyond the default one.

That prototype used a well known perceptual contrast algorithm and that reference implementation. We then used that against a large number of ghostty themes and ensured that it looked good against all the themes. We then did not want to ship that algorithm itself. We tried to use simpler measures but were unable to approximate the results. In the end we had a coding agent do the fitting. For each contrast level in the reference the agent ran the original algorithm on every gray background from white to black and recorded the lightness and fitted a polynomial to the results. It settled on a fifth degree polynomial which was found to stay close enough to the reference lightness. Pi now only ships with those coefficients.

The chart below shows those polynomials, one curve for each contrast level in the rules above. Along the bottom is the lightness of the surface a color is drawn on, and up the side the lightness the color needs on it. The diagonal is no contrast at all: a color exactly as light as its surface. The vertical lines are the surfaces: the background, and the panels, which Pi solves first on the background. Where a rule's curve crosses one of its surfaces, you can read off the lightness that rule needs there, and the strictest one wins. Drag the background to see how every color follows it.

<figure class="post-figure lightness-curves" data-lightness-curves data-pi-themes="/static/posts/system-theme/themes.json">
<p class="lightness-curves__fallback">A chart of Pi's contrast levels as curves: for every lightness of a surface, the lightness a color needs on it. On dark surfaces the curves lie above the diagonal, where colors are lighter than their surface; on light surfaces below it. The stronger the level, the further its curve is from the diagonal.</p>
<p class="color-space__help">Drag across the chart, or use the slider, to change the background's lightness, or pick a terminal theme. Pick a rule, or a word in the terminal, to see the lightness it needs on each of its surfaces. Click a color to show it in the other figures.</p>
<figcaption>Each curve is the polynomial for one contrast level. Dots are the selected rule's targets, one per surface, the outlined one the strictest. On the right, the square is Pi's color and the circle the terminal's ANSI color it started from.</figcaption>
</figure>

We first convert the queried terminal colors from RGB into OKLCH and OKHSL. From that we get the original lightness L, chroma C and hue H as well as the saturation S relative to what sRGB can display at that lightness. Once the polynomial is evaluated against the lightness of the background. The resulting lightness is then not used as a direct replacement, but converted into an OKHSL lightness and a new color is computed using the original hue and adjusted saturation. A bell shaped saturation curve is applied. Strongest at the middle lightness and weaker towards black and white. Finally that is converted to OKLCH and Pi limits the original chroma so that H stays the same, L comes from the contrast rules and C becomes what the adjusted OKHSL produces. This is so that a pale pink for instance, when moved towards a darker shade, might otherwise make it too vivid. The adjustment ensures that it can never be more colorful than the original color.

## Hue & chroma

Pi keeps the hue of your palette colors as it is. Chroma is trickier. The weird shape of OKLCH shows how much chroma a screen can display, which depends on both hue and lightness. At a lightness of 0.9, the most colorful yellow a screen can show has a chroma of about 0.2, while the most colorful blue only reaches about 0.05. So when Pi moves a palette color to the lightness it needs, its chroma might not exist at that lightness, and mapping it back to a displayable color can change the lightness Pi just calculated.

That's why Pi builds its colors in OKHSL. OKHSL is built on the same foundation as OKLCH and uses the same hues, but it stretches the weird shape back into a cylinder. Its saturation goes from 0% to 100%, where 100% always means "the most colorful this hue can be at this lightness". It tries to keep the best of both worlds: it stays as close to human perception as it can, while bringing back the simple geometry that makes RGB based color spaces easy to work with. Every combination of hue, saturation and lightness is a color your screen can display, which makes it a good fit for generating themes and palettes in general. Pi also lets saturation fall off toward black and white, so that very dark and very light colors, like a panel only slightly lighter than the background, get a hint of color rather than a bright block.

But keeping the saturation the same doesn't keep a color equally colorful. Since saturation is relative to what the screen can display, the same percentage can mean very different amounts of chroma at different lightnesses. Shortly after the release, a bug report showed that Pi looked much more vivid than the terminal with Catppuccin Frappé. Catppuccin's pink, <span data-select-color="#f4b8e4" data-pi-theme="Catppuccin Frappé" data-pi-role="accent">#f4b8e4</span>, has an OKHSL saturation of 84%, but that is 84% of the little chroma a screen can show at such a high lightness. Pi's accent needs to be darker to be readable, and since the shape is much wider there, 84% saturation becomes <span data-select-color="#eb76d1" data-pi-theme="Catppuccin Frappé" data-pi-role="accent">#eb76d1</span>, with about twice the chroma of the original pink. The fix was to also cap the chroma: a palette color can move to a different lightness, but it can never become more colorful than it is in your palette. With the cap, the accent becomes <span data-select-color="#cc92bd" data-pi-theme="Catppuccin Frappé" data-pi-role="accent">#cc92bd</span>, which looks like Catppuccin again.

So in the end, the chroma of a palette color is limited three times: by what your screen can display, through OKHSL; by the falloff toward black and white; and by the chroma it has in your palette.

The two views below separate the color space from what Pi does inside it. OKHSL's cylinder stays fixed. Pi's range depends on the source color and the family of the UI role: the source's saturation applies at its own lightness, and the falloff is relative to that point. Moving toward the middle never raises the saturation above the source's. Different families use different falloffs; a yellow warning and a violet accent do not use the same curve.

<div class="post-figure color-space-pair" data-color-space-pair>
<figure class="color-space" data-color-space="okhsl">
<p class="color-space__title">OKHSL color space</p>
<p class="color-space__fallback">The full OKHSL cylinder: lightness from black at the bottom to white at the top, saturation from gray at the center outward, and hue around. It is cut open at the source's hue.</p>
<figcaption>The sRGB OKHSL cylinder, cut open at the source's hue.</figcaption>
</figure>
<figure class="color-space" data-color-space="pi-range" data-pi-themes="/static/posts/system-theme/themes.json">
<p class="color-space__title">What Pi makes from a palette color</p>
<p class="color-space__fallback">Pi's output range for one ANSI color of a terminal theme and the role that uses it, as a colored hue slice inside the cylinder's outline. Its outer edge follows the anchored saturation falloff and source-chroma cap, and passes through the source itself at its own lightness. Its interior shows outputs at lower saturation settings. Without a terminal palette, Pi uses the family's own hue and saturation curve instead.</p>
<figcaption>Every color Pi can make from the source, at its hue.</figcaption>
</figure>
<p class="color-space__help">Pick a color to check whether Pi can make it from the source, here or in the terminal above. The dot is the source; squares are the colors Pi uses in this theme. Drag either view to rotate both.</p>
</div>

## The result

Pi asks the terminal for its foreground, background and ANSI colors on startup, and rebuilds the theme when the terminal switches between light and dark. If a terminal only reports its background, Pi uses its own hues. If it reports nothing, Pi falls back to the ANSI colors and lets the terminal draw them. The generated colors keep the hues of your terminal, but their lightness is adjusted to a similar contrast. Gruvbox's dark red becomes a lot lighter, Catppuccin Latte's red a little darker, and Nord's colors barely move.

If you haven't picked a theme, you are already using the system theme. Otherwise, you can switch to it in /settings under Theme. If your terminal theme looks off in Pi, please open an issue with the name of the theme.
