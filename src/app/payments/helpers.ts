import { btcFromUsdMidPriceFn, usdFromBtcMidPriceFn } from "@app/shared"
import {
  getAccountLimits,
  getPubkeysToSkipProbe,
  MIN_SATS_FOR_PRICE_RATIO_PRECISION,
  ONE_DAY,
} from "@config"
import { AccountLimitsChecker } from "@domain/accounts"
import { AlreadyPaidError } from "@domain/errors"
import {
  InvalidZeroAmountPriceRatioInputError,
  LightningPaymentFlowBuilder,
  PriceRatio,
  ZeroAmountForUsdRecipientError,
} from "@domain/payments"
import { WalletCurrency } from "@domain/shared"
import { LedgerService } from "@services/ledger"
import { LndService } from "@services/lnd"
import {
  AccountsRepository,
  WalletInvoicesRepository,
  WalletsRepository,
} from "@services/mongoose"
import { wrapAsyncToRunInSpan } from "@services/tracing"
import { timestampDaysAgo } from "@utils"

const ledger = LedgerService()

export const constructPaymentFlowBuilder = async <
  S extends WalletCurrency,
  R extends WalletCurrency,
>({
  senderWallet,
  invoice,
  uncheckedAmount,
  hedgeBuyUsd,
  hedgeSellUsd,
}: {
  senderWallet: WalletDescriptor<S>
  invoice: LnInvoice
  uncheckedAmount?: number
  hedgeBuyUsd: ConversionFns
  hedgeSellUsd: ConversionFns
}): Promise<LPFBWithConversion<S, R> | ApplicationError> => {
  const lndService = LndService()
  if (lndService instanceof Error) return lndService
  const paymentBuilder = LightningPaymentFlowBuilder({
    localNodeIds: lndService.listAllPubkeys(),
    flaggedPubkeys: getPubkeysToSkipProbe(),
  })
  const builderWithInvoice = uncheckedAmount
    ? (paymentBuilder.withNoAmountInvoice({
        invoice,
        uncheckedAmount,
      }) as LPFBWithInvoice<S>)
    : (paymentBuilder.withInvoice(invoice) as LPFBWithInvoice<S>)

  const builderWithSenderWallet = builderWithInvoice.withSenderWallet(senderWallet)

  let builderAfterRecipientStep: LPFBWithRecipientWallet<S, R> | LPFBWithError
  if (builderWithSenderWallet.isIntraLedger()) {
    const recipientDetails = await recipientDetailsFromInvoice<R>(invoice)
    if (recipientDetails instanceof Error) return recipientDetails
    builderAfterRecipientStep =
      builderWithSenderWallet.withRecipientWallet<R>(recipientDetails)
  } else {
    builderAfterRecipientStep = builderWithSenderWallet.withoutRecipientWallet()
  }

  const builderWithConversion = await builderAfterRecipientStep.withConversion({
    mid: { usdFromBtc: usdFromBtcMidPriceFn, btcFromUsd: btcFromUsdMidPriceFn },
    hedgeBuyUsd,
    hedgeSellUsd,
  })

  const check = await builderWithConversion.usdPaymentAmount()
  if (
    check instanceof InvalidZeroAmountPriceRatioInputError &&
    builderWithSenderWallet.isIntraLedger() === true
  ) {
    return new ZeroAmountForUsdRecipientError()
  }

  return builderWithConversion
}

const recipientDetailsFromInvoice = async <R extends WalletCurrency>(
  invoice: LnInvoice,
): Promise<
  | {
      id: WalletId
      currency: R
      accountId: AccountId
      pubkey: Pubkey
      usdPaymentAmount: UsdPaymentAmount | undefined
      username: Username
      userId: UserId
    }
  | ApplicationError
> => {
  const invoicesRepo = WalletInvoicesRepository()
  const walletInvoice = await invoicesRepo.findByPaymentHash(invoice.paymentHash)
  if (walletInvoice instanceof Error) return walletInvoice

  if (walletInvoice.paid) return new AlreadyPaidError(walletInvoice.paymentHash)

  const {
    recipientWalletDescriptor: {
      id: recipientWalletId,
      currency: recipientsWalletCurrency,
    },
    pubkey: recipientPubkey,
    usdAmount: usdPaymentAmount,
  } = walletInvoice

  const recipientWallet = await WalletsRepository().findById(recipientWalletId)
  if (recipientWallet instanceof Error) return recipientWallet
  const { accountId } = recipientWallet

  const recipientAccount = await AccountsRepository().findById(accountId)
  if (recipientAccount instanceof Error) return recipientAccount
  const { username: recipientUsername, kratosUserId: recipientUserId } = recipientAccount

  return {
    id: recipientWalletId,
    currency: recipientsWalletCurrency as R,
    accountId: recipientAccount.id,
    pubkey: recipientPubkey,
    usdPaymentAmount,
    username: recipientUsername,
    userId: recipientUserId,
  }
}

const checkLimitsBase = async ({
  accountId,
  volumeAmountSinceFn,
}: {
  accountId: AccountId
  volumeAmountSinceFn: GetVolumeAmountSinceFn
}) => {
  const timestamp1Day = timestampDaysAgo(ONE_DAY)
  if (timestamp1Day instanceof Error) return timestamp1Day

  const account = await AccountsRepository().findById(accountId)
  if (account instanceof Error) return account

  const wallets = await WalletsRepository().listByAccountId(accountId)
  if (wallets instanceof Error) return wallets

  const walletVolumesWithErrors = await Promise.all(
    wallets.map((wallet) =>
      volumeAmountSinceFn({
        walletDescriptor: wallet,
        timestamp: timestamp1Day,
      }),
    ),
  )
  const walletVolError = walletVolumesWithErrors.find((vol) => vol instanceof Error)
  if (walletVolError instanceof Error) return walletVolError

  // To satisfy type-checker
  const walletVolumes = walletVolumesWithErrors.filter(
    (vol): vol is TxBaseVolumeAmount<WalletCurrency> => true,
  )

  return {
    accountLimits: getAccountLimits({ level: account.level }),
    walletVolumes,
  }
}

export const newCheckIntraledgerLimits = async ({
  amount,
  accountId,
  priceRatio,
}: {
  amount: UsdPaymentAmount
  accountId: AccountId
  priceRatio: PriceRatio
}) => {
  const volumesAndLimits = await checkLimitsBase({
    accountId,
    volumeAmountSinceFn: ledger.intraledgerTxBaseVolumeAmountSince,
  })
  if (volumesAndLimits instanceof Error) return volumesAndLimits
  const { walletVolumes, accountLimits } = volumesAndLimits

  return AccountLimitsChecker({
    accountLimits,
    priceRatio,
  }).checkIntraledger({
    amount,
    walletVolumes,
  })
}

export const newCheckTradeIntraAccountLimits = async ({
  amount,
  accountId,
  priceRatio,
}: {
  amount: UsdPaymentAmount
  accountId: AccountId
  priceRatio: PriceRatio
}) => {
  const volumesAndLimits = await checkLimitsBase({
    accountId,
    volumeAmountSinceFn: ledger.tradeIntraAccountTxBaseVolumeAmountSince,
  })
  if (volumesAndLimits instanceof Error) return volumesAndLimits
  const { walletVolumes, accountLimits } = volumesAndLimits

  return AccountLimitsChecker({
    accountLimits,
    priceRatio,
  }).checkTradeIntraAccount({
    amount,
    walletVolumes,
  })
}

export const newCheckWithdrawalLimits = async ({
  amount,
  accountId,
  priceRatio,
}: {
  amount: UsdPaymentAmount
  accountId: AccountId
  priceRatio: PriceRatio
}) => {
  const volumesAndLimits = await checkLimitsBase({
    accountId,
    volumeAmountSinceFn: ledger.externalPaymentVolumeAmountSince,
  })
  if (volumesAndLimits instanceof Error) return volumesAndLimits
  const { walletVolumes, accountLimits } = volumesAndLimits

  return AccountLimitsChecker({
    accountLimits,
    priceRatio,
  }).checkWithdrawal({
    amount,
    walletVolumes,
  })
}

export const getPriceRatioForLimits = wrapAsyncToRunInSpan({
  namespace: "app.payments",
  fnName: "getPriceRatioForLimits",
  fn: async (paymentAmounts: PaymentAmountInAllCurrencies) => {
    const amount = MIN_SATS_FOR_PRICE_RATIO_PRECISION

    if (paymentAmounts.btc.amount < amount) {
      const btcPaymentAmountForRatio = {
        amount,
        currency: WalletCurrency.Btc,
      }
      const usdPaymentAmountForRatio = await usdFromBtcMidPriceFn(
        btcPaymentAmountForRatio,
      )
      if (usdPaymentAmountForRatio instanceof Error) return usdPaymentAmountForRatio

      return PriceRatio({
        usd: usdPaymentAmountForRatio,
        btc: btcPaymentAmountForRatio,
      })
    }

    return PriceRatio(paymentAmounts)
  },
})
