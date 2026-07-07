# Installation

Tokenomy is currently distributed as a project-local Pi extension. It is not an
npm package. Install it by copying the extension and config into the project
where you run Pi.

## Requirements

- Pi installed and working locally
- Node.js 22.19 or newer
- ChatGPT Plus/Pro Codex access authenticated in Pi
- `openai-codex` models available in `pi --list-models openai-codex`

## Install in a Project

From the project where you want Tokenomy enabled:

```bash
mkdir -p .pi/extensions/tokenomy
cp /path/to/tokenomy/.pi/extensions/tokenomy/index.ts .pi/extensions/tokenomy/index.ts
cp /path/to/tokenomy/.pi/tokenomy.json .pi/tokenomy.json
```

Then add the extension to `.pi/settings.json`:

```json
{
  "extensions": ["extensions/tokenomy/index.ts"]
}
```

If `.pi/settings.json` already exists, merge the `extensions` entry instead of
overwriting the file.

## Verify

List available Codex models:

```bash
pi --list-models openai-codex
```

Start Pi in the project:

```bash
pi
```

Inside Pi, run:

```text
/tokenomy status
```

You should see Tokenomy enabled, the configured provider, and the last routing
decision once you send a prompt.

## Disable

Disable for the current Pi run:

```bash
pi --tokenomy-off
```

Disable inside a running Pi session:

```text
/tokenomy off
```

Preview routing without changing model, thinking, or active tools:

```text
/tokenomy dry-run on
```

Show why the last route happened:

```text
/tokenomy explain
```

Reset local lifetime counters:

```text
/tokenomy reset-stats
```

Disable by config:

```json
{
  "enabled": false
}
```

## Update

Copy the new extension file and config from the Tokenomy repo:

```bash
cp /path/to/tokenomy/.pi/extensions/tokenomy/index.ts .pi/extensions/tokenomy/index.ts
```

Review `.pi/tokenomy.json` before replacing a local config, because users often
customize model IDs and UI settings.
