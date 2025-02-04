import EventEmitter from 'events'

import React, { useCallback, useContext, useEffect, useState } from 'react'

import { useConnection } from '../settings/connectionHooks'
import { Eip1193Provider, JsonRpcRequest } from '../types'

const GanacheContext = React.createContext<GanacheProvider | null>(null)

export const useGanacheProvider = (): GanacheProvider => {
  const context = useContext(GanacheContext)
  if (!context) {
    throw new Error('must be wrapped by <ProvideGanache>')
  }
  return context
}

const ProvideGanache: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { provider: walletConnectProvider } = useConnection()
  const [provider, setProvider] = useState<GanacheProvider | null>(null)
  const [bridgeReady, setBridgeReady] = useState(false)

  // Once the iframe is mounted we create the GanacheProvider that calls to it.
  const ref = useCallback((frame: HTMLIFrameElement | null) => {
    if (frame?.contentWindow) {
      setProvider(new GanacheProvider(frame.contentWindow))
    }
  }, [])

  // Establish bridge so the provider powering the Ganache fork can call to the WalletConnect provider
  useEffect(() => {
    if (!walletConnectProvider) return

    const bridgeHost = new GanacheBridgeHost(walletConnectProvider)

    bridgeHost.once('ready', () => setBridgeReady(true))
    const handle = (ev: MessageEvent<any>) => bridgeHost.handleMessage(ev)
    window.addEventListener('message', handle)

    return () => {
      window.removeEventListener('message', handle)
    }
  }, [walletConnectProvider])

  // We only render children when provider is available and the bridge is established so that we are ready to handle requests.
  return (
    <GanacheContext.Provider value={provider}>
      {provider && bridgeReady && children}
      <iframe
        title="Ganache"
        name="ganache-frame"
        ref={ref}
        // We need to run the iframe window under an external host for Chrome to give us permission to use Indexed DB.
        src="https://pilot.gnosisguild.org/"
        style={{ display: 'none' }}
      />
    </GanacheContext.Provider>
  )
}

export default ProvideGanache

// This is like the Dapp bridge host (/src/bridge/host) just for the ganache iframe.
// So it handles JSON RPC requests that Ganache performs for forking the network.
class GanacheBridgeHost extends EventEmitter {
  private source: WindowProxy | undefined
  private provider: Eip1193Provider

  constructor(provider: Eip1193Provider) {
    super()
    this.provider = provider
  }

  initBridge(event: MessageEvent<any>) {
    if (!event.source) throw new Error('Unable to get message source')
    if (
      event.source instanceof MessagePort ||
      event.source instanceof ServiceWorker
    ) {
      throw new Error('Expected message to originate from window')
    }
    this.source = event.source
    this.emit('ready')
  }

  private async handleRequest(request: Request, messageId: number) {
    // console.debug('REQ FROM GANACHE', messageId, request)
    if (!this.source) throw new Error('source must be set')

    let response
    let error
    try {
      response = await this.provider.request(request)
    } catch (e) {
      error = e
    }

    this.source.postMessage(
      {
        zodiacPilotResponseToGanache: true,
        messageId,
        response,
        error,
      },
      '*'
    )
  }

  handleMessage(ev: MessageEvent<any>) {
    const {
      zodiacPilotGanacheInit,

      zodiacPilotRequestFromGanache,
      messageId,
      request,
    } = ev.data

    if (zodiacPilotGanacheInit) {
      this.initBridge(ev)
      return
    }

    if (zodiacPilotRequestFromGanache) {
      this.assertConsistentSource(ev)
      this.handleRequest(request, messageId)
    }
  }

  private assertConsistentSource(event: MessageEvent<any>) {
    if (event.source !== this.source) {
      throw new Error('unexpected message source')
    }
  }
}

export class GanacheProvider extends EventEmitter {
  private messageId = 0
  private ganacheWindow: Window

  constructor(ganacheWindow: Window) {
    super()
    this.ganacheWindow = ganacheWindow
  }

  request(request: JsonRpcRequest): Promise<any> {
    const currentMessageId = this.messageId
    this.messageId++

    return new Promise((resolve, reject) => {
      this.ganacheWindow.postMessage(
        {
          zodiacPilotGanacheRequest: true,
          request,
          messageId: currentMessageId,
        },
        '*'
      )

      const handleMessage = (ev: MessageEvent) => {
        const { zodiacPilotGanacheResponse, messageId, error, response } =
          ev.data
        if (zodiacPilotGanacheResponse && messageId === currentMessageId) {
          window.removeEventListener('message', handleMessage)
          console.debug('GAN RES', messageId, response)
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
