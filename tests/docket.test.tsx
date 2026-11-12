import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = {
  plugin: 'docket',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 4 },
} as const

const PANE = {
  plugin: 'docket',
  component: 'Pane',
  requestId: 'docket',
  props: {
    title: '🏷️ Docket 0.12.16',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const OTHER = {
  sessionId: 'other',
  hostId: 'local_other',
  label: 'Revue ABC-1234',
  folder: 'my-app',
  status: 'en-attente',
  isRemote: true,
  updatedAt: 0,
}

// A full setup: French, two trackers, and a color per project.
const FR = {
  options: {
    language: 'fr',
    ticketLinks: JSON.stringify([
      { pattern: '\\b(ABC-\\d+)\\b', url: 'https://tracker.example.com/browse/{id}', project: 'my-app', uppercase: true },
      {
        pattern: '(?:^|[^\\w&])#(\\d{4,})\\b',
        url: 'https://dev.azure.com/example/project/_workitems/edit/{id}',
        label: '#{id}',
        project: 'other-app',
      },
    ]),
    projectColors: JSON.stringify({ 'my-app': 212, 'other-app': 24, 'third-app': 145, perso: 285 }),
  },
}

const CYCLE = { options: { ...FR.options, statusControl: 'cycle' } }

// Shows only the given groups through the status picker: check all, then toggle.
async function showOnly(
  ui: { select: (target: { key: string; value: string }) => Promise<unknown> },
  ids: readonly string[],
  all: readonly string[] = ['en-cours', 'en-attente', 'termine', 'recycle'],
): Promise<void> {
  await ui.select({ key: 'status-filter', value: 'tous' })
  for (const id of ids.filter(one => !all.includes(one))) {
    await ui.select({ key: 'status-filter', value: `basculer:${id}` })
  }
  for (const id of all.filter(one => !ids.includes(one))) {
    await ui.select({ key: 'status-filter', value: `basculer:${id}` })
  }
}

let clock: { advance: (ms: number) => Promise<void> }
// Files outside the desktop app's records, such as the sync folder, by path.
const disk = new Map<string, string>()

const DESKTOP = '/Users/me/Library/Application Support/Claude/claude-code-sessions/acc/org'

function desktopRecord(
  id: string,
  title: string,
  isArchived = false,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    sessionId: `local_${id}`,
    cliSessionId: id,
    cwd: '/Users/me/src/my-app',
    title,
    lastActivityAt: 3_000_000,
    isArchived,
    ...extra,
  })
}

function mockEngine(
  on: On,
  entries: Record<string, unknown> = {},
  files: Record<string, string> = {},
  moreEnv: Record<string, string> = {},
): Map<string, unknown> {
  const env: Record<string, string> = {
    ...moreEnv,
    HOME: '/Users/me',
    CLAUDE_CODE_ACCOUNT_UUID: 'acc',
    CLAUDE_CODE_ORGANIZATION_UUID: 'org',
    CLAUDE_CODE_HOST_SESSION_ID: 'local_here',
  }
  // Changes with the content, so a rewritten file is read again.
  const stamp = (text: string) => [...text].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) | 0, 7)
  disk.clear()
  on('fs.list', (_, e) => ({
    value:
      e.path === DESKTOP
        ? Object.keys(files).map(name => ({
            name,
            kind: 'file' as const,
            size: 1,
            mtimeMs: stamp(files[name] ?? ''),
            isLink: false,
          }))
        : [...disk.keys()]
            .filter(path => path.startsWith(`${e.path}/`) && !path.slice(e.path.length + 1).includes('/'))
            .map(path => ({
              name: path.slice(e.path.length + 1),
              kind: 'file' as const,
              size: 1,
              mtimeMs: stamp(disk.get(path) ?? ''),
              isLink: false,
            })),
  }))
  on('fs.read', (_, e) => {
    const name = e.path.slice(DESKTOP.length + 1)
    if (e.path.startsWith(DESKTOP) && files[name] !== undefined) {
      return { value: files[name] }
    }
    const text = disk.get(e.path)
    if (text === undefined) {
      throw new Error('missing')
    }

    return { value: text }
  })
  on('fs.write', (_, e) => {
    disk.set(e.path, e.text)

    return { value: undefined }
  })
  const store = new Map(Object.entries(entries))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)

    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    store.delete(e.key)

    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  clock = mock.clock(on, { now: 3_600_000 })
  on('ui.panes', () => ({
    value: [{ id: 'docket', title: '🏷️ Docket', isShown: true, isFocused: false, isPlaced: true }],
  }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.id', () => ({ value: 'here' }))
  on('env.get', (_, e) => ({ value: env[e.name] }))
  on('session.cwd', () => ({ value: '/Users/me/src/my-app' }))
  on('session.messages', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))

  return store
}

test('the first prompt files the conversation as in progress', FR, async ($, on) => {
  mockEngine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Corriger le filtre des rapports' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    // Four statuses: one button each, the current one marked.
    expect((await ui.find({ type: 'Button', key: 'status-en-cours' }))?.props.variant).toBe(
      'primary',
    )
    expect((await ui.find({ type: 'Button', key: 'status-termine' }))?.props.dimColor).toBe(true)
    expect((await ui.find({ type: 'Button', key: 'flag-remote' }))?.props.label).toBe(
      '☐ Remote',
    )
    await ui.unmount()
  }
})

test('a conversation started with a command is in progress too', FR, async ($, on) => {
  const store = mockEngine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({
    text: '/explain-ticket ABC-1234',
    command: { name: 'explain-ticket', args: 'ABC-1234' },
  } as never)
  expect(store.get('host:local_here')).toMatchObject({ status: 'en-cours', label: '/explain-ticket ABC-1234' })
})

test('/docket as the first message sets the status it names', FR, async ($, on) => {
  const store = mockEngine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: 'termine' })
  await $.prompt.submit({ text: '/docket termine', command: { name: 'docket', args: 'termine' } } as never)
  expect(store.get('host:local_here')).toMatchObject({ status: 'termine' })
})

test('the band changes the status and the remote flag', CYCLE, async ($, on) => {
  const store = mockEngine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Préparer la QA' })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  // From in progress, three presses reach recycled; a fourth goes round to the start.
  for (const label of ['En attente', 'Terminé', 'Recyclé']) {
    await ui.press({ key: 'status' })
    expect((await ui.find({ type: 'Button', key: 'status' }))?.props.label).toBe(label)
  }
  await ui.press({ key: 'flag-remote' })
  expect((await ui.find({ type: 'Button', key: 'flag-remote' }))?.props.label).toBe(
    '☑ Remote',
  )
  expect(store.get('host:local_here')).toMatchObject({
    status: 'recycle',
    flags: { remote: true },
  })
  await ui.unmount()
})

test('the band shows before the first message, with nothing selected', CYCLE, async ($, on) => {
  const store = mockEngine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Button', key: 'status' }))?.props).toMatchObject({
    label: 'Sans statut',
    dimColor: true,
  })
  await ui.press({ key: 'status' })
  expect((await ui.find({ type: 'Button', key: 'status' }))?.props.label).toBe('Sur le feu')
  expect(store.get('host:local_here')).toMatchObject({ status: 'en-cours' })
  await ui.press({ key: 'status' })
  expect(store.get('host:local_here')).toMatchObject({ status: 'en-attente' })
  await ui.unmount()
})

test('the command sets the status and the flag', FR, async ($, on) => {
  const store = mockEngine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const set = await $.command.run({ command: 'docket', args: 'Terminé' })
  const flag = await $.command.run({ command: 'docket', args: 'remote oui' })
  const bad = await $.command.run({ command: 'docket', args: 'plus tard' })

  expect(set.text).toBe('Statut : Terminé.')
  expect(flag.text).toBe('Remote.')
  expect(bad.text).toContain('Statut inconnu "plus tard".')
  expect(store.get('host:local_here')).toMatchObject({
    status: 'termine',
    flags: { remote: true },
  })
})

test('the board groups the conversations and filters on remote', FR, async ($, on) => {
  const store = mockEngine(on, { 'session:other': OTHER })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: 'en-cours' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Box', key: 'heading-en-cours' })).toBeTruthy()
  expect(await ui.find({ type: 'Box', key: 'heading-en-attente' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^my-app · remote$/ })).toBeTruthy()

  await ui.select({ key: 'flag-filter-remote', value: 'oui' })
  expect(await ui.find({ type: 'Box', key: 'heading-en-cours' })).toBeFalsy()
  expect(await ui.find({ type: 'Box', key: 'heading-en-attente' })).toBeTruthy()

  await ui.press({ key: 'remove-other' })
  expect(await ui.find({ type: 'Box', key: 'heading-en-attente' })).toBeFalsy()
  expect(store.has('session:other')).toBe(false)
  await ui.unmount()
})

test('the board shows one status at a time', FR, async ($, on) => {
  mockEngine(on, { 'session:other': OTHER })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: 'en-cours' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const statusFilter = await ui.find({ type: 'Select', key: 'status-filter' })
  expect(
    statusFilter?.props.options.find(option => option.value === 'basculer:en-attente')?.label,
  ).toBe('☑ En attente (1)')

  await showOnly(ui, ['en-attente'])
  expect(await ui.find({ type: 'Box', key: 'heading-en-cours' })).toBeFalsy()
  expect(await ui.find({ type: 'Box', key: 'heading-en-attente' })).toBeTruthy()

  await ui.select({ key: 'status-filter', value: 'tous' })
  expect(await ui.find({ type: 'Box', key: 'heading-en-cours' })).toBeTruthy()
  await ui.unmount()
})

test('a row opens its conversation in the app', FR, async ($, on) => {
  mockEngine(on, { 'session:other': OTHER })
  const runs: (readonly string[])[] = []
  on('process.run', (_, e) => {
    runs.push(e.argv)

    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: 'en-cours' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Markdown', key: 'open-here' })).toBeFalsy()
  await ui.press({ key: 'open-other', link: { href: 'https://conversation.invalid/local_other' } })

  expect(runs).toEqual([['/usr/bin/open', 'claude://claude.ai/epitaxy/local_other']])
  await ui.unmount()
})

test('the board lists the desktop conversations by their sidebar title', FR, async ($, on) => {
  mockEngine(
    on,
    {},
    {
      'local_here.json': desktopRecord('here', 'Titre de la barre latérale'),
      'local_desk.json': desktopRecord('desk', 'Revue PR 7368'),
      'local_old.json': desktopRecord('old', 'Vieille conversation', true),
      'notes.txt': 'not a record',
    },
  )

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: 'en-cours' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^Titre de la barre latérale$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^Ici · my-app/ })).toBeTruthy()
  expect(await ui.find({ type: 'Markdown', key: 'open-here' })).toBeFalsy()
  const statusFilter = await ui.find({ type: 'Select', key: 'status-filter' })
  expect(statusFilter?.props.options.find(option => option.value === 'basculer:aucun')?.label).toBe(
    '☐ Sans statut (1)',
  )
  expect(await ui.find({ type: 'Text', text: /Revue PR 7368/ })).toBeFalsy()

  await showOnly(ui, ['aucun'])
  expect((await ui.find({ type: 'Markdown', key: 'open-desk' }))?.props.text).toContain('Revue PR 7368')
  expect(await ui.find({ type: 'Text', text: /^il y a 10 min$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Markdown', key: 'open-desk' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'remove-desk' })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: /Vieille conversation/ })).toBeFalsy()
  await ui.unmount()
})

test('the perso flag separates personal conversations from job ones', FR, async ($, on) => {
  const store = mockEngine(
    on,
    {
      'session:bws': {
        sessionId: 'bws',
        hostId: 'local_bws',
        label: 'BWS2',
        folder: 'BWS2',
        status: null,
        isRemote: false,
        isPerso: true,
        updatedAt: 0,
      },
    },
    { 'local_bws.json': desktopRecord('bws', '🥗 BWS2') },
  )

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const set = await $.command.run({ command: 'docket', args: 'perso' })
  expect(set.text).toBe('Perso.')
  expect(store.get('host:local_here')).toMatchObject({ flags: { perso: true }, status: 'en-cours' })

  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'flag-perso' })
  expect((await band.find({ type: 'Button', key: 'flag-perso' }))?.props.label).toBe('☐ Perso')
  await band.unmount()

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.select({ key: 'flag-filter-perso', value: 'oui' })
  await showOnly(ui, ['aucun'])
  expect(await ui.find({ type: 'Markdown', key: 'open-bws' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /BWS2 · perso|my-app · perso/ })).toBeTruthy()

  await ui.select({ key: 'flag-filter-perso', value: 'non' })
  expect(await ui.find({ type: 'Markdown', key: 'open-bws' })).toBeFalsy()
  await ui.unmount()
})

test('the board opens with the filters last chosen in any conversation', FR, async ($, on) => {
  const store = mockEngine(on, {
    filters: { status: 'en-attente', kind: 'job', remote: 'remote' },
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Select', key: 'status-filter' }))?.props.options[0]?.label).toBe(
    '1 statut',
  )
  expect((await ui.find({ type: 'Select', key: 'flag-filter-remote' }))?.props.value).toBe('oui')

  await ui.select({ key: 'flag-filter-perso', value: 'oui' })
  expect(store.get('filters')).toEqual({
    status: ['en-attente'],
    period: 'tout',
    flags: { perso: 'oui', remote: 'oui' },
  })
  await ui.unmount()
})

test('labels drop the app markup and deleted conversations are hidden', FR, async ($, on) => {
  mockEngine(
    on,
    {
      'session:cmd': { ...OTHER, sessionId: 'cmd', hostId: undefined, label: '<command-message>explain-ticket</command-message> <command-name>/explain-ticket</command-name> <command-args>ABC-1234</command-args>' },
      'session:note': { ...OTHER, sessionId: 'note', hostId: undefined, label: '<system-reminder> The user started this session without choosing a project folder' },
      'session:gone': { ...OTHER, sessionId: 'gone', hostId: 'local_gone', label: 'Supprimée' },
    },
    { 'local_desk.json': desktopRecord('desk', 'Revue PR 7368') },
  )

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^\/explain-ticket ABC-1234$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^Conversation sans titre$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /system-reminder/ })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: /Supprimée/ })).toBeFalsy()
  await ui.unmount()
})

test('a row shows the last turn summary, what is asked and the pull request', FR, async ($, on) => {
  mockEngine(
    on,
    {},
    {
      'local_qa.json': desktopRecord('qa', 'QA #365897', false, {
        postTurnSummary: {
          status_category: 'blocked',
          status_detail: 'waiting on review',
          needs_action: "The reviewer's answer on the open question",
        },
        prs: [{ prNumber: 7368, state: 'OPEN' }],
      }),
      'local_done.json': desktopRecord('done', 'ABC-6883', false, {
        postTurnSummary: { status_category: 'completed', status_detail: 'Récap QA publié' },
      }),
    },
  )

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await showOnly(ui, ['aucun'])
  // The folder on the facts line; the pull request above the age, on the card's last line.
  expect(await ui.find({ type: 'Text', text: /^my-app$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'PR #7368 ouverte' })).toBeTruthy()
  expect(
    await ui.find({ type: 'Text', text: /^⚠️ The reviewer's answer on the open question$/ }),
  ).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^Récap QA publié$/ })).toBeTruthy()
  // A plain summary reads in italics.
  expect((await ui.find({ type: 'Text', text: /^Récap QA publié$/ }))?.props.italic).toBe(true)
  await ui.unmount()
})

test('statuses kept under a CLI id move to the conversation local id', FR, async ($, on) => {
  const store = mockEngine(
    on,
    { 'session:old-cli': { ...OTHER, sessionId: 'old-cli', hostId: undefined, label: 'Talk' } },
    { 'local_talk.json': desktopRecord('talk', '📰 Talk to me Bro', false, { priorCliSessionIds: ['old-cli'] }) },
  )

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })

  expect(store.has('session:old-cli')).toBe(false)
  expect(store.get('host:local_talk')).toMatchObject({ status: 'en-attente', hostId: 'local_talk' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await showOnly(ui, ['en-attente'])
  expect((await ui.find({ type: 'Markdown', key: 'open-talk' }))?.props.text).toContain('📰 Talk to me Bro')
  await ui.unmount()
})

test('a thin rule separates the conversations of a group', FR, async ($, on) => {
  mockEngine(
    on,
    { filters: { status: 'aucun', kind: 'tous', remote: 'tous' } },
    {
      'local_one.json': desktopRecord('one', 'Première'),
      'local_two.json': desktopRecord('two', 'Deuxième'),
    },
  )

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })

  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const steps = {
    rows: (await desktop.find({ type: 'Markdown', key: 'open-two' })) !== undefined,
    rule: (await desktop.find({ type: 'Svg' })) !== undefined,
  }
  await desktop.unmount()

  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const dashes = (await terminal.find({ type: 'Text', text: /^─+$/ })) !== undefined
  await terminal.unmount()

  expect({ ...steps, dashes }).toEqual({ rows: true, rule: true, dashes: true })
})

test('a row links to the ticket its title names', FR, async ($, on) => {
  mockEngine(
    on,
    { filters: { status: 'aucun', kind: 'tous', remote: 'tous' } },
    {
      'local_jira.json': desktopRecord('jira', '🧊 abc-6882 explanation'),
      'local_azure.json': desktopRecord('azure', '#367348 — QA divider'),
      'local_none.json': desktopRecord('none', 'Outils QA'),
    },
  )
  const runs: (readonly string[])[] = []
  on('process.run', (_, e) => {
    runs.push(e.argv)

    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Markdown', key: 'ticket-jira' }))?.props.text).toBe('[ABC\\-6882 ↗](https://tracker.example.com/browse/ABC-6882)')
  expect(await ui.find({ type: 'Markdown', key: 'ticket-none' })).toBeFalsy()
  await ui.press({ key: 'ticket-jira', link: { href: 'https://tracker.example.com/browse/ABC-6882' } })
  await ui.press({
    key: 'ticket-azure',
    link: { href: 'https://dev.azure.com/example/project/_workitems/edit/367348' },
  })
  expect(runs).toEqual([
    ['/usr/bin/open', 'https://tracker.example.com/browse/ABC-6882'],
    ['/usr/bin/open', 'https://dev.azure.com/example/project/_workitems/edit/367348'],
  ])
  await ui.unmount()
})

test('the shown board redraws by itself every 30 seconds', FR, async ($, on) => {
  mockEngine(
    on,
    { filters: { status: 'aucun', kind: 'tous', remote: 'tous' } },
    { 'local_one.json': desktopRecord('one', 'Première') },
  )

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /il y a 10 min/ })).toBeTruthy()

  await clock.advance(60_000)
  expect(await ui.find({ type: 'Text', text: /il y a 11 min/ })).toBeTruthy()
  await ui.unmount()
})

test('each conversation gets its own steady glyph', FR, async ($, on) => {
  mockEngine(
    on,
    { filters: { status: 'aucun', kind: 'tous', remote: 'tous' } },
    {
      'local_one.json': desktopRecord('one', 'Première'),
      'local_two.json': desktopRecord('two', 'Deuxième'),
    },
  )

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })

  const draw = async () => {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const found = await ui.find({ type: 'Svg', alt: 'Repère de la conversation' } as never)
    await ui.unmount()

    return found?.props.source
  }
  const first = await draw()
  expect(first).toMatch(/^<svg .*fill="#[0-9a-f]{6}"/)
  expect(await draw()).toBe(first)

  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await terminal.find({ type: 'Text', text: /^[●■▲◆★✚◐⬢]$/ })).toBeTruthy()
  await terminal.unmount()
})

test('glyph colors follow the project', FR, async ($, on) => {
  mockEngine(
    on,
    { filters: { status: 'aucun', kind: 'tous', remote: 'tous' } },
    {
      'local_a.json': desktopRecord('a', 'Première'),
      'local_b.json': desktopRecord('b', 'Deuxième'),
    },
  )

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const colors = [] as string[]
  for (const shape of ['●', '■', '▲', '◆', '★', '✚', '◐', '⬢']) {
    const found = await ui.find({ type: 'Text', text: shape })
    if (typeof found?.props.color === 'string') {
      colors.push(found.props.color)
    }
  }
  await ui.unmount()

  // Both rows are in the my-app folder: blue hues, around 212°.
  expect(colors.length).toBeGreaterThan(0)
  for (const color of colors) {
    const [r, g, b] = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16))
    expect(b).toBeGreaterThan(r)
    expect(b).toBeGreaterThan(g)
  }
})

test('with no options the mod speaks English and links no ticket', async ($, on) => {
  mockEngine(
    on,
    { filters: { status: 'aucun', kind: 'tous', remote: 'tous' } },
    { 'local_jira.json': desktopRecord('jira', 'ABC-6882 explanation') },
  )

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await band.find({ type: 'Button', key: 'status-en-cours' }))?.props.label).toBe(
    'On the stove',
  )
  expect((await band.find({ type: 'Button', key: 'flag-perso' }))?.props.label).toBe('☐ Personal')
  await band.unmount()

  expect((await $.command.run({ command: 'docket', args: 'waiting' })).text).toBe(
    'Status: Waiting.',
  )
  await $.command.run({ command: 'docket', args: 'aucun' })
  await $.command.run({ command: 'docket', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Markdown', key: 'ticket-jira' })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: /^10 min ago$/ })).toBeTruthy()
  await ui.unmount()
})

test('a ticket rule that does not parse is left out', { options: { ticketLinks: '[{"pattern": "(", "url": "https://x.example/{id}"}, {"pattern": "(T-\\\\d+)", "url": "http://x.example/{id}"}]' } }, async ($, on) => {
  mockEngine(
    on,
    { filters: { status: 'aucun', kind: 'tous', remote: 'tous' } },
    { 'local_t.json': desktopRecord('t', 'T-12 fix') },
  )

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Markdown', key: 'ticket-t' })).toBeFalsy()
  expect((await ui.find({ type: 'Markdown', key: 'open-t' }))?.props.text).toMatch(/T\\-12 fix/)
  await ui.unmount()
})

test(
  'statuses and flags come from the options',
  {
    options: {
      statuses: JSON.stringify([
        { id: 'todo', label: 'To do' },
        { id: 'doing', label: 'Doing' },
        { id: 'tous', label: 'Reserved' },
        { id: 'bad id', label: 'Bad' },
      ]),
      flags: JSON.stringify([
        { id: 'client', label: 'Client', on: 'Client', off: 'Internal' },
        { id: 'urgent', label: 'Urgent' },
        { id: 'todo', label: 'Clash' },
      ]),
    },
  },
  async ($, on) => {
    const store = mockEngine(
      on,
      {
        // A status the options no longer list, kept as it was.
        'host:local_other': { ...OTHER, status: 'en-attente' },
        filters: { status: 'tous', kind: 'perso', remote: 'remote' },
      },
      { 'local_other.json': desktopRecord('other', 'Old one') },
    )

    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.prompt.submit({ text: 'Start' })
    expect(store.get('host:local_here')).toMatchObject({ status: 'todo', flags: {} })

    const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect((await band.find({ type: 'Button', key: 'status-todo' }))?.props.variant).toBe('primary')
    expect(await band.find({ type: 'Button', key: 'status-doing' })).toBeTruthy()
    expect(await band.find({ type: 'Button', key: 'status-tous' })).toBeFalsy()
    expect(await band.find({ type: 'Button', key: 'flag-todo' })).toBeFalsy()
    expect(await band.find({ type: 'Button', key: 'flag-remote' })).toBeFalsy()
    expect((await band.find({ type: 'Button', key: 'flag-client' }))?.props.label).toBe('☐ Client')
    expect((await band.find({ type: 'Button', key: 'flag-urgent' }))?.props.label).toBe('☐ Urgent')
    await band.press({ key: 'flag-client' })
    await band.unmount()

    expect((await $.command.run({ command: 'docket', args: 'Doing' })).text).toBe('Status: Doing.')
    expect((await $.command.run({ command: 'docket', args: 'urgent' })).text).toBe('Urgent.')
    expect(store.get('host:local_here')).toMatchObject({
      status: 'doing',
      flags: { client: true, urgent: true },
    })

    // The old row has a status the options do not list: it shows under no status.
    await $.command.run({ command: 'docket', args: '' })
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const statusFilter = await ui.find({ type: 'Select', key: 'status-filter' })
    expect(statusFilter?.props.options.map(option => option.value)).toEqual([
      'resume',
      'basculer:todo',
      'basculer:doing',
      'basculer:aucun',
      'tous',
    ])
    await ui.select({ key: 'flag-filter-client', value: 'oui' })
    expect(store.get('filters')).toMatchObject({ flags: { client: 'oui' } })
    expect(store.get('host:local_other')).toMatchObject({ status: 'en-attente' })
    await ui.unmount()
  },
)

test('a turn of this conversation redraws the board at once', FR, async ($, on) => {
  const files: Record<string, string> = { 'local_here.json': desktopRecord('here', 'Ici') }
  mockEngine(on, { filters: { status: 'aucun', flags: {} } }, files)
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^Nouveau titre$/ })).toBeFalsy()

  files['local_two.json'] = desktopRecord('two', 'Nouveau titre')
  await $.turn.complete({
    answer: 'ok',
    durationMs: 1,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
  } as never)
  expect(await ui.find({ type: 'Markdown', key: 'open-two' })).toBeTruthy()
  await ui.unmount()
})

test('the band counts the conversations that wait on the person', FR, async ($, on) => {
  const store = mockEngine(
    on,
    { filters: { status: 'tous', flags: {} } },
    {
      'local_here.json': desktopRecord('here', 'Ici', false, {
        postTurnSummary: { status_category: 'blocked', needs_action: 'Réponds-moi' },
      }),
      'local_a.json': desktopRecord('a', 'Première', false, {
        postTurnSummary: { status_category: 'blocked', needs_action: 'Choisis une option' },
      }),
      'local_b.json': desktopRecord('b', 'Deuxième', false, {
        postTurnSummary: { status_category: 'blocked', needs_action: 'Valide la PR' },
      }),
      'local_c.json': desktopRecord('c', 'Troisième', true, {
        postTurnSummary: { status_category: 'blocked', needs_action: 'Archivée' },
      }),
      'local_d.json': desktopRecord('d', 'Quatrième'),
    },
  )

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  // This conversation and the archived one are not counted.
  expect((await band.find({ type: 'Button', key: 'your-turn' }))?.props.label).toBe('⚠️ 2')
  await band.press({ key: 'your-turn' })
  await band.unmount()

  // The your-turn section sits under the filters, whatever they are, above the statuses.
  await $.command.run({ command: 'docket', args: 'termine' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // What waits on the person is a group of its own, with a heading like the others and no frame.
  expect(await ui.find({ type: 'Text', text: '🫵 Ton tour (2)' })).toBeTruthy()
  expect((await ui.find({ type: 'Box', key: 'your-turn' } as never))?.props.borderStyle).toBeUndefined()
  expect((await ui.find({ type: 'Box', key: 'filters' } as never))?.props).toMatchObject({
    borderStyle: 'single',
    borderColor: 'promptBorder',
  })
  // In order: the filters, what waits on the person, then the first group.
  const board = JSON.stringify(await ui.find({ type: 'Box' }))
  const at = (key: string) => board.indexOf(`"key":"${key}`)
  expect(at('filters')).toBeGreaterThan(-1)
  expect(at('your-turn')).toBeGreaterThan(at('filters'))
  expect(at('group-')).toBeGreaterThan(at('your-turn'))
  expect(await ui.find({ type: 'Markdown', key: 'open-a' })).toBeTruthy()
  expect(await ui.find({ type: 'Markdown', key: 'open-b' })).toBeTruthy()
  // d waits on no one and has no status: the default filter hides it.
  expect(await ui.find({ type: 'Markdown', key: 'open-d' })).toBeFalsy()
  // The rows of the section are left out of the counts below.
  const statusFilter = await ui.find({ type: 'Select', key: 'status-filter' })
  expect(statusFilter?.props.options.map(option => option.value)).not.toContain('a-toi')
  expect(statusFilter?.props.options.find(option => option.value === 'basculer:aucun')?.label).toBe(
    '☐ Sans statut (1)',
  )
  await ui.unmount()
  expect(store.get('filters')).toMatchObject({ status: 'tous' })
})

test('a note says why a conversation waits', FR, async ($, on) => {
  const store = mockEngine(
    on,
    { filters: { status: 'tous', flags: {} } },
    { 'local_here.json': desktopRecord('here', 'Ici') },
  )

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Préparer la QA' })
  const saved = await $.command.run({ command: 'docket', args: 'note attendre   le retour de l’équipe' })
  expect(saved.text).toBe('Note enregistrée.')
  expect(store.get('host:local_here')).toMatchObject({
    status: 'en-cours',
    note: 'attendre le retour de l’équipe',
  })

  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Text', text: /📝 attendre le retour de l’équipe/ })).toBeTruthy()
  await band.unmount()
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /📝 attendre le retour de l’équipe/ })).toBeTruthy()
  await ui.unmount()

  const cleared = await $.command.run({ command: 'docket', args: 'note' })
  expect(cleared.text).toBe('Note effacée.')
  expect(store.get('host:local_here')).not.toHaveProperty('note')
})

test('a your-turn filter kept by 0.4 falls back to every status', FR, async ($, on) => {
  const store = mockEngine(on, { filters: { status: 'a-toi', flags: {} } })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Select', key: 'status-filter' }))?.props.options[0]?.label).toBe(
    'Tous',
  )
  // Nothing waits on the person: no section.
  expect(await ui.find({ type: 'Text', text: /^🫵 Ton tour/ })).toBeFalsy()
  await ui.select({ key: 'period-filter', value: 'today' })
  expect(store.get('filters')).toEqual({ status: 'tous', period: 'today', flags: {} })
  await ui.unmount()
})

test('the period keeps the conversations active since then', FR, async ($, on) => {
  const store = mockEngine(
    on,
    { filters: { status: 'aucun', flags: {} } },
    {
      'local_new.json': desktopRecord('new', 'Récente', false, { lastActivityAt: 3_000_000 }),
      'local_old.json': desktopRecord('old', 'Ancienne', false, { lastActivityAt: 100_000 }),
    },
  )

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Markdown', key: 'open-old' })).toBeTruthy()

  // The clock reads one hour: the old one was active 58 minutes ago, the new one 10.
  await ui.select({ key: 'period-filter', value: '1h' })
  expect(await ui.find({ type: 'Markdown', key: 'open-old' })).toBeTruthy()
  await clock.advance(10 * 60_000)
  expect(await ui.find({ type: 'Markdown', key: 'open-old' })).toBeFalsy()
  expect(await ui.find({ type: 'Markdown', key: 'open-new' })).toBeTruthy()
  expect(store.get('filters')).toMatchObject({ period: '1h' })
  await ui.unmount()
})

test(
  'past five statuses the band shows a picker',
  {
    options: {
      statuses: JSON.stringify(['a', 'b', 'c', 'd', 'e', 'f'].map(id => ({ id, label: id.toUpperCase() }))),
    },
  },
  async ($, on) => {
    const store = mockEngine(on)

    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
    const picker = await band.find({ type: 'Select', key: 'status' })
    expect(picker?.props.value).toBe('')
    expect(picker?.props.options.map(option => option.value)).toEqual(['', 'a', 'b', 'c', 'd', 'e', 'f'])
    expect(await band.find({ type: 'Button', key: 'status-a' })).toBeFalsy()
    await band.select({ key: 'status', value: 'e' })
    expect(store.get('host:local_here')).toMatchObject({ status: 'e' })
    await band.unmount()
  },
)

test('the status control option overrides the automatic choice', { options: { statusControl: 'dropdown' } }, async ($, on) => {
  mockEngine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Select', key: 'status' })).toBeTruthy()
  expect(await band.find({ type: 'Button', key: 'status-en-cours' })).toBeFalsy()
  await band.unmount()
})

test('the filters sit in two columns, each with its label above', FR, async ($, on) => {
  const store = mockEngine(
    on,
    { filters: { status: 'tous', flags: {} } },
    { 'local_one.json': desktopRecord('one', 'Première') },
  )

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Button', key: 'refresh' }))?.props.label).toBe('↻ Rafraîchir')
  // Each picker has its label above it.
  expect(await ui.find({ type: 'Text', text: 'Période' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'Type' })).toBeTruthy()
  expect((await ui.find({ type: 'Select', key: 'flag-filter-remote' }))?.props.options[0]?.label).toBe(
    'Tous',
  )

  await ui.select({ key: 'flag-filter-perso', value: 'non' })
  expect(store.get('filters')).toEqual({ status: 'tous', period: 'tout', flags: { perso: 'non' } })
  await ui.unmount()
})

test('refresh is a bar of its own under the pickers', FR, async ($, on) => {
  mockEngine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Box', key: 'refresh-cell' } as never)).toBeFalsy()
  expect(await ui.find({ type: 'Button', key: 'refresh' })).toBeTruthy()
  await ui.unmount()
})

test(
  'default statuses listed by id alone keep their labels, in the new order',
  { options: { language: 'fr', statuses: '[{"id":"en-cours"},{"id":"en-attente"},{"id":"recycle"},{"id":"termine"}]' } },
  async ($, on) => {
    mockEngine(on)

    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.command.run({ command: 'docket', args: '' })
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const options = (await ui.find({ type: 'Select', key: 'status-filter' }))?.props.options ?? []
    expect(options.map(option => option.label)).toEqual([
      'Tous',
      '☑ Sur le feu (0)',
      '☑ En attente (0)',
      '☑ Recyclé (0)',
      '☑ Terminé (0)',
      '☐ Sans statut (0)',
      'Tout cocher',
    ])
    await ui.unmount()
  },
)

test(
  'the filters option sets the order of the pickers and hides the others',
  { options: { language: 'fr', filters: '["status", "perso", "period"]' } },
  async ($, on) => {
    mockEngine(
      on,
      // A remote filter chosen before it was hidden no longer filters.
      { filters: { status: 'aucun', flags: { remote: 'oui' } } },
      { 'local_one.json': desktopRecord('one', 'Première') },
    )

    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.command.run({ command: 'docket', args: '' })
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const left = await ui.find({ type: 'Box', key: 'filter-column-0' } as never)
    const right = await ui.find({ type: 'Box', key: 'filter-column-1' } as never)
    const keys = (box: unknown) =>
      JSON.stringify(box)
        .match(/"key":"(status|period|flag)-filter[^"]*"/g)
        ?.map(found => found.slice(7, -1))
    // Row by row: status | type, then period alone.
    expect(keys(left)).toEqual(['status-filter', 'period-filter'])
    expect(keys(right)).toEqual(['flag-filter-perso'])
    expect(await ui.find({ type: 'Select', key: 'flag-filter-remote' })).toBeFalsy()
    expect(await ui.find({ type: 'Markdown', key: 'open-one' })).toBeTruthy()
    await ui.unmount()
  },
)

test('a search keeps the conversations whose title, folder, ticket or note match', FR, async ($, on) => {
  mockEngine(
    on,
    {
      filters: { status: 'aucun', flags: {} },
      'host:local_noted': { ...OTHER, sessionId: 'noted', hostId: 'local_noted', status: null, note: 'Attendre la révision' },
    },
    {
      'local_one.json': desktopRecord('one', 'ALTO-42 Préparer la démo'),
      'local_two.json': desktopRecord('two', 'Corriger le rapport'),
      'local_noted.json': desktopRecord('noted', 'Sans rapport'),
    },
  )

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.input({ key: 'search', text: 'demo', kind: 'change' })
  // Accents and case aside, by title.
  expect(await ui.find({ type: 'Markdown', key: 'open-one' })).toBeTruthy()
  expect(await ui.find({ type: 'Markdown', key: 'open-two' })).toBeFalsy()

  await ui.input({ key: 'search', text: 'revision', kind: 'change' })
  expect(await ui.find({ type: 'Markdown', key: 'open-noted' })).toBeTruthy()
  expect(await ui.find({ type: 'Markdown', key: 'open-one' })).toBeFalsy()

  await ui.input({ key: 'search', text: 'introuvable', kind: 'change' })
  expect(await ui.find({ type: 'Text', text: 'Rien ne correspond à « introuvable ».' })).toBeTruthy()
  await ui.unmount()
})

test('the status picker checks several groups and keeps one at least', FR, async ($, on) => {
  const store = mockEngine(on, {
    'host:local_a': { ...OTHER, sessionId: 'a', hostId: 'local_a', status: 'en-cours' },
    'host:local_b': { ...OTHER, sessionId: 'b', hostId: 'local_b', status: 'en-attente' },
    'host:local_c': { ...OTHER, sessionId: 'c', hostId: 'local_c', status: 'termine' },
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await showOnly(ui, ['en-cours', 'en-attente'])
  const picker = await ui.find({ type: 'Select', key: 'status-filter' })
  expect(picker?.props.value).toBe('resume')
  expect(picker?.props.options[0]?.label).toBe('2 statuts')
  expect(store.get('filters')).toMatchObject({ status: ['en-cours', 'en-attente'] })
  expect(await ui.find({ type: 'Box', key: 'heading-termine' })).toBeFalsy()

  // Down to one group, the last one cannot be unchecked.
  await ui.select({ key: 'status-filter', value: 'basculer:en-cours' })
  await ui.select({ key: 'status-filter', value: 'basculer:en-attente' })
  expect(store.get('filters')).toMatchObject({ status: ['en-attente'] })

  // Three groups read as a count; checking every status reads as all.
  await ui.select({ key: 'status-filter', value: 'basculer:termine' })
  await ui.select({ key: 'status-filter', value: 'basculer:aucun' })
  await ui.select({ key: 'status-filter', value: 'basculer:recycle' })
  expect((await ui.find({ type: 'Select', key: 'status-filter' }))?.props.options[0]?.label).toBe(
    '4 statuts',
  )
  await ui.select({ key: 'status-filter', value: 'tous' })
  expect(store.get('filters')).toMatchObject({ status: 'tous' })
  await ui.unmount()
})

test('a search sets the filters aside and they come back once it is cleared', FR, async ($, on) => {
  const store = mockEngine(
    on,
    // Only in progress, the last hour, and personal conversations.
    { filters: { status: ['en-cours'], period: '1h', flags: { perso: 'oui' } } },
    {
      'local_old.json': desktopRecord('old', 'Rapport annuel', false, { lastActivityAt: 1 }),
    },
  )

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Markdown', key: 'open-old' })).toBeFalsy()

  // No status, too old, not personal: the search still finds it.
  await ui.input({ key: 'search', text: 'rapport', kind: 'change' })
  expect(await ui.find({ type: 'Markdown', key: 'open-old' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'Les filtres sont en pause pendant la recherche.' })).toBeTruthy()
  expect(store.get('filters')).toMatchObject({ status: ['en-cours'], period: '1h', flags: { perso: 'oui' } })

  await ui.input({ key: 'search', text: '', kind: 'change' })
  expect(await ui.find({ type: 'Markdown', key: 'open-old' })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: 'Les filtres sont en pause pendant la recherche.' })).toBeFalsy()
  await ui.unmount()
})

test('a board drawn again after a while reads the conversations again', FR, async ($, on) => {
  const files: Record<string, string> = {}
  mockEngine(on, { filters: { status: 'aucun', flags: {} } }, files)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })
  const first = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await first.find({ type: 'Markdown', key: 'open-late' })).toBeFalsy()
  await first.unmount()

  // Another conversation appeared; coming back draws the board after 10 seconds.
  files['local_late.json'] = desktopRecord('late', 'Arrivée tard')
  await clock.advance(10_000)
  const again = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(1)
  expect(await again.find({ type: 'Markdown', key: 'open-late' })).toBeTruthy()
  await again.unmount()
})

test('a search hides the filters and the refresh button until it is cleared', FR, async ($, on) => {
  mockEngine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.input({ key: 'search', text: 'qa', kind: 'change' })
  expect(await ui.find({ type: 'Select', key: 'status-filter' })).toBeFalsy()
  expect(await ui.find({ type: 'Button', key: 'refresh' })).toBeFalsy()

  await ui.input({ key: 'search', text: '', kind: 'change' })
  expect(await ui.find({ type: 'Select', key: 'status-filter' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'refresh' })).toBeTruthy()
  await ui.unmount()
})

test('a row shows what git still holds of the branch it committed on', FR, async ($, on) => {
  const store = mockEngine(
    on,
    { filters: { status: 'aucun', flags: {} } },
    {
      'local_work.json': desktopRecord('work', 'Travail', false, {
        writtenBranches: ['/repo\u0000feature'],
      }),
      'local_done.json': desktopRecord('done', 'Fini', false, {
        writtenBranches: ['/repo\u0000old'],
        prs: [{ prNumber: 9, state: 'MERGED' }],
      }),
    },
  )
  const runs: string[] = []
  on('process.run', (_, e) => {
    const args = e.argv.slice(3).join(' ')
    runs.push(args)
    const answers: Record<string, string> = {
      'rev-parse --abbrev-ref HEAD': 'feature',
      'status --porcelain --untracked-files=no': ' M file.ts',
      'rev-list --count --no-merges refs/heads/feature --not --remotes': '2',
      'rev-list --count --no-merges refs/heads/old --not --remotes': '0',
      'symbolic-ref --short refs/remotes/origin/HEAD': 'origin/main',
      'rev-parse --verify --quiet refs/heads/feature': 'abc',
    }
    const isAncestor = args.startsWith('merge-base')

    return {
      value: {
        exitCode: isAncestor ? 1 : answers[args] === undefined ? 1 : 0,
        stdout: answers[args] ?? '',
        stderr: '',
      },
    }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // Other conversations are asked about on ↻ only.
  expect(runs.length).toBe(0)
  await ui.press({ key: 'refresh' })
  // Each sign stands out from the age: its mark, count and words in plain text.
  expect((await ui.find({ type: 'Text', text: '↑2 non poussé' }))?.props.dimColor).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '✎ non commité' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: '⑂ pas mergé' })).toBeTruthy()
  // Merged through its pull request, nothing left to push: no sign.
  expect(await ui.find({ type: 'Text', text: 'PR #9 mergée' })).toBeTruthy()
  expect(store.get('git')).toMatchObject({ states: expect.any(Object) })

  // Drawn again, the board reads git's answers from the store: git is not asked.
  const asked = runs.length
  await ui.unmount()
  await clock.advance(60_000)
  const again = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(1)
  expect(runs.length).toBe(asked)
  expect(await again.find({ type: 'Text', text: '↑2 non poussé' })).toBeTruthy()
  await again.unmount()
})

test('coming into a conversation and its git commands ask git about its branches only', FR, async ($, on) => {
  mockEngine(
    on,
    { filters: { status: 'aucun', flags: {} } },
    {
      'local_here.json': desktopRecord('here', 'Ici', false, { writtenBranches: ['/repo\u0000mine'] }),
      'local_other.json': desktopRecord('other', 'Autre', false, { writtenBranches: ['/repo\u0000theirs'] }),
    },
  )
  const asked: string[] = []
  on('process.run', (_, e) => {
    asked.push(e.argv.slice(3).join(' '))

    return { value: { exitCode: 1, stdout: '', stderr: '' } }
  })
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // Coming in draws the band: git is asked about this conversation's branch alone.
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await clock.advance(1)
  expect(asked.some(args => args.includes('refs/heads/mine'))).toBe(true)
  expect(asked.some(args => args.includes('refs/heads/theirs'))).toBe(false)

  // Drawn again soon after, the band does not ask again.
  const count = asked.length
  await band.unmount()
  const again = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await clock.advance(1)
  expect(asked.length).toBe(count)
  await again.unmount()

  // A command that changes no branch asks nothing; a push asks at once.
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(asked.length).toBe(count)
  await $.tool.call({ tool: 'Bash', command: 'cd repo && git push origin mine' })
  expect(asked.length).toBeGreaterThan(count)
  expect(asked.some(args => args.includes('refs/heads/theirs'))).toBe(false)
})

// The mock clock reads one hour: the turn started 20 s ago and moved 10 s ago.
const RUNNING = { latestUserFrameAt: 3_580_000, lastTurnEdgeAt: 3_570_000, lastActivityAt: 3_590_000 }

// A drawing keeps no key: spinners are counted by what they say.
async function findSpinners(ui: {
  findAll: (query: { type: string }) => Promise<{ props: Record<string, unknown> }[]>
}): Promise<{ props: Record<string, unknown> }[]> {
  return (await ui.findAll({ type: 'Svg' })).filter(one => one.props.alt === 'Claude travaille')
}

test('a spinner marks a running conversation and stops soon after its turn ends', FR, async ($, on) => {
  const files: Record<string, string> = {
    'local_busy.json': desktopRecord('busy', 'Occupée', false, RUNNING),
    'local_idle.json': desktopRecord('idle', 'Au repos', false, {
      latestUserFrameAt: 3_500_000,
      lastTurnEdgeAt: 3_510_000,
      lastActivityAt: 3_590_000,
    }),
  }
  mockEngine(on, { filters: { status: 'aucun', flags: {} } }, files)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await findSpinners(ui)).toHaveLength(1)
  expect((await findSpinners(ui))[0]?.props.isInteractive).toBe(true)

  // The turn ends; the board sees it on its quick reread, 5 seconds later.
  files['local_busy.json'] = desktopRecord('busy', 'Occupée', false, { ...RUNNING, lastTurnEdgeAt: 3_595_000 })
  await clock.advance(4_000)
  expect(await findSpinners(ui)).toHaveLength(1)
  await clock.advance(1_000)
  await clock.advance(1)
  expect(await findSpinners(ui)).toHaveLength(0)
  await ui.unmount()
})

test('a turn quiet for 10 minutes shows no spinner, and the terminal shows a dot mark', FR, async ($, on) => {
  mockEngine(on, { filters: { status: 'aucun', flags: {} } }, {
    'local_busy.json': desktopRecord('busy', 'Occupée', false, RUNNING),
    'local_quit.json': desktopRecord('quit', 'Quittée', false, { ...RUNNING, lastActivityAt: 3_000_000 }),
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await findSpinners(ui)).toHaveLength(1)
  await ui.unmount()

  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await terminal.findAll({ type: 'Text', text: /^⋯$/ })).toHaveLength(1)
  await terminal.unmount()
})

test('a turn whose start the app wrote late still shows a spinner, until its summary', FR, async ($, on) => {
  // Started from another device: the turn's start came 6 seconds after the message.
  const late = {
    latestUserFrameAt: 3_580_000,
    lastTurnEdgeAt: 3_586_000,
    lastActivityAt: 3_590_000,
    completedTurns: 3,
    lastAssistantUuid: 'answer-4',
    postTurnSummaryFor: 'answer-3',
  }
  const files: Record<string, string> = {
    'local_late.json': desktopRecord('late', 'Lancée de loin', false, late),
    // A first turn, not ended: Claude wrote and no turn is counted yet.
    'local_first.json': desktopRecord('first', 'Première', false, {
      latestUserFrameAt: 3_580_000,
      lastTurnEdgeAt: 3_586_000,
      lastActivityAt: 3_590_000,
      lastAssistantUuid: 'answer-1',
    }),
    // Ended and summed up: no spinner.
    'local_done.json': desktopRecord('done', 'Finie', false, { ...late, postTurnSummaryFor: 'answer-4' }),
  }
  mockEngine(on, { filters: { status: 'aucun', flags: {} } }, files)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await findSpinners(ui)).toHaveLength(2)

  // The app sums up the turn once it ends: the spinner stops on the next quick reread.
  files['local_late.json'] = desktopRecord('late', 'Lancée de loin', false, {
    ...late,
    lastTurnEdgeAt: 3_595_000,
    postTurnSummaryFor: 'answer-4',
  })
  await clock.advance(5_000)
  await clock.advance(1)
  expect(await findSpinners(ui)).toHaveLength(1)
  await ui.unmount()
})

test('the transcript says a turn runs when the app record does not', FR, async ($, on) => {
  // Driven from another device, without turn summaries: the record looks ended.
  const record = {
    latestUserFrameAt: 3_580_000,
    lastTurnEdgeAt: 3_582_000,
    lastActivityAt: 3_582_000,
    completedTurns: 17,
    lastAssistantUuid: 'answer-17',
  }
  mockEngine(on, { filters: { status: 'aucun', flags: {} } }, {
    'local_far.json': desktopRecord('far', 'Pilotée de loin', false, record),
  })
  const transcript = '/Users/me/.claude/projects/-Users-me-src-my-app/far.jsonl'
  const line = (entry: Record<string, unknown>) => JSON.stringify(entry)
  let text = [
    line({ type: 'user', message: { content: 'Corrige le test' } }),
    line({ type: 'assistant', message: { stop_reason: 'tool_use', content: [{ type: 'tool_use' }] } }),
    line({ type: 'bridge-session' }),
  ].join('\n')
  let writtenAt = 3_595_000
  on('fs.stat', (_, e) => {
    if (e.path !== transcript) {
      throw new Error('missing')
    }

    return { value: { kind: 'file' as const, size: text.length, mtimeMs: writtenAt, isLink: false } }
  })
  on('process.run', (_, e) => ({
    value: { exitCode: e.argv[0] === 'tail' ? 0 : 1, stdout: e.argv[0] === 'tail' ? text : '', stderr: '' },
  }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await findSpinners(ui)).toHaveLength(1)

  // The turn ends: an answer that ends it, then the stop hooks' summary.
  text = [
    text,
    line({ type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text' }] } }),
    line({ type: 'system', subtype: 'stop_hook_summary' }),
  ].join('\n')
  writtenAt = 3_599_000
  await clock.advance(5_000)
  await clock.advance(1)
  expect(await findSpinners(ui)).toHaveLength(0)

  // A command run directly afterwards, such as /docket, starts no turn.
  text = [
    text,
    line({ type: 'queue-operation' }),
    line({ type: 'user', isMeta: true, message: { content: '<local-command-caveat>Run directly</local-command-caveat>' } }),
    line({ type: 'user', message: { content: '<command-name>/docket</command-name>\n<command-args>termine</command-args>' } }),
    line({ type: 'system', subtype: 'local_command' }),
  ].join('\n')
  writtenAt = 3_604_000
  await clock.advance(30_000)
  expect(await findSpinners(ui)).toHaveLength(0)
  await ui.unmount()
})

const SYNC = {
  options: { ...FR.options, syncFolder: '~/Cloud/docket', machineName: 'Portable' },
}
const MACHINES = '/Users/me/Cloud/docket/machines'

test('a computer writes its conversations to the sync folder', SYNC, async ($, on) => {
  mockEngine(on, {}, {
    'local_here.json': desktopRecord('here', 'Ici', false, { bridgeSessionIds: ['nope', 'session_0123456789abcdef'] }),
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Préparer la démo' })
  await $.command.run({ command: 'docket', args: 'note relire demain' })

  const written = [...disk.keys()].filter(path => path.startsWith(`${MACHINES}/`))
  expect(written.length).toBe(1)
  const machine = JSON.parse(disk.get(written[0] ?? '') ?? '{}')
  expect(machine.name).toBe('Portable')
  expect(machine.sessions.map((session: { title: string }) => session.title)).toEqual(['Ici'])
  // Its Remote Control id, so the other computers can open it.
  expect(machine.sessions[0].remoteId).toBe('session_0123456789abcdef')
  // The note set a moment ago is already shared.
  expect(machine.entries[0]).toMatchObject({ hostId: 'local_here', status: 'en-cours', note: 'relire demain' })
  // With the mod's version, and when it wrote.
  expect(machine.version).toBe(PANE.props.title.replace('🏷️ Docket ', ''))
  expect(machine.publishedAt).toBe(3_600_000)

  // Unchanged, the file is written again only after a while, so the others see this one is there.
  const writtenAt = () => JSON.parse(disk.get(written[0] ?? '') ?? '{}').publishedAt as number
  await clock.advance(30_000)
  const settled = writtenAt()
  await clock.advance(60_000)
  expect(writtenAt()).toBe(settled)
  await clock.advance(5 * 60_000)
  expect(writtenAt()).toBeGreaterThan(settled)
})

test('the board shows the conversations another computer shared', SYNC, async ($, on) => {
  mockEngine(on, { filters: { status: 'tous', flags: {} } })
  disk.set(
    `${MACHINES}/far-machine.json`,
    JSON.stringify({
      machineId: 'far-machine',
      name: 'Bureau',
      sessions: [
        {
          cliSessionId: 'far',
          hostId: 'local_far',
          title: 'Loin',
          folder: 'api',
          lastActivityAt: 3_590_000,
          isArchived: false,
          priorCliSessionIds: [],
          turnStartedAt: 3_580_000,
          branches: [{ repo: '/repo', branch: 'feature' }],
          remoteId: 'cse_0123456789abcdef',
        },
        {
          cliSessionId: 'closed',
          hostId: 'local_closed',
          title: 'Fermée',
          folder: 'api',
          lastActivityAt: 3_500_000,
          isArchived: false,
          priorCliSessionIds: [],
        },
      ],
      entries: [
        { sessionId: 'far', hostId: 'local_far', label: 'Loin', folder: 'api', status: 'en-attente', flags: {}, updatedAt: 1 },
      ],
      git: { '/repo\u0000feature': { isDirty: true, unpushed: 0, isMerged: true } },
    }),
  )
  disk.set(`${MACHINES}/broken.json`, 'not json')
  const runs: (readonly string[])[] = []
  on('process.run', (_, e) => {
    runs.push(e.argv)

    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // In its status group, named after its computer, with that computer's git and a spinner.
  expect(await ui.find({ type: 'Box', key: 'heading-en-attente' })).toBeTruthy()
  // Under its computer's name, apart from this computer's conversations, under "Local".
  expect(await ui.find({ type: 'Text', text: '📡 Bureau' })).toBeTruthy()
  expect(await ui.find({ type: 'Box', key: 'place-en-attente-Bureau' } as never)).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^api$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: '✎ non commité' })).toBeTruthy()
  expect(await ui.find({ type: 'Svg', alt: 'Claude travaille' } as never)).toBeTruthy()
  // It opens through Remote Control; it cannot be removed from here.
  expect((await ui.find({ type: 'Markdown', key: 'open-far' }))?.props.text).toBe(
    '**[Loin](https://claude.ai/code/cse_0123456789abcdef)**',
  )
  expect(await ui.find({ type: 'Button', key: 'remove-far' })).toBeFalsy()
  await ui.press({ key: 'open-far', link: { href: 'https://claude.ai/code/cse_0123456789abcdef' } })
  // In the app, through its own scheme.
  expect(runs).toEqual([['/usr/bin/open', 'claude://claude.ai/code/cse_0123456789abcdef']])
  // Without a Remote Control id, the title is plain text.
  await showOnly(ui, ['aucun'])
  expect(await ui.find({ type: 'Text', text: /^Fermée$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Markdown', key: 'open-closed' })).toBeFalsy()
  await ui.unmount()
})

test('without a sync folder nothing is written nor read', FR, async ($, on) => {
  mockEngine(on, { filters: { status: 'tous', flags: {} } }, { 'local_here.json': desktopRecord('here', 'Ici') })
  disk.set('/Users/me/Cloud/docket/machines/far.json', JSON.stringify({ machineId: 'far', name: 'Bureau', sessions: [], entries: [], git: {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Préparer la démo' })
  expect([...disk.keys()]).toEqual(['/Users/me/Cloud/docket/machines/far.json'])
})

test('a snooze hides a conversation for a while, and the search still finds it', FR, async ($, on) => {
  const store = mockEngine(
    on,
    { filters: { status: 'tous', flags: {} } },
    {
      'local_a.json': desktopRecord('a', 'Première', false, {
        postTurnSummary: { status_category: 'blocked', needs_action: 'Choisis une option' },
      }),
      'local_b.json': desktopRecord('b', 'Deuxième'),
    },
  )

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const picker = await ui.find({ type: 'Select', key: 'snooze-a' })
  expect(picker?.props.options.map(option => option.value)).toEqual([
    '',
    '5m',
    '10m',
    '15m',
    '30m',
    '1h',
    '1d',
  ])
  expect(await ui.find({ type: 'Box', key: 'your-turn' } as never)).toBeTruthy()
  // At the bottom of the card, after the summary, so the title keeps the width.
  const card = JSON.stringify(await ui.find({ type: 'Box', key: 'row-a' } as never))
  expect(card.indexOf('"key":"snooze-a"')).toBeGreaterThan(card.indexOf('Choisis une option'))
  // On that last line, the age at the left and 🌙 at the right.
  const last = await ui.find({ type: 'Box', key: 'snooze-row-a' } as never)
  expect(last?.props.justifyContent).toBe('space-between')
  const line = JSON.stringify(last)
  expect(line.indexOf('"key":"age-a"')).toBeGreaterThan(-1)
  expect(line.indexOf('"key":"age-a"')).toBeLessThan(line.indexOf('"key":"snooze-a"'))
  // The glyph sits on that line too, left of the age, so the lines above start at the card's edge.
  expect(line.indexOf('"type":"Svg"')).toBeGreaterThan(-1)
  expect(line.indexOf('"type":"Svg"')).toBeLessThan(line.indexOf('"key":"age-a"'))

  // Snoozed, it leaves the frame of what waits on you and the band's count.
  await ui.select({ key: 'snooze-a', value: '10m' })
  expect(await ui.find({ type: 'Markdown', key: 'open-a' })).toBeFalsy()
  expect(await ui.find({ type: 'Box', key: 'your-turn' } as never)).toBeFalsy()
  expect(Object.keys(store.get('snoozes') as object)).toEqual(['local_a'])
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Button', key: 'your-turn' })).toBeFalsy()
  await band.unmount()

  // A button left of ↻ shows the snoozed conversations again, until pressed again.
  expect((await ui.find({ type: 'Button', key: 'show-snoozed' }))?.props.label).toBe('☐ 🌙 En snooze (1)')
  const board = JSON.stringify(await ui.find({ type: 'Box', key: 'refresh-row' } as never))
  expect(board.indexOf('"key":"show-snoozed"')).toBeLessThan(board.indexOf('"key":"refresh"'))
  // The toggle sits at the left of the bar, ↻ at its right.
  expect((await ui.find({ type: 'Box', key: 'refresh-row' } as never))?.props.justifyContent).toBe('space-between')
  await ui.press({ key: 'show-snoozed' })
  expect((await ui.find({ type: 'Button', key: 'show-snoozed' }))?.props.label).toBe('☑ 🌙 En snooze (1)')
  expect(await ui.find({ type: 'Markdown', key: 'open-a' })).toBeTruthy()
  expect((await ui.find({ type: 'Select', key: 'snooze-a' }))?.props.options[0]?.label).toBe('🌙 10 min')
  expect(store.get('filters')).toMatchObject({ showSnoozed: true })
  await ui.press({ key: 'show-snoozed' })
  expect(await ui.find({ type: 'Markdown', key: 'open-a' })).toBeFalsy()

  // The search finds it, with what is left of its snooze.
  await ui.input({ key: 'search', text: 'premiere', kind: 'change' })
  expect(await ui.find({ type: 'Markdown', key: 'open-a' })).toBeTruthy()
  expect((await ui.find({ type: 'Select', key: 'snooze-a' }))?.props.options[0]?.label).toBe('🌙 10 min')
  await ui.input({ key: 'search', text: '', kind: 'change' })

  // It wakes up on its own once the time is up.
  await clock.advance(11 * 60_000)
  expect(await ui.find({ type: 'Markdown', key: 'open-a' })).toBeTruthy()

  // Or sooner, from the search.
  await ui.select({ key: 'snooze-a', value: '1d' })
  expect(await ui.find({ type: 'Markdown', key: 'open-a' })).toBeFalsy()
  await ui.input({ key: 'search', text: 'premiere', kind: 'change' })
  expect((await ui.find({ type: 'Select', key: 'snooze-a' }))?.props.options[0]?.label).toBe('🌙 1 j')
  await ui.select({ key: 'snooze-a', value: 'wake' })
  await ui.input({ key: 'search', text: '', kind: 'change' })
  expect(await ui.find({ type: 'Markdown', key: 'open-a' })).toBeTruthy()
  expect(store.get('snoozes')).toMatchObject({ local_a: { until: 0 } })
  await ui.unmount()
})

test('the computers share their snoozes, and the last word on one wins', SYNC, async ($, on) => {
  const store = mockEngine(on, { filters: { status: 'tous', flags: {} } })
  disk.set(
    `${MACHINES}/far-machine.json`,
    JSON.stringify({
      machineId: 'far-machine',
      name: 'Bureau',
      sessions: [
        {
          cliSessionId: 'far',
          hostId: 'local_far',
          title: 'Loin',
          folder: 'api',
          lastActivityAt: 3_590_000,
          isArchived: false,
          priorCliSessionIds: [],
        },
      ],
      entries: [
        { sessionId: 'far', hostId: 'local_far', label: 'Loin', folder: 'api', status: 'en-attente', flags: {}, updatedAt: 1 },
      ],
      git: {},
      // Snoozed over there a minute ago, for half an hour.
      snoozes: { local_far: { until: 3_600_000 + 29 * 60_000, setAt: 3_540_000 } },
    }),
  )

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^Loin$/ })).toBeFalsy()

  // Woken up here: this computer's word is the last, and it is published.
  await ui.input({ key: 'search', text: 'loin', kind: 'change' })
  expect((await ui.find({ type: 'Select', key: 'snooze-far' }))?.props.options[0]?.label).toBe('🌙 29 min')
  await ui.select({ key: 'snooze-far', value: 'wake' })
  await ui.input({ key: 'search', text: '', kind: 'change' })
  expect(await ui.find({ type: 'Text', text: /^Loin$/ })).toBeTruthy()
  expect(store.get('snoozes')).toMatchObject({ local_far: { until: 0 } })
  const own = [...disk.keys()].find(path => path.startsWith(`${MACHINES}/`) && !path.endsWith('far-machine.json'))
  expect(JSON.parse(disk.get(own ?? '') ?? '{}').snoozes).toMatchObject({ local_far: { until: 0 } })
  await ui.unmount()
})

test('a group with conversations of several computers shows this one first, under Local', SYNC, async ($, on) => {
  mockEngine(on, { filters: { status: 'tous', flags: {} }, 'session:other': OTHER })
  disk.set(
    `${MACHINES}/far-machine.json`,
    JSON.stringify({
      machineId: 'far-machine',
      name: 'Bureau',
      sessions: [
        { cliSessionId: 'far', hostId: 'local_far', title: 'Loin', folder: 'api', lastActivityAt: 3_590_000, isArchived: false, priorCliSessionIds: [] },
      ],
      entries: [
        { sessionId: 'far', hostId: 'local_far', label: 'Loin', folder: 'api', status: OTHER.status, flags: {}, updatedAt: 1 },
      ],
      git: {},
      version: '0.1.0',
      publishedAt: 3_000_000,
    }),
  )

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const group = JSON.stringify(await ui.find({ type: 'Box', key: `group-${OTHER.status}` } as never))
  // The other computer's version, marked as not this one's, and how long ago it wrote.
  expect(group).toContain('⚠️ 0.1.0 · il y a 10 min')
  // Positions in the tree, past the group's flattened text.
  const at = (text: string) => group.indexOf(text, group.indexOf('"children"'))
  expect(at('🏠 Local')).toBeGreaterThan(-1)
  expect(at('📡 Bureau')).toBeGreaterThan(at('🏠 Local'))
  expect(at('Loin')).toBeGreaterThan(at('📡 Bureau'))
  // The rule closing the Local section's last card comes before the other computer's name.
  expect(at('separator-other')).toBeGreaterThan(at('🏠 Local'))
  expect(at('separator-other')).toBeLessThan(at('📡 Bureau'))
  // The last card of the group gets its rule too, before the next heading.
  expect(at('separator-far')).toBeGreaterThan(at('Loin'))
  await ui.unmount()
})

test('a conversation in two files of one computer is drawn once, with its latest status', SYNC, async ($, on) => {
  mockEngine(on, { filters: { status: 'tous', flags: {} } })
  const session = (lastActivityAt: number) => ({
    cliSessionId: 'far',
    hostId: 'local_far',
    title: 'Loin',
    folder: 'api',
    lastActivityAt,
    isArchived: false,
    priorCliSessionIds: [],
    remoteId: 'cse_0123456789abcdef',
  })
  // The older file has the status; the newer one, written by another copy of the mod, does not.
  disk.set(
    `${MACHINES}/old-machine.json`,
    JSON.stringify({
      machineId: 'old-machine',
      name: 'Bureau',
      sessions: [session(3_000_000)],
      entries: [{ sessionId: 'far', hostId: 'local_far', label: 'Loin', folder: 'api', status: 'en-attente', flags: {}, updatedAt: 5 }],
      git: {},
    }),
  )
  disk.set(
    `${MACHINES}/new-machine.json`,
    JSON.stringify({ machineId: 'new-machine', name: 'Bureau', sessions: [session(3_500_000)], entries: [], git: {} }),
  )

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Markdown', key: 'open-far' })).toBeTruthy()
  expect(await ui.find({ type: 'Box', key: 'heading-en-attente' })).toBeTruthy()
  await ui.unmount()
})

test('a wide board lays its groups side by side, one column each', FR, async ($, on) => {
  mockEngine(on, { 'session:other': OTHER })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: 'en-cours' })

  const narrow = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await narrow.find({ type: 'Box', key: 'heading-en-cours' })).toBeTruthy()
  expect(await narrow.find({ type: 'Box', key: 'board-columns' })).toBeFalsy()
  await narrow.unmount()

  const wide = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns: 160 } })
  const board = JSON.stringify(await wide.find({ type: 'Box', key: 'board-columns' }))
  expect(board).toContain('group-en-cours')
  expect(board).toContain('group-en-attente')
  expect(board.indexOf('group-en-cours')).toBeLessThan(board.indexOf('group-en-attente'))
  // Your turn and Clauding keep their columns, empty, so the others do not move.
  expect(board.indexOf('"your-turn"')).toBeLessThan(board.indexOf('group-running'))
  expect(board.indexOf('group-running')).toBeLessThan(board.indexOf('group-en-cours'))
  expect(board).toContain('Rien ne t’attend.')
  expect(board).toContain('Claude ne travaille nulle part.')
  // Its filters sit on one line rather than in two columns.
  expect(await wide.find({ type: 'Box', key: 'filter-line' })).toBeTruthy()
  expect(await wide.find({ type: 'Box', key: 'filter-column-1' })).toBeFalsy()
  await wide.unmount()
})

test('a wide board gives the running conversations a column of their own', FR, async ($, on) => {
  mockEngine(on, { filters: { status: 'aucun', flags: {} } }, {
    'local_busy.json': desktopRecord('busy', 'Occupée', false, RUNNING),
    'local_idle.json': desktopRecord('idle', 'Au repos', false, {
      latestUserFrameAt: 3_500_000,
      lastTurnEdgeAt: 3_510_000,
      lastActivityAt: 3_590_000,
    }),
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })

  // Narrow, the running conversation stays in its group.
  const narrow = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await narrow.find({ type: 'Box', key: 'heading-running' })).toBeFalsy()
  await narrow.unmount()

  const wide = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns: 160 } })
  const column = JSON.stringify(await wide.find({ type: 'Box', key: 'group-running' }))
  expect(column).toContain('✻ Clauding (1)')
  expect(column).toContain('Occupée')
  expect(column).not.toContain('Au repos')
  const rest = JSON.stringify(await wide.find({ type: 'Box', key: 'group-aucun' }))
  expect(rest).toContain('Au repos')
  expect(rest).not.toContain('Occupée')
  await wide.unmount()
})

test('a wide board keeps filters of its own, started from the side panel ones', FR, async ($, on) => {
  const store = mockEngine(on, { 'session:other': OTHER })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: 'en-cours' })
  const period = async (ui: { find: (q: { type: string; key: string }) => Promise<{ props: { value?: unknown } } | undefined> }) =>
    (await ui.find({ type: 'Select', key: 'period-filter' }))?.props.value

  const narrow = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await narrow.select({ key: 'period-filter', value: '7d' })
  await narrow.unmount()

  // The wide board starts from the side panel's filters, then keeps its own.
  const wide = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns: 160 } })
  expect(await period(wide)).toBe('7d')
  await wide.select({ key: 'period-filter', value: '1h' })
  expect(await period(wide)).toBe('1h')
  await wide.unmount()

  const back = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await period(back)).toBe('7d')
  await back.unmount()
  expect((store.get('filters') as { period: string }).period).toBe('7d')
  expect((store.get('filtersWide') as { period: string }).period).toBe('1h')
})

test('a dashboard conversation leaves the board and its band names it', FR, async ($, on) => {
  const store = mockEngine(on, {}, {
    'local_here.json': desktopRecord('here', 'Tableau'),
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: 'en-cours' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Box', key: 'row-here' })).toBeTruthy()

  const made = await $.command.run({ command: 'docket', args: 'dashboard' })
  expect(made.text).toContain('tableau de bord')
  expect(await ui.find({ type: 'Box', key: 'row-here' })).toBeFalsy()
  expect((store.get('host:local_here') as { status: unknown; isDashboard: boolean }).status).toBeNull()

  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Text', text: /Tableau de bord/ })).toBeTruthy()
  expect(await band.find({ type: 'Button', key: 'status-en-cours' })).toBeFalsy()
  await band.unmount()

  const undone = await $.command.run({ command: 'docket', args: 'dashboard non' })
  expect(undone.text).toContain('n’est plus')
  expect((store.get('host:local_here') as { isDashboard?: boolean }).isDashboard).toBeUndefined()
  await ui.unmount()
})

test('a dashboard tells when a conversation waits on you or Claude is done', FR, async ($, on) => {
  const files: Record<string, string> = {
    'local_here.json': desktopRecord('here', 'Tableau'),
    'local_busy.json': desktopRecord('busy', 'Occupée', false, RUNNING),
    'local_ask.json': desktopRecord('ask', 'Questionneuse', false, RUNNING),
  }
  mockEngine(on, {}, files)
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: 'dashboard' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // The first look only learns what runs.
  await clock.advance(30_000)
  expect(toasts).toEqual([])

  // One turn ends; the other stops to ask something.
  files['local_busy.json'] = desktopRecord('busy', 'Occupée', false, { ...RUNNING, lastTurnEdgeAt: 3_595_000 })
  files['local_ask.json'] = desktopRecord('ask', 'Questionneuse', false, {
    ...RUNNING,
    lastTurnEdgeAt: 3_595_000,
    postTurnSummary: { status_category: 'blocked', needs_action: 'Laquelle ?' },
  })
  await clock.advance(30_000)
  expect(toasts).toEqual(['⚠️ Questionneuse t’attend', '✻ Occupée a fini'])
  await ui.unmount()
})

test('a turn that closes on a question in the next-step box waits on the person', FR, async ($, on) => {
  // The app's summary calls the turn completed.
  const record = {
    latestUserFrameAt: 3_580_000,
    lastTurnEdgeAt: 3_582_000,
    lastActivityAt: 3_582_000,
    completedTurns: 3,
    lastAssistantUuid: 'answer-3',
    postTurnSummaryFor: 'answer-3',
    postTurnSummary: { status_category: 'completed', status_detail: 'Pochettes agrandies', needs_action: '' },
  }
  mockEngine(on, { filters: { status: 'aucun', flags: {} } }, {
    'local_far.json': desktopRecord('far', 'Pochettes', false, record),
  })
  const transcript = '/Users/me/.claude/projects/-Users-me-src-my-app/far.jsonl'
  const line = (entry: Record<string, unknown>) => JSON.stringify(entry)
  let text = [
    line({ type: 'user', message: { content: 'Agrandis les pochettes' } }),
    line({
      type: 'assistant',
      message: {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', name: 'mcp__ccd_turn__wrap_up', input: { ask: 'La taille te convient ?', actions: [] } }],
      },
    }),
    line({ type: 'user', message: { content: [{ type: 'tool_result' }] } }),
    line({ type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text' }] } }),
    line({ type: 'system', subtype: 'stop_hook_summary' }),
    // A command run directly afterwards changes nothing.
    line({ type: 'user', message: { content: '<command-name>/docket</command-name>' } }),
    line({ type: 'system', subtype: 'local_command' }),
  ].join('\n')
  let writtenAt = 3_590_000
  on('fs.stat', (_, e) => {
    if (e.path !== transcript) {
      throw new Error('missing')
    }

    return { value: { kind: 'file' as const, size: text.length, mtimeMs: writtenAt, isLink: false } }
  })
  on('process.run', (_, e) => ({
    value: { exitCode: e.argv[0] === 'tail' ? 0 : 1, stdout: e.argv[0] === 'tail' ? text : '', stderr: '' },
  }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const yourTurn = JSON.stringify(await ui.find({ type: 'Box', key: 'your-turn' }))
  expect(yourTurn).toContain('Pochettes')
  expect(yourTurn).toContain('La taille te convient ?')

  // Once the person answers and the next turn ends with no question, it waits no more.
  text = [
    text,
    line({ type: 'user', message: { content: 'Oui, commite' } }),
    line({ type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text' }] } }),
    line({ type: 'system', subtype: 'stop_hook_summary' }),
  ].join('\n')
  writtenAt = 3_599_000
  await clock.advance(30_000)
  expect(await ui.find({ type: 'Box', key: 'your-turn' })).toBeFalsy()

  // A question card left open mid-turn waits on the person too: the turn does not run.
  text = [
    text,
    line({ type: 'user', message: { content: 'Quel fond ?' } }),
    line({ type: 'assistant', message: { stop_reason: 'tool_use', content: [{ type: 'thinking' }] } }),
    line({
      type: 'assistant',
      message: {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', name: 'AskUserQuestion', input: { questions: [{ question: 'Quel écran ?' }] } }],
      },
    }),
    line({ type: 'last-prompt' }),
  ].join('\n')
  writtenAt = 3_600_000
  await clock.advance(30_000)
  const asked = JSON.stringify(await ui.find({ type: 'Box', key: 'your-turn' }))
  expect(asked).toContain('Quel écran ?')
  await ui.unmount()
})

test('a project colored gray gets gray glyphs', { options: { ...FR.options, projectColors: JSON.stringify({ 'my-app': 'gris' }) } }, async ($, on) => {
  mockEngine(on, { filters: { status: 'aucun', flags: {} } }, { 'local_a.json': desktopRecord('a', 'Première') })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const colors = [] as string[]
  for (const shape of ['●', '■', '▲', '◆', '★', '✚', '◐', '⬢']) {
    const found = await ui.find({ type: 'Text', text: shape })
    if (typeof found?.props.color === 'string') {
      colors.push(found.props.color)
    }
  }
  await ui.unmount()

  expect(colors.length).toBeGreaterThan(0)
  for (const color of colors) {
    const [r, g, b] = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16))
    expect(r).toBe(g)
    expect(g).toBe(b)
  }
})

test('the board asks for a restart when a newer version waits in the mod folder', FR, async ($, on) => {
  mockEngine(on, { filters: { status: 'aucun', flags: {} } }, {}, { CLAUDE_CODE_PLUGIN_DIRS: '~/src/docket' })
  const manifest = '/Users/me/src/docket/.claude-plugin/plugin.json'
  let version = '9.9.9'
  on('fs.stat', (_, e) => {
    if (e.path !== manifest) {
      throw new Error('missing')
    }

    return { value: { kind: 'file' as const, size: 1, mtimeMs: version.length + version.charCodeAt(0), isLink: false } }
  })
  const write = () => disk.set(manifest, JSON.stringify({ name: 'docket', version }))
  write()

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '🔄 Docket 9.9.9 est prêt : relance l’app pour l’utiliser.' })).toBeTruthy()

  // Once the folder holds the running version again, the line leaves.
  version = PANE.props.title.replace('🏷️ Docket ', '')
  write()
  await $.command.run({ command: 'docket', args: '' })
  expect(await ui.find({ type: 'Text', text: /relance l’app/ })).toBeFalsy()
  await ui.unmount()
})
