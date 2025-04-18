import { CouldNotFindTransactionsForAccountError } from "@domain/errors"
import { GT } from "@graphql/index"
import { mapError } from "@graphql/error-map"
import {
  connectionArgs,
  connectionFromArray,
  checkedConnectionArgs,
} from "@graphql/connections"

import { WalletsRepository } from "@services/mongoose"

import { Accounts, Wallets } from "@app"
import getUuidByString from "uuid-by-string"

import IAccount from "../abstract/account"
import Wallet from "../abstract/wallet"

import WalletId from "../scalar/wallet-id"

import { TransactionConnection } from "./transaction"

const BusinessAccount = GT.Object({
  name: "BusinessAccount",
  interfaces: () => [IAccount],
  isTypeOf: () => false,
  fields: () => ({
    id: {
      type: GT.NonNullID,
      resolve: (source) => getUuidByString(source.id),
    },

    wallets: {
      type: GT.NonNullList(Wallet),
      resolve: async (source: Account) => {
        return Wallets.listWalletsByAccountId(source.id)
      },
    },

    defaultWalletId: {
      type: GT.NonNull(WalletId),
      resolve: (source, args, { domainAccount }: { domainAccount: Account }) =>
        domainAccount.defaultWalletId,
    },

    csvTransactions: {
      description:
        "return CSV stream, base64 encoded, of the list of transactions in the wallet",
      type: GT.NonNull(GT.String),
      args: {
        walletIds: {
          type: GT.NonNullList(WalletId),
        },
      },
      resolve: async (source) => {
        return Accounts.getCSVForAccount(source.id)
      },
    },
    transactions: {
      description:
        "A list of all transactions associated with walletIds optionally passed.",
      type: TransactionConnection,
      args: {
        ...connectionArgs,
        walletIds: {
          type: GT.List(WalletId),
        },
      },
      resolve: async (source, args) => {
        const paginationArgs = checkedConnectionArgs(args)
        if (paginationArgs instanceof Error) {
          throw paginationArgs
        }

        let { walletIds } = args
        if (walletIds instanceof Error) {
          return { errors: [{ message: walletIds.message }] }
        }

        if (walletIds === undefined) {
          const wallets = await WalletsRepository().listByAccountId(source.id)
          if (wallets instanceof Error) {
            return { errors: [{ message: walletIds.message }] }
          }
          walletIds = wallets.map((wallet) => wallet.id)
        }

        const { result: transactions, error } =
          await Accounts.getTransactionsForAccountByWalletIds({
            account: source,
            walletIds,
            paginationArgs,
          })
        if (error instanceof Error) {
          throw mapError(error)
        }
        if (transactions === null) {
          const nullError = new CouldNotFindTransactionsForAccountError()
          throw mapError(nullError)
        }

        return connectionFromArray<WalletTransaction>(transactions, args)
      },
    },
  }),
})

export default BusinessAccount
