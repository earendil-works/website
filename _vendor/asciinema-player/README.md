# asciinema-player (patched)

asciinema-player 3.17.0 with one patch, `set-theme.patch`: `player.setTheme(theme)`
recolors the terminal while it plays, with a palette of up to 256 colors. The
system theme post uses it to show one recording of Pi in many terminal themes
(see `scripts/pi-system-themes.mts`).

To rebuild (needs Rust, wasm-pack and Node):

```sh
git clone https://github.com/asciinema/asciinema-player
cd asciinema-player
git checkout v3.17.0
git am /path/to/earendil-website/_vendor/asciinema-player/set-theme.patch
npm ci --ignore-scripts
npm run build
cp dist/bundle/asciinema-player.min.js dist/bundle/asciinema-player.css \
  /path/to/earendil-website/_vendor/asciinema-player/
```

`build.py` copies these files to `/static/asciinema-player/`.
