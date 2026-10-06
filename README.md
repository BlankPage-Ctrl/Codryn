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

**After installation, see [Get Started](https://github.com/BlankPage-Ctrl/Codryn-Desktop/blob/master/docs/getting-started.md#open-codryn).**

> [!WARNING]
> The installation above includes the Desktop Client.

## About

This is the backend/server component of the Codryn application. Since this is still in the **Beta** stage, certain features and support have been scaled back, many things and features are not wired at all.; however, you can contribute to expanding that support—whether by submitting **Issues** to report bugs, performance problems, or other matters.

### Agents

- **Edit** — applies file edits from the approved plan.
- **Ask** — read-only. Answers and investigates, never edits.
- **Plan** — read-only plus writes a plan to `.codryn/plan/`.

### MCP Support

MCP servers connect over stdio or HTTP (WebSocket is not supported). Their tools show up as agent tools and every call waits for your approval; if a server fails, the chat simply continues without it. Content is text only for now, so images and other non-text blocks are left out of model context. Resources and prompts are listed but never auto-injected, and the model never invokes prompts on its own.

> [!NOTE]
> For the MCP configuration, Codryn will attempt to read the `.mcp.json` file located in your project workspace root.

### Insight(Code Indexing)

When you use Insight to explore your code, Insight asks SrcInsight to read your project and find how functions and types are connected. The results you see in Insight come from this engine.

In terms of features, Agentic AI can request 'Insights' to search, trace (explore), or map out function graphs, so enabling this capability can be highly beneficial for the AI.

As a user, you can index your project, and there is no need to repeatedly press the index button; SrcInsight updates your project code incrementally.

> [!NOTE]
> Language support is limited to TypeScript, Python, and Golang. See [SrcInsight](srcinsight/README.md) for more details.

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
