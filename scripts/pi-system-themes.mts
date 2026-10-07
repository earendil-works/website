// Generates terminal palettes that recolor a Pi recording like Pi's system theme.
//
// Pi's system theme builds ~60 color tokens from the terminal's foreground, background and
// 16 ANSI colors, so a recording made with a plain 16-color palette cannot show it. Instead,
// a recording is made with a "token" theme that draws every token in its own 256-color
// index (16, 17, ...). For each terminal theme, this script runs Pi's own generator and
// writes a 256-color palette: the terminal's ANSI colors in 0-15 and the generated token
// colors after them. The player recolors the recording by switching palettes.
//
// Usage:
//   node scripts/pi-system-themes.mts <pi-mono checkout> <themes.json> [token-theme.json]
//
// Terminal themes come from Ghostty's bundled theme files, except Ghostty's default
// colors, which are not shipped as a theme file and are listed below.
//
// A recording only matches palettes with the token order it was recorded with. When
// <themes.json> exists, its token order is kept; if Pi's tokens changed since, the
// recording has to be redone with a new token theme (delete <themes.json> first).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

interface Rgb {
	r: number;
	g: number;
	b: number;
}

interface TerminalColors {
	foreground: string;
	background: string;
	palette: string[];
}

const GHOSTTY_THEMES = "/Applications/Ghostty.app/Contents/Resources/ghostty/themes";

// `ghostty +show-config --default`
const GHOSTTY_DEFAULT: TerminalColors = {
	foreground: "#ffffff",
	background: "#282c34",
	palette: [
		"#1d1f21",
		"#cc6666",
		"#b5bd68",
		"#f0c674",
		"#81a2be",
		"#b294bb",
		"#8abeb7",
		"#c5c8c6",
		"#666666",
		"#d54e53",
		"#b9ca4a",
		"#e7c547",
		"#7aa6da",
		"#c397d8",
		"#70c0b1",
		"#eaeaea",
	],
};

const THEMES: { name: string; ghostty?: string }[] = [
	{ name: "Ghostty Default" },
	{ name: "Catppuccin Frappé", ghostty: "Catppuccin Frappe" },
	{ name: "Gruvbox Dark", ghostty: "Gruvbox Dark" },
	{ name: "Tokyo Night", ghostty: "TokyoNight" },
	{ name: "Nord", ghostty: "Nord" },
	{ name: "Dracula", ghostty: "Dracula" },
	{ name: "Rosé Pine", ghostty: "Rose Pine" },
	{ name: "One Dark", ghostty: "Atom One Dark" },
	{ name: "Palenight", ghostty: "Pale Night Hc" },
	{ name: "Solarized Dark", ghostty: "iTerm2 Solarized Dark" },
	// Low contrast out of the box: most ANSI colors are below 3:1 on the background.
	{ name: "Ocean", ghostty: "Ocean" },
	{ name: "Material Dark", ghostty: "Material Dark" },
	{ name: "Catppuccin Latte", ghostty: "Catppuccin Latte" },
	{ name: "Gruvbox Light", ghostty: "Gruvbox Light" },
	{ name: "Solarized Light", ghostty: "iTerm2 Solarized Light" },
	{ name: "GitHub Light", ghostty: "GitHub Light Default" },
	{ name: "Rosé Pine Dawn", ghostty: "Rose Pine Dawn" },
	{ name: "Tokyo Night Day", ghostty: "TokyoNight Day" },
	{ name: "One Light", ghostty: "Atom One Light" },
	{ name: "Ayu Light", ghostty: "Ayu Light" },
	{ name: "Monokai Pro Light", ghostty: "Monokai Pro Light" },
	{ name: "Kanagawa Lotus", ghostty: "Kanagawa Lotus" },
	// Low contrast out of the box: most ANSI colors are below 3:1 on the background.
	{ name: "Everforest Light", ghostty: "Everforest Light Med" },
	{ name: "Nord Light", ghostty: "Nord Light" },
];

/** First 256-color index used for Pi's tokens; 0-15 stay the terminal's ANSI colors. */
const FIRST_TOKEN_INDEX = 16;

/** The themes the player starts with, matching the page's own dark or light appearance. */
const INITIAL_THEMES = { dark: "Ghostty Default", light: "Catppuccin Latte" };

function readGhosttyTheme(file: string): TerminalColors {
	const colors: Partial<TerminalColors> = { palette: [] };
	for (const line of readFileSync(join(GHOSTTY_THEMES, file), "utf8").split("\n")) {
		const eq = line.indexOf("=");
		if (eq < 0) continue;
		const key = line.slice(0, eq).trim();
		const value = line.slice(eq + 1).trim();
		if (key === "foreground") colors.foreground = normalizeHex(value);
		else if (key === "background") colors.background = normalizeHex(value);
		else if (key === "palette") {
			const [index, color] = value.split("=");
			colors.palette![Number(index)] = normalizeHex(color);
		}
	}
	const { foreground, background, palette } = colors;
	if (!foreground || !background || palette!.slice(0, 16).filter(Boolean).length !== 16) {
		throw new Error(`incomplete Ghostty theme: ${file}`);
	}
	return { foreground, background, palette: palette!.slice(0, 16) };
}

function normalizeHex(value: string): string {
	const hex = value.trim().toLowerCase().replace(/^#/, "");
	if (!/^[0-9a-f]{6}$/.test(hex)) throw new Error(`not a hex color: ${value}`);
	return `#${hex}`;
}

/** OKLab lightness and a, b of a hex color. */
function oklab(hex: string): [number, number, number] {
	const linear = (channel: number) => {
		const value = channel / 255;
		return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	};
	const { r, g, b } = rgb(hex);
	const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
	const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
	const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
	const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	];
}

/**
 * Orders colors so that neighbors look as similar as possible: the shortest path through all of
 * them in OKLab, found exactly (Held-Karp, fine for a dozen colors). Sorting by hue alone puts a
 * bright blue between near-black navies; this also follows lightness and chroma. The more
 * neutral end comes first.
 */
function perceptualOrder(colors: string[]): number[] {
	const labs = colors.map(oklab);
	const count = labs.length;
	const distance = labs.map((a) => labs.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])));
	const full = (1 << count) - 1;
	const cost = Array.from({ length: full + 1 }, () => new Array<number>(count).fill(Number.POSITIVE_INFINITY));
	const previous = Array.from({ length: full + 1 }, () => new Array<number>(count).fill(-1));
	for (let index = 0; index < count; index++) cost[1 << index][index] = 0;
	for (let mask = 1; mask <= full; mask++) {
		for (let last = 0; last < count; last++) {
			if (cost[mask][last] === Number.POSITIVE_INFINITY) continue;
			for (let next = 0; next < count; next++) {
				if (mask & (1 << next)) continue;
				const extended = mask | (1 << next);
				const total = cost[mask][last] + distance[last][next];
				if (total < cost[extended][next]) {
					cost[extended][next] = total;
					previous[extended][next] = last;
				}
			}
		}
	}
	let last = 0;
	for (let index = 1; index < count; index++) if (cost[full][index] < cost[full][last]) last = index;
	const path: number[] = [];
	for (let mask = full; last !== -1; ) {
		path.unshift(last);
		const before = previous[mask][last];
		mask ^= 1 << last;
		last = before;
	}
	const chroma = (index: number) => Math.hypot(labs[index][1], labs[index][2]);
	return chroma(path[0]) <= chroma(path[path.length - 1]) ? path : path.reverse();
}

function rgb(hex: string): Rgb {
	const value = Number.parseInt(hex.slice(1), 16);
	return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

type Generate = (input: { foreground?: Rgb; background?: Rgb; palette?: Rgb[] }) => {
	colors: Record<string, string | number>;
	appearance: "dark" | "light" | undefined;
};

async function main(): Promise<void> {
	const [piMono, themesOut, tokenThemeOut] = process.argv.slice(2);
	if (!piMono || !themesOut) {
		throw new Error("usage: node scripts/pi-system-themes.mts <pi-mono checkout> <themes.json> [token-theme.json]");
	}
	const systemTheme = resolve(piMono, "packages/coding-agent/src/modes/interactive/theme/system-theme.ts");
	if (!existsSync(systemTheme)) throw new Error(`not found: ${systemTheme}`);
	// The checkout is only known at runtime.
	const { generateSystemThemeColors } = (await import(pathToFileURL(systemTheme).href)) as {
		generateSystemThemeColors: Generate;
	};

	let tokens: string[] | undefined = existsSync(themesOut)
		? (JSON.parse(readFileSync(themesOut, "utf8")) as { tokens: string[] }).tokens
		: undefined;
	const unordered = THEMES.map(({ name, ghostty }) => {
		const terminal = ghostty ? readGhosttyTheme(ghostty) : GHOSTTY_DEFAULT;
		const generated = generateSystemThemeColors({
			foreground: rgb(terminal.foreground),
			background: rgb(terminal.background),
			palette: terminal.palette.map(rgb),
		});
		const generatedTokens = Object.keys(generated.colors);
		tokens ??= generatedTokens;
		if (generatedTokens.length !== tokens.length || !generatedTokens.every((token) => tokens!.includes(token))) {
			throw new Error(`Pi's color tokens differ from ${themesOut}; re-record with a new token theme`);
		}
		const tokenColors = tokens.map((token) => {
			const color = generated.colors[token];
			// "" is the terminal's default color; only text tokens use it once a background is known.
			if (color === "") return terminal.foreground;
			if (typeof color !== "string") throw new Error(`${name}: unexpected indexed color for ${token}`);
			return color;
		});
		return {
			name,
			appearance: generated.appearance,
			foreground: terminal.foreground,
			background: terminal.background,
			palette: [...terminal.palette, ...tokenColors],
		};
	});
	// Display order: dark themes, then light ones, each in perceptual order of their backgrounds.
	const themes = (["dark", "light"] as const).flatMap((appearance) => {
		const group = unordered.filter((theme) => theme.appearance === appearance);
		return perceptualOrder(group.map((theme) => theme.background)).map((index) => group[index]);
	});

	for (const [appearance, name] of Object.entries(INITIAL_THEMES)) {
		if (!themes.some((theme) => theme.name === name && theme.appearance === appearance)) {
			throw new Error(`initial ${appearance} theme not found: ${name}`);
		}
	}

	writeFileSync(
		themesOut,
		`${JSON.stringify({ firstTokenIndex: FIRST_TOKEN_INDEX, initial: INITIAL_THEMES, tokens, themes }, null, "\t")}\n`,
	);

	if (tokenThemeOut) {
		const colors = Object.fromEntries(tokens!.map((token, index) => [token, FIRST_TOKEN_INDEX + index]));
		const tokenTheme = { name: "pi-system-tokens", appearance: "dark", colors };
		writeFileSync(tokenThemeOut, `${JSON.stringify(tokenTheme, null, "\t")}\n`);
	}
}

await main();
