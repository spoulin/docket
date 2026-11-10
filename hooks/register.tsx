import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type {
  DesktopSession,
  Entry,
  KindFilter,
  RemoteFilter,
  Status,
  StatusFilter,
} from '../types'

const PANE = 'docket'
const KEY_PREFIX = 'session:'
const HOST_KEY_PREFIX = 'host:'
const REFRESH_MS = 30_000
// A one-pixel gray rule, stretched to the row's width; a mid gray reads on light and dark.
const SEPARATOR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 1" preserveAspectRatio="none">' +
  '<rect width="100" height="1" fill="#8a8a8a" fill-opacity="0.35"/></svg>'

// The words the mod shows, per language. Ids stay the same in every language:
// they are what the store keeps.
const TEXTS = {
  en: {
    commandDescription:
      'Status: in-progress, waiting, done, recycled; remote [yes|no]; personal [yes|no]; alone, opens the board',
    boardOpened: 'Status board opened.',
    unknownFlag: (value: string) => `Unknown value "${value}". Values: yes, no.`,
    personalOn: 'Personal: yes.',
    personalOff: 'Personal: no (work).',
    remoteOn: 'Remote: yes.',
    remoteOff: 'Remote: no.',
    unknownStatus: (value: string) =>
      `Unknown status "${value}". Values: in-progress, waiting, done, recycled.`,
    statusSet: (label: string) => `Status: ${label}.`,
    saveFailed: 'The conversation status could not be saved.',
    status: 'Status',
    remoteButton: (isRemote: boolean): string => (isRemote ? 'Remote: yes' : 'Remote: no'),
    board: 'Board',
    paneTitle: 'Statuses',
    statuses: { 'en-cours': 'In progress', 'en-attente': 'Waiting', termine: 'Done', recycle: 'Recycled' },
    kinds: { tous: 'All', job: 'Work', perso: 'Personal' },
    remoteFilters: { tous: 'All', remote: 'Remote', local: 'Not remote' },
    all: (count: number) => `All (${count})`,
    noStatus: 'No status',
    kind: 'Kind',
    remote: 'Remote',
    refresh: 'Refresh',
    empty: 'No conversation here.',
    separator: 'Separator',
    glyph: 'Conversation mark',
    here: 'Here',
    remove: 'Remove',
    openFailed: 'The conversation could not be opened.',
    ticketFailed: 'The ticket could not be opened.',
    untitled: 'Untitled conversation',
    personalTag: 'personal',
    remoteTag: 'remote',
    never: 'never',
    blocked: (text: string) => `⚠️ Your turn: ${text}`,
    review: (text: string) => `👀 To review: ${text}`,
    prStates: { OPEN: 'open', MERGED: 'merged', CLOSED: 'closed', DRAFT: 'draft' } as Record<string, string>,
    justNow: 'just now',
    minutesAgo: (count: number) => `${count} min ago`,
    hoursAgo: (count: number) => `${count} h ago`,
    daysAgo: (count: number) => `${count} d ago`,
  },
  fr: {
    commandDescription:
      'Statut : en-cours, en-attente, termine, recycle; remote [oui|non]; perso [oui|non]; seul, ouvre le tableau',
    boardOpened: 'Tableau des statuts ouvert.',
    unknownFlag: (value: string) => `Valeur inconnue "${value}". Valeurs : oui, non.`,
    personalOn: 'Perso : oui.',
    personalOff: 'Perso : non (job).',
    remoteOn: 'Remote : oui.',
    remoteOff: 'Remote : non.',
    unknownStatus: (value: string) =>
      `Statut inconnu "${value}". Valeurs : en-cours, en-attente, termine, recycle.`,
    statusSet: (label: string) => `Statut : ${label}.`,
    saveFailed: "Le statut de la conversation n'a pas pu être enregistré.",
    status: 'Statut',
    remoteButton: (isRemote: boolean): string => (isRemote ? 'Remote : oui' : 'Remote : non'),
    board: 'Tableau',
    paneTitle: 'Statuts',
    statuses: { 'en-cours': 'En cours', 'en-attente': 'En attente', termine: 'Terminé', recycle: 'Recyclé' },
    kinds: { tous: 'Tous', job: 'Job', perso: 'Perso' },
    remoteFilters: { tous: 'Tous', remote: 'Remote', local: 'Pas remote' },
    all: (count: number) => `Tous (${count})`,
    noStatus: 'Sans statut',
    kind: 'Type',
    remote: 'Remote',
    refresh: 'Rafraîchir',
    empty: 'Aucune conversation ici.',
    separator: 'Séparateur',
    glyph: 'Repère de la conversation',
    here: 'Ici',
    remove: 'Retirer',
    openFailed: "La conversation n'a pas pu être ouverte.",
    ticketFailed: "Le ticket n'a pas pu être ouvert.",
    untitled: 'Conversation sans titre',
    personalTag: 'perso',
    remoteTag: 'remote',
    never: 'jamais',
    blocked: (text: string) => `⚠️ À toi : ${text}`,
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

// The options the module was loaded with; register sets them on each load.
const config: { texts: Texts; tickets: TicketRule[]; hues: Record<string, number> } = {
  texts: TEXTS.en,
  tickets: [],
  hues: {},
}

const STATUS_IDS: readonly Status[] = ['en-cours', 'en-attente', 'termine', 'recycle']
const KIND_IDS: readonly KindFilter[] = ['tous', 'job', 'perso']
const REMOTE_IDS: readonly RemoteFilter[] = ['tous', 'remote', 'local']

function statuses(): { id: Status; label: string }[] {
  return STATUS_IDS.map(id => ({ id, label: config.texts.statuses[id] }))
}

function kinds(): { id: KindFilter; label: string }[] {
  return KIND_IDS.map(id => ({ id, label: config.texts.kinds[id] }))
}

function remoteFilters(): { id: RemoteFilter; label: string }[] {
  return REMOTE_IDS.map(id => ({ id, label: config.texts.remoteFilters[id] }))
}

// Change the tag when an entry's fields change: it declines what an earlier
// version stored, which outlives a reload.
const current = atom({ plugin: 'docket', key: 'current' } as const, null, {
  shape: 'entry-1',
})
const all = atom({ plugin: 'docket', key: 'all' } as const, [], {
  shape: 'entry-1',
})
const desktop = atom({ plugin: 'docket', key: 'desktop' } as const, [], {
  shape: 'desktop-1',
})
const statusFilter = atom(
  { plugin: 'docket', key: 'statusFilter' } as const,
  'tous',
)
const tick = atom({ plugin: 'docket', key: 'tick' } as const, 0)
const kindFilter = atom({ plugin: 'docket', key: 'kindFilter' } as const, 'tous')
const remoteFilter = atom(
  { plugin: 'docket', key: 'remoteFilter' } as const,
  'tous',
)

export const register: Register = (on, options) => {
  let timer: Timer | undefined
  applyOptions(options)
  const t = config.texts

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'docket',
      description: t.commandDescription,
    })

    const hostId = await findHostId($)
    const byHost = hostId === undefined ? undefined : await $.store.get(`${HOST_KEY_PREFIX}${hostId}`)
    const stored = isEntry(byHost) ? byHost : await $.store.get(storeKey(await $.session.id()))
    if (isEntry(stored)) {
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

    return submitted
  })

  on('command.run', { command: 'docket' }, async ($, e) => {
    const args = e.args.trim()
    if (args === '') {
      await refreshAll($)
      await $.ui.open({ id: PANE, title: t.paneTitle })

      return { text: t.boardOpened }
    }

    const perso = /^(?:perso|personal)(?:\s+(\S+))?$/i.exec(args)
    if (perso !== null) {
      const entry = await ensureEntry($)
      const isPerso =
        perso[1] === undefined ? entry.isPerso !== true : parseFlag(perso[1].toLowerCase())
      if (isPerso === null) {
        return { text: t.unknownFlag(perso[1] ?? '') }
      }
      await setPerso($, isPerso)

      return { text: isPerso ? t.personalOn : t.personalOff }
    }

    const remote = /^remote(?:\s+(\S+))?$/i.exec(args)
    if (remote !== null) {
      const entry = await ensureEntry($)
      const isRemote =
        remote[1] === undefined ? !entry.isRemote : parseFlag(remote[1].toLowerCase())
      if (isRemote === null) {
        return { text: t.unknownFlag(remote[1] ?? '') }
      }
      await setRemote($, isRemote)

      return { text: isRemote ? t.remoteOn : t.remoteOff }
    }

    const status = parseStatus(args)
    if (status === null) {
      return { text: t.unknownStatus(args) }
    }
    await setStatus($, status)

    return { text: t.statusSet(statusLabel(status)) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const entry = await read($, current)
    if (e.props.hasSurvey) {
      return next(e)
    }

    // Before the first message there is no entry yet: show the band with nothing selected.
    const status = entry?.status ?? null
    const isRemote = entry?.isRemote === true
    const isPerso = entry?.isPerso === true
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap={1}>
        <Text dimColor>{t.status}</Text>
        {statuses().map(option => (
          <Button
            key={`status-${option.id}`}
            label={option.label}
            variant={option.id === status ? 'primary' : undefined}
            dimColor={option.id !== status}
            onPress={() => setStatus($, option.id)}
          />
        ))}
        <Text dimColor>·</Text>
        <Button
          key="remote"
          label={t.remoteButton(isRemote)}
          variant={isRemote ? 'primary' : undefined}
          dimColor={!isRemote}
          onPress={() => setRemote($, !isRemote)}
        />
        <Button
          key="perso"
          label={isPerso ? t.kinds.perso : t.kinds.job}
          variant={isPerso ? 'primary' : undefined}
          dimColor={!isPerso}
          onPress={() => setPerso($, !isPerso)}
        />
        <Text dimColor>·</Text>
        <Button
          key="board"
          label={t.board}
          dimColor
          onPress={async () => {
            await refreshAll($)
            await $.ui.open({ id: PANE, title: t.paneTitle })
          }}
        />
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
    const filter = await read($, remoteFilter)
    const kind = await read($, kindFilter)
    const onlyStatus = await read($, statusFilter)
    const hereId = await $.session.id()
    const now = await $.clock.now()
    const shown = rows.filter(row => matchesFilter(row, filter) && matchesKind(row, kind))
    const withStatus = shown.filter(row => hasStatus(row))
    const withoutStatus = shown.filter(row => !hasStatus(row))
    const groups: { id: Status | 'aucun'; label: string; rows: Row[] }[] = [
      ...statuses().map(status => ({
        ...status,
        rows: withStatus.filter(row => row.entry?.status === status.id),
      })),
      { id: 'aucun', label: t.noStatus, rows: withoutStatus },
    ]
    const isShown = (id: Status | 'aucun') =>
      onlyStatus === id || (onlyStatus === 'tous' && id !== 'aucun')
    const statusOptions = [
      { value: 'tous', label: t.all(withStatus.length) },
      ...groups.map(group => ({
        value: group.id,
        label: `${group.label} (${group.rows.length})`,
      })),
    ]

    return (
      <Box flexDirection="column" gap={1}>
        {Select === undefined ? (
          <Box flexDirection="column" gap={1}>
            <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap={1}>
              {statusOptions.map(option => (
                <Button
                  key={`only-${option.value}`}
                  label={option.label}
                  variant={onlyStatus === option.value ? 'primary' : undefined}
                  dimColor={onlyStatus !== option.value}
                  onPress={() => saveFilters($, { status: parseStatusFilter(option.value) })}
                />
              ))}
            </Box>
            <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap={1}>
              {kinds().map(option => (
                <Button
                  key={`kind-${option.id}`}
                  label={option.label}
                  variant={option.id === kind ? 'primary' : undefined}
                  dimColor={option.id !== kind}
                  onPress={() => saveFilters($, { kind: option.id })}
                />
              ))}
            </Box>
            <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap={1}>
              {remoteFilters().map(option => (
                <Button
                  key={`filter-${option.id}`}
                  label={option.label}
                  variant={option.id === filter ? 'primary' : undefined}
                  dimColor={option.id !== filter}
                  onPress={() => saveFilters($, { remote: option.id })}
                />
              ))}
            </Box>
          </Box>
        ) : (
          <Box flexDirection="column" alignItems="flex-start" gap={1}>
            <Select
              key="status-filter"
              label={t.status}
              options={statusOptions}
              value={onlyStatus}
              onSelect={(value: string) => saveFilters($, { status: parseStatusFilter(value) })}
            />
            <Select
              key="kind-filter"
              label={t.kind}
              options={kinds().map(option => ({ value: option.id, label: option.label }))}
              value={kind}
              onSelect={(value: string) => saveFilters($, { kind: parseKindFilter(value) })}
            />
            <Box flexDirection="row" alignItems="center" gap={2}>
              <Select
                key="remote-filter"
                label={t.remote}
                options={remoteFilters().map(option => ({ value: option.id, label: option.label }))}
                value={filter}
                onSelect={(value: string) => saveFilters($, { remote: parseRemoteFilter(value) })}
              />
              <Button key="refresh" label={t.refresh} dimColor onPress={() => refreshAll($)} />
            </Box>
          </Box>
        )}
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
              {group.rows.flatMap((row, index) => [
                ...(index === 0 ? [] : [separator(`separator-${row.key}`)]),
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
                        {row.key === hereId ? `${t.here} · ${describe(row, now)}` : describe(row, now)}
                      </Text>
                    </Box>
                    {row.summary !== undefined && (
                      <Text
                        size="footnote"
                        dimColor={row.attention !== 'blocked'}
                        color={row.attention === 'blocked' ? 'warning' : undefined}
                        wrap="truncate-end"
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
                </Box>,
              ])}
            </Box>
          )
        })}
      </Box>
    )
  })
}

async function setStatus($: EngineInterface, status: Status): Promise<void> {
  const entry = await ensureEntry($)
  await saveEntry($, { ...entry, status })
}

async function setPerso($: EngineInterface, isPerso: boolean): Promise<void> {
  const entry = await ensureEntry($)
  await saveEntry($, { ...entry, isPerso })
}

async function setRemote($: EngineInterface, isRemote: boolean): Promise<void> {
  const entry = await ensureEntry($)
  await saveEntry($, { ...entry, isRemote })
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
    status: 'en-cours',
    isRemote: false,
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
type Filters = { status: StatusFilter; kind: KindFilter; remote: RemoteFilter }

const FILTERS_KEY = 'filters'

async function saveFilters($: EngineInterface, change: Partial<Filters>): Promise<void> {
  const filters = { ...(await readStoredFilters($)), ...change }
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
  if ((await read($, kindFilter)) !== filters.kind) {
    await update($, kindFilter, () => filters.kind)
  }
  if ((await read($, remoteFilter)) !== filters.remote) {
    await update($, remoteFilter, () => filters.remote)
  }
}

async function readStoredFilters($: EngineInterface): Promise<Filters> {
  const stored = await $.store.get(FILTERS_KEY)
  const value =
    typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {}

  return {
    status: parseStatusFilter(typeof value.status === 'string' ? value.status : 'tous'),
    kind: parseKindFilter(typeof value.kind === 'string' ? value.kind : 'tous'),
    remote: parseRemoteFilter(typeof value.remote === 'string' ? value.remote : 'tous'),
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
    const value = await $.store.get(key)
    if (!isEntry(value)) {
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

// The project a row belongs to, by the rules the sidebar groups follow: the
// perso flag, the folder, then the ticket a title names (work done in scratch folders).
function findProject(row: Row): string {
  if (row.entry?.isPerso === true) {
    return 'perso'
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

function hasStatus(row: Row): boolean {
  return row.entry !== undefined && row.entry.status !== null
}

function matchesKind(row: Row, kind: KindFilter): boolean {
  const isPerso = row.entry?.isPerso === true
  if (kind === 'perso') {
    return isPerso
  }
  if (kind === 'job') {
    return !isPerso
  }

  return true
}

function matchesFilter(row: Row, filter: RemoteFilter): boolean {
  const isRemote = row.entry?.isRemote === true
  if (filter === 'remote') {
    return isRemote
  }
  if (filter === 'local') {
    return !isRemote
  }

  return true
}

function describe(row: Row, now: number): string {
  const parts = [row.folder]
  if (row.pr !== undefined) {
    parts.push(`PR #${row.pr.number} ${formatPrState(row.pr.state)}`.trim())
  }
  if (row.entry?.isPerso === true) {
    parts.push(config.texts.personalTag)
  }
  if (row.entry?.isRemote === true) {
    parts.push(config.texts.remoteTag)
  }
  parts.push(row.lastActivityAt > 0 ? formatAge(now - row.lastActivityAt) : config.texts.never)

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

function parseStatus(text: string): Status | null {
  const word = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s_]+/g, '-')
  const aliases: Record<string, Status> = {
    'en-cours': 'en-cours',
    encours: 'en-cours',
    cours: 'en-cours',
    'in-progress': 'en-cours',
    progress: 'en-cours',
    'en-attente': 'en-attente',
    attente: 'en-attente',
    waiting: 'en-attente',
    termine: 'termine',
    fini: 'termine',
    done: 'termine',
    recycle: 'recycle',
    recycled: 'recycle',
  }

  return aliases[word] ?? null
}

function parseStatusFilter(value: string): StatusFilter {
  return value === 'aucun' || STATUS_IDS.some(one => one === value)
    ? (value as StatusFilter)
    : 'tous'
}

function parseKindFilter(value: string): KindFilter {
  return KIND_IDS.find(one => one === value) ?? 'tous'
}

function parseRemoteFilter(value: string): RemoteFilter {
  return REMOTE_IDS.find(one => one === value) ?? 'tous'
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

function statusLabel(status: Status): string {
  return config.texts.statuses[status]
}

function isEntry(value: unknown): value is Entry {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const entry = value as Record<string, unknown>

  return (
    typeof entry.sessionId === 'string' &&
    typeof entry.label === 'string' &&
    typeof entry.folder === 'string' &&
    typeof entry.isRemote === 'boolean' &&
    typeof entry.updatedAt === 'number' &&
    (entry.hostId === undefined || typeof entry.hostId === 'string') &&
    (entry.isPerso === undefined || typeof entry.isPerso === 'boolean') &&
    (entry.status === null || STATUS_IDS.some(one => one === entry.status))
  )
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
