import { USER_ACTIVENESS_MONTHLY_VOLUME_THRESHOLD } from "@config"
import { ActivityChecker } from "@domain/ledger"
import { WalletsRepository, AccountsRepository } from "@services/mongoose"
import { LedgerService } from "@services/ledger"
import { getCurrentPrice } from "@app/prices"
import { DisplayCurrencyConverter } from "@domain/fiat/display-currency"

export const getRecentlyActiveAccounts = async function* ():
  | AsyncGenerator<Account>
  | ApplicationError {
  const unlockedAccounts = AccountsRepository().listUnlockedAccounts()
  if (unlockedAccounts instanceof Error) return unlockedAccounts

  const displayCurrencyPerSat = await getCurrentPrice()
  if (displayCurrencyPerSat instanceof Error) return displayCurrencyPerSat

  const dCConverter = DisplayCurrencyConverter(displayCurrencyPerSat)

  const ledger = LedgerService()
  const activityChecker = ActivityChecker({
    getVolumeFn: ledger.allTxBaseVolumeSince,
    dCConverter,
    monthlyVolumeThreshold: USER_ACTIVENESS_MONTHLY_VOLUME_THRESHOLD,
  })
  for await (const account of unlockedAccounts) {
    // FIXME: this is a very slow query (not critical as only run daily on cron currently).
    // a mongodb query would be able to get the wallet in aggregate directly
    // from medici_transactions instead

    const wallets = await WalletsRepository().listByAccountId(account.id)
    if (wallets instanceof Error) return wallets

    const isActive = await activityChecker.aboveThreshold(wallets)
    if (isActive instanceof Error) continue
    if (isActive) {
      yield account
    }
  }
}
