import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type {
  DesktopSession,
  BoardFilters,
  Entry,
  FlagFilter,
  GitState,
  Period,
  RemoteMachine,
  Snooze,
  StatusFilter,
} from '../types'

const PANE = 'docket'
// The mod's version, shown in the board's title. A mod can read neither its manifest nor
// its own version: keep it the same as .claude-plugin/plugin.json on each release.
const VERSION = '0.12.3'
const KEY_PREFIX = 'session:'
const HOST_KEY_PREFIX = 'host:'
const REFRESH_MS = 30_000
// The app writes a turn's summary to its record a moment after the turn ends.
const SETTLE_MS = 3_000
// A board drawn after this long without a refresh reads the data again: coming back
// to a conversation redraws its board, and no event says the person came back.
const STALE_MS = 5_000
// From this many columns across, the board lays its groups side by side, one column each.
const BOARD_COLUMNS_MIN = 120
// A one-pixel gray rule, stretched to the row's width; a mid gray reads on light and dark.
const SEPARATOR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 1" preserveAspectRatio="none">' +
  '<rect width="100" height="1" fill="#8a8a8a" fill-opacity="0.35"/></svg>'
// A gray ring with a quarter that turns, while Claude works in a conversation.
const SPINNER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">' +
  '<circle cx="8" cy="8" r="6" fill="none" stroke="#8a8a8a" stroke-opacity="0.3" stroke-width="2"/>' +
  '<path d="M8 2 A6 6 0 0 1 14 8" fill="none" stroke="#8a8a8a" stroke-width="2" stroke-linecap="round">' +
  '<animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur="1s" repeatCount="indefinite"/>' +
  '</path></svg>'
// While a conversation shows a spinner, the board reads the records this often.
const RUNNING_REFRESH_MS = 5_000

// The words the mod shows, per language. Ids stay the same in every language:
// they are what the store keeps.
const TEXTS = {
  en: {
    commandDescription: (statusIds: string, flagIds: string) =>
      `Status: ${statusIds}; ${flagIds} [yes|no]; note <text>; alone, opens the board`,
    boardOpened: 'Status board opened.',
    unknownFlag: (value: string) => `Unknown value "${value}". Values: yes, no.`,
    unknownStatus: (value: string, ids: string) => `Unknown status "${value}". Values: ${ids}.`,
    statusSet: (label: string) => `Status: ${label}.`,
    flagSet: (label: string) => `${label}.`,
    noteSaved: 'Note saved.',
    noteCleared: 'Note cleared.',
    yourTurnBand: (count: number) => `⚠️ ${count}`,
    yourTurn: (count: number) => `⚠️ Your turn (${count})`,
    runningGroup: (count: number) => `⚙️ Running (${count})`,
    saveFailed: 'The conversation status could not be saved.',
    paneTitle: `🏷️ Docket ${VERSION}`,
    statuses: [
      { id: 'en-cours', label: 'In progress', aliases: ['in-progress', 'progress', 'encours', 'cours'] },
      { id: 'en-attente', label: 'Waiting', aliases: ['waiting', 'attente'] },
      { id: 'termine', label: 'Done', aliases: ['done', 'fini'] },
      { id: 'recycle', label: 'Recycled', aliases: ['recycled'] },
    ],
    flags: [
      { id: 'remote', label: 'Remote', on: 'Remote', off: 'Not remote', aliases: [] },
      { id: 'perso', label: 'Kind', on: 'Personal', off: 'Work', aliases: ['personal'] },
    ],
    not: (label: string) => `Not ${label.toLowerCase()}`,
    checkAll: 'Check all',
    someStatuses: (count: number) => (count === 1 ? '1 status' : `${count} statuses`),
    everyStatus: 'All',
    allFlags: 'All',
    status: 'Status',
    period: 'Period',
    refresh: '↻ Refresh',
    periods: {
      tout: 'Any time',
      '1h': '1 hour',
      '2h': '2 hours',
      '3h': '3 hours',
      '6h': '6 hours',
      today: 'Today',
      '7d': '7 days',
      '30d': '30 days',
    } as Record<Period, string>,
    noStatus: 'No status',
    empty: 'No conversation here.',
    search: 'Search',
    noMatch: (query: string) => `Nothing matches "${query}".`,
    uncommitted: 'uncommitted',
    unpushed: 'unpushed',
    unmerged: 'not merged',
    filtersPaused: 'The filters wait while you search.',
    separator: 'Separator',
    glyph: 'Conversation mark',
    here: 'Here',
    remove: 'Remove',
    openFailed: 'The conversation could not be opened.',
    ticketFailed: 'The ticket could not be opened.',
    untitled: 'Untitled conversation',
    never: 'never',
    running: 'Claude is working',
    snooze: '🌙',
    snoozedFor: (rest: string) => `🌙 ${rest}`,
    wake: 'Wake up',
    showSnoozed: (isOn: boolean, count: number) => `${isOn ? '☑' : '☐'} 🌙 Snoozed (${count})`,
    local: '🏠 Local',
    machine: (name: string) => `💻 ${name}`,
    snoozes: {
      '5m': '5 min',
      '10m': '10 min',
      '15m': '15 min',
      '30m': '30 min',
      '1h': '1 hour',
      '1d': '1 day',
    } as Record<SnoozeId, string>,
    blocked: (text: string) => `⚠️ ${text}`,
    review: (text: string) => `👀 To review: ${text}`,
    prStates: { OPEN: 'open', MERGED: 'merged', CLOSED: 'closed', DRAFT: 'draft' } as Record<string, string>,
    justNow: 'just now',
    minutesAgo: (count: number) => `${count} min ago`,
    hoursAgo: (count: number) => `${count} h ago`,
    daysAgo: (count: number) => `${count} d ago`,
  },
  fr: {
    commandDescription: (statusIds: string, flagIds: string) =>
      `Statut : ${statusIds}; ${flagIds} [oui|non]; note <texte>; seul, ouvre le tableau`,
    boardOpened: 'Tableau des statuts ouvert.',
    unknownFlag: (value: string) => `Valeur inconnue "${value}". Valeurs : oui, non.`,
    unknownStatus: (value: string, ids: string) => `Statut inconnu "${value}". Valeurs : ${ids}.`,
    statusSet: (label: string) => `Statut : ${label}.`,
    flagSet: (label: string) => `${label}.`,
    noteSaved: 'Note enregistrée.',
    noteCleared: 'Note effacée.',
    yourTurnBand: (count: number) => `⚠️ ${count}`,
    yourTurn: (count: number) => `⚠️ À toi (${count})`,
    runningGroup: (count: number) => `⚙️ En marche (${count})`,
    saveFailed: "Le statut de la conversation n'a pas pu être enregistré.",
    paneTitle: `🏷️ Docket ${VERSION}`,
    statuses: [
      { id: 'en-cours', label: 'En cours', aliases: ['in-progress', 'progress', 'encours', 'cours'] },
      { id: 'en-attente', label: 'En attente', aliases: ['waiting', 'attente'] },
      { id: 'termine', label: 'Terminé', aliases: ['done', 'fini'] },
      { id: 'recycle', label: 'Recyclé', aliases: ['recycled'] },
    ],
    flags: [
      { id: 'remote', label: 'Remote', on: 'Remote', off: 'Pas remote', aliases: [] },
      { id: 'perso', label: 'Type', on: 'Perso', off: 'Job', aliases: ['personal'] },
    ],
    not: (label: string) => `Pas ${label.toLowerCase()}`,
    checkAll: 'Tout cocher',
    someStatuses: (count: number) => (count === 1 ? '1 statut' : `${count} statuts`),
    everyStatus: 'Tous',
    allFlags: 'Tous',
    status: 'Statut',
    period: 'Période',
    refresh: '↻ Rafraîchir',
    periods: {
      tout: 'Tout',
      '1h': '1 heure',
      '2h': '2 heures',
      '3h': '3 heures',
      '6h': '6 heures',
      today: "Aujourd'hui",
      '7d': '7 jours',
      '30d': '30 jours',
    } as Record<Period, string>,
    noStatus: 'Sans statut',
    empty: 'Aucune conversation ici.',
    search: 'Recherche',
    noMatch: (query: string) => `Rien ne correspond à « ${query} ».`,
    uncommitted: 'non commité',
    unpushed: 'non poussé',
    unmerged: 'pas mergé',
    filtersPaused: 'Les filtres sont en pause pendant la recherche.',
    separator: 'Séparateur',
    glyph: 'Repère de la conversation',
    here: 'Ici',
    remove: 'Retirer',
    openFailed: "La conversation n'a pas pu être ouverte.",
    ticketFailed: "Le ticket n'a pas pu être ouvert.",
    untitled: 'Conversation sans titre',
    never: 'jamais',
    running: 'Claude travaille',
    snooze: '🌙',
    snoozedFor: (rest: string) => `🌙 ${rest}`,
    wake: 'Réveiller',
    showSnoozed: (isOn: boolean, count: number) => `${isOn ? '☑' : '☐'} 🌙 En snooze (${count})`,
    local: '🏠 Local',
    machine: (name: string) => `💻 ${name}`,
    snoozes: {
      '5m': '5 min',
      '10m': '10 min',
      '15m': '15 min',
      '30m': '30 min',
      '1h': '1 heure',
      '1d': '1 jour',
    } as Record<SnoozeId, string>,
    blocked: (text: string) => `⚠️ ${text}`,
    review: (text: string) => `👀 À revoir : ${text}`,
    prStates: { OPEN: 'ouverte', MERGED: 'mergée', CLOSED: 'fermée', DRAFT: 'brouillon' } as Record<string, string>,
    justNow: "à l'instant",
    minutesAgo: (count: number) => `il y a ${count} min`,
    hoursAgo: (count: number) => `il y a ${count} h`,
    daysAgo: (count: number) => `il y a ${count} j`,
  },
}

type Texts = (typeof TEXTS)['en']

// A ticket rule from the options: a title matching `pattern` links to `url`,
// where {id} stands for the pattern's first group (or the whole match),
// in capitals when `uppercase` is set.
type TicketRule = { pattern: RegExp; url: string; label: string; project?: string; uppercase: boolean }

// A status a conversation can have; the first one in the list is given on the first message.
type StatusDef = { id: string; label: string; aliases: readonly string[] }

// A yes-or-no flag: a button in the band, a filter on the board, a word in each row.
// `label` names the filter, `on` and `off` say what each state reads.
type FlagDef = { id: string; label: string; on: string; off: string; aliases: readonly string[] }

// The options the module was loaded with; register sets them on each load.
const config: {
  texts: Texts
  tickets: TicketRule[]
  hues: Record<string, number>
  statuses: StatusDef[]
  flags: FlagDef[]
  statusControl: StatusControl
  filters: string[] | undefined
  // A folder the person's computers share (iCloud Drive, Dropbox...); none: no sharing.
  syncFolder: string | undefined
  machineName: string | undefined
} = {
  texts: TEXTS.en,
  tickets: [],
  hues: {},
  statuses: [...TEXTS.en.statuses],
  flags: [...TEXTS.en.flags],
  statusControl: 'auto',
  filters: undefined,
  syncFolder: undefined,
  machineName: undefined,
}

// The board's filters by id: the status, the period, then each flag by its id.
const STATUS_FILTER_ID = 'status'
const PERIOD_FILTER_ID = 'period'

// The filters the board shows, in order: the `filters` option, or every one.
function filterIds(): string[] {
  const known = [STATUS_FILTER_ID, PERIOD_FILTER_ID, ...flags().map(flag => flag.id)]

  return config.filters?.filter(id => known.includes(id)) ?? known
}

// How the band shows the status: a button per status, a picker, or one button
// that moves to the next status. `auto` picks buttons up to MAX_STATUS_BUTTONS.
type StatusControl = 'auto' | 'buttons' | 'dropdown' | 'cycle'
const STATUS_CONTROLS: readonly StatusControl[] = ['auto', 'buttons', 'dropdown', 'cycle']
const MAX_STATUS_BUTTONS = 5

// The status filter's own values, kept apart from the status ids.
const ALL_STATUSES = 'tous'
const NO_STATUS = 'aucun'
// Kept out of status and flag ids: 0.4 stored it as a status filter.
const YOUR_TURN = 'a-toi'
// Ids the statuses and flags cannot take: the filter's own values, and the note command.
const RESERVED_IDS: readonly string[] = [ALL_STATUSES, NO_STATUS, YOUR_TURN, 'note']
// The status picker's own values: its summary line, and a group to check or uncheck.
const STATUS_SUMMARY = 'resume'
const STATUS_TOGGLE = 'basculer:'
const NOTE_MAX = 200
const FLAG_FILTERS: readonly FlagFilter[] = ['tous', 'oui', 'non']

function statuses(): StatusDef[] {
  return config.statuses
}

function flags(): FlagDef[] {
  return config.flags
}

function flagOptions(flag: FlagDef): { value: FlagFilter; label: string }[] {
  return [
    { value: 'tous', label: config.texts.allFlags },
    { value: 'oui', label: flag.on },
    { value: 'non', label: flag.off },
  ]
}

// Change the tag when an entry's fields change: it declines what an earlier
// version stored, which outlives a reload.
const current = atom({ plugin: 'docket', key: 'current' } as const, null, {
  shape: 'entry-2',
})
const all = atom({ plugin: 'docket', key: 'all' } as const, [], {
  shape: 'entry-2',
})
const desktop = atom({ plugin: 'docket', key: 'desktop' } as const, [], {
  shape: 'desktop-4',
})
// What git says of each branch a conversation committed on, by repository and branch.
const gitStates = atom({ plugin: 'docket', key: 'git' } as const, {} as Record<string, GitState>)
// What the person's other computers published in the sync folder.
const remote = atom({ plugin: 'docket', key: 'remote' } as const, [] as RemoteMachine[], {
  shape: 'remote-1',
})
const statusFilter = atom(
  { plugin: 'docket', key: 'statusFilter' } as const,
  'tous' as StatusFilter,
)
const tick = atom({ plugin: 'docket', key: 'tick' } as const, 0)
const flagFilters = atom({ plugin: 'docket', key: 'flagFilters' } as const, {})
const periodFilter = atom({ plugin: 'docket', key: 'period' } as const, 'tout' as Period)
// A wide board keeps filters of its own, apart from the side panel's.
const wideFilters = atom({ plugin: 'docket', key: 'wideFilters' } as const, {
  status: 'tous',
  period: 'tout',
  flags: {},
  showSnoozed: false,
} as BoardFilters)
// The search is this board's own; it is not kept between conversations.
const searchQuery = atom({ plugin: 'docket', key: 'search' } as const, '')

// A snooze hides a conversation from the board for a while, whatever its status;
// the search still finds it. By the conversation's key, when it wakes up.
const snoozes = atom({ plugin: 'docket', key: 'snoozes' } as const, {} as Record<string, number>)
type SnoozeId = '5m' | '10m' | '15m' | '30m' | '1h' | '1d'
const SNOOZES: Record<SnoozeId, number> = {
  '5m': 5 * 60_000,
  '10m': 10 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 3_600_000,
  '1d': 24 * 3_600_000,
}
// Whether the board shows the snoozed conversations too, kept with the filters.
const showSnoozed = atom({ plugin: 'docket', key: 'showSnoozed' } as const, false)
const SNOOZE_NONE = ''
const SNOOZE_WAKE = 'wake'

const PERIODS: readonly Period[] = ['tout', '1h', '2h', '3h', '6h', 'today', '7d', '30d']
const HOUR_MS = 3_600_000

export const register: Register = (on, options) => {
  let timer: Timer | undefined
  let settle: Timer | undefined
  applyOptions(options)
  const t = config.texts

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'docket',
      description: t.commandDescription(
        statuses()
          .map(status => status.id)
          .join(', '),
        flags()
          .map(flag => flag.id)
          .join(', '),
      ),
    })

    const hostId = await findHostId($)
    const byHost =
      hostId === undefined ? null : readEntry(await $.store.get(`${HOST_KEY_PREFIX}${hostId}`))
    const stored = byHost ?? readEntry(await $.store.get(storeKey(await $.session.id())))
    if (stored !== null) {
      await persistEntry($, {
        ...stored,
        sessionId: await $.session.id(),
        ...(hostId === undefined ? {} : { hostId }),
      })
    } else {
      const label = await findFirstPrompt($)
      if (label !== null) {
        await saveEntry($, await createEntry($, label))
      }
    }
    await refreshAll($)

    timer?.cancel()
    timer = $.clock.every(REFRESH_MS, () => {
      void refreshBoard($)
    })

    return started
  })

  // A git command Claude ran may change what the board says of a branch: the shared
  // answer is dropped, and the next board shown asks git again.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const command = (e as { command?: unknown }).command
    if (typeof command === 'string' && GIT_CHANGE.test(command)) {
      await refreshOwnGit($, true).catch(() => undefined)
    }

    return ran
  })

  // The desktop app connecting to the conversation, maybe on coming back to it.
  on('session.attach', async ($, e, next) => {
    const attached = await next(e)
    void refreshBoard($).catch(() => undefined)

    return attached
  })

  on('session.end', async ($, e, next) => {
    timer?.cancel()
    timer = undefined
    settle?.cancel()
    settle = undefined
    stopRunningRefresh()

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const submitted = await next(e)
    // A conversation started with a command (a skill such as /explain-ticket) counts too;
    // /docket sets the status itself.
    const isFirstPrompt =
      e.isMeta !== true && e.command?.name !== 'docket' && (await read($, current)) === null
    if (isFirstPrompt && e.text.trim() !== '') {
      await createEntry($, e.text)
        .then(entry => saveEntry($, entry))
        .catch(() => $.ui.toast(t.saveFailed))
    }

    // The prompt is already on its way: a failed read never holds it back.
    await refreshBoard($).catch(() => undefined)

    return submitted
  })

  // A turn of this conversation changes its row: the board is read at once, then
  // again once the app has written the turn's summary. Other conversations are
  // seen on the next timed refresh, since a mod hears no other session's turns.
  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    if (e.agentId === undefined) {
      await refreshBoard($)
      settle?.cancel()
      settle = $.clock.after(SETTLE_MS, () => {
        void refreshBoard($)
      })
    }

    return completed
  })

  on('command.run', { command: 'docket' }, async ($, e) => {
    const args = e.args.trim()
    if (args === '') {
      await refreshAll($)
      await $.ui.open({ id: PANE, title: t.paneTitle })

      return { text: t.boardOpened }
    }

    const note = /^note(?:\s+([\s\S]*))?$/i.exec(args)
    if (note !== null) {
      const text = (note[1] ?? '').replace(/\s+/g, ' ').trim()
      await setNote($, text)

      return { text: text === '' ? t.noteCleared : t.noteSaved }
    }

    const [word = '', value, ...rest] = args.split(/\s+/)
    const flag = findFlag(word)
    if (flag !== undefined && rest.length === 0) {
      const entry = await ensureEntry($)
      const isOn = value === undefined ? entry.flags[flag.id] !== true : parseFlag(value.toLowerCase())
      if (isOn === null) {
        return { text: t.unknownFlag(value ?? '') }
      }
      await setFlag($, flag.id, isOn)

      return { text: t.flagSet(isOn ? flag.on : flag.off) }
    }

    const status = findStatus(args)
    if (status === undefined) {
      return {
        text: t.unknownStatus(
          args,
          statuses()
            .map(one => one.id)
            .join(', '),
        ),
      }
    }
    await setStatus($, status.id)

    return { text: t.statusSet(status.label) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Coming into the conversation draws its band: git is asked about its branches.
    void refreshOwnGit($).catch(() => undefined)
    const entry = await read($, current)
    if (e.props.hasSurvey) {
      return next(e)
    }

    // Before the first message there is no entry yet: show the band with nothing selected.
    const status = entry?.status ?? null
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    const known = status === null ? undefined : findStatus(status)
    const index = known === undefined ? -1 : statuses().indexOf(known)
    const nextStatus = statuses()[(index + 1) % statuses().length]
    const chosenControl =
      config.statusControl === 'auto'
        ? statuses().length > MAX_STATUS_BUTTONS
          ? 'dropdown'
          : 'buttons'
        : config.statusControl
    // A surface that draws no picker gets the buttons instead.
    const Select = 'Select' in elements ? elements.Select : undefined
    const control = chosenControl === 'dropdown' && Select === undefined ? 'buttons' : chosenControl
    const statusControl =
      control === 'cycle' ? (
        <Button
          key="status"
          label={known?.label ?? t.noStatus}
          variant={known === undefined ? undefined : 'primary'}
          dimColor={known === undefined}
          onPress={() => (nextStatus === undefined ? undefined : setStatus($, nextStatus.id))}
        />
      ) : control === 'dropdown' && Select !== undefined ? (
        <Select
          key="status"
          options={[
            ...(known === undefined ? [{ value: '', label: '—' }] : []),
            ...statuses().map(option => ({ value: option.id, label: option.label })),
          ]}
          value={known?.id ?? ''}
          onSelect={(value: string) => (value === '' ? undefined : setStatus($, value))}
        />
      ) : (
        statuses().map(option => (
          <Button
            key={`status-${option.id}`}
            label={option.label}
            variant={option.id === known?.id ? 'primary' : undefined}
            dimColor={option.id !== known?.id}
            onPress={() => setStatus($, option.id)}
          />
        ))
      )
    const hostId = await findHostId($)
    const asleep = await read($, snoozes)
    const bandNow = await $.clock.now()
    const waiting = (await readAllSessions($)).filter(
      session =>
        session.attention === 'blocked' &&
        !session.isArchived &&
        session.hostId !== hostId &&
        !isSnoozed(asleep, session.hostId, bandNow),
    ).length

    // Left: this conversation (status, flags, note). Right: every conversation.
    return (
      <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap={2}>
        <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap={1} flexShrink={1}>
          {statusControl}
          {flags().map(flag => {
            const isOn = entry?.flags[flag.id] === true

            return (
              <Button
                key={`flag-${flag.id}`}
                plain
                label={`${isOn ? '☑' : '☐'} ${flag.on}`}
                dimColor={!isOn}
                onPress={() => setFlag($, flag.id, !isOn)}
              />
            )
          })}
          {entry?.note !== undefined && (
            <Text dimColor wrap="truncate-end">
              📝 {entry.note}
            </Text>
          )}
        </Box>
        <Box flexDirection="row" alignItems="center" gap={1} flexShrink={0}>
          {waiting > 0 && (
            <Button
              key="your-turn"
              label={t.yourTurnBand(waiting)}
              onPress={async () => {
                await refreshAll($)
                await $.ui.open({ id: PANE, title: t.paneTitle })
              }}
            />
          )}
          <Button
            key="board"
            label="🏷️"
            dimColor
            onPress={async () => {
              await refreshAll($)
              await $.ui.open({ id: PANE, title: t.paneTitle })
            }}
          />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if ((await $.clock.now()) - lastRefreshAt > STALE_MS) {
      // Not awaited: the board draws now, and again once the data is read.
      void refreshBoard($).catch(() => undefined)
    }
    const elements = $.ui.resolve(e)
    const { Box, Button, Markdown, Text } = elements
    // Not every surface draws a Select: those get buttons instead.
    const Select = 'Select' in elements ? elements.Select : undefined
    // The terminal lists no vector drawing it can show: it gets a text rule.
    const Svg = e.surface !== 'terminal' && 'Svg' in elements ? elements.Svg : undefined
    const columns = 'bodyColumns' in e.props ? e.props.bodyColumns : 40
    // A card's rule spans its column: the whole board, or one group's column when wide.
    let cardColumns = columns
    if (columns !== lastPaneColumns) {
      // Kept to tune BOARD_COLUMNS_MIN: what width each surface reports.
      lastPaneColumns = columns
      void $.store.set('paneColumns', { columns, surface: e.surface }).catch(() => undefined)
    }
    const separator = (key: string, width = columns) =>
      Svg === undefined ? (
        <Box key={key}>
          <Text dimColor>{'─'.repeat(Math.max(10, width - 2))}</Text>
        </Box>
      ) : (
        <Box key={key}>
          <Svg source={SEPARATOR_SVG} alt={t.separator} height={1} width={2000} />
        </Box>
      )
    const rows = buildAllRows(await read($, desktop), await read($, all), await read($, remote))
    const git = await read($, gitStates)
    await read($, tick)
    // A wide board reads and saves its own filters; the side panel keeps its own.
    const isWideBoard = columns >= BOARD_COLUMNS_MIN
    const wideView = isWideBoard ? await read($, wideFilters) : undefined
    const chosen = wideView?.flags ?? (await read($, flagFilters))
    const query = await read($, searchQuery)
    // A search looks through every conversation: the filters wait, unchanged, for it to end.
    const isSearching = query.trim() !== ''
    // A filter the options hide keeps every row, whatever was chosen before.
    const isVisible = (id: string) => filterIds().includes(id)
    const flagFilter = (flag: FlagDef): FlagFilter =>
      (isVisible(flag.id) ? chosen[flag.id] : undefined) ?? 'tous'
    const appliedFlagFilter = (flag: FlagDef): FlagFilter => (isSearching ? 'tous' : flagFilter(flag))
    const statusChoice: StatusFilter = isVisible(STATUS_FILTER_ID)
      ? (wideView?.status ?? (await read($, statusFilter)))
      : ALL_STATUSES
    const selected = resolveStatusFilter(statusChoice)
    const hereId = await $.session.id()
    const now = await $.clock.now()
    // A board drawn with a spinner reads the records again soon, to stop it.
    if (rows.some(row => isRunning(row, now))) {
      startRunningRefresh($)
    }
    const period = isVisible(PERIOD_FILTER_ID) ? (wideView?.period ?? (await read($, periodFilter))) : 'tout'
    const since = isSearching ? Number.NEGATIVE_INFINITY : findPeriodStart(period, now)
    const asleep = await read($, snoozes)
    const wakesAt = (row: Row) => asleep[snoozeKey(row)] ?? 0
    const isShowingSnoozed = wideView?.showSnoozed ?? (await read($, showSnoozed))
    const snoozedCount = rows.filter(row => isSnoozed(asleep, snoozeKey(row), now)).length
    // A snoozed conversation is left out, the group of what waits on you included,
    // until it wakes up, unless the board shows them; a search still finds it.
    const found = rows.filter(
      row =>
        matchesSearch(row, query) &&
        (isSearching || isShowingSnoozed || !isSnoozed(asleep, snoozeKey(row), now)),
    )
    const shown = found.filter(
      row =>
        row.lastActivityAt >= since &&
        flags().every(flag => matchesFlag(row, flag, appliedFlagFilter(flag))),
    )
    const periodOptions = PERIODS.map(id => ({ value: id, label: t.periods[id] }))
    // What waits on the person sits between the filters and the groups, filters aside, and is not repeated below.
    const isYourTurn = (row: Row) => row.attention === 'blocked' && row.key !== hereId
    const yourTurn = found.filter(isYourTurn)
    const isChecked = (id: string) => selected.includes(id)
    const isShown = (id: string) => isSearching || isChecked(id)
    // A wide board gives the conversations where Claude works a column of their own,
    // after what waits on you, as the status filter allows; they leave their group.
    const groupOf = (row: Row) => (hasStatus(row) ? (row.entry?.status ?? NO_STATUS) : NO_STATUS)
    const running =
      isWideBoard
        ? shown.filter(row => !isYourTurn(row) && isRunning(row, now) && isShown(groupOf(row)))
        : []
    const listed = shown.filter(row => !isYourTurn(row) && !running.includes(row))
    const groups: { id: string; label: string; rows: Row[] }[] = [
      ...statuses().map(status => ({
        id: status.id,
        label: status.label,
        rows: listed.filter(row => hasStatus(row) && row.entry?.status === status.id),
      })),
      { id: NO_STATUS, label: t.noStatus, rows: listed.filter(row => !hasStatus(row)) },
    ]
    // The picker shows a summary of the checked groups; each other choice checks or
    // unchecks one group, and the last checked group stays checked.
    const shownGroups = groups.filter(group => isChecked(group.id))
    // A short summary: its width does not move with the names or the counts.
    const summary =
      statusChoice === ALL_STATUSES ? t.everyStatus : t.someStatuses(shownGroups.length)
    const statusOptions = [
      { value: STATUS_SUMMARY, label: summary },
      ...groups.map(group => ({
        value: `${STATUS_TOGGLE}${group.id}`,
        label: `${isChecked(group.id) ? '☑' : '☐'} ${group.label} (${group.rows.length})`,
      })),
      { value: ALL_STATUSES, label: t.checkAll },
    ]
    const pickStatus = (value: string) => saveStatusFilter($, pickStatusFilter(selected, value), isWideBoard)
    const renderRow = (row: Row) => (
      // A mail-like card, every line from its left edge: the title, the facts, the git
      // state, the note and the summary; last, the glyph, the pull request and the age, and 🌙.
      <Box key={`row-${row.key}`} flexDirection="column" gap={1}>
        <Box flexDirection="row" alignItems="flex-start" gap={2}>
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Box flexDirection="row" justifyContent="space-between" alignItems="flex-start" gap={2}>
              <Box flexDirection="column" flexShrink={1}>
                {row.key !== hereId && row.hostId !== undefined && row.machine === undefined ? (
                  <Markdown
                    key={`open-${row.key}`}
                    text={`**[${escapeMarkdown(row.title)}](${conversationHref(row.hostId)})**`}
                    pressableLinks={[conversationHref(row.hostId)]}
                    onLinkPress={() => openConversation($, row.hostId)}
                  />
                ) : row.machine !== undefined && row.remoteId !== undefined ? (
                  // Another computer's conversation opens through Remote Control.
                  <Markdown
                    key={`open-${row.key}`}
                    text={`**[${escapeMarkdown(row.title)}](${remoteHref(row.remoteId)})**`}
                    pressableLinks={[remoteHref(row.remoteId)]}
                    onLinkPress={() => openRemote($, row.remoteId)}
                  />
                ) : (
                  <Text weight="semibold" wrap="truncate-end">
                    {row.title}
                  </Text>
                )}
              </Box>
            </Box>
            <Box flexDirection="row" alignItems="center" gap={1}>
              {findTicket(row.title) !== undefined && (
                <Markdown
                  key={`ticket-${row.key}`}
                  dimColor
                  text={`[${escapeMarkdown(`${findTicket(row.title)?.label} ↗`)}](${findTicket(row.title)?.url})`}
                  pressableLinks={[findTicket(row.title)?.url ?? '']}
                  onLinkPress={() => openTicket($, findTicket(row.title))}
                />
              )}
              <Text dimColor size="footnote" wrap="truncate-end">
                {row.key === hereId ? `${t.here} · ${describe(row)}` : describe(row)}
              </Text>
            </Box>
            {describeGit(row, row.machine?.git ?? git).length > 0 && (
              // What git still holds, on a line of its own: mark, count and words.
              <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap={1}>
                {describeGit(row, row.machine?.git ?? git).map((sign, index) => (
                  <Box key={`git-${row.key}-${sign.word}`} flexDirection="row" gap={1}>
                    {index > 0 && (
                      <Text dimColor size="caption">
                        ·
                      </Text>
                    )}
                    <Text size="caption">{`${sign.mark} ${sign.word}`}</Text>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
          {!row.isDesktop && row.key !== hereId && row.machine === undefined && (
            <Button
              key={`remove-${row.key}`}
              label={t.remove}
              dimColor
              onPress={() => row.entry !== undefined && removeEntry($, row.entry)}
            />
          )}
        </Box>
        {row.entry?.note !== undefined && (
          <Text size="footnote" wrap="wrap">
            📝 {row.entry.note}
          </Text>
        )}
        {row.summary !== undefined && row.attention === undefined && (
          // The last turn's summary, in italics: what the conversation said, not a fact of it.
          <Text key={`summary-${row.key}`} size="footnote" dimColor italic wrap="wrap">
            {row.summary}
          </Text>
        )}
        {row.summary !== undefined && row.attention !== undefined && (
          <Text
            size="footnote"
            dimColor={row.attention !== 'blocked'}
            color={row.attention === 'blocked' ? 'warning' : undefined}
            wrap={row.attention === 'blocked' ? 'wrap' : 'truncate-end'}
          >
            {formatSummary(row)}
          </Text>
        )}
        {/* The card's last line: the glyph, the spinner and the age at the left, 🌙 at the right; the lines above all start at the card's left edge. */}
        <Box
          key={`snooze-row-${row.key}`}
          flexDirection="row"
          justifyContent="space-between"
          alignItems="center"
          gap={1}
        >
          {/* The glyph, then the pull request above the age, as tall together as the 🌙 picker. */}
          <Box key={`mark-${row.key}`} flexDirection="row" alignItems="center" gap={2} flexShrink={1}>
            {Svg === undefined ? (
              <Text color={glyphColor(row.hostId ?? row.key, findProject(row))}>
                {textGlyph(row.hostId ?? row.key)}
              </Text>
            ) : (
              <Svg
                source={glyphSvg(row.hostId ?? row.key, findProject(row))}
                alt={t.glyph}
                width={22}
                height={22}
              />
            )}
            <Box key={`facts-${row.key}`} flexDirection="column" alignItems="flex-start" flexShrink={1}>
              {describePr(row) !== undefined && (
                <Text key={`pr-${row.key}`} dimColor size="footnote" wrap="truncate-end">
                  {describePr(row)}
                </Text>
              )}
              <Box key={`age-${row.key}`} flexDirection="row" alignItems="center" gap={1} flexShrink={0}>
                {isRunning(row, now) &&
                  (Svg === undefined ? (
                    <Text key={`running-${row.key}`} dimColor size="caption">
                      ⋯
                    </Text>
                  ) : (
                    <Svg
                      key={`running-${row.key}`}
                      source={SPINNER_SVG}
                      alt={t.running}
                      width={12}
                      height={12}
                      isInteractive
                    />
                  ))}
                <Text dimColor size="caption">
                  {row.lastActivityAt > 0 ? formatAge(now - row.lastActivityAt) : t.never}
                </Text>
              </Box>
            </Box>
          </Box>
          {Select !== undefined && (
            <Select
              key={`snooze-${row.key}`}
              options={[
                {
                  value: SNOOZE_NONE,
                  label: wakesAt(row) > now ? t.snoozedFor(formatLeft(wakesAt(row) - now)) : t.snooze,
                },
                ...(wakesAt(row) > now ? [{ value: SNOOZE_WAKE, label: t.wake }] : []),
                ...(Object.keys(SNOOZES) as SnoozeId[]).map(id => ({ value: id, label: t.snoozes[id] })),
              ]}
              value={SNOOZE_NONE}
              onSelect={(value: string) => snooze($, snoozeKey(row), value)}
            />
          )}
        </Box>
      </Box>
    )
    // A thin rule closes every card, the last one before a heading included.
    const listRows = (list: readonly Row[]) =>
      list.flatMap(row => [renderRow(row), separator(`separator-${row.key}`, cardColumns)])
    // A list holding conversations of other computers is cut in two: this computer's
    // first, under "Local", then each other computer's under its name.
    const listByPlace = (prefix: string, list: readonly Row[]) => {
      const names = [...new Set(list.flatMap(row => (row.machine === undefined ? [] : [row.machine.name])))]
      const places = [
        ...(list.some(row => row.machine === undefined) ? [undefined] : []),
        ...names.sort((a, b) => a.localeCompare(b)),
      ]
      if (places.length === 1 && places[0] === undefined) {
        return listRows(list)
      }

      // The rule closing each section's last card sets it apart from the next one's name.
      return places.map(place => (
        <Box key={`place-${prefix}-${place ?? 'local'}`} flexDirection="column" gap={1}>
          <Text weight="semibold" dimColor>
            {place === undefined ? t.local : t.machine(place)}
          </Text>
          {listRows(list.filter(row => row.machine?.name === place))}
        </Box>
      ))
    }
    // Each picker with its label above it, laid out in two columns, row by row.
    // The right column's pickers sit against the frame's right edge, label and all.
    const labelled = (key: string, label: string, node: JSX.Element) => ({
      id: key,
      node: (isRight: boolean) => (
        <Box
          key={`picker-${key}`}
          flexDirection="column"
          alignItems={isRight ? 'flex-end' : 'flex-start'}
        >
          <Text dimColor size="caption">
            {label}
          </Text>
          {node}
        </Box>
      ),
    })
    const allPickers =
      Select === undefined
        ? []
        : [
            labelled(
              STATUS_FILTER_ID,
              t.status,
              <Select
                key="status-filter"
                options={statusOptions}
                value={STATUS_SUMMARY}
                onSelect={(value: string) => pickStatus(value)}
              />,
            ),
            labelled(
              PERIOD_FILTER_ID,
              t.period,
              <Select
                key="period-filter"
                options={periodOptions}
                value={period}
                onSelect={(value: string) => savePeriod($, parsePeriod(value), isWideBoard)}
              />,
            ),
            ...flags().map(flag =>
              labelled(
                flag.id,
                flag.label,
                <Select
                  key={`flag-filter-${flag.id}`}
                  options={flagOptions(flag)}
                  value={flagFilter(flag)}
                  onSelect={(value: string) => saveFlagFilter($, flag.id, parseFlagFilter(value), isWideBoard)}
                />,
              ),
            ),
          ]
    // A surface without pickers gets a row of buttons per filter, in the same order.
    const fallbackRows: Record<string, JSX.Element> = {
      [STATUS_FILTER_ID]: (
            <Box key="fallback-status" flexDirection="row" flexWrap="wrap" alignItems="center" gap={1}>
              {statusOptions.slice(1).map(option => (
                <Button
                  key={`only-${option.value}`}
                  label={option.label}
                  plain
                  dimColor={option.label.startsWith('☐')}
                  onPress={() => pickStatus(option.value)}
                />
              ))}
            </Box>
      ),
      [PERIOD_FILTER_ID]: (
            <Box key="fallback-period" flexDirection="row" flexWrap="wrap" alignItems="center" gap={1}>
              {periodOptions.map(option => (
                <Button
                  key={`period-${option.value}`}
                  label={option.label}
                  variant={period === option.value ? 'primary' : undefined}
                  dimColor={period !== option.value}
                  onPress={() => savePeriod($, option.value, isWideBoard)}
                />
              ))}
            </Box>
      ),
      ...Object.fromEntries(
        flags().map(flag => [
          flag.id,

              <Box
                key={`flag-filters-${flag.id}`}
                flexDirection="row"
                flexWrap="wrap"
                alignItems="center"
                gap={1}
              >
                {flagOptions(flag).map(option => (
                  <Button
                    key={`flag-${flag.id}-${option.value}`}
                    label={option.label}
                    variant={option.value === flagFilter(flag) ? 'primary' : undefined}
                    dimColor={option.value !== flagFilter(flag)}
                    onPress={() => saveFlagFilter($, flag.id, option.value, isWideBoard)}
                  />
                ))}
              </Box>
        ]),
      ),
    }
    const pickers = filterIds().flatMap(id => allPickers.filter(picker => picker.id === id))
    // What waits on the person comes first, then each group shown that holds a conversation.
    const sectionList = [
      ...(yourTurn.length > 0
        ? [{ id: 'your-turn', heading: t.yourTurn(yourTurn.length), rows: yourTurn }]
        : []),
      ...(running.length > 0 ? [{ id: 'running', heading: t.runningGroup(running.length), rows: running }] : []),
      ...groups
        .filter(group => isShown(group.id) && group.rows.length > 0)
        .map(group => ({ id: group.id, heading: `${group.label} (${group.rows.length})`, rows: group.rows })),
    ]
    const isWide = isWideBoard && sectionList.length > 1
    if (isWide) {
      cardColumns = Math.floor(columns / sectionList.length) - 3
    }
    const sections = sectionList.map(section => (
      <Box
        key={section.id === 'your-turn' ? 'your-turn' : `group-${section.id}`}
        flexDirection="column"
        gap={1}
        marginTop={1}
        {...(isWide ? { width: `${Math.floor(100 / sectionList.length) - 2}%`, flexGrow: 1, flexShrink: 1 } : {})}
      >
        {/* A line of space under the group's name, before its first row. */}
        <Box key={`heading-${section.id}`} marginBottom={1}>
          <Text weight="bold" size="title">
            {section.heading}
          </Text>
        </Box>
        {listByPlace(section.id, section.rows)}
      </Box>
    ))
    return (
      <Box flexDirection="column" gap={1}>
        <Box key="filters" flexDirection="column" borderStyle="single" borderColor="promptBorder" paddingX={1}>
          {'Input' in elements && (
            <Box key="search-row" flexDirection="column" alignItems="stretch" width="100%">
              <elements.Input
                key="search"
                placeholder={t.search}
                value={query}
                onInput={(value: string) => setSearch($, value)}
                onSubmit={(value: string) => setSearch($, value)}
              />
            </Box>
          )}
          {isSearching && (
            <Box key="search-note" marginTop={1}>
              <Text dimColor size="caption">
                {t.filtersPaused}
              </Text>
            </Box>
          )}
          {/* While a search holds text, only the search shows: the filters wait. */}
          {!isSearching && (
            <Box key="filter-body" flexDirection="column">
          <Box key="rule-search" marginY={1}>
            {separator('rule-search-line')}
          </Box>
          {Select === undefined ? (
          <Box flexDirection="column" gap={1}>
            {filterIds().map(id => fallbackRows[id])}
          </Box>
        ) : isWideBoard ? (
          // A wide board: every picker on one line, from the left, close together.
          <Box key="filter-line" flexDirection="row" flexWrap="wrap" alignItems="flex-start" gap={4}>
            {pickers.map(picker => picker.node(false))}
          </Box>
        ) : (
          <Box flexDirection="column" gap={1}>
            <Box flexDirection="row" alignItems="flex-start" gap={3}>
              {[0, 1].map(column => (
                <Box
                  key={`filter-column-${column}`}
                  flexDirection="column"
                  alignItems={column === 1 ? 'flex-end' : 'flex-start'}
                  gap={1}
                  flexGrow={1}
                  flexShrink={1}
                >
                  {pickers
                    .filter((_, index) => index % 2 === column)
                    .map(picker => picker.node(column === 1))}
                </Box>
              ))}
            </Box>
          </Box>
          )}
          <Box key="rule-refresh" marginY={1}>
            {separator('rule-refresh-line')}
          </Box>
          <Box key="refresh-row" flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
            <Button
              key="show-snoozed"
              plain
              label={t.showSnoozed(isShowingSnoozed, snoozedCount)}
              dimColor={!isShowingSnoozed}
              onPress={() => saveShowSnoozed($, !isShowingSnoozed, isWideBoard)}
            />
            <Button
              key="refresh"
              label={t.refresh}
              onPress={async () => {
                await refreshAll($)
                const keys = new Set([...shown, ...yourTurn].map(row => row.hostId))
                await refreshGitFor(
                  $,
                  (await read($, desktop)).filter(session => keys.has(session.hostId)),
                )
              }}
            />
          </Box>
            </Box>
          )}
        </Box>
        {sectionList.length === 0 && (
          <Text dimColor>{query.trim() === '' ? t.empty : t.noMatch(query.trim())}</Text>
        )}
        {isWide ? (
          // A wide board: one column per group, side by side, what waits on you first.
          <Box key="board-columns" flexDirection="row" alignItems="flex-start" gap={3}>
            {sections}
          </Box>
        ) : (
          sections
        )}
      </Box>
    )
  })
}

async function setStatus($: EngineInterface, status: string): Promise<void> {
  const entry = await ensureEntry($)
  await saveEntry($, { ...entry, status })
}

async function setNote($: EngineInterface, text: string): Promise<void> {
  const { note: _cleared, ...entry } = await ensureEntry($)
  const note = text.length > NOTE_MAX ? `${text.slice(0, NOTE_MAX - 1)}…` : text
  await saveEntry($, note === '' ? entry : { ...entry, note })
}

async function setFlag($: EngineInterface, id: string, isOn: boolean): Promise<void> {
  const entry = await ensureEntry($)
  const flagsSet = { ...entry.flags }
  if (isOn) {
    flagsSet[id] = true
  } else {
    delete flagsSet[id]
  }
  await saveEntry($, { ...entry, flags: flagsSet })
}

async function ensureEntry($: EngineInterface): Promise<Entry> {
  const entry = await read($, current)
  if (entry !== null) {
    return entry
  }

  return createEntry($, (await findFirstPrompt($)) ?? config.texts.untitled)
}

async function createEntry($: EngineInterface, text: string): Promise<Entry> {
  return {
    sessionId: await $.session.id(),
    hostId: await findHostId($),
    label: toLabel(text),
    folder: basename(await $.session.cwd()),
    status: statuses()[0]?.id ?? null,
    flags: {},
    updatedAt: await $.clock.now(),
  }
}

async function saveEntry($: EngineInterface, entry: Entry): Promise<void> {
  await persistEntry($, { ...entry, updatedAt: await $.clock.now() })
}

async function persistEntry($: EngineInterface, entry: Entry): Promise<void> {
  await storeEntry($, entry)
  await update($, current, () => entry)
  await update($, all, list => [
    ...list.filter(one => entryKey(one) !== entryKey(entry)),
    entry,
  ])
  // The other computers see the new status without waiting for a refresh.
  await syncMachines($).catch(() => undefined)
}

async function storeEntry($: EngineInterface, entry: Entry): Promise<void> {
  await $.store.set(entryKey(entry), entry)
  if (entry.hostId !== undefined) {
    await $.store.delete(storeKey(entry.sessionId))
  }
}

async function removeEntry($: EngineInterface, entry: Entry): Promise<void> {
  await $.store.delete(entryKey(entry))
  await $.store.delete(storeKey(entry.sessionId))
  await update($, all, list => list.filter(one => entryKey(one) !== entryKey(entry)))
  await syncMachines($).catch(() => undefined)
}

// The board's filters, shared by every conversation so the board opens as it was left.
// A flag filter is kept by the flag's id, so it outlives a flag removed then added back.
type Filters = BoardFilters

const FILTERS_KEY = 'filters'
// A wide board's own filters; until it has any, it starts from the side panel's.
const WIDE_FILTERS_KEY = 'filtersWide'

async function saveFilters(
  $: EngineInterface,
  isWide: boolean,
  change: (filters: Filters) => Filters,
): Promise<void> {
  const filters = change(await readStoredFilters($, isWide))
  await storeFilters($, filters, isWide)
  await applyFilters($, filters, isWide)
  // A wide board with no filters of its own yet follows the side panel's.
  if (!isWide) {
    await applyFilters($, await readStoredFilters($, true), true)
  }
}

async function saveStatusFilter($: EngineInterface, status: StatusFilter, isWide = false): Promise<void> {
  await saveFilters($, isWide, filters => ({ ...filters, status }))
}

async function savePeriod($: EngineInterface, period: Period, isWide = false): Promise<void> {
  await saveFilters($, isWide, filters => ({ ...filters, period }))
}

async function saveFlagFilter(
  $: EngineInterface,
  id: string,
  value: FlagFilter,
  isWide = false,
): Promise<void> {
  await saveFilters($, isWide, filters => ({ ...filters, flags: { ...filters.flags, [id]: value } }))
}

// The filters as kept: the snoozed conversations' toggle only once it is on.
async function storeFilters($: EngineInterface, filters: Filters, isWide = false): Promise<void> {
  const { showSnoozed: isShowingSnoozed, ...rest } = filters
  await $.store.set(isWide ? WIDE_FILTERS_KEY : FILTERS_KEY, isShowingSnoozed ? filters : rest)
}

async function saveShowSnoozed($: EngineInterface, isOn: boolean, isWide = false): Promise<void> {
  await saveFilters($, isWide, filters => ({ ...filters, showSnoozed: isOn }))
}

async function loadFilters($: EngineInterface): Promise<void> {
  await applyFilters($, await readStoredFilters($))
  await applyFilters($, await readStoredFilters($, true), true)
}

const SNOOZES_KEY = 'snoozes'
// The longest snooze: a snooze set or a wake-up made longer ago than this is moot.
const SNOOZE_KEPT_MS = 24 * 3_600_000

// This computer's snoozes and wake-ups, shared by every conversation's board, and
// published to the other computers. A wake-up is kept a while as `until: 0`, so it
// outweighs the snooze another computer set before it.
async function readStoredSnoozes($: EngineInterface): Promise<Record<string, Snooze>> {
  return parseSnoozes(await $.store.get(SNOOZES_KEY), await $.clock.now())
}

function parseSnoozes(value: unknown, now: number): Record<string, Snooze> {
  const kept: Record<string, Snooze> = {}
  if (typeof value !== 'object' || value === null) {
    return kept
  }
  for (const [key, one] of Object.entries(value as Record<string, unknown>)) {
    const snooze = one as Partial<Snooze> | null
    if (
      typeof snooze?.until === 'number' &&
      typeof snooze.setAt === 'number' &&
      Number.isFinite(snooze.until) &&
      Number.isFinite(snooze.setAt) &&
      snooze.setAt + SNOOZE_KEPT_MS > now
    ) {
      kept[key] = { until: snooze.until, setAt: snooze.setAt }
    }
  }

  return kept
}

// When each conversation wakes up: of every computer's word on it, the last one said wins.
function mergeSnoozes(lists: readonly Readonly<Record<string, Snooze>>[]): Record<string, number> {
  const latest = new Map<string, Snooze>()
  for (const list of lists) {
    for (const [key, snooze] of Object.entries(list)) {
      const known = latest.get(key)
      if (known === undefined || snooze.setAt > known.setAt) {
        latest.set(key, snooze)
      }
    }
  }

  return Object.fromEntries(
    [...latest.entries()]
      .filter(([, snooze]) => snooze.until > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, snooze]) => [key, snooze.until]),
  )
}

async function loadSnoozes($: EngineInterface): Promise<void> {
  const merged = mergeSnoozes([
    await readStoredSnoozes($),
    ...(await read($, remote)).map(machine => machine.snoozes),
  ])
  if (JSON.stringify(await read($, snoozes)) !== JSON.stringify(merged)) {
    await update($, snoozes, () => merged)
  }
}

// Snoozes a conversation for one of the SNOOZES, or wakes it up.
async function snooze($: EngineInterface, key: string, choice: string): Promise<void> {
  const length = SNOOZES[choice as SnoozeId]
  if (choice !== SNOOZE_WAKE && length === undefined) {
    return
  }
  const now = await $.clock.now()
  const next = {
    ...(await readStoredSnoozes($)),
    [key]: { until: length === undefined ? 0 : now + length, setAt: now },
  }
  await $.store.set(SNOOZES_KEY, next)
  await loadSnoozes($)
  // The other computers hear of it at once, not on the next refresh.
  await publishOwn($).catch(() => undefined)
}

function snoozeKey(row: Pick<Row, 'hostId' | 'key'>): string {
  return row.hostId ?? row.key
}

function isSnoozed(asleep: Readonly<Record<string, number>>, key: string | undefined, now: number): boolean {
  return key !== undefined && (asleep[key] ?? 0) > now
}

async function setSearch($: EngineInterface, value: string): Promise<void> {
  if ((await read($, searchQuery)) !== value) {
    await update($, searchQuery, () => value)
  }
}

// A row matches when each word of the search is in its title, folder, ticket or
// note, in any case and with or without accents.
function matchesSearch(row: Row, query: string): boolean {
  const words = toSearchText(query)
    .split(' ')
    .filter(word => word !== '')
  if (words.length === 0) {
    return true
  }
  const text = toSearchText(
    [row.title, row.folder, findTicket(row.title)?.label ?? '', row.entry?.note ?? ''].join(' '),
  )

  return words.every(word => text.includes(word))
}

function toSearchText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function applyFilters($: EngineInterface, filters: Filters, isWide = false): Promise<void> {
  if (isWide) {
    if (JSON.stringify(await read($, wideFilters)) !== JSON.stringify(filters)) {
      await update($, wideFilters, () => filters)
    }
    return
  }
  if (JSON.stringify(await read($, statusFilter)) !== JSON.stringify(filters.status)) {
    await update($, statusFilter, () => filters.status)
  }
  if ((await read($, periodFilter)) !== filters.period) {
    await update($, periodFilter, () => filters.period)
  }
  if (JSON.stringify(await read($, flagFilters)) !== JSON.stringify(filters.flags)) {
    await update($, flagFilters, () => filters.flags)
  }
  if ((await read($, showSnoozed)) !== filters.showSnoozed) {
    await update($, showSnoozed, () => filters.showSnoozed)
  }
}

async function readStoredFilters($: EngineInterface, isWide = false): Promise<Filters> {
  const kept = isWide ? await $.store.get(WIDE_FILTERS_KEY) : undefined
  if (isWide && (typeof kept !== 'object' || kept === null)) {
    return readStoredFilters($)
  }
  const stored = isWide ? kept : await $.store.get(FILTERS_KEY)
  const value =
    typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {}

  const flagsKept: Record<string, FlagFilter> = {}
  if (typeof value.flags === 'object' && value.flags !== null) {
    for (const [id, one] of Object.entries(value.flags as Record<string, unknown>)) {
      flagsKept[id] = parseFlagFilter(typeof one === 'string' ? one : '')
    }
  }
  // Filters an earlier version kept for its two fixed flags.
  const legacy: Record<string, { id: string; values: Record<string, FlagFilter> }> = {
    kind: { id: 'perso', values: { perso: 'oui', job: 'non' } },
    remote: { id: 'remote', values: { remote: 'oui', local: 'non' } },
  }
  for (const [field, { id, values }] of Object.entries(legacy)) {
    const kept = typeof value[field] === 'string' ? values[value[field] as string] : undefined
    if (kept !== undefined && flagsKept[id] === undefined) {
      flagsKept[id] = kept
    }
  }

  const status = readStoredStatusFilter(value.status)

  return {
    status,
    period: parsePeriod(typeof value.period === 'string' ? value.period : ''),
    flags: flagsKept,
    showSnoozed: value.showSnoozed === true,
  }
}

// Refreshes the data, and redraws the board while it is shown: the ages and the
// order move with time even when no data changed.
// When the data was last read; a board drawn long after reads it again.
let lastRefreshAt = 0
let lastPaneColumns = 0

// The quick reread while a shown board has a spinner: a mod hears no other
// conversation's turn end, so the board looks again soon. It never asks git.
let runningTimer: Timer | undefined

async function refreshBoard($: EngineInterface): Promise<void> {
  await refreshAll($)
  const isShown = (await $.ui.panes()).some(pane => pane.id === PANE && pane.isShown)
  if (isShown) {
    await update($, tick, value => value + 1)
  }
  const now = await $.clock.now()
  const isSpinning = (await readAllSessions($)).some(
    session => !session.isArchived && isRunning(session, now),
  )
  if (isShown && isSpinning) {
    startRunningRefresh($)
  } else {
    stopRunningRefresh()
  }
}

function startRunningRefresh($: EngineInterface): void {
  runningTimer ??= $.clock.after(RUNNING_REFRESH_MS, () => {
    runningTimer = undefined
    void refreshBoard($).catch(() => undefined)
  })
}

function stopRunningRefresh(): void {
  runningTimer?.cancel()
  runningTimer = undefined
}

async function refreshAll($: EngineInterface): Promise<void> {
  lastRefreshAt = await $.clock.now()
  await loadFilters($)
  const sessions = await scanDesktop($)
  const byHost = new Map<string, Entry>()
  const legacy: Entry[] = []
  for (const key of await $.store.keys()) {
    const value = readEntry(await $.store.get(key))
    if (value === null) {
      continue
    }
    if (key.startsWith(HOST_KEY_PREFIX)) {
      byHost.set(key, value)
    } else if (key.startsWith(KEY_PREFIX)) {
      legacy.push(value)
    }
  }

  // Move entries kept under a CLI id to the conversation's local_ id; an older
  // version of the mod in another conversation may still write the CLI key.
  const entries: Entry[] = []
  for (const entry of legacy) {
    const hostId =
      entry.hostId ??
      sessions.find(
        session =>
          session.cliSessionId === entry.sessionId ||
          session.priorCliSessionIds.includes(entry.sessionId),
      )?.hostId
    if (hostId === undefined) {
      entries.push(entry)
      continue
    }
    const moved = { ...entry, hostId }
    const kept = byHost.get(entryKey(moved))
    if (kept === undefined || kept.updatedAt < moved.updatedAt) {
      byHost.set(entryKey(moved), moved)
      await $.store.set(entryKey(moved), moved)
    }
    await $.store.delete(storeKey(entry.sessionId))
  }
  entries.push(...byHost.values())
  entries.sort((a, b) => entryKey(a).localeCompare(entryKey(b)))

  const known = await read($, all)
  const sortedKnown = [...known].sort((a, b) => entryKey(a).localeCompare(entryKey(b)))
  if (JSON.stringify(sortedKnown) !== JSON.stringify(entries)) {
    await update($, all, () => entries)
  }

  if (JSON.stringify(await read($, desktop)) !== JSON.stringify(sessions)) {
    await update($, desktop, () => sessions)
  }
  await loadGit($)
  await syncMachines($).catch(() => undefined)
  await loadSnoozes($)
}

// Sharing between computers: each one writes a single file of its own in the sync
// folder, machines/<id>.json, with its conversations, their statuses and its git
// answers, and reads the others'. No computer writes another's file: there is
// nothing to merge. A conversation's status is set where the conversation runs.
const MACHINE_KEY = 'machine'
let machineId: string | undefined
let machineName: string | undefined
// The text this conversation last wrote, so an unchanged file is not written again.
let lastPublished: string | undefined
// A parsed file per path, kept while the file's time does not change.
const machineFiles = new Map<string, { mtimeMs: number; machine: RemoteMachine | null }>()

// This computer's conversations, then those the other computers shared.
async function readAllSessions($: EngineInterface): Promise<DesktopSession[]> {
  return [...(await read($, desktop)), ...(await read($, remote)).flatMap(machine => machine.sessions)]
}

async function syncMachines($: EngineInterface): Promise<void> {
  if (config.syncFolder === undefined) {
    return
  }
  await publishOwn($)
  const machines = await readMachines($)
  if (JSON.stringify(await read($, remote)) !== JSON.stringify(machines)) {
    await update($, remote, () => machines)
  }
}

async function findSyncFolder($: EngineInterface): Promise<string | undefined> {
  const folder = config.syncFolder
  if (folder === undefined) {
    return undefined
  }
  if (folder === '~' || folder.startsWith('~/')) {
    const home = await $.env.get('HOME')

    return home === undefined ? undefined : `${home}${folder.slice(1)}`
  }

  return folder
}

// This computer's id: drawn once, then kept in the store.
async function findMachineId($: EngineInterface): Promise<string> {
  if (machineId !== undefined) {
    return machineId
  }
  const stored = await $.store.get(MACHINE_KEY)
  const kept = typeof stored === 'object' && stored !== null ? (stored as { id?: unknown }).id : undefined
  if (typeof kept === 'string' && /^[a-z0-9-]{8,64}$/i.test(kept)) {
    machineId = kept
  } else {
    machineId = crypto.randomUUID()
    await $.store.set(MACHINE_KEY, { id: machineId })
  }

  return machineId
}

// The name the other computers show: the option, else the computer's own name.
async function findMachineName($: EngineInterface): Promise<string> {
  if (config.machineName !== undefined) {
    return config.machineName
  }
  if (machineName !== undefined) {
    return machineName
  }
  const platform = await findPlatform($)
  const asked =
    platform === 'windows'
      ? await $.env.get('COMPUTERNAME')
      : await $.process
          .run(platform === 'mac' ? ['scutil', '--get', 'ComputerName'] : ['hostname'], {
            timeoutMs: 5_000,
          })
          .then(ran => (ran.exitCode === 0 ? ran.stdout.trim() : undefined))
          .catch(() => undefined)
  machineName = asked === undefined || asked === '' ? 'Mac' : asked.slice(0, 40)

  return machineName
}

async function publishOwn($: EngineInterface): Promise<void> {
  const folder = await findSyncFolder($)
  // Before this conversation first read the records, it would publish an empty list.
  if (folder === undefined || lastRefreshAt === 0) {
    return
  }
  const sessions = (await read($, desktop)).filter(session => !session.isArchived)
  const hostIds = new Set(sessions.map(session => session.hostId))
  const archived = new Set(
    (await read($, desktop)).filter(session => session.isArchived).map(session => session.hostId),
  )
  const entries = (await read($, all)).filter(
    entry => entry.hostId === undefined || !archived.has(entry.hostId),
  )
  const keys = new Set(
    sessions.flatMap(session => (session.branches ?? []).map(one => gitKey(one.repo, one.branch))),
  )
  const git = Object.fromEntries(
    Object.entries(await read($, gitStates)).filter(([key]) => keys.has(key)),
  )
  const id = await findMachineId($)
  const machine: RemoteMachine = {
    machineId: id,
    name: await findMachineName($),
    sessions: sessions.filter(session => hostIds.has(session.hostId)),
    entries,
    git,
    snoozes: await readStoredSnoozes($),
  }
  const text = JSON.stringify(machine)
  if (text === lastPublished) {
    return
  }
  await $.fs.write(`${folder}/machines/${id}.json`, text)
  lastPublished = text
}

async function readMachines($: EngineInterface): Promise<RemoteMachine[]> {
  const folder = await findSyncFolder($)
  if (folder === undefined) {
    return []
  }
  const id = await findMachineId($)
  const machines: RemoteMachine[] = []
  for (const file of await $.fs.list(`${folder}/machines`).catch(() => [])) {
    // A file iCloud has not downloaded is a .icloud stand-in: it is skipped.
    if (file.kind !== 'file' || !file.name.endsWith('.json') || file.name === `${id}.json`) {
      continue
    }
    const path = `${folder}/machines/${file.name}`
    let known = machineFiles.get(path)
    if (known === undefined || known.mtimeMs !== file.mtimeMs) {
      const text = await $.fs.read(path).catch(() => null)
      known = { mtimeMs: file.mtimeMs, machine: text === null ? null : parseMachine(text, id) }
      machineFiles.set(path, known)
    }
    if (known.machine !== null) {
      machines.push(known.machine)
    }
  }

  return machines.sort((a, b) => a.machineId.localeCompare(b.machineId))
}

// Another computer's file, as far as it reads; anything unexpected is left out.
function parseMachine(text: string, ownId: string): RemoteMachine | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const record = value as Record<string, unknown>
  if (typeof record.machineId !== 'string' || record.machineId === ownId) {
    return null
  }
  const list = (field: unknown): unknown[] => (Array.isArray(field) ? field : [])
  const git: Record<string, GitState> = {}
  if (typeof record.git === 'object' && record.git !== null) {
    for (const [key, state] of Object.entries(record.git as Record<string, unknown>)) {
      const one = state as Record<string, unknown> | null
      if (
        typeof one?.isDirty === 'boolean' &&
        typeof one.unpushed === 'number' &&
        typeof one.isMerged === 'boolean'
      ) {
        git[key] = { isDirty: one.isDirty, unpushed: one.unpushed, isMerged: one.isMerged }
      }
    }
  }

  return {
    machineId: record.machineId,
    name: typeof record.name === 'string' && record.name.trim() !== '' ? record.name.slice(0, 40) : '?',
    sessions: list(record.sessions).flatMap(one => {
      const session = parseSharedSession(one)

      return session === null ? [] : [session]
    }),
    entries: list(record.entries).flatMap(one => {
      const entry = readEntry(one)

      return entry === null ? [] : [entry]
    }),
    git,
    // The other computer pruned them; past ones are moot here.
    snoozes: parseSnoozes(record.snoozes, Number.NEGATIVE_INFINITY),
  }
}

function parseSharedSession(value: unknown): DesktopSession | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const one = value as Record<string, unknown>
  if (
    typeof one.hostId !== 'string' ||
    !/^local_[A-Za-z0-9-]{1,64}$/.test(one.hostId) ||
    typeof one.cliSessionId !== 'string' ||
    typeof one.title !== 'string' ||
    typeof one.folder !== 'string' ||
    typeof one.lastActivityAt !== 'number'
  ) {
    return null
  }
  const pr = one.pr as Record<string, unknown> | undefined
  const branches = Array.isArray(one.branches)
    ? one.branches.flatMap(item => {
        const branch = item as Record<string, unknown> | null
        return typeof branch?.repo === 'string' && typeof branch.branch === 'string'
          ? [{ repo: branch.repo, branch: branch.branch }]
          : []
      })
    : []

  return {
    cliSessionId: one.cliSessionId,
    hostId: one.hostId,
    title: one.title,
    folder: one.folder,
    lastActivityAt: one.lastActivityAt,
    isArchived: one.isArchived === true,
    priorCliSessionIds: Array.isArray(one.priorCliSessionIds)
      ? one.priorCliSessionIds.filter((id): id is string => typeof id === 'string')
      : [],
    ...(typeof one.summary === 'string' ? { summary: one.summary } : {}),
    ...(one.attention === 'blocked' || one.attention === 'review_ready' ? { attention: one.attention } : {}),
    ...(typeof pr?.number === 'number' && typeof pr.state === 'string'
      ? { pr: { number: pr.number, state: pr.state } }
      : {}),
    ...(branches.length > 0 ? { branches } : {}),
    ...(typeof one.turnStartedAt === 'number' ? { turnStartedAt: one.turnStartedAt } : {}),
    ...parseRemoteId([one.remoteId]),
    ...(typeof one.writtenAt === 'number' ? { writtenAt: one.writtenAt } : {}),
  }
}

// Git is asked about the conversation one comes into, after Claude's git commands
// there, and about every row shown when ↻ is pressed. Answers are kept per branch
// in the store, shared by every conversation; other rows show the last one known.
const GIT_KEY = 'git'
// Coming into a conversation draws its band; within this long it is not asked again.
const GIT_ENTER_MS = 30_000
let lastOwnGitAt = Number.NEGATIVE_INFINITY
let isGitRunning = false
// The git commands that change a branch: what was committed, pushed or merged.
const GIT_CHANGE =
  /\bgit\b[^\n;&|]*\s(commit|push|pull|merge|rebase|checkout|switch|reset|cherry-pick|revert|am|stash)\b/

async function readStoredGit($: EngineInterface): Promise<Record<string, GitState>> {
  const stored = await $.store.get(GIT_KEY)
  const states =
    typeof stored === 'object' && stored !== null ? (stored as { states?: unknown }).states : undefined

  return typeof states === 'object' && states !== null ? (states as Record<string, GitState>) : {}
}

// Shows what other conversations learned of git: no git command runs.
async function loadGit($: EngineInterface): Promise<void> {
  const states = await readStoredGit($)
  if (JSON.stringify(await read($, gitStates)) !== JSON.stringify(states)) {
    await update($, gitStates, () => states)
  }
}

// Asks git about the given sessions' branches, and adds the answers to the store.
async function refreshGitFor($: EngineInterface, sessions: readonly DesktopSession[]): Promise<void> {
  if (isGitRunning) {
    return
  }
  isGitRunning = true
  try {
    const fresh = await readGitStates($, sessions)
    const states = { ...(await readStoredGit($)), ...fresh }
    await $.store.set(GIT_KEY, { states })
    if (JSON.stringify(await read($, gitStates)) !== JSON.stringify(states)) {
      await update($, gitStates, () => states)
    }
  } finally {
    isGitRunning = false
  }
}

// The conversation one is in: asked when one comes into it, at most every 30 seconds.
async function refreshOwnGit($: EngineInterface, isForced = false): Promise<void> {
  const now = await $.clock.now()
  if (!isForced && now - lastOwnGitAt < GIT_ENTER_MS) {
    return
  }
  lastOwnGitAt = now
  const hostId = await findHostId($)
  const own = (await read($, desktop)).filter(session => session.hostId === hostId)
  if (own.length > 0) {
    await refreshGitFor($, own)
  }
}

function gitKey(repo: string, branch: string): string {
  return `${repo}\u0000${branch}`
}

async function readGitStates(
  $: EngineInterface,
  sessions: readonly DesktopSession[],
): Promise<Record<string, GitState>> {
  const wanted = new Map<string, { repo: string; branch: string; pr?: { state: string } }>()
  for (const session of sessions) {
    if (session.isArchived) {
      continue
    }
    for (const one of session.branches ?? []) {
      wanted.set(gitKey(one.repo, one.branch), { ...one, ...(session.pr === undefined ? {} : { pr: session.pr }) })
    }
  }
  // One status per repository: which branch it is on, and whether files changed.
  const heads = new Map<string, { branch: string; isDirty: boolean } | null>()
  const states: Record<string, GitState> = {}
  for (const [key, one] of wanted) {
    if (!heads.has(one.repo)) {
      heads.set(one.repo, await readHead($, one.repo))
    }
    states[key] = await readGitState($, one.repo, one.branch, heads.get(one.repo) ?? null, one.pr)
  }

  return states
}

async function runGit($: EngineInterface, repo: string, args: readonly string[]): Promise<string | null> {
  const ran = await $.process.run(['git', '-C', repo, ...args], { timeoutMs: 10_000 }).catch(() => null)

  return ran === null || ran.exitCode !== 0 ? null : ran.stdout.trim()
}

async function readHead(
  $: EngineInterface,
  repo: string,
): Promise<{ branch: string; isDirty: boolean } | null> {
  const branch = await runGit($, repo, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch === null) {
    return null
  }
  // Untracked files are left out: listing them takes seconds in a large repository.
  const status = await runGit($, repo, ['status', '--porcelain', '--untracked-files=no'])

  return { branch, isDirty: status !== null && status !== '' }
}

// Uncommitted only shows on the branch the folder is on: git has one working copy
// a folder. Unpushed counts the commits no remote has, merges aside. A merged pull request
// settles merged; otherwise the default branch must hold the branch's tip.
async function readGitState(
  $: EngineInterface,
  repo: string,
  branch: string,
  head: { branch: string; isDirty: boolean } | null,
  pr: { state: string } | undefined,
): Promise<GitState> {
  const isDirty = head?.branch === branch && head.isDirty
  const unpushed = Number(
    (await runGit($, repo, [
      'rev-list',
      '--count',
      // A merge of the default branch into a work branch, kept local on purpose, is no work to push.
      '--no-merges',
      `refs/heads/${branch}`,
      '--not',
      '--remotes',
    ])) ?? '0',
  )
  const defaultRef =
    (await runGit($, repo, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])) ?? 'origin/main'
  const isDefault = defaultRef.replace(/^origin\//, '') === branch
  let isMerged = true
  if (!isDefault) {
    const prState = pr?.state.toUpperCase()
    if (prState === 'MERGED') {
      isMerged = true
    } else if (prState === 'OPEN' || prState === 'DRAFT') {
      isMerged = false
    } else {
      const exists = (await runGit($, repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])) !== null
      isMerged =
        !exists ||
        (await $.process
          .run(['git', '-C', repo, 'merge-base', '--is-ancestor', `refs/heads/${branch}`, defaultRef], {
            timeoutMs: 10_000,
          })
          .then(ran => ran.exitCode === 0)
          .catch(() => true))
    }
  }

  return { isDirty, unpushed: Number.isFinite(unpushed) ? unpushed : 0, isMerged }
}

// The row's git signs, over every branch it committed on.
function describeGit(
  row: Row,
  git: Readonly<Record<string, GitState>>,
): { mark: string; word: string }[] {
  const states = (row.branches ?? []).flatMap(one => {
    const state = git[gitKey(one.repo, one.branch)]

    return state === undefined ? [] : [state]
  })
  const unpushed = states.reduce((sum, state) => sum + state.unpushed, 0)

  return [
    ...(states.some(state => state.isDirty) ? [{ mark: '✎', word: config.texts.uncommitted }] : []),
    ...(unpushed > 0 ? [{ mark: `↑${unpushed}`, word: config.texts.unpushed }] : []),
    ...(states.some(state => !state.isMerged) ? [{ mark: '⑂', word: config.texts.unmerged }] : []),
  ]
}

// The desktop panes only follow https links, so the app's own link is opened by the system.
async function openConversation($: EngineInterface, hostId: string | undefined): Promise<void> {
  if (hostId === undefined) {
    return
  }
  if (!(await openUrl($, `claude://claude.ai/epitaxy/${hostId}`))) {
    $.ui.toast(config.texts.openFailed)
  }
}

type Platform = 'mac' | 'windows' | 'linux'

// The mod has no platform API: the environment tells the systems apart.
async function findPlatform($: EngineInterface): Promise<Platform> {
  if ((await $.env.get('OS')) === 'Windows_NT') {
    return 'windows'
  }
  const home = (await $.env.get('HOME')) ?? ''
  const isMac =
    home.startsWith('/Users/') || (await $.env.get('__CF_USER_TEXT_ENCODING')) !== undefined

  return isMac ? 'mac' : 'linux'
}

// Opens a link with the system's own opener; true when it ran.
async function openUrl($: EngineInterface, url: string): Promise<boolean> {
  const platform = await findPlatform($)
  const argv =
    platform === 'mac'
      ? ['/usr/bin/open', url]
      : platform === 'windows'
        ? ['rundll32', 'url.dll,FileProtocolHandler', url]
        : ['xdg-open', url]
  const opened = await $.process.run(argv).catch(() => null)

  return opened !== null && opened.exitCode === 0
}

// One line of the board: a desktop conversation, or a status kept for a
// conversation the desktop app does not list.
type Row = {
  branches?: { repo: string; branch: string }[]
  key: string
  hostId?: string
  title: string
  folder: string
  lastActivityAt: number
  entry?: Entry
  isDesktop: boolean
  summary?: string
  attention?: 'blocked' | 'review_ready'
  pr?: { number: number; state: string }
  turnStartedAt?: number
  remoteId?: string
  writtenAt?: number
  // Set on a conversation of another computer: its name and what its git said.
  machine?: { name: string; git: Record<string, GitState> }
}

// Every row: this computer's, then each other computer's, newest first. A conversation
// this computer lists itself is not taken from another's file.
function buildAllRows(
  sessions: readonly DesktopSession[],
  entries: readonly Entry[],
  machines: readonly RemoteMachine[],
): Row[] {
  const local = buildRows(sessions, entries)
  const seen = new Set(local.flatMap(row => [row.key, ...(row.hostId === undefined ? [] : [row.hostId])]))
  // One conversation may sit in several files of one computer: an older copy of the mod
  // wrote under another id. It is drawn once: its latest activity, with its latest status.
  const others = new Map<string, Row>()
  for (const machine of machines) {
    for (const row of buildRows(machine.sessions, machine.entries)) {
      if (seen.has(row.key) || (row.hostId !== undefined && seen.has(row.hostId))) {
        continue
      }
      const id = row.hostId ?? row.key
      const known = others.get(id)
      const shared = { ...row, machine: { name: machine.name, git: machine.git } }
      if (known === undefined) {
        others.set(id, shared)
        continue
      }
      const newer = shared.lastActivityAt > known.lastActivityAt ? shared : known
      const entry =
        (shared.entry?.updatedAt ?? -1) > (known.entry?.updatedAt ?? -1) ? shared.entry : known.entry
      others.set(id, { ...newer, entry })
    }
  }
  // Two rows of one key would break the board: a key already drawn is left out.
  const keys = new Set<string>()
  const remoteRows = [...others.values()].filter(row => {
    if (keys.has(row.key)) {
      return false
    }
    keys.add(row.key)

    return true
  })

  return [...local, ...remoteRows].sort((a, b) => b.lastActivityAt - a.lastActivityAt)
}

// A parsed record per file, kept while the file's time does not change.
const desktopFiles = new Map<
  string,
  { mtimeMs: number; session: DesktopSession | null; cwd: string | undefined }
>()

function parseCwd(text: string): string | undefined {
  try {
    const cwd = (JSON.parse(text) as { cwd?: unknown }).cwd

    return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
  } catch {
    return undefined
  }
}

// The transcript tells best whether a turn runs: Claude Code ends each turn with an
// answer that ends it, then the stop hooks' summary, while a running turn ends with a
// tool call, its result or the person's message. The app's record misses turns some
// conversations run, such as one driven from another device without turn summaries.
// Only a conversation active lately is looked at, and a transcript is read again only
// once it changed.
const TRANSCRIPT_WINDOW_MS = 12 * HOUR_MS
const TRANSCRIPT_TAIL_BYTES = 200_000
const transcripts = new Map<string, { mtimeMs: number; isRunning: boolean | undefined }>()

async function applyTranscript(
  $: EngineInterface,
  session: DesktopSession,
  cwd: string | undefined,
): Promise<DesktopSession> {
  if (session.isArchived || cwd === undefined) {
    return session
  }
  const home = await $.env.get('HOME')
  if (home === undefined || (await $.clock.now()) - session.lastActivityAt > TRANSCRIPT_WINDOW_MS) {
    return session
  }
  const path = `${home}/.claude/projects/${cwd.replace(/[^A-Za-z0-9]/g, '-')}/${session.cliSessionId}.jsonl`
  const stat = await $.fs.stat(path).catch(() => undefined)
  if (stat === undefined) {
    return session
  }
  let known = transcripts.get(path)
  if (known === undefined || known.mtimeMs !== stat.mtimeMs) {
    known = { mtimeMs: stat.mtimeMs, isRunning: await readTranscriptTurn($, path, stat.size) }
    transcripts.set(path, known)
  }
  if (known.isRunning === undefined) {
    return session
  }
  const { turnStartedAt: _dropped, writtenAt: _old, ...ended } = session

  return known.isRunning
    ? { ...ended, turnStartedAt: session.turnStartedAt ?? session.lastActivityAt, writtenAt: stat.mtimeMs }
    : ended
}

// Whether the transcript's last turn still runs; undefined when it cannot tell.
async function readTranscriptTurn(
  $: EngineInterface,
  path: string,
  size: number,
): Promise<boolean | undefined> {
  const isWindows = (await findPlatform($)) === 'windows'
  const text = isWindows
    ? size <= TRANSCRIPT_TAIL_BYTES
      ? await $.fs.read(path).catch(() => null)
      : null
    : await $.process
        .run(['tail', '-c', String(TRANSCRIPT_TAIL_BYTES), path], { timeoutMs: 5_000 })
        .then(ran => (ran.exitCode === 0 ? ran.stdout : null))
        .catch(() => null)

  return text === null ? undefined : findTurnState(text)
}

function findTurnState(text: string): boolean | undefined {
  const lines = text.split('\n')
  for (let index = lines.length - 1; index >= 0; index--) {
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(lines[index] ?? '') as Record<string, unknown>
    } catch {
      continue
    }
    const message = (entry.message ?? {}) as Record<string, unknown>
    if (entry.type === 'system') {
      if (entry.subtype === 'stop_hook_summary' || entry.subtype === 'turn_duration') {
        return false
      }
      continue
    }
    if (entry.type === 'assistant') {
      const reason = message.stop_reason
      return !(reason === 'end_turn' || reason === 'stop_sequence' || reason === 'max_tokens' || reason === 'refusal')
    }
    if (entry.type === 'user') {
      if (entry.isMeta === true) {
        continue
      }
      const content = message.content
      const said = typeof content === 'string' ? content : JSON.stringify(content ?? '')
      return !said.includes('[Request interrupted')
    }
  }

  return undefined
}

// The desktop app keeps one JSON record per conversation, with the title the
// sidebar shows. The format is the app's own: anything unexpected is skipped.
async function scanDesktop($: EngineInterface): Promise<DesktopSession[]> {
  const sessions: DesktopSession[] = []
  for (const folder of await findDesktopFolders($)) {
    const files = await $.fs.list(folder).catch(() => [])
    for (const file of files) {
      if (file.kind !== 'file' || !/^local_.*\.json$/.test(file.name)) {
        continue
      }
      const path = `${folder}/${file.name}`
      let known = desktopFiles.get(path)
      if (known === undefined || known.mtimeMs !== file.mtimeMs) {
        const text = await $.fs.read(path).catch(() => null)
        known = {
          mtimeMs: file.mtimeMs,
          session: text === null ? null : parseDesktopSession(text),
          cwd: text === null ? undefined : parseCwd(text),
        }
        desktopFiles.set(path, known)
      }
      if (known.session !== null) {
        sessions.push(await applyTranscript($, known.session, known.cwd))
      }
    }
  }

  return sessions.sort((a, b) => a.hostId.localeCompare(b.hostId))
}

// Where the desktop app keeps its records: known on macOS, a guess on Windows,
// and none on Linux, which has no desktop app. A missing folder lists nothing.
async function findDesktopRoot($: EngineInterface): Promise<string | undefined> {
  const platform = await findPlatform($)
  if (platform === 'windows') {
    const appData = await $.env.get('APPDATA')

    return appData === undefined ? undefined : `${appData.replace(/\\/g, '/')}/Claude/claude-code-sessions`
  }
  const home = await $.env.get('HOME')
  if (platform === 'linux' || home === undefined) {
    return undefined
  }

  return `${home}/Library/Application Support/Claude/claude-code-sessions`
}

async function findDesktopFolders($: EngineInterface): Promise<string[]> {
  const root = await findDesktopRoot($)
  if (root === undefined) {
    return []
  }
  const account = await $.env.get('CLAUDE_CODE_ACCOUNT_UUID')
  const organization = await $.env.get('CLAUDE_CODE_ORGANIZATION_UUID')
  if (account !== undefined && organization !== undefined) {
    return [`${root}/${account}/${organization}`]
  }

  const folders: string[] = []
  for (const accountDir of await $.fs.list(root).catch(() => [])) {
    if (accountDir.kind !== 'dir') {
      continue
    }
    for (const organizationDir of await $.fs.list(`${root}/${accountDir.name}`).catch(() => [])) {
      if (organizationDir.kind === 'dir') {
        folders.push(`${root}/${accountDir.name}/${organizationDir.name}`)
      }
    }
  }

  return folders
}

function parseDesktopSession(text: string): DesktopSession | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const record = value as Record<string, unknown>
  const isValid =
    typeof record.sessionId === 'string' &&
    /^local_[A-Za-z0-9-]{1,64}$/.test(record.sessionId) &&
    typeof record.cliSessionId === 'string' &&
    typeof record.cwd === 'string'
  if (!isValid) {
    return null
  }

  return {
    cliSessionId: record.cliSessionId as string,
    hostId: record.sessionId as string,
    title:
      typeof record.title === 'string' && record.title.trim() !== ''
        ? record.title
        : config.texts.untitled,
    folder: basename(record.cwd as string),
    lastActivityAt: typeof record.lastActivityAt === 'number' ? record.lastActivityAt : 0,
    isArchived: record.isArchived === true,
    priorCliSessionIds: Array.isArray(record.priorCliSessionIds)
      ? record.priorCliSessionIds.filter((id): id is string => typeof id === 'string')
      : [],
    ...parseTurnSummary(record.postTurnSummary),
    ...parsePullRequest(record.prs),
    ...parseWrittenBranches(record.writtenBranches),
    ...parseRunningTurn(record),
    ...parseRemoteId(record.bridgeSessionIds),
  }
}

// Whether a turn runs, from three marks of the app's record; any one of them says so.
// - The person's last message is newer than the last start or end of a turn: the app
//   writes the end of a turn after the message that started it.
// - Claude wrote after the last turn summary: the app sums up each turn once it ends,
//   so a summary of an earlier message means the turn goes on. This holds when the
//   app wrote the turn's start a few seconds after the message, as for a conversation
//   started from another device.
// - A first turn not ended yet: Claude wrote, and no turn is counted.
function parseRunningTurn(record: Record<string, unknown>): Pick<DesktopSession, 'turnStartedAt'> {
  const userFrameAt = record.latestUserFrameAt
  const turnEdgeAt = record.lastTurnEdgeAt
  if (typeof userFrameAt !== 'number' || typeof turnEdgeAt !== 'number') {
    return {}
  }
  const lastAnswer = record.lastAssistantUuid
  const summedUp = record.postTurnSummaryFor
  const hasAnswer = typeof lastAnswer === 'string' && lastAnswer !== ''
  const isRunning =
    userFrameAt >= turnEdgeAt ||
    (hasAnswer && typeof summedUp === 'string' && summedUp !== '' && summedUp !== lastAnswer) ||
    (hasAnswer && summedUp == null && (typeof record.completedTurns !== 'number' || record.completedTurns === 0))

  return isRunning ? { turnStartedAt: userFrameAt } : {}
}

// An app that quits during a turn never writes its end: a turn quiet this long is over.
const RUNNING_STALE_MS = 10 * 60_000

function isRunning(row: Pick<Row, 'turnStartedAt' | 'lastActivityAt' | 'writtenAt'>, now: number): boolean {
  return (
    row.turnStartedAt !== undefined &&
    now - Math.max(row.lastActivityAt, row.writtenAt ?? 0) < RUNNING_STALE_MS
  )
}

function parseTurnSummary(value: unknown): Pick<DesktopSession, 'summary' | 'attention'> {
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  const summary = value as Record<string, unknown>
  const attention =
    summary.status_category === 'blocked' || summary.status_category === 'review_ready'
      ? summary.status_category
      : undefined
  const asked = typeof summary.needs_action === 'string' ? summary.needs_action : undefined
  const detail = typeof summary.status_detail === 'string' ? summary.status_detail : undefined
  const text = (attention === 'blocked' ? (asked ?? detail) : detail)?.replace(/\s+/g, ' ').trim()

  return {
    ...(text === undefined || text === '' ? {} : { summary: text }),
    ...(attention === undefined ? {} : { attention }),
  }
}

// The branches the conversation committed on, each as its repository and name.
function parseWrittenBranches(value: unknown): Pick<DesktopSession, 'branches'> {
  if (!Array.isArray(value)) {
    return {}
  }
  const branches = value.flatMap(item => {
    const [repo, branch] = typeof item === 'string' ? item.split('\u0000') : []

    return repo !== undefined && branch !== undefined && repo !== '' && branch !== ''
      ? [{ repo, branch }]
      : []
  })

  return branches.length > 0 ? { branches } : {}
}

// The last pull request the conversation worked on.
function parsePullRequest(value: unknown): Pick<DesktopSession, 'pr'> {
  if (!Array.isArray(value)) {
    return {}
  }
  const last = value.at(-1) as Record<string, unknown> | undefined
  if (typeof last?.prNumber !== 'number') {
    return {}
  }

  return { pr: { number: last.prNumber, state: typeof last.state === 'string' ? last.state : '' } }
}

function buildRows(sessions: readonly DesktopSession[], entries: readonly Entry[]): Row[] {
  const byHost = new Map(
    entries.flatMap(entry => (entry.hostId === undefined ? [] : [[entry.hostId, entry] as const])),
  )
  const byId = new Map(entries.map(entry => [entry.sessionId, entry]))
  const rows: Row[] = []
  const used = new Set<Entry>()
  for (const session of sessions) {
    const entry =
      byHost.get(session.hostId) ??
      [session.cliSessionId, ...session.priorCliSessionIds]
        .map(id => byId.get(id))
        .find(one => one !== undefined)
    if (entry !== undefined) {
      used.add(entry)
    }
    if (session.isArchived) {
      continue
    }
    rows.push({
      key: session.cliSessionId,
      hostId: session.hostId,
      title: session.title,
      folder: session.folder,
      lastActivityAt: session.lastActivityAt,
      entry,
      isDesktop: true,
      summary: session.summary,
      attention: session.attention,
      pr: session.pr,
      branches: session.branches,
      turnStartedAt: session.turnStartedAt,
      ...(session.remoteId === undefined ? {} : { remoteId: session.remoteId }),
      ...(session.writtenAt === undefined ? {} : { writtenAt: session.writtenAt }),
    })
  }
  const hostIds = new Set(sessions.map(session => session.hostId))
  for (const entry of entries) {
    // A desktop conversation the app no longer lists was deleted: its status is moot.
    const isDeleted =
      sessions.length > 0 && entry.hostId !== undefined && !hostIds.has(entry.hostId)
    if (!used.has(entry) && !isDeleted) {
      rows.push({
        key: entry.sessionId,
        hostId: entry.hostId,
        title: toLabel(entry.label),
        folder: entry.folder,
        lastActivityAt: entry.updatedAt,
        entry,
        isDesktop: false,
      })
    }
  }

  return rows.sort((a, b) => b.lastActivityAt - a.lastActivityAt)
}

// The last Remote Control id the app noted for the conversation, if it reads as one.
function parseRemoteId(value: unknown): Pick<DesktopSession, 'remoteId'> {
  const ids = Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string' && /^(session|cse)_[A-Za-z0-9]{8,64}$/.test(id))
    : []
  const last = ids.at(-1)

  return last === undefined ? {} : { remoteId: last }
}

// The link the board draws; the press is answered by the mod, never opened as written.
function remoteHref(remoteId: string): string {
  return `https://claude.ai/code/${remoteId}`
}

// The system sends an https link to the browser: the app's own scheme opens the
// conversation in the app. The https link is kept for a computer without the app.
async function openRemote($: EngineInterface, remoteId: string | undefined): Promise<void> {
  if (remoteId === undefined) {
    return
  }
  const isOpened =
    (await openUrl($, `claude://claude.ai/code/${remoteId}`)) || (await openUrl($, remoteHref(remoteId)))
  if (!isOpened) {
    $.ui.toast(config.texts.openFailed)
  }
}

// A title drawn as a link sits flush with the lines under it, where a Button gets the
// desktop's inner padding. The link is answered by the mod, never opened as written.

function conversationHref(hostId: string | undefined): string {
  return `https://conversation.invalid/${hostId ?? ''}`
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}\[\]()#+\-.!|<>~]/g, character => `\\${character}`)
}

// A glyph per conversation, drawn from its id so it never changes: a 5 by 5
// mirrored pattern in one color, as an identicon.
const glyphs = new Map<string, string>()

function glyphSvg(id: string, project: string): string {
  const color = glyphColor(id, project)
  const known = glyphs.get(`${id}:${color}`)
  if (known !== undefined) {
    return known
  }
  const bits = hash(`${id}:cells`)
  const cells: string[] = []
  for (let row = 0; row < 5; row++) {
    for (let column = 0; column < 3; column++) {
      if (((bits >>> (row * 3 + column)) & 1) === 0) {
        continue
      }
      for (const x of new Set([column, 4 - column])) {
        cells.push(`<rect x="${x * 4 + 1}" y="${row * 4 + 1}" width="4" height="4"/>`)
      }
    }
  }
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22">' +
    `<rect width="22" height="22" rx="5" fill="${color}" fill-opacity="0.18"/>` +
    `<g fill="${color}">${cells.join('')}</g></svg>`
  glyphs.set(`${id}:${color}`, svg)

  return svg
}

// The project a row belongs to: a flag set on it that has a color, the folder,
// then the ticket a title names (work done in scratch folders).
function findProject(row: Row): string {
  const flagged = flags().find(flag => row.entry?.flags[flag.id] === true && flag.id in config.hues)
  if (flagged !== undefined) {
    return flagged.id
  }
  const folder = row.folder.toLowerCase()
  if (folder in config.hues) {
    return folder
  }

  return findTicket(row.title)?.project ?? folder
}

// A hex color, which every surface reads: the project's hue, shifted a little
// per conversation, with mid saturation and lightness for light and dark themes.
function glyphColor(id: string, project: string): string {
  const value = hash(`${id}:color`)
  // One hue per project, from the options; a project not listed gets one from its name.
  const base = config.hues[project] ?? hash(`${project}:hue`) % 360
  const hue = (base + ((value % 37) - 18) + 360) % 360
  const saturation = (55 + ((value >>> 9) % 20)) / 100
  const lightness = (50 + ((value >>> 17) % 12)) / 100
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const channel = (offset: number) => {
    const k = (offset + hue / 30) % 12
    const level = lightness - chroma / 2 * Math.max(-1, Math.min(k - 3, 9 - k, 1))

    return Math.round(level * 255)
      .toString(16)
      .padStart(2, '0')
  }

  return `#${channel(0)}${channel(8)}${channel(4)}`
}

// The terminal draws one colored shape instead.
function textGlyph(id: string): string {
  const shapes = ['●', '■', '▲', '◆', '★', '✚', '◐', '⬢']

  return shapes[hash(`${id}:shape`) % shapes.length] ?? '●'
}

// FNV-1a, 32 bits.
function hash(text: string): number {
  let value = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index)
    value = Math.imul(value, 0x01000193) >>> 0
  }

  return value
}

// The ticket a conversation's title names, by the first ticket rule it matches.
function findTicket(title: string): { label: string; url: string; project?: string } | undefined {
  for (const rule of config.tickets) {
    const match = rule.pattern.exec(title)
    if (match === null) {
      continue
    }
    const found = (match[1] ?? match[0]).trim()
    const id = rule.uppercase ? found.toUpperCase() : found

    return {
      label: rule.label.replaceAll('{id}', id),
      url: rule.url.replaceAll('{id}', encodeURIComponent(id)),
      ...(rule.project === undefined ? {} : { project: rule.project }),
    }
  }

  return undefined
}

// Reads the options; a value that does not parse is left out, so the mod still loads.
function applyOptions(options: Readonly<Record<string, unknown>>): void {
  config.texts = options.language === 'fr' ? TEXTS.fr : TEXTS.en
  config.tickets = parseTicketRules(options.ticketLinks)
  config.hues = parseHues(options.projectColors)
  config.statuses = parseStatuses(options.statuses) ?? [...config.texts.statuses]
  config.flags = parseFlags(options.flags, config.statuses) ?? [...config.texts.flags]
  config.statusControl = STATUS_CONTROLS.find(one => one === options.statusControl) ?? 'auto'
  config.filters = parseFilterOrder(options.filters)
  config.syncFolder =
    typeof options.syncFolder === 'string' && options.syncFolder.trim() !== ''
      ? options.syncFolder.trim().replace(/[\\/]+$/, '')
      : undefined
  config.machineName =
    typeof options.machineName === 'string' && options.machineName.trim() !== ''
      ? options.machineName.trim().slice(0, 40)
      : undefined
}

// The filter ids the options list, in order; a repeated id counts once.
// An empty or unreadable list keeps every filter.
function parseFilterOrder(value: unknown): string[] | undefined {
  const list = parseJson(value)
  if (!Array.isArray(list)) {
    return undefined
  }
  const ids = [...new Set(list.map(parseId).filter((id): id is string => id !== undefined))]

  return ids.length > 0 ? ids : undefined
}

// An id is a short word: letters, digits and dashes.
function parseId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,31}$/i.test(value)
    ? value.toLowerCase()
    : undefined
}

function readText(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field]

  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

// The statuses the options list, or undefined to keep the defaults. A status
// without a valid id or label is left out; so is a repeated id.
function parseStatuses(value: unknown): StatusDef[] | undefined {
  const list = parseJson(value)
  if (!Array.isArray(list)) {
    return undefined
  }
  const defs: StatusDef[] = []
  for (const item of list) {
    const record = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {}
    const id = parseId(record.id)
    const isReserved = id !== undefined && RESERVED_IDS.includes(id)
    if (id === undefined || isReserved || defs.some(one => one.id === id)) {
      continue
    }
    const known = config.texts.statuses.find(one => one.id === id)
    const label = readText(record, 'label') ?? known?.label
    if (label === undefined) {
      continue
    }
    defs.push({ id, label, aliases: known?.aliases ?? [] })
  }

  return defs.length > 0 ? defs : undefined
}

// The flags the options list, or undefined to keep the defaults; [] means no flag.
// A flag whose id is also a status id is left out: the command could not tell them apart.
function parseFlags(value: unknown, statusDefs: readonly StatusDef[]): FlagDef[] | undefined {
  const list = parseJson(value)
  if (!Array.isArray(list)) {
    return undefined
  }
  const defs: FlagDef[] = []
  for (const item of list) {
    const record = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {}
    const id = parseId(record.id)
    const isTaken =
      statusDefs.some(one => one.id === id) ||
      defs.some(one => one.id === id) ||
      (id !== undefined && RESERVED_IDS.includes(id)) ||
      id === STATUS_FILTER_ID ||
      id === PERIOD_FILTER_ID
    if (id === undefined || isTaken) {
      continue
    }
    // A default flag listed by its id alone keeps its words.
    const known = readText(record, 'label') === undefined
      ? config.texts.flags.find(one => one.id === id)
      : undefined
    const label = readText(record, 'label') ?? known?.label
    if (label === undefined) {
      continue
    }
    defs.push({
      id,
      label,
      on: readText(record, 'on') ?? known?.on ?? label,
      off: readText(record, 'off') ?? known?.off ?? config.texts.not(label),
      aliases: config.texts.flags.find(one => one.id === id)?.aliases ?? [],
    })
  }

  return defs
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined
  }
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function parseTicketRules(value: unknown): TicketRule[] {
  const list = parseJson(value)
  if (!Array.isArray(list)) {
    return []
  }
  const rules: TicketRule[] = []
  for (const item of list) {
    if (typeof item !== 'object' || item === null) {
      continue
    }
    const rule = item as Record<string, unknown>
    if (typeof rule.pattern !== 'string' || typeof rule.url !== 'string' || !rule.url.startsWith('https://')) {
      continue
    }
    let pattern: RegExp
    try {
      pattern = new RegExp(rule.pattern, 'i')
    } catch {
      continue
    }
    rules.push({
      pattern,
      url: rule.url,
      label: typeof rule.label === 'string' ? rule.label : '{id}',
      uppercase: rule.uppercase === true,
      ...(typeof rule.project === 'string' ? { project: rule.project.toLowerCase() } : {}),
    })
  }

  return rules
}

function parseHues(value: unknown): Record<string, number> {
  const map = parseJson(value)
  if (typeof map !== 'object' || map === null || Array.isArray(map)) {
    return {}
  }
  const hues: Record<string, number> = {}
  for (const [project, hue] of Object.entries(map)) {
    if (typeof hue === 'number' && Number.isFinite(hue)) {
      hues[project.toLowerCase()] = ((Math.round(hue) % 360) + 360) % 360
    }
  }

  return hues
}

async function openTicket(
  $: EngineInterface,
  ticket: { url: string } | undefined,
): Promise<void> {
  if (ticket === undefined) {
    return
  }
  if (!(await openUrl($, ticket.url))) {
    $.ui.toast(config.texts.ticketFailed)
  }
}

// The desktop app's own id for the conversation (local_...), which its links open.
async function findHostId($: EngineInterface): Promise<string | undefined> {
  const hostId = await $.env.get('CLAUDE_CODE_HOST_SESSION_ID')

  return hostId !== undefined && /^local_[A-Za-z0-9-]{1,64}$/.test(hostId) ? hostId : undefined
}

async function findFirstPrompt($: EngineInterface): Promise<string | null> {
  const messages = await $.session.messages()
  const first = messages.find(
    message => message.role === 'user' && message.text.trim() !== '',
  )

  return first === undefined ? null : first.text
}

// A status the options no longer list counts as none; it comes back with the status.
function hasStatus(row: Row): boolean {
  const status = row.entry?.status ?? null

  return status !== null && findStatus(status)?.id === status
}

function matchesFlag(row: Row, flag: FlagDef, filter: FlagFilter): boolean {
  const isOn = row.entry?.flags[flag.id] === true
  if (filter === 'oui') {
    return isOn
  }
  if (filter === 'non') {
    return !isOn
  }

  return true
}

// The row's facts line: folder, pull request and flags; the age has its own line under it.
function describe(row: Row): string {
  const parts = [row.folder]
  for (const flag of flags()) {
    if (row.entry?.flags[flag.id] === true) {
      parts.push(flag.on.toLowerCase())
    }
  }
  return parts.join(' · ')
}

function formatSummary(row: Row): string {
  if (row.attention === 'blocked') {
    return config.texts.blocked(row.summary ?? '')
  }
  if (row.attention === 'review_ready') {
    return config.texts.review(row.summary ?? '')
  }

  return row.summary ?? ''
}

// The pull request, shown above the age on the card's last line.
function describePr(row: Row): string | undefined {
  return row.pr === undefined ? undefined : `PR #${row.pr.number} ${formatPrState(row.pr.state)}`.trim()
}

function formatPrState(state: string): string {
  return config.texts.prStates[state.toUpperCase()] ?? state.toLowerCase()
}

// What is left of a snooze, rounded up: "25 min", "3 h", "1 d".
function formatLeft(ms: number): string {
  const minutes = Math.ceil(ms / 60_000)
  if (minutes < 60) {
    return `${minutes} min`
  }
  const hours = Math.ceil(minutes / 60)
  if (hours < 24) {
    return `${hours} h`
  }

  return `${Math.ceil(hours / 24)} ${config.texts === TEXTS.fr ? 'j' : 'd'}`
}

function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) {
    return config.texts.justNow
  }
  if (minutes < 60) {
    return config.texts.minutesAgo(minutes)
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return config.texts.hoursAgo(hours)
  }

  return config.texts.daysAgo(Math.floor(hours / 24))
}

// A status by its id, its label or an alias, in any case and with or without accents.
function findStatus(text: string): StatusDef | undefined {
  const word = toWord(text)

  return statuses().find(status =>
    [status.id, status.label, ...status.aliases].some(name => toWord(name) === word),
  )
}

function findFlag(text: string): FlagDef | undefined {
  const word = toWord(text)

  return flags().find(flag => [flag.id, ...flag.aliases].some(name => toWord(name) === word))
}

function toWord(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_]+/g, '-')
}

// The status filter as kept: every status, or the ids of the checked groups.
// Up to 0.7 it was one id; 0.4's your-turn value means every status now.
function readStoredStatusFilter(value: unknown): StatusFilter {
  if (Array.isArray(value)) {
    const ids = value.filter((id): id is string => typeof id === 'string')

    return ids.length > 0 ? ids : ALL_STATUSES
  }
  if (typeof value === 'string' && value !== ALL_STATUSES && value !== YOUR_TURN) {
    return [value]
  }

  return ALL_STATUSES
}

// The groups the filter shows, among those the options list now.
function resolveStatusFilter(filter: StatusFilter): string[] {
  const known = [...statuses().map(status => status.id), NO_STATUS]
  const ids = filter === ALL_STATUSES ? [] : filter.filter(id => known.includes(id))

  return ids.length > 0 ? ids : statuses().map(status => status.id)
}

// The filter after a choice in the status picker: check all, or toggle one group.
function pickStatusFilter(selected: readonly string[], value: string): StatusFilter {
  if (value === ALL_STATUSES) {
    return ALL_STATUSES
  }
  if (!value.startsWith(STATUS_TOGGLE)) {
    return [...selected]
  }
  const id = value.slice(STATUS_TOGGLE.length)
  const next = selected.includes(id) ? selected.filter(one => one !== id) : [...selected, id]
  if (next.length === 0) {
    return [...selected]
  }
  const isEveryStatus =
    !next.includes(NO_STATUS) && statuses().every(status => next.includes(status.id))

  return isEveryStatus ? ALL_STATUSES : next
}

function parsePeriod(value: string): Period {
  return PERIODS.find(one => one === value) ?? 'tout'
}

// The earliest last activity a period keeps; today starts at local midnight.
function findPeriodStart(period: Period, now: number): number {
  if (period === 'today') {
    const midnight = new Date(now)
    midnight.setHours(0, 0, 0, 0)

    return midnight.getTime()
  }
  const hours: Record<Exclude<Period, 'today'>, number> = {
    tout: Number.POSITIVE_INFINITY,
    '1h': 1,
    '2h': 2,
    '3h': 3,
    '6h': 6,
    '7d': 7 * 24,
    '30d': 30 * 24,
  }

  return now - hours[period] * HOUR_MS
}

function parseFlagFilter(value: string): FlagFilter {
  return FLAG_FILTERS.find(one => one === value) ?? 'tous'
}

function parseFlag(text: string): boolean | null {
  if (['oui', 'on', 'true', '1', 'yes'].includes(text)) {
    return true
  }
  if (['non', 'off', 'false', '0', 'no'].includes(text)) {
    return false
  }

  return null
}

// An entry as the store keeps it, or null. Statuses the options do not list are
// kept as they are; the two flags of earlier versions move into `flags`.
function readEntry(value: unknown): Entry | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const entry = value as Record<string, unknown>
  const isValid =
    typeof entry.sessionId === 'string' &&
    typeof entry.label === 'string' &&
    typeof entry.folder === 'string' &&
    typeof entry.updatedAt === 'number' &&
    (entry.hostId === undefined || typeof entry.hostId === 'string') &&
    (entry.status === null || typeof entry.status === 'string')
  if (!isValid) {
    return null
  }
  const flagsSet: Record<string, boolean> = {}
  if (typeof entry.flags === 'object' && entry.flags !== null) {
    for (const [id, isOn] of Object.entries(entry.flags as Record<string, unknown>)) {
      if (isOn === true) {
        flagsSet[id] = true
      }
    }
  }
  if (entry.isRemote === true) {
    flagsSet.remote = true
  }
  if (entry.isPerso === true) {
    flagsSet.perso = true
  }

  return {
    sessionId: entry.sessionId as string,
    ...(entry.hostId === undefined ? {} : { hostId: entry.hostId as string }),
    label: entry.label as string,
    folder: entry.folder as string,
    status: entry.status as string | null,
    flags: flagsSet,
    ...(typeof entry.note === 'string' && entry.note !== '' ? { note: entry.note } : {}),
    updatedAt: entry.updatedAt as number,
  }
}

// The first prompt can carry the app's own markup: notes it inserts, and the
// tags around a slash command.
function toLabel(text: string): string {
  const command = /<command-name>\s*(\S+?)\s*<\/command-name>/.exec(text)?.[1]
  const commandArgs = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1] ?? ''
  const cleaned =
    command !== undefined
      ? `${command.startsWith('/') ? command : `/${command}`} ${commandArgs}`
      : text
          .replace(/<system-reminder>[\s\S]*?(<\/system-reminder>|$)/g, ' ')
          .replace(/<[a-z-]+>[\s\S]*?<\/[a-z-]+>/g, ' ')
  const line = cleaned.replace(/\s+/g, ' ').trim()
  if (line === '') {
    return config.texts.untitled
  }

  return line.length > 80 ? `${line.slice(0, 79)}…` : line
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(part => part !== '').at(-1) ?? path
}

function storeKey(sessionId: string): string {
  return `${KEY_PREFIX}${sessionId}`
}

// A desktop conversation keeps its local_ id for life, while its CLI id changes on
// a rewind or a fork: entries are kept under the former when there is one.
function entryKey(entry: Entry): string {
  return entry.hostId === undefined ? storeKey(entry.sessionId) : `${HOST_KEY_PREFIX}${entry.hostId}`
}
