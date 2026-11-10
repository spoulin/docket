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
    title: 'Statuts',
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

let clock: { advance: (ms: number) => Promise<void> }

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
): Map<string, unknown> {
  const env: Record<string, string> = {
    HOME: '/Users/me',
    CLAUDE_CODE_ACCOUNT_UUID: 'acc',
    CLAUDE_CODE_ORGANIZATION_UUID: 'org',
    CLAUDE_CODE_HOST_SESSION_ID: 'local_here',
  }
  on('fs.list', (_, e) => ({
    value:
      e.path === DESKTOP
        ? Object.keys(files).map(name => ({
            name,
            kind: 'file' as const,
            size: 1,
            mtimeMs: 1,
            isLink: false,
          }))
        : [],
  }))
  on('fs.read', (_, e) => {
    const name = e.path.slice(DESKTOP.length + 1)
    if (!e.path.startsWith(DESKTOP) || files[name] === undefined) {
      throw new Error('missing')
    }

    return { value: files[name] }
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
    value: [{ id: 'docket', title: 'Statuts', isShown: true, isFocused: false, isPlaced: true }],
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
    expect((await ui.find({ type: 'Button', key: 'status-en-cours' }))?.props.variant).toBe(
      'primary',
    )
    expect((await ui.find({ type: 'Button', key: 'remote' }))?.props.label).toBe(
      'Remote : non',
    )
    await ui.unmount()
  }
})

test('the band changes the status and the remote flag', FR, async ($, on) => {
  const store = mockEngine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Préparer la QA' })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'status-recycle' })
  await ui.press({ key: 'remote' })

  expect((await ui.find({ type: 'Button', key: 'status-recycle' }))?.props.variant).toBe(
    'primary',
  )
  expect((await ui.find({ type: 'Button', key: 'remote' }))?.props.label).toBe(
    'Remote : oui',
  )
  expect(store.get('host:local_here')).toMatchObject({
    status: 'recycle',
    isRemote: true,
  })
  await ui.unmount()
})

test('the band shows before the first message, with nothing selected', FR, async ($, on) => {
  const store = mockEngine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Button', key: 'status-en-cours' }))?.props.variant).toBe(
    undefined,
  )
  await ui.press({ key: 'status-en-attente' })
  expect((await ui.find({ type: 'Button', key: 'status-en-attente' }))?.props.variant).toBe(
    'primary',
  )
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
  expect(flag.text).toBe('Remote : oui.')
  expect(bad.text).toContain('Statut inconnu "plus tard".')
  expect(store.get('host:local_here')).toMatchObject({
    status: 'termine',
    isRemote: true,
  })
})

test('the board groups the conversations and filters on remote', FR, async ($, on) => {
  const store = mockEngine(on, { 'session:other': OTHER })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: 'en-cours' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^En cours \(1\)$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^En attente \(1\)$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /my-app · remote · jamais/ })).toBeTruthy()

  await ui.select({ key: 'remote-filter', value: 'remote' })
  expect(await ui.find({ type: 'Text', text: /^En cours/ })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: /^En attente \(1\)$/ })).toBeTruthy()

  await ui.press({ key: 'remove-other' })
  expect(await ui.find({ type: 'Text', text: /^En attente/ })).toBeFalsy()
  expect(store.has('session:other')).toBe(false)
  await ui.unmount()
})

test('the board shows one status at a time', FR, async ($, on) => {
  mockEngine(on, { 'session:other': OTHER })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'docket', args: 'en-cours' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const statusFilter = await ui.find({ type: 'Select', key: 'status-filter' })
  expect(statusFilter?.props.options.find(option => option.value === 'en-attente')?.label).toBe(
    'En attente (1)',
  )

  await ui.select({ key: 'status-filter', value: 'en-attente' })
  expect(await ui.find({ type: 'Text', text: /^En cours/ })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: /^En attente \(1\)$/ })).toBeTruthy()

  await ui.select({ key: 'status-filter', value: 'tous' })
  expect(await ui.find({ type: 'Text', text: /^En cours \(1\)$/ })).toBeTruthy()
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
  expect(statusFilter?.props.options.find(option => option.value === 'aucun')?.label).toBe(
    'Sans statut (1)',
  )
  expect(await ui.find({ type: 'Text', text: /Revue PR 7368/ })).toBeFalsy()

  await ui.select({ key: 'status-filter', value: 'aucun' })
  expect((await ui.find({ type: 'Markdown', key: 'open-desk' }))?.props.text).toContain('Revue PR 7368')
  expect(await ui.find({ type: 'Text', text: /my-app · il y a 10 min/ })).toBeTruthy()
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
  expect(set.text).toBe('Perso : oui.')
  expect(store.get('host:local_here')).toMatchObject({ isPerso: true, status: 'en-cours' })

  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'perso' })
  expect((await band.find({ type: 'Button', key: 'perso' }))?.props.label).toBe('Job')
  await band.unmount()

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.select({ key: 'kind-filter', value: 'perso' })
  await ui.select({ key: 'status-filter', value: 'aucun' })
  expect(await ui.find({ type: 'Markdown', key: 'open-bws' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /BWS2 · perso|my-app · perso/ })).toBeTruthy()

  await ui.select({ key: 'kind-filter', value: 'job' })
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
  expect((await ui.find({ type: 'Select', key: 'status-filter' }))?.props.value).toBe('en-attente')
  expect((await ui.find({ type: 'Select', key: 'remote-filter' }))?.props.value).toBe('remote')

  await ui.select({ key: 'kind-filter', value: 'perso' })
  expect(store.get('filters')).toEqual({ status: 'en-attente', kind: 'perso', remote: 'remote' })
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
          needs_action: "Cédric's answer on the Validator RB gap",
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
  await ui.select({ key: 'status-filter', value: 'aucun' })
  expect(await ui.find({ type: 'Text', text: /my-app · PR #7368 ouverte · il y a/ })).toBeTruthy()
  expect(
    await ui.find({ type: 'Text', text: /^⚠️ À toi : Cédric's answer on the Validator RB gap$/ }),
  ).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^Récap QA publié$/ })).toBeTruthy()
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
  await ui.select({ key: 'status-filter', value: 'en-attente' })
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
    'In progress',
  )
  expect((await band.find({ type: 'Button', key: 'perso' }))?.props.label).toBe('Work')
  await band.unmount()

  expect((await $.command.run({ command: 'docket', args: 'waiting' })).text).toBe(
    'Status: Waiting.',
  )
  await $.command.run({ command: 'docket', args: 'aucun' })
  await $.command.run({ command: 'docket', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Markdown', key: 'ticket-jira' })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: /my-app · 10 min ago/ })).toBeTruthy()
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
