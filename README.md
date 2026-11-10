# docket

A [Claude Code](https://claude.com/claude-code) mod that keeps a docket of your conversations.
Each conversation gets a status and two flags, and a board lists all of them.

- Statuses: in progress, waiting, done, recycled.
- Flags: remote, and personal (as opposed to work).
- A band above the prompt sets the status and the flags of the current conversation.
- The board groups every conversation by status, with filters on status, kind and remote.
- In the desktop app, each row shows the sidebar title, the last turn summary, the pull request and the age.
- A click on a title opens that conversation.
- Each conversation gets a small glyph, colored by project, to spot it at a glance.
- Titles that name a ticket get a link to it, with rules you set.

> [!WARNING]
> In the desktop app, the board reads the app's own conversation records and opens conversations through the app's own links.
> Neither is a documented interface: an app update can break the titles, the summaries or the open links.
> The status band and the `/docket` command do not depend on them.

## Install

At the prompt of a terminal session:

```
/plugin install docket --marketplace spoulin/docket
```

Answer `y` to add the marketplace, then pick a scope.
From a shell, the same is:

```bash
claude plugin install docket --marketplace spoulin/docket
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `spoulin/docket`, then Add plugin.

## Use

- `/docket` opens the board.
- `/docket in-progress`, `/docket waiting`, `/docket done`, `/docket recycled` set the status.
- `/docket remote [yes|no]` and `/docket personal [yes|no]` set the flags. With no value, they toggle.
- The band above the prompt does the same with buttons.

A conversation is filed as in progress when you send its first message.

## Options

Set them when you install, or later in `/config`.

| Option | What it does | Default |
| --- | --- | --- |
| `language` | `en` or `fr`. | `en` |
| `ticketLinks` | A JSON list of rules that turn a ticket named in a title into a link. | none |
| `projectColors` | A JSON map from a project to a hue from 0 to 359. | a hue from the project's name |

A ticket rule has these fields:

- `pattern`: a regular expression, matched without regard to case. Its first group is the ticket id.
- `url`: the link, which must start with `https://`. `{id}` stands for the ticket id.
- `label` (optional): what the link shows. Default: `{id}`.
- `project` (optional): the project whose color the row takes.
- `uppercase` (optional): `true` to write the id in capitals.

Example, for Jira keys and GitHub issues:

```json
[
  { "pattern": "\\b(ABC-\\d+)\\b", "url": "https://example.atlassian.net/browse/{id}", "uppercase": true },
  { "pattern": "(?:^|\\s)#(\\d+)\\b", "url": "https://github.com/me/repo/issues/{id}", "label": "#{id}" }
]
```

A project is the conversation's folder name, or `perso` for personal conversations.
Example: `{"my-repo": 212, "perso": 285}`.

## Platforms

- macOS: tested.
- Windows: not tested. The board looks for the desktop app's records under `%APPDATA%\Claude`.
- Linux: the band and the board work, without desktop conversations.

## Develop

```bash
claude plugin validate .
claude plugin test .
```

To run your working copy, name its folder in `CLAUDE_CODE_PLUGIN_DIRS`, in the `env` block of `~/.claude/settings.json`.
A new conversation loads the latest version.

## License

[MIT](LICENSE)
