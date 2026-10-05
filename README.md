<p align="center">
  <img src="images/applogo.webp" width="196" alt="Codryn icon">
</p>
<h1 align="center"><strong>Codryn</strong></h1>
<h4 align="center">
  <img src="https://badgen.net/badge/status/beta/yellow" alt="status: beta">
  <img src="https://badgen.net/badge/license/MIT/blue" alt="license: MIT">
</h4>

> What kind of experimental software do you have in mind?

## Installation

**Windows**

```bash
powershell -c "irm https://raw.githubusercontent.com/BlankPage-Ctrl/Codryn/master/installs/install.ps1 | iex"
```
**Linux(debian/ubuntu)**
```bash
curl -fsSL https://raw.githubusercontent.com/BlankPage-Ctrl/Codryn/master/installs/install.sh | bash
```
> [!WARNING]
> The installation above includes the Desktop Client.

## About

This is the backend/server component of the Codryn application. Since this is still in the **Beta** stage, certain features and support have been scaled back; however, you can contribute to expanding that support—whether by submitting **Issues** to report bugs, performance problems, or other matters.

### Agents

- **Edit** — applies file edits from the approved plan.
- **Ask** — read-only. Answers and investigates, never edits.
- **Plan** — read-only plus writes a plan to `.codryn/plan/`.

### MCP Support

MCP servers connect over stdio or HTTP (WebSocket is not supported). Their tools show up as agent tools and every call waits for your approval; if a server fails, the chat simply continues without it. Content is text only for now, so images and other non-text blocks are left out of model context. Resources and prompts are listed but never auto-injected, and the model never invokes prompts on its own.

### Configuration

To tweak the config, edit `config.toml` inside `~/.codryn/backend` folder, or point elsewhere with `codryn --config <path>` and `--data-dir <dir>`. Env vars like `TRANSPORT` and `PORT`, or flags like `--port`, override the file.

> [!WARNING]
> The shell tool currently only speaks PowerShell on Windows and bash everywhere else.

## Known limits

- Beta: install and some flows are glitchy.
- Only linux/windows amd64 are built and tested.
- OpenAI provider path has not been tested end to end yet.

## Contributing

Contributing does not have to mean writing code. Opening an issue or reporting a bug is a real contribution and very welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

## License

[MIT](LICENSE)
