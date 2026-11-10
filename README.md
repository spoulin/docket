# 🏷️ docket

A [Claude Code](https://claude.com/claude-code) mod that keeps a docket of your conversations.
Each conversation gets a status and yes-or-no flags, and a board lists all of them.

- Statuses: in progress, waiting, done, recycled, or your own list.
- Flags: remote, and personal (as opposed to work), or your own list.
- A band above the prompt sets the status and the flags (check boxes) of the current conversation.
- The board groups every conversation by status, with a filter on status, one per flag, and a period (1 hour, today, 7 days…).
- The status filter checks one group or several (in progress + waiting); one stays checked. "No status" is unchecked at first.
- A search field keeps the conversations whose title, folder, ticket or note holds every word typed. While it holds text, the filters and the ↻ button hide and stop filtering; they come back as they were once it is cleared.
- In the desktop app, each row is a card: the sidebar title with its age on the right; the folder, pull request and flags; the git signs on a line of their own; then, across the card, the note and the last turn summary in italics.
- A click on a title opens that conversation.
- Each conversation gets a small glyph, colored by project, to spot it at a glance.
- Titles that name a ticket get a link to it, with rules you set.
- The band counts the other conversations that wait on you (⚠️ 2); 🏷️ opens the board.
- An orange frame heads the board when something waits on you, with what each conversation asks. Filters leave it alone, and its conversations are not repeated in the groups below.
- A short note per conversation says why it waits or what comes next.
- Each row tells what git still holds of the branches the conversation committed on: `✎ uncommitted`, `↑2 unpushed`, `⑂ not merged`.
  Git is asked about a conversation's branches when you come into it, and again right after Claude runs a git command there that changes a branch (commit, push, merge…).
  ↻ asks about every row shown. Other rows show what was last learned; every conversation shares the answers.
  Untracked files and merge commits are left out, and a squash-merged branch without a pull request reads as not merged.

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
- `/docket <status>` sets the status, by its id or its label: `/docket done`, `/docket waiting`.
- `/docket <flag> [yes|no]` sets a flag: `/docket remote yes`. With no value, it toggles.
- `/docket note <text>` writes the conversation's note, shown in the band and on the board. `/docket note` alone clears it.
- The band above the prompt does the same, with buttons, a dropdown or one cycling button (see `statusControl`).

A conversation gets the first status when you send its first message.

The board reads the conversations again:

- when a turn of the current conversation ends;
- when you come back to a conversation whose board is open;
- every 30 seconds, and with its ↻ button.

A mod hears only its own conversation's events, so another conversation's changes show up on the next of these.

## Options

Set them when you install, or later in `/config` from a terminal session.
In the desktop app, which has no `/config`, write them in `~/.claude/settings.json`:

```json
"pluginConfigs": {
  "docket": {
    "options": {
      "language": "fr",
      "filters": "[\"status\", \"perso\", \"period\", \"remote\"]"
    }
  }
}
```

A new conversation reads them.

| Option | What it does | Default |
| --- | --- | --- |
| `language` | `en` or `fr`. | `en` |
| `statuses` | A JSON list of the statuses, in order. | in progress, waiting, done, recycled |
| `flags` | A JSON list of yes-or-no flags. `[]` for none. | remote, personal |
| `statusControl` | How the band shows the status: `buttons`, `dropdown`, `cycle` (one button that moves to the next status), or `auto`. | `auto`: buttons up to 5 statuses, a dropdown past that |
| `filters` | A JSON list of the board's filters, in order: `status`, `period` and flag ids. A filter left out is hidden. | status, period, then every flag |
| `ticketLinks` | A JSON list of rules that turn a ticket named in a title into a link. | none |
| `projectColors` | A JSON map from a project to a hue from 0 to 359. | a hue from the project's name |

Each option that takes JSON takes it as a string: in `settings.json`, escape its quotes.

### Statuses

```json
[
  { "id": "todo", "label": "To do" },
  { "id": "doing", "label": "Doing" },
  { "id": "blocked", "label": "Blocked" },
  { "id": "done", "label": "Done" }
]
```

- `id`: letters, digits and dashes. The store keeps it, so change a label freely, not an id.
- `tous`, `aucun`, `a-toi` and `note` are taken by the board and the note command.
- `label`: what the band and the board show. It may hold an emoji: `"🔨 In progress"`.
- A default status listed by its id alone (`{ "id": "termine" }`) keeps its translated label: list the defaults in another order this way.
- The first status is the one a new conversation gets.
- A conversation whose status you remove shows under "No status". Add the id back and it returns.
- The band shows them in this order.

### Flags

```json
[
  { "id": "remote", "label": "Remote" },
  { "id": "client", "label": "Client", "on": "Client", "off": "Internal" }
]
```

- `id`: letters, digits and dashes. It cannot be a status id, nor `tous`, `aucun`, `a-toi`, `note`, `status` or `period`.
- `label`: the name of the flag's filter on the board.
- `on` (optional): the flag's name next to its check box in the band, its "yes" in the filter, and its word in the row. Default: the label.
- `off` (optional): the filter's "no". Default: "Not" and the label.
- A flag listed by its id alone (`{ "id": "perso" }`) keeps its default words.
- Each flag gets a check box in the band, a filter on the board, and a word in each row where it is set.

### Board filters

```json
["status", "perso", "period", "remote"]
```

- The board lays the filters in two columns, row by row: this list gives status and kind on the first row, period and remote on the second.
- A filter left out of the list is hidden, and what it had chosen stops filtering.
- A flag cannot have the id `status` or `period`.

### Ticket links

A ticket rule has these fields:

- `pattern`: a JavaScript regular expression, matched without regard to case. Its first group is the ticket id.
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

The first rule that matches a title wins.

### Project colors

A project is the conversation's folder name, or the id of a flag set on it.
A flag with a color takes precedence: `{"my-repo": 212, "perso": 285}` colors personal conversations purple wherever they are.

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
