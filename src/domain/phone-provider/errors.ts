import { DomainError, ErrorLevel } from "@domain/shared"

export class PhoneProviderServiceError extends DomainError {}

export class ExpiredOrNonExistentPhoneNumberError extends PhoneProviderServiceError {}
export class InvalidPhoneNumberPhoneProviderError extends PhoneProviderServiceError {}
export class RestrictedRegionPhoneProviderError extends PhoneProviderServiceError {}
export class UnsubscribedRecipientPhoneProviderError extends PhoneProviderServiceError {}

export class PhoneCodeInvalidError extends PhoneProviderServiceError {}

export class PhoneProviderConnectionError extends PhoneProviderServiceError {
  level = ErrorLevel.Warn
}
export class UnknownPhoneProviderServiceError extends PhoneProviderServiceError {
  level = ErrorLevel.Critical
}
