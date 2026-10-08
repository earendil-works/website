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

<figure class="post-figure asciicast" data-asciicast="/static/posts/system-theme/demo.cast.json" data-asciicast-themes="/static/posts/system-theme/themes.json" data-asciicast-poster="0:53.2" data-asciicast-loop>
<p class="asciicast__fallback">A Pi session in the terminal. With JavaScript enabled, it plays here and can be shown in 24 terminal themes.</p>
</figure>

## Contrast is all you need

Contrast is one of the most important aspects of color in user interfaces. If it is too low, people will have a hard time using your product. Contrast is mainly driven by lightness. Saturation affects it a little, but by far the most important factor is how light or dark a color is compared to the color behind it.

RGB, the way we usually write colors, doesn't have a lightness axis. It was made for machines to display colors on a monitor, not for humans to understand them. As a 3D shape, it is a neat cube with one axis per channel. But colors that are close to each other in this cube aren't necessarily colors humans would describe as similar. `#0000ff` and `#00ff00`, for example, both have one channel at full strength, but on white, the blue has a WCAG contrast ratio of 8.6:1 and the green only 1.4:1.

<figure class="post-figure color-space" data-color-space="rgb">
<p class="color-space__fallback">The RGB color space as a cube with one axis per channel: black and white at opposite corners, with red, green, blue and their mixes on the corners in between.</p>
<figcaption>The RGB color space. Drag to rotate, and pick a color to cut it open there.</figcaption>
</figure>

Perceptual color spaces like OKLCH are built around human perception instead. Colors that are close to each other in OKLCH are also colors humans would describe as similar, and its axes are the ones humans use to describe color: lightness, chroma (how colorful a color is) and hue. Because it follows human perception rather than a monitor's hardware, its shape is a lot weirder than a cube.

<figure class="post-figure color-space" data-color-space="oklch">
<p class="color-space__fallback">The same colors in OKLCH as a landscape: lightness runs from black to white, hue runs front to back, and the height is how much chroma a color of that lightness and hue can have. Every hue peaks at a different lightness: blue close to black, yellow close to white.</p>
<figcaption>The same colors in OKLCH: lightness from left to right, hue from front to back, and chroma as height. Drag to rotate, and pick a color to cut it open there.</figcaption>
</figure>

With a lightness axis, the idea behind the system theme is simple: Pi decides the lightness of every color based on contrast requirements, and takes the hue and chroma from your terminal's palette.

## Hue & chroma

Pi keeps the hue of your palette colors as it is. Chroma is trickier. The weird shape of OKLCH shows how much chroma a screen can display, which depends on both hue and lightness. At a lightness of 0.9, the most colorful yellow a screen can show has a chroma of about 0.2, while the most colorful blue only reaches about 0.05. So when Pi moves a palette color to the lightness it needs, its chroma might not exist at that lightness, and mapping it back to a displayable color can change the lightness Pi just calculated.

That's why Pi builds its colors in OKHSL. OKHSL is built on the same foundation as OKLCH and uses the same hues, but it stretches the weird shape back into a cylinder. Its saturation goes from 0% to 100%, where 100% always means "the most colorful this hue can be at this lightness". It tries to keep the best of both worlds: it stays as close to human perception as it can, while bringing back the simple geometry that makes RGB based color spaces easy to work with. Every combination of hue, saturation and lightness is a color your screen can display, which makes it a good fit for generating themes and palettes in general. Pi also lets saturation fall off toward black and white, so that very dark and very light colors, like a panel only slightly lighter than the background, get a hint of color rather than a bright block.

<figure class="post-figure color-space" data-color-space="okhsl">
<p class="color-space__fallback">What Pi makes of the most colorful color of each hue when it moves it to other lightnesses, in OKHSL: lightness goes from black at the bottom to white at the top, saturation from gray at the center outward, and hue around. The shape reaches OKHSL's full cylinder, outlined around it, only at mid lightness and narrows toward black and white, where Pi lets saturation fall off.</p>
<figcaption>What Pi makes of the most colorful color of each hue at other lightnesses, in OKHSL: lightness going up, saturation going out, and hue around. Saturation falls off toward black and white, inside OKHSL's full cylinder (outlined). Drag to rotate, and pick a color to cut it open there.</figcaption>
</figure>
