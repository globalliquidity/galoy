import { ONCHAIN_MIN_CONFIRMATIONS } from "@config"

import { getCurrentPrice } from "@app/prices"
import { PartialResult } from "@app/partial-result"

import { LedgerError } from "@domain/ledger"
import { WalletTransactionHistory } from "@domain/wallets"
import { TxFilter } from "@domain/bitcoin/onchain"

import { baseLogger } from "@services/logger"
import { LedgerService } from "@services/ledger"
import { AccountsRepository } from "@services/mongoose"

import { getOnChainTxs } from "./private/get-on-chain-txs"

export const getTransactionsForWalletsByAddresses = async ({
  wallets,
  addresses,
  paginationArgs,
}: {
  wallets: Wallet[]
  addresses: OnChainAddress[]
  paginationArgs?: PaginationArgs
}): Promise<PartialResult<WalletTransaction[]>> => {
  const walletIds = wallets.map((wallet) => wallet.id)

  const ledger = LedgerService()
  const ledgerTransactionsForWallets = await ledger.getTransactionsByWalletIds({
    walletIds,
    paginationArgs,
  })
  if (ledgerTransactionsForWallets instanceof LedgerError)
    return PartialResult.err(ledgerTransactionsForWallets)
  const ledgerTransactions = ledgerTransactionsForWallets.filter(
    (tx) => tx.address && addresses.includes(tx.address),
  )

  const confirmedHistory = WalletTransactionHistory.fromLedger(ledgerTransactions)

  const onChainTxs = await getOnChainTxs()
  if (onChainTxs instanceof Error) {
    baseLogger.warn({ onChainTxs }, "impossible to get listIncomingTransactions")
    return PartialResult.partial(confirmedHistory.transactions, onChainTxs)
  }

  const allAddresses: OnChainAddress[] = []
  const addressesByWalletId: { [walletid: string]: OnChainAddress[] } = {}
  const walletDetailsByWalletId: {
    [walletid: string]: { currency: WalletCurrency; depositFeeRatio: DepositFeeRatio }
  } = {}

  const accountRepo = AccountsRepository()
  for (const wallet of wallets) {
    const walletAddresses = wallet.onChainAddresses()
    addressesByWalletId[wallet.id] = walletAddresses
    allAddresses.push(...walletAddresses)

    const account = await accountRepo.findById(wallet.accountId)
    const depositFeeRatio =
      account instanceof Error ? (0 as DepositFeeRatio) : account.depositFeeRatio
    walletDetailsByWalletId[wallet.id] = { currency: wallet.currency, depositFeeRatio }
  }
  const addressesForWallets = addresses.filter((address) =>
    allAddresses.includes(address),
  )

  const filter = TxFilter({
    confirmationsLessThan: ONCHAIN_MIN_CONFIRMATIONS,
    addresses: addressesForWallets,
  })

  const pendingIncoming = filter.apply(onChainTxs)

  let price = await getCurrentPrice()
  if (price instanceof Error) {
    price = NaN as DisplayCurrencyPerSat
  }

  return PartialResult.ok(
    confirmedHistory.addPendingIncoming({
      pendingIncoming,
      addressesByWalletId,
      walletDetailsByWalletId,
      displayCurrencyPerSat: price,
    }).transactions,
  )
}
