import { OathkeeperUnauthorizedServiceError } from "@domain/oathkeeper/errors"
import { sendOathkeeperRequest } from "@services/oathkeeper"
import * as jwt from "jsonwebtoken"

import { BTC_NETWORK } from "@config"

import { createToken } from "@services/legacy-jwt"

import { AccountsRepository } from "@services/mongoose"

import { IdentityRepository } from "@services/kratos"

import USER_LOGIN from "../../../e2e/servers/graphql-main-server/mutations/user-login.gql"

import {
  createApolloClient,
  defaultTestClientConfig,
  getPhoneAndCodeFromRef,
  killServer,
  PID,
  startServer,
} from "test/helpers"
let serverPid: PID

beforeAll(async () => {
  serverPid = await startServer("start-main-ci")
})

afterAll(async () => {
  await killServer(serverPid)
})

// TODO: if "D" failed silently.
// should have a fail safe error fallback when therer is mismatch
// between account/user on mongoose and kratos
const userRef = "L"

describe("Oathkeeper", () => {
  it("return anon if no bearer assets", async () => {
    const res = await sendOathkeeperRequest(undefined)
    if (res instanceof Error) throw res

    const decoded = jwt.decode(res, { complete: true })
    expect(decoded?.payload?.sub).toBe("anon")
  })

  it("error if an invalid token is provided", async () => {
    const res = await sendOathkeeperRequest("invalid.token" as SessionToken)
    expect(res).toBeInstanceOf(OathkeeperUnauthorizedServiceError)
  })

  it("return UserId when kratos session token is provided", async () => {
    const { phone, code } = getPhoneAndCodeFromRef(userRef)

    const { apolloClient, disposeClient } = createApolloClient(defaultTestClientConfig())

    const input = { phone, code }

    const result = await apolloClient.mutate({
      mutation: USER_LOGIN,
      variables: { input },
    })
    disposeClient()

    const token = result.data.userLogin.authToken

    const res = await sendOathkeeperRequest(token)
    if (res instanceof Error) throw res

    const decodedNew = jwt.decode(res, { complete: true })
    const uidFromJwt = decodedNew?.payload?.sub

    expect(uidFromJwt).toHaveLength(36) // uuid-v4 token (kratosUserId)
  })

  it("return UserId when legacy JWT is provided", async () => {
    const { phone } = getPhoneAndCodeFromRef(userRef)

    const user = await IdentityRepository().slowFindByPhone(phone)
    if (user instanceof Error) throw user

    const account = await AccountsRepository().findByUserId(user.id)
    if (account instanceof Error) throw account

    const jwtToken = createToken({
      uid: account.id,
      network: BTC_NETWORK,
    })

    const res = await sendOathkeeperRequest(jwtToken)
    if (res instanceof Error) throw res

    const decodedNew = jwt.decode(res, { complete: true })
    const uidFromJwt = decodedNew?.payload?.sub

    expect(uidFromJwt).toHaveLength(36) // uuid-v4 token (kratosUserId)
  })
})
