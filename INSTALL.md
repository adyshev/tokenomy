# Installation

Tokenomy is distributed as a Pi package. Install it from git with `pi install`.

## Requirements

- Pi installed and working locally
- Node.js 22.19 or newer
- ChatGPT Plus/Pro Codex access authenticated in Pi
- `openai-codex` models available in `pi --list-models openai-codex`

## Install with Pi

Install from npm once the package is published:

```bash
pi install npm:tokenomy-pi
```

Project-local npm install:

```bash
pi install -l npm:tokenomy-pi
```

Recommended public install:

```bash
pi install https://github.com/adyshev/tokenomy
```

Install project-locally instead of globally:

```bash
pi install -l https://github.com/adyshev/tokenomy
```

SSH install also works if you prefer GitHub SSH auth:

```bash
pi install git:git@github.com:adyshev/tokenomy
```

For a pinned release or commit:

```bash
pi install https://github.com/adyshev/tokenomy@v0.1.11-beta
```

`pi install` reads the `pi` manifest from `package.json` and enables the
Tokenomy extension declared there.

## Project Config

Tokenomy works with built-in defaults after package install. Add
`.pi/tokenomy.json` only when you want to customize model IDs, UI settings,
classifier behavior, or tool management.

Example project config:

```json
{
  "provider": "openai-codex",
  "ui": {
    "notifyDecisions": true
  }
}
```

See `CONFIG.md` for all options.

## Manual Development Install

For local development, you can install from a checked-out path:

```bash
pi install ./path/to/tokenomy
```

Or load it for one run without adding it to settings:

```bash
pi -e ./path/to/tokenomy
```

Manual copy still works, but `pi install` is preferred:

```bash
mkdir -p .pi/extensions/tokenomy
cp /path/to/tokenomy/.pi/extensions/tokenomy/index.ts .pi/extensions/tokenomy/index.ts
cp /path/to/tokenomy/.pi/tokenomy.json .pi/tokenomy.json
```

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

Update installed Pi packages:

```bash
pi update --extensions
```

Pinned git installs do not move automatically. To move a pinned install, run
`pi install` again with the new tag or commit.
