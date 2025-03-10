import { toSats } from "@domain/bitcoin"
import { DisplayCurrency, DisplayCurrencyConverter } from "@domain/fiat"
import { WalletCurrency } from "@domain/shared"

import { getCurrentPrice } from "@app/prices"
import { LedgerService } from "@services/ledger"
import { WalletsRepository, UsersRepository } from "@services/mongoose"
import { NotificationsService } from "@services/notifications"
import { wrapAsyncToRunInSpan } from "@services/tracing"

import { getRecentlyActiveAccounts } from "./active-accounts"

export const sendDefaultWalletBalanceToUsers = async () => {
  const accounts = getRecentlyActiveAccounts()
  if (accounts instanceof Error) throw accounts

  const price = await getCurrentPrice()
  const displayCurrencyPerSat = price instanceof Error ? undefined : price
  const converter = displayCurrencyPerSat
    ? DisplayCurrencyConverter(displayCurrencyPerSat)
    : undefined
  const notifyUser = wrapAsyncToRunInSpan({
    namespace: "daily-balance-notification",
    fn: async (account: Account): Promise<void | ApplicationError> => {
      const user = await UsersRepository().findById(account.kratosUserId)
      if (user instanceof Error) return user
      if (user.deviceTokens.length === 0) return

      const wallet = await WalletsRepository().findById(account.defaultWalletId)
      if (wallet instanceof Error) return wallet

      const balanceAmount = await LedgerService().getWalletBalanceAmount(wallet)
      if (balanceAmount instanceof Error) return balanceAmount

      let displayBalanceAmount: DisplayBalanceAmount<DisplayCurrency> | undefined
      if (converter && wallet.currency === WalletCurrency.Btc) {
        const amount = converter.fromSats(toSats(balanceAmount.amount))
        displayBalanceAmount = { amount, currency: DisplayCurrency.Usd }
      }

      return NotificationsService().sendBalance({
        balanceAmount,
        deviceTokens: user.deviceTokens,
        displayBalanceAmount,
        recipientLanguage: user.language,
      })
    },
  })

  for await (const account of accounts) {
    await notifyUser(account)
  }
}
