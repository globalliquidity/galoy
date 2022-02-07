import mongoose from "mongoose"

import { Transaction } from "@services/ledger/schema"

import { lazyLoadLedgerAdmin } from "@services/ledger"

import { WalletsRepository } from "@services/mongoose"

import { WalletCurrency } from "@domain/wallets"

import { ConfigError } from "@config"

import { fromObjectId } from "@services/mongoose/utils"

import { baseLogger } from "../logger"

import { User, WalletInvoice } from "../mongoose/schema"

export const ledgerAdmin = lazyLoadLedgerAdmin({
  bankOwnerWalletResolver: async () => {
    const { defaultWalletId } = await User.findOne(
      { role: "bankowner" },
      { defaultWalletId: 1 },
    )
    return defaultWalletId
  },
  dealerBtcWalletResolver: async () => {
    const user: UserRecord = await User.findOne({ role: "dealer" }, { id: 1 })
    // FIXME remove the use of UserRecord when role if part of the AccountRepository
    const accountId = fromObjectId<AccountId>(user._id)
    const wallets = await WalletsRepository().listByAccountId(accountId)
    if (wallets instanceof Error) {
      baseLogger.error({ err: wallets }, "Error while listing wallets for dealer")
      throw new ConfigError("Couldn't load dealer wallets")
    }
    const wallet = wallets.find((wallet) => wallet.currency === WalletCurrency.Btc)
    if (wallet === undefined) throw new ConfigError("missing dealer btc wallet")
    return wallet.id
  },
  dealerUsdWalletResolver: async () => {
    const user: UserRecord = await User.findOne({ role: "dealer" }, { id: 1 })
    // FIXME remove the use of UserRecord when role if part of the AccountRepository
    const accountId = fromObjectId<AccountId>(user._id)
    const wallets = await WalletsRepository().listByAccountId(accountId)
    if (wallets instanceof Error) {
      baseLogger.error({ err: wallets }, "Error while listing wallets for dealer")
      throw new ConfigError("Couldn't load dealer wallets")
    }
    const wallet = wallets.find((wallet) => wallet.currency === WalletCurrency.Usd)
    if (wallet === undefined) throw new ConfigError("missing dealer usd wallet")
    return wallet.id
  },
  funderWalletResolver: async () => {
    const { defaultWalletId } = await User.findOne(
      { role: "funder" },
      { defaultWalletId: 1 },
    )
    return defaultWalletId
  },
})

// TODO add an event listenever if we got disconnecter from MongoDb
// after a first successful connection

const user = process.env.MONGODB_USER ?? "testGaloy"
const password = process.env.MONGODB_PASSWORD
const address = process.env.MONGODB_ADDRESS ?? "mongodb"
const db = process.env.MONGODB_DATABASE ?? "galoy"

const path = `mongodb://${user}:${password}@${address}/${db}`

export const setupMongoConnection = async (syncIndexes = false) => {
  try {
    await mongoose.connect(path, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      useCreateIndex: true,
      useFindAndModify: false,
    })
  } catch (err) {
    baseLogger.fatal({ err, user, address, db }, `error connecting to mongodb`)
    throw err
  }

  try {
    mongoose.set("runValidators", true)
    if (syncIndexes) {
      await User.syncIndexes()
      await Transaction.syncIndexes()
      await WalletInvoice.syncIndexes()
    }
  } catch (err) {
    baseLogger.fatal({ err, user, address, db }, `error setting the indexes`)
    throw err
  }

  return mongoose
}
export const setupMongoConnectionSecondary = async () => {
  try {
    await mongoose.connect(path, {
      replset: { readPreference: "secondary" },
    })
    mongoose.set("runValidators", true)
  } catch (err) {
    baseLogger.fatal({ err, user, address, db }, `error connecting to secondary mongodb`)
    throw err
  }

  return mongoose
}
