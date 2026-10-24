# Status-bar artwork

- `claude.svg` is the vector source for the minimal Claude mascot: a hollow body, two eyes, thin arms and two legs on a 16px grid. Its artwork occupies 16 × 14px to match the OpenAI mark's visual size. Its nonzero winding preserves the eyes inside the hollow body. The glyph inherits the current VS Code theme's foreground color.
- `openai.svg` is the monochrome OpenAI knot mark, obtained from [Lobe Icons](https://github.com/lobehub/lobe-icons/blob/master/packages/static-svg/icons/openai.svg). See `openai-LICENSE.txt` for the source package license.
- `ai-usage-icons.woff` contains the native theme-aware status-bar glyphs built by `scripts/build-icons.py`.
