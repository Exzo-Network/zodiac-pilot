import { BigNumber } from 'ethers'
import React, { useEffect, useRef, useState } from 'react'
import { RiFileCopy2Line, RiRefreshLine } from 'react-icons/ri'
import { encodeMulti, encodeSingle } from 'react-multisend'
import { toast } from 'react-toastify'

import { BlockButton, Box, Drawer, Flex, IconButton } from '../../components'
import { ForkProvider } from '../../providers'
import { wrapRequest } from '../../providers/WrappingProvider'
import { useConnection } from '../../settings'
import { useProvider } from '../ProvideProvider'
import { useAllTransactions, useDispatch, useNewTransactions } from '../state'

import Submit from './Submit'
import { Transaction, TransactionBadge } from './Transaction'
import classes from './style.module.css'

const TransactionsDrawer: React.FC = () => {
  const [expanded, setExpanded] = useState(true)
  const allTransactions = useAllTransactions()
  const newTransactions = useNewTransactions()
  const dispatch = useDispatch()
  const provider = useProvider()
  const { connection } = useConnection()

  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  const [scrollItemIntoView, setScrollItemIntoView] = useState<
    number | undefined
  >(undefined)

  const lengthRef = useRef(0)
  useEffect(() => {
    if (newTransactions.length > lengthRef.current) {
      setScrollItemIntoView(newTransactions.length - 1)
    }

    lengthRef.current = newTransactions.length
  }, [newTransactions])

  const reforkAndRerun = async () => {
    // remove all transactions from the store
    dispatch({
      type: 'REMOVE_TRANSACTION',
      payload: { id: allTransactions[0].input.id },
    })

    if (!(provider instanceof ForkProvider)) {
      throw new Error('This is only supported when using ForkProvider')
    }

    await provider.refork()

    // re-simulate all new transactions (assuming the already submitted ones have already been mined on the fresh fork)
    for (let i = 0; i < newTransactions.length; i++) {
      const transaction = newTransactions[i]
      const encoded = encodeSingle(transaction.input)
      await provider.request({
        method: 'eth_sendTransaction',
        params: [
          {
            to: encoded.to,
            data: encoded.data,
            value: formatValue(encoded.value),
            from: connection.avatarAddress,
          },
        ],
      })
    }
  }

  const copyTransactionData = () => {
    const metaTransactions = newTransactions.map((tx) => encodeSingle(tx.input))
    const batchTransaction =
      metaTransactions.length === 1
        ? metaTransactions[0]
        : encodeMulti(
            metaTransactions,
            '0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761'
          )
    const wrappedReq = wrapRequest(batchTransaction, connection)
    navigator.clipboard.writeText(JSON.stringify(wrappedReq, undefined, 2))
    toast(<>Transaction data has been copied to clipboard.</>)
  }

  return (
    <Drawer
      expanded={expanded}
      onToggle={() => {
        setScrollItemIntoView(undefined) // clear scrollItemIntoView so that the original scroll position is restored
        setExpanded(!expanded)
      }}
      collapsedChildren={
        <div className={classes.collapsed}>
          <div className={classes.recordingIcon} />
          <Flex
            gap={2}
            direction="column"
            alignItems="stretch"
            className={classes.wrapper}
          >
            <Flex
              gap={1}
              data-collapsed={true}
              ref={scrollContainerRef}
              className={classes.body + ' coll'}
              direction="column"
            >
              {newTransactions.map((transaction, index) => (
                <BlockButton
                  key={transaction.input.id}
                  onClick={(ev) => {
                    ev.stopPropagation()
                    setScrollItemIntoView(index)
                    setExpanded(true)
                  }}
                >
                  <TransactionBadge
                    index={index}
                    scrollIntoView={scrollItemIntoView === index}
                    {...transaction}
                  />
                </BlockButton>
              ))}
            </Flex>
          </Flex>
        </div>
      }
    >
      <Flex gap={2} alignItems="center">
        <h4 className={classes.header}>Recording Transactions</h4>
        <Flex gap={1} className={classes.headerButtons}>
          <IconButton
            title="Copy batch transaction data to clipboard"
            disabled={newTransactions.length === 0}
            onClick={copyTransactionData}
          >
            <RiFileCopy2Line />
          </IconButton>

          <IconButton
            title="Re-simulate on current blockchain head"
            disabled={newTransactions.length === 0}
            onClick={reforkAndRerun}
          >
            <RiRefreshLine />
          </IconButton>
          <div className={classes.recordingIcon} />
        </Flex>
      </Flex>
      <Flex
        gap={2}
        direction="column"
        alignItems="stretch"
        className={classes.wrapper}
      >
        <Flex
          gap={4}
          ref={scrollContainerRef}
          className={classes.body + ' exp'}
          direction="column"
        >
          {newTransactions.map((transaction, index) => (
            <Transaction
              key={transaction.input.id}
              index={index}
              scrollIntoView={scrollItemIntoView === index}
              {...transaction}
            />
          ))}

          {newTransactions.length === 0 && (
            <p className={classes.hint}>
              As you interact with apps in the browser, transactions will be
              recorded here. You can then sign and submit them as a batch.
            </p>
          )}
        </Flex>
        <Box p={2} bg>
          <Submit />
        </Box>
      </Flex>
    </Drawer>
  )
}

export default TransactionsDrawer

// Tenderly has particular requirements for the encoding of value: it must not have any leading zeros
const formatValue = (value: string): string => {
  const valueBN = BigNumber.from(value)
  if (valueBN.isZero()) return '0x0'
  else return valueBN.toHexString().replace(/^0x(0+)/, '0x')
}
