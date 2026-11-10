import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { DesktopSession, Entry, FlagFilter, Period, StatusFilter } from '../types'

const PANE = 'docket'
const KEY_PREFIX = 'session:'
const HOST_KEY_PREFIX = 'host:'
const REFRESH_MS = 30_000
// The app writes a turn's summary to its record a moment after the turn ends.
const SETTLE_MS = 3_000
// A one-pixel gray rule, stretched to the row's width; a mid gray reads on light and dark.
const SEPARATOR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 1" preserveAspectRatio="none">' +
  '<rect width="100" height="1" fill="#8a8a8a" fill-opacity="0.35"/></svg>'

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
    saveFailed: 'The conversation status could not be saved.',
    paneTitle: '🏷️ Docket',
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
    all: (count: number) => `All (${count})`,
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
    separator: 'Separator',
    glyph: 'Conversation mark',
    here: 'Here',
    remove: 'Remove',
    openFailed: 'The conversation could not be opened.',
    ticketFailed: 'The ticket could not be opened.',
    untitled: 'Untitled conversation',
    never: 'never',
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
    saveFailed: "Le statut de la conversation n'a pas pu être enregistré.",
    paneTitle: '🏷️ Docket',
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
    all: (count: number) => `Tous (${count})`,
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
    separator: 'Séparateur',
    glyph: 'Repère de la conversation',
    here: 'Ici',
    remove: 'Retirer',
    openFailed: "La conversation n'a pas pu être ouverte.",
    ticketFailed: "Le ticket n'a pas pu être ouvert.",
    untitled: 'Conversation sans titre',
    never: 'jamais',
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
} = {
  texts: TEXTS.en,
  tickets: [],
  hues: {},
  statuses: [...TEXTS.en.statuses],
  flags: [...TEXTS.en.flags],
  statusControl: 'auto',
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
  shape: 'desktop-1',
})
const statusFilter = atom(
  { plugin: 'docket', key: 'statusFilter' } as const,
  'tous',
)
const tick = atom({ plugin: 'docket', key: 'tick' } as const, 0)
const flagFilters = atom({ plugin: 'docket', key: 'flagFilters' } as const, {})
const periodFilter = atom({ plugin: 'docket', key: 'period' } as const, 'tout' as Period)

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

  on('session.end', async ($, e, next) => {
    timer?.cancel()
    timer = undefined
    settle?.cancel()
    settle = undefined

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const submitted = await next(e)
    const isFirstPrompt =
      e.isMeta !== true && e.command === undefined && (await read($, current)) === null
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
    const waiting = (await read($, desktop)).filter(
      session => session.attention === 'blocked' && !session.isArchived && session.hostId !== hostId,
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
    const elements = $.ui.resolve(e)
    const { Box, Button, Markdown, Text } = elements
    // Not every surface draws a Select: those get buttons instead.
    const Select = 'Select' in elements ? elements.Select : undefined
    // The terminal lists no vector drawing it can show: it gets a text rule.
    const Svg = e.surface !== 'terminal' && 'Svg' in elements ? elements.Svg : undefined
    const columns = 'bodyColumns' in e.props ? e.props.bodyColumns : 40
    const separator = (key: string) =>
      Svg === undefined ? (
        <Box key={key}>
          <Text dimColor>{'─'.repeat(Math.max(10, columns - 2))}</Text>
        </Box>
      ) : (
        <Box key={key}>
          <Svg source={SEPARATOR_SVG} alt={t.separator} height={1} width={2000} />
        </Box>
      )
    const rows = buildRows(await read($, desktop), await read($, all))
    await read($, tick)
    const chosen = await read($, flagFilters)
    const flagFilter = (flag: FlagDef): FlagFilter => chosen[flag.id] ?? 'tous'
    const onlyStatus = parseStatusFilter(await read($, statusFilter))
    const hereId = await $.session.id()
    const now = await $.clock.now()
    const period = await read($, periodFilter)
    const since = findPeriodStart(period, now)
    const shown = rows.filter(
      row =>
        row.lastActivityAt >= since && flags().every(flag => matchesFlag(row, flag, flagFilter(flag))),
    )
    const periodOptions = PERIODS.map(id => ({ value: id, label: t.periods[id] }))
    // What waits on the person heads the board, filters aside, and is not repeated below.
    const isYourTurn = (row: Row) => row.attention === 'blocked' && row.key !== hereId
    const yourTurn = rows.filter(isYourTurn)
    const listed = shown.filter(row => !isYourTurn(row))
    const groups: { id: string; label: string; rows: Row[] }[] = [
      ...statuses().map(status => ({
        id: status.id,
        label: status.label,
        rows: listed.filter(row => hasStatus(row) && row.entry?.status === status.id),
      })),
      { id: NO_STATUS, label: t.noStatus, rows: listed.filter(row => !hasStatus(row)) },
    ]
    const isShown = (id: string) =>
      onlyStatus === id || (onlyStatus === ALL_STATUSES && id !== NO_STATUS)
    const statusOptions = [
      { value: ALL_STATUSES, label: t.all(listed.filter(row => hasStatus(row)).length) },
      ...groups.map(group => ({
        value: group.id,
        label: `${group.label} (${group.rows.length})`,
      })),
    ]
    const renderRow = (row: Row) => (
                <Box key={`row-${row.key}`} flexDirection="row" alignItems="flex-start" gap={2}>
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
                  <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                    {row.key !== hereId && row.hostId !== undefined ? (
                      <Markdown
                        key={`open-${row.key}`}
                        text={`**[${escapeMarkdown(row.title)}](${conversationHref(row.hostId)})**`}
                        pressableLinks={[conversationHref(row.hostId)]}
                        onLinkPress={() => openConversation($, row.hostId)}
                      />
                    ) : (
                      <Text weight="semibold" wrap="truncate-end">
                        {row.title}
                      </Text>
                    )}
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
                    {row.entry?.note !== undefined && (
                      <Text size="footnote" wrap="wrap">
                        📝 {row.entry.note}
                      </Text>
                    )}
                    <Text dimColor size="caption">
                      {row.lastActivityAt > 0 ? formatAge(now - row.lastActivityAt) : t.never}
                    </Text>
                    {row.summary !== undefined && (
                      <Text
                        size="footnote"
                        dimColor={row.attention !== 'blocked'}
                        color={row.attention === 'blocked' ? 'warning' : undefined}
                        wrap={row.attention === 'blocked' ? 'wrap' : 'truncate-end'}
                      >
                        {formatSummary(row)}
                      </Text>
                    )}
                  </Box>
                  {!row.isDesktop && row.key !== hereId && (
                    <Button
                      key={`remove-${row.key}`}
                      label={t.remove}
                      dimColor
                      onPress={() => row.entry !== undefined && removeEntry($, row.entry)}
                    />
                  )}
                </Box>
    )
    const listRows = (list: readonly Row[]) =>
      list.flatMap((row, index) => [
        ...(index === 0 ? [] : [separator(`separator-${row.key}`)]),
        renderRow(row),
      ])
    // Each picker with its label above it, laid out in two columns, row by row.
    const labelled = (key: string, label: string, node: JSX.Element) => ({
      node: (
        <Box key={`picker-${key}`} flexDirection="column">
          <Text dimColor size="caption">
            {label}
          </Text>
          {node}
        </Box>
      ),
    })
    const pickers =
      Select === undefined
        ? []
        : [
            labelled(
              'status',
              t.status,
              <Select
                key="status-filter"
                options={statusOptions}
                value={onlyStatus}
                onSelect={(value: string) => saveStatusFilter($, value)}
              />,
            ),
            labelled(
              'period',
              t.period,
              <Select
                key="period-filter"
                options={periodOptions}
                value={period}
                onSelect={(value: string) => savePeriod($, parsePeriod(value))}
              />,
            ),
            ...flags().map(flag =>
              labelled(
                `flag-${flag.id}`,
                flag.label,
                <Select
                  key={`flag-filter-${flag.id}`}
                  options={flagOptions(flag)}
                  value={flagFilter(flag)}
                  onSelect={(value: string) => saveFlagFilter($, flag.id, parseFlagFilter(value))}
                />,
              ),
            ),
          ]
    // Refresh has a row of its own under the pickers, centered: a button keeps its own width.
    const tools = (
      <Box key="tools" flexDirection="row" justifyContent="center" marginTop={1}>
        <Button key="refresh" label={t.refresh} onPress={() => refreshAll($)} />
      </Box>
    )
    return (
      <Box flexDirection="column" gap={1}>
        {yourTurn.length > 0 && (
          <Box
            key="your-turn"
            flexDirection="column"
            gap={1}
            borderStyle="round"
            borderColor="warning"
            paddingX={1}
          >
            <Text weight="bold" size="heading" color="warning">
              {t.yourTurn(yourTurn.length)}
            </Text>
            {listRows(yourTurn)}
          </Box>
        )}
        <Box key="filters" flexDirection="column" borderStyle="round" borderColor="promptBorder" paddingX={1}>
          {Select === undefined ? (
          <Box flexDirection="column" gap={1}>
            <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap={1}>
              {statusOptions.map(option => (
                <Button
                  key={`only-${option.value}`}
                  label={option.label}
                  variant={onlyStatus === option.value ? 'primary' : undefined}
                  dimColor={onlyStatus !== option.value}
                  onPress={() => saveStatusFilter($, option.value)}
                />
              ))}
            </Box>
            <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap={1}>
              {periodOptions.map(option => (
                <Button
                  key={`period-${option.value}`}
                  label={option.label}
                  variant={period === option.value ? 'primary' : undefined}
                  dimColor={period !== option.value}
                  onPress={() => savePeriod($, option.value)}
                />
              ))}
            </Box>
            {flags().map(flag => (
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
                    onPress={() => saveFlagFilter($, flag.id, option.value)}
                  />
                ))}
              </Box>
            ))}
            {tools}
          </Box>
        ) : (
          <Box flexDirection="column" gap={1}>
            <Box flexDirection="row" alignItems="flex-start" gap={3}>
              {[0, 1].map(column => (
                <Box
                  key={`filter-column-${column}`}
                  flexDirection="column"
                  gap={1}
                  flexGrow={1}
                  flexShrink={1}
                >
                  {pickers.filter((_, index) => index % 2 === column).map(picker => picker.node)}
                </Box>
              ))}
            </Box>
            {tools}
          </Box>
          )}
        </Box>
        {groups.every(group => !isShown(group.id) || group.rows.length === 0) && (
          <Text dimColor>{t.empty}</Text>
        )}
        {groups.map(group => {
          if (!isShown(group.id) || group.rows.length === 0) {
            return null
          }

          return (
            <Box key={`group-${group.id}`} flexDirection="column" gap={1} marginTop={1}>
              <Text weight="bold" size="heading">
                {group.label} ({group.rows.length})
              </Text>
              {listRows(group.rows)}
            </Box>
          )
        })}
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
}

// The board's filters, shared by every conversation so the board opens as it was left.
// A flag filter is kept by the flag's id, so it outlives a flag removed then added back.
type Filters = {
  status: StatusFilter
  period: Period
  flags: Record<string, FlagFilter>
}

const FILTERS_KEY = 'filters'

async function saveStatusFilter($: EngineInterface, status: string): Promise<void> {
  const filters = { ...(await readStoredFilters($)), status: parseStatusFilter(status) }
  await $.store.set(FILTERS_KEY, filters)
  await applyFilters($, filters)
}

async function savePeriod($: EngineInterface, period: Period): Promise<void> {
  const filters = { ...(await readStoredFilters($)), period }
  await $.store.set(FILTERS_KEY, filters)
  await applyFilters($, filters)
}

async function saveFlagFilter($: EngineInterface, id: string, value: FlagFilter): Promise<void> {
  const stored = await readStoredFilters($)
  const filters = { ...stored, flags: { ...stored.flags, [id]: value } }
  await $.store.set(FILTERS_KEY, filters)
  await applyFilters($, filters)
}

async function loadFilters($: EngineInterface): Promise<void> {
  await applyFilters($, await readStoredFilters($))
}

async function applyFilters($: EngineInterface, filters: Filters): Promise<void> {
  if ((await read($, statusFilter)) !== filters.status) {
    await update($, statusFilter, () => filters.status)
  }
  if ((await read($, periodFilter)) !== filters.period) {
    await update($, periodFilter, () => filters.period)
  }
  if (JSON.stringify(await read($, flagFilters)) !== JSON.stringify(filters.flags)) {
    await update($, flagFilters, () => filters.flags)
  }
}

async function readStoredFilters($: EngineInterface): Promise<Filters> {
  const stored = await $.store.get(FILTERS_KEY)
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

  // 0.4 kept the your-turn list as a status filter; it heads the board now.
  const status =
    typeof value.status === 'string' && value.status !== YOUR_TURN ? value.status : ALL_STATUSES

  return {
    status,
    period: parsePeriod(typeof value.period === 'string' ? value.period : ''),
    flags: flagsKept,
  }
}

// Refreshes the data, and redraws the board while it is shown: the ages and the
// order move with time even when no data changed.
async function refreshBoard($: EngineInterface): Promise<void> {
  await refreshAll($)
  const isShown = (await $.ui.panes()).some(pane => pane.id === PANE && pane.isShown)
  if (isShown) {
    await update($, tick, value => value + 1)
  }
}

async function refreshAll($: EngineInterface): Promise<void> {
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
}

// A parsed record per file, kept while the file's time does not change.
const desktopFiles = new Map<string, { mtimeMs: number; session: DesktopSession | null }>()

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
        known = { mtimeMs: file.mtimeMs, session: text === null ? null : parseDesktopSession(text) }
        desktopFiles.set(path, known)
      }
      if (known.session !== null) {
        sessions.push(known.session)
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
  }
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
      (id !== undefined && RESERVED_IDS.includes(id))
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
  if (row.pr !== undefined) {
    parts.push(`PR #${row.pr.number} ${formatPrState(row.pr.state)}`.trim())
  }
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

function formatPrState(state: string): string {
  return config.texts.prStates[state.toUpperCase()] ?? state.toLowerCase()
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

function parseStatusFilter(value: string): StatusFilter {
  return value === NO_STATUS || findStatus(value)?.id === value ? value : ALL_STATUSES
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
