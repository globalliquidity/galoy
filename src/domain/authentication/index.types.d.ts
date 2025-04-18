type SessionId = string & { readonly brand: unique symbol }

type AuthenticationError = import("./errors").AuthenticationError

type IdentityPassword = string & { readonly brand: unique symbol }

type UserId = string & { readonly brand: unique symbol }
type SessionToken = string & { readonly brand: unique symbol }

type IdentityPhone = {
  id: UserId
  phone: PhoneNumber
  createdAt: Date
}

type Session = {
  identity: IdentityPhone // | IdentityEmail // TODO
  id: SessionId
}

type WithSessionResponse = {
  sessionToken: SessionToken
  kratosUserId: UserId
}

type LoginWithPhoneNoPasswordSchemaResponse = WithSessionResponse
type CreateKratosUserForPhoneNoPasswordSchemaResponse = WithSessionResponse

interface IAuthWithPhonePasswordlessService {
  login(
    phone: PhoneNumber,
  ): Promise<LoginWithPhoneNoPasswordSchemaResponse | AuthenticationError>
  createIdentityWithSession(
    phone: PhoneNumber,
  ): Promise<CreateKratosUserForPhoneNoPasswordSchemaResponse | AuthenticationError>
  createIdentityNoSession(phone: PhoneNumber): Promise<UserId | AuthenticationError>
  upgradeToPhoneWithPasswordSchema(input: {
    kratosUserId: UserId
    password: IdentityPassword
  }): Promise<IdentityPhone | AuthenticationError> // TODO: should be IdentityPhoneWithPassword
}

interface IIdentityRepository {
  getIdentity(id: UserId): Promise<IdentityPhone | KratosError>
  listIdentities(): Promise<IdentityPhone[] | KratosError>
  slowFindByPhone(phone: PhoneNumber): Promise<IdentityPhone | KratosError>
}
