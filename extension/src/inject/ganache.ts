// Ganache and @ethereum/vm use eval and wasm-eval so we cannot run it in an extension page or a background script.
// We also cannot run in in a Sandbox page (https://developer.chrome.com/docs/extensions/mv3/manifest/sandbox/), because Indexed DB is not available there.
// So this script is injected via contentScripts.ts into an externally hosted page loaded in an iframe, communication happens via postMessage.

import EventEmitter from 'events'

import ganache from 'ganache'

interface JsonRpcRequest {
  method: string
  params?: Array<any>
}

// Ganache needs a provider for forking, we bridge to the host page's provider
class Eip1193Provider extends EventEmitter {
  private messageId = 0

  constructor() {
    super()
    if (!window.top) throw new Error('Must run inside iframe')

    window.top.postMessage(
      {
        zodiacPilotGanacheInit: true,
      },
      '*'
    )
  }

  request(request: JsonRpcRequest): Promise<any> {
    const currentMessageId = this.messageId
    this.messageId++

    return new Promise((resolve, reject) => {
      if (!window.top) throw new Error('Must run inside iframe')

      window.top.postMessage(
        {
          zodiacPilotRequestFromGanache: true,
          request,
          messageId: currentMessageId,
        },
        '*'
      )

      const handleMessage = (ev: MessageEvent) => {
        const { zodiacPilotResponseToGanache, messageId, error, response } =
          ev.data
        if (zodiacPilotResponseToGanache && messageId === currentMessageId) {
          window.removeEventListener('message', handleMessage)
          // console.debug('RES TO GANACHE', messageId, response)
          if (error) {
            reject(error)
          } else {
            resolve(response)
          }
        }
      }

      window.addEventListener('message', handleMessage)
    })
  }
}

const DB_NAME = 'pilot'

const setupFork = () => {
  const provider = ganache.provider({
    fork: {
      /* eslint-disable-next-line @typescript-eslint/ban-ts-comment */
      // @ts-ignore wrong typing in the ganache package
      provider: new Eip1193Provider(),
    },
    chain: {
      chainId: 4,
    },
    wallet: {
      unlockedAccounts: ['0x87eb5f76c3785936406fa93654f39b2087fd8068'],
    },
    database: {
      dbPath: DB_NAME,
    },
  })

  // establish message bridge for ganache requests
  window.addEventListener('message', async (ev: MessageEvent) => {
    const { zodiacPilotGanacheRequest, messageId, request } = ev.data
    if (zodiacPilotGanacheRequest) {
      if (!window.top) throw new Error('Must run inside iframe')
      console.debug('GAN REQ', messageId, request)

      const response = await provider.request(request)

      window.top.postMessage(
        {
          zodiacPilotGanacheResponse: true,
          messageId,
          response,
        },
        '*'
      )
    }
  })

  if (!window.top) throw new Error('Must run inside iframe')
  window.top.postMessage(
    {
      zodiacPilotGanacheInit: true,
    },
    '*'
  )
}

// clear DB when reloading the page
const req = indexedDB.deleteDatabase(DB_NAME)
req.onsuccess = function () {
  setupFork()
}
