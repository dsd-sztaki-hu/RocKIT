import { expect } from 'chai'
import { createRockitTerminalLinkHandler } from './rockit-terminal-link-contribution'

describe('RockIT terminal link handler', () => {
  it('opens the exact HTTP URL without creating a blank window', () => {
    const opened: string[] = []
    let prevented = false
    const handler = createRockitTerminalLinkHandler((href) => opened.push(href))
    const event = {
      preventDefault: () => {
        prevented = true
      },
    } as unknown as MouseEvent
    const href =
      'https://repo.researchdata.hu/aroma?localFile=http%3A%2F%2F127.0.0.1%3A9393%2Flocal-file%3Fid%3D540abe3c-7fdc-494e-a714-e5f7f710dba'

    handler.activate(event, ` ${href} `)

    expect(prevented).to.be.true
    expect(opened).to.deep.equal([href])
  })

  it('ignores malformed and non-HTTP links', () => {
    const opened: string[] = []
    const handler = createRockitTerminalLinkHandler((href) => opened.push(href))
    const event = { preventDefault: () => undefined } as unknown as MouseEvent

    handler.activate(event, 'javascript:alert(1)')
    handler.activate(event, 'not a URL')

    expect(opened).to.deep.equal([])
  })
})
