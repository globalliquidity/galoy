import { LightningBtcWallet } from "./LightningBtcWallet"
import { LightningUsdWallet } from "./LightningUsdWallet"
import { User } from "./mongodb"

export const WalletFactory = ({uid, logger, currency = "BTC"}: {uid: string, currency: string, logger: any}) => {
// TODO: remove default BTC once old tokens had been "expired"
  if (currency === "USD") {
    return new LightningUsdWallet({uid, logger})
  } else {
    return new LightningBtcWallet({uid, logger})
  }
}

export const getFunderWallet = async ({ logger }) => {
  const funder = await User.findOne({ role: "funder" })
  return new LightningBtcWallet({ uid: funder._id, logger })
}