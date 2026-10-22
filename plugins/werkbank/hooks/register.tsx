// Werkbank: zes mods in één plugin. Elke mod staat in hooks/mods/ en doet
// alleen mee als zijn schakelaar (userConfig, te zien in /config) aan staat.
// /werkbank toont de schakelaars en zet een mod aan of uit.
//
// De engine neemt per event één hook zonder matcher per plugin, dus de
// gedeelde events (session.start, tool.call, de band boven de prompt) worden
// hier één keer geregistreerd en met de hand door de mods geleid.
import type { Register, RenderNode } from 'claude-code'

import type { ToolNext } from './lib/types'
import { bestandsboom, bestandsboomStart, bestandsboomTool, toggleTree } from './mods/bestandsboom'
import { bewakerBand, bewakerTool } from './mods/bewaker'
import { diffpaneel, diffpaneelStart, diffpaneelTool, toggleDiffs } from './mods/diffpaneel'
import { statusbalkBand, statusbalkStart, statusbalkTool } from './mods/statusbalk'
import { teller, tellerStart, tellerTool } from './mods/teller'
import { tijdlijn, tijdlijnStart, tijdlijnTool, toggleTimeline } from './mods/tijdlijn'

const MODS = [
  { name: 'teller', title: 'Tool-teller' },
  { name: 'bestandsboom', title: 'Bestandsboom' },
  { name: 'diffpaneel', title: 'Diff-paneel' },
  { name: 'bewaker', title: 'Veiligheidsbewaker' },
  { name: 'tijdlijn', title: 'Agent-tijdlijn' },
  { name: 'statusbalk', title: 'Statusbalk' },
] as const

export const register: Register = (on, options) => {
  const isOn = (name: string) => options[name] !== false

  if (isOn('teller')) teller(on)
  if (isOn('bestandsboom')) bestandsboom(on)
  if (isOn('diffpaneel')) diffpaneel(on)
  if (isOn('tijdlijn')) tijdlijn(on)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'werkbank',
      description: 'Toon de werkbank-mods, of zet er een aan/uit: /werkbank <mod> aan|uit',
      argumentHint: '[mod] [aan|uit]',
    })
    // Een mod die bij de start faalt, houdt de andere niet tegen.
    const failed = (mod: string) => (error: unknown) => $.ui.log(`werkbank/${mod}: start faalde: ${String(error)}`, { to: 'debug' })
    if (isOn('teller')) await tellerStart($).catch(failed('teller'))
    if (isOn('bestandsboom')) await bestandsboomStart($).catch(failed('bestandsboom'))
    if (isOn('diffpaneel')) await diffpaneelStart($).catch(failed('diffpaneel'))
    if (isOn('tijdlijn')) await tijdlijnStart($).catch(failed('tijdlijn'))
    if (isOn('statusbalk')) await statusbalkStart($).catch(failed('statusbalk'))

    return next(e)
  })

  // Van buiten naar binnen: tijdlijn, teller en statusbalk zien elke poging, ook een
  // geblokkeerde; daarna de bewaker, en pas daarachter de mods die bijhouden
  // wat er echt gebeurde (bestandsboom, diff-paneel).
  on('tool.call', ($, e, next) => {
    const toDiff: ToolNext = one => (isOn('diffpaneel') ? diffpaneelTool($, one, next) : next(one))
    const toTree: ToolNext = one => (isOn('bestandsboom') ? bestandsboomTool($, one, toDiff) : toDiff(one))
    const toGuard: ToolNext = one => (isOn('bewaker') ? bewakerTool($, one, toTree) : toTree(one))
    const toBar: ToolNext = one => (isOn('statusbalk') ? statusbalkTool($, one, toGuard) : toGuard(one))
    const toTeller: ToolNext = one => (isOn('teller') ? tellerTool($, one, toBar) : toBar(one))

    return isOn('tijdlijn') ? tijdlijnTool($, e, toTeller) : toTeller(e)
  }).catch(($, e, next) =>
    // Faalt een mod voordat de call de engine bereikte, dan liever weigeren
    // dan een riskant commando doorlaten.
    next.called || !isOn('bewaker') ? next(e) : { deny: 'werkbank: de veiligheidsbewaker faalde; de call is geweigerd.' },
  )

  // De band boven de prompt: waarschuwingen van de bewaker, de statusbalk,
  // dan de knoppen die de panelen tonen of verbergen.
  const hasChips = isOn('bestandsboom') || isOn('diffpaneel') || isOn('tijdlijn')
  if (hasChips || isOn('bewaker') || isOn('statusbalk')) {
    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
      if (e.props.hasSurvey) return next(e)

      const { Box, Button, Text } = $.ui.resolve(e)
      const rows: RenderNode[] = []
      const warning = isOn('bewaker') ? await bewakerBand($, e) : null
      if (warning !== null) rows.push(warning)
      if (isOn('statusbalk')) rows.push(await statusbalkBand($, e))
      if (hasChips) rows.push(
        <Box flexDirection="row" gap={1}>
          <Text dimColor>Panelen (ctrl+x tab, dan letter):</Text>
          {isOn('bestandsboom') && (
            <Button key="chip-tree" hotkey="b" plain dimColor label="Bestanden" onPress={() => toggleTree($)} />
          )}
          {isOn('diffpaneel') && (
            <Button key="chip-diffs" hotkey="d" plain dimColor label="Diffs" onPress={() => toggleDiffs($)} />
          )}
          {isOn('tijdlijn') && (
            <Button key="chip-timeline" hotkey="t" plain dimColor label="Tijdlijn" onPress={() => toggleTimeline($)} />
          )}
        </Box>,
      )
      if (rows.length === 0) return next(e)

      return <Box flexDirection="column">{rows}</Box>
    })
  }

  on('command.run', { command: 'werkbank' }, async ($, e) => {
    const [name, wish] = e.args.trim().toLowerCase().split(/\s+/)
    const list = MODS.map(
      mod => `${isOn(mod.name) ? '●' : '○'} ${mod.name.padEnd(13)} ${mod.title}`,
    ).join('\n')
    if (!name) {
      return { text: `Werkbank-mods (● aan, ○ uit):\n${list}\n\n/werkbank <mod> aan|uit om te schakelen.` }
    }

    const mod = MODS.find(one => one.name === name)
    if (mod === undefined || (wish !== 'aan' && wish !== 'uit')) {
      return { text: `Gebruik: /werkbank <mod> aan|uit\n${list}` }
    }
    // De sleutel is `werkbank.<mod>`, of `werkbank@<bron>.<mod>` naargelang
    // waar de plugin vandaan komt: zoek de rij op in /config.
    const rows = await $.config.list().catch(() => [])
    const row = rows.find(one => /^werkbank(@[^.]+)?\./.test(one.key) && one.key.endsWith(`.${mod.name}`))
    const answer = await $.config.set({ key: row?.key ?? `werkbank.${mod.name}`, value: wish === 'aan' })
    if ('deny' in answer && answer.deny !== undefined) {
      return { text: `Kon ${mod.title} niet schakelen: ${answer.deny}. Gebruik /config.` }
    }

    return { text: `${mod.title} staat nu ${wish}. De plugin herlaadt vanzelf.` }
  })
}
