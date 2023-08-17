/** Server-side utilities.  Using any of these in the front end will lead to darkness and despair. */
import { validate as isUuid } from "uuid"
import * as jwt from "jsonwebtoken"
import * as dotenv from "dotenv"
import * as picomatch from "picomatch"
import type {
  NewUser,
  Success,
  Error,
  Topic,
  UpdateUser,
  UserId,
  AdminSafeUser,
  Comment,
  DeletedComment,
  Discussion,
  PublicSafeUser,
  User,
  TokenClaim,
  Email,
  ValidationResult,
} from "./simple-comment-types"
import { uuidv4 } from "./crypt"
import urlNormalizer from "normalize-url"
import {
  joinValidations,
  validateDisplayName,
  validateEmail,
  validateUserId,
} from "./shared-utilities"

dotenv.config()

export const REALM = "Access to restricted resources"
const AUTHORIZATION_HEADER = "Authorization"
const BEARER_SCHEME = "Bearer"
const BASIC_SCHEME = "Basic"

const isDefined = <T>(x: T | undefined | null): x is T =>
  x !== undefined && x !== null

/** Creates an id specifically for a guest */
export const createGuestId = () => uuidv4()

/**
 * Returns true if userId is a guest id
 */
export const isGuestId = (userId: UserId) => isUuid(userId)

/**
 * These are user properties that are unsafe to return to admins
 */
export const adminUnsafeUserProperties: (keyof User)[] = ["hash", "_id"]

/**
 * These are user properties that are unsafe to return to ordinary users and the public
 */
export const publicUnsafeUserProperties: (keyof User)[] = [
  ...adminUnsafeUserProperties,
  "email",
  "isVerified",
]

/**
 * These are user properties that only admins can modify on users
 */
export const adminOnlyModifiableUserProperties: (keyof User)[] = [
  "isVerified",
  "isAdmin",
]

/**
 * Return a user object that is clean and secure
 */
export const toSafeUser = (
  user: User,
  isAdmin: boolean = false
): PublicSafeUser | AdminSafeUser =>
  isAdmin ? toAdminSafeUser(user) : toPublicSafeUser(user)
export const toPublicSafeUser = (user: User) =>
  user ? narrowType<PublicSafeUser>(user, ["id", "name", "isAdmin"]) : user
export const toAdminSafeUser = (user: User) =>
  user
    ? narrowType<AdminSafeUser>(user, [
        "id",
        "name",
        "email",
        "isAdmin",
        "isVerified",
      ])
    : user

export const isEmail = (x: string | Email): x is Email =>
  /\S+@\S+\.\S+/.test(x.trim())

export const isComment = (target: Comment | Discussion): target is Comment =>
  isDefined(target) && "parentId" in target

export const isDeleted = (target: Comment | Discussion) =>
  isDefined(target) && "dateDeleted" in target

export const isDeletedComment = (
  target: Comment | Discussion
): target is DeletedComment => isComment(target) && isDeleted(target)

export const isAdminSafeUser = (user: Partial<User>): user is AdminSafeUser =>
  (Object.keys(user) as (keyof User)[]).every(
    key => !adminOnlyModifiableUserProperties.includes(key)
  )
export const isPublicSafeUser = (user: Partial<User>): user is PublicSafeUser =>
  (Object.keys(user) as (keyof User)[]).every(
    key => !publicUnsafeUserProperties.includes(key)
  )

const hasHeader = (headers: { [header: string]: string }, header: string) =>
  Object.keys(headers).some(
    h => h.toLowerCase() === header.toLowerCase() && headers[h] !== undefined
  )

const getHeader = (headers: { [header: string]: string }, header: string) =>
  Object.keys(headers).find(h => h.toLowerCase() === header.toLowerCase())

export const getHeaderValue = (
  headers: { [header: string]: string },
  header: string
) => headers[getHeader(headers, header)]

export const addHeaders = (
  res: {
    statusCode: number
    body?: unknown
    headers?: Record<string, string>
  },
  headers
) => {
  const resHeaders = res?.headers ?? {}

  if (res?.body) {
    const isJSON = typeof res.body === "object"
    const contentType = isJSON ? "application/json" : "text/plain"
    const body = isJSON ? JSON.stringify(res.body) : res.body

    return {
      ...res,
      body,
      headers: { ...resHeaders, ...headers, "Content-Type": contentType },
    }
  } else
    return {
      ...res,
      headers: { ...resHeaders, ...headers },
    }
}

const getOrigin = (headers: { [header: string]: string }) =>
  getHeaderValue(headers, "origin")

export const getAllowedOrigins = () => process.env.ALLOW_ORIGIN.split(",")

/** Normalize a url for allowedReferer test
 * - strips hash and query parameters
 * - strips protocol (https)
 * - removes directory index (/index.[a-z]+$/)
 */
export const normalizeUrl = (url: string) =>
  urlNormalizer(url, {
    stripHash: true,
    stripProtocol: true,
    removeQueryParameters: true,
    removeDirectoryIndex: true,
  })

/**
 * Return true if `url` matches any of the patterns in `allowedPatterns`
 * Strips any trailing '/' from the referring url
 *
 * Matches using the picomatch library
 * @see https://github.com/micromatch/picomatch#ismatch
 *
 * @param {string} url
 * @param {string[]} allowedPatterns
 * @returns {boolean}
 */
export const isAllowedReferer = (
  url: string,
  allowedPatterns: string[] = getAllowedOrigins()
) => picomatch.isMatch(normalizeUrl(url), allowedPatterns)

/** Returns the proper headers for Access-Control-Allow-Origin
 * as set in .env and as determined by the Request Origin header
 *
 * If allowed origin is '*" will return that header
 *
 * If allowed origin list matches origin, will return that header + vary:origin
 *
 * If no match will return {}
 *
 * @param headers
 * @param allowedOrigins
 * @returns
 */
export const getAllowOriginHeaders = (
  headers: { [header: string]: string },
  allowedOrigins: string[] = []
):
  | Record<string, never>
  | { "Access-Control-Allow-Origin": string; Vary?: "Origin" } =>
  // This function needs to return two headers if there
  // is an exact match and *no* headers if there is not!
  allowedOrigins.includes("*")
    ? { "Access-Control-Allow-Origin": "*" }
    : allowedOrigins.includes(getOrigin(headers))
    ? { "Access-Control-Allow-Origin": getOrigin(headers), Vary: "Origin" }
    : {}

const parseAuthHeaderValue = (
  authHeaderValue: string,
  spaceIndex?: number
): { scheme: string; credentials: string } =>
  spaceIndex === undefined
    ? parseAuthHeaderValue(authHeaderValue, authHeaderValue.indexOf(" "))
    : {
        scheme: authHeaderValue.slice(0, spaceIndex),
        credentials: authHeaderValue.slice(spaceIndex + 1),
      }

/** nowPlusMinutes returns the numericDate `minutes` from now */
export const nowPlusMinutes = (minutes: number): number =>
  new Date(new Date().valueOf() + minutes * 60 * 1000).valueOf()

export const getAuthHeaderValue = (headers: {
  [header: string]: string
}): string | undefined => getHeaderValue(headers, AUTHORIZATION_HEADER)

export const getAuthCredentials = (authHeaderValue: string) =>
  parseAuthHeaderValue(authHeaderValue).credentials

export const hasBasicScheme = (
  headers: { [header: string]: string },
  parse?: { scheme: string; credentials: string }
) =>
  parse === undefined
    ? hasHeader(headers, AUTHORIZATION_HEADER)
      ? hasBasicScheme(
          headers,
          parseAuthHeaderValue(getHeaderValue(headers, AUTHORIZATION_HEADER))
        )
      : false
    : parse.scheme.toLowerCase() === BASIC_SCHEME.toLowerCase()

/** Checks the Cookie header for "simple_comment_token" and returns true if found, false otherwise */
export const hasTokenCookie = (headers: { [header: string]: string }) =>
  hasHeader(headers, "Cookie") &&
  getHeaderValue(headers, "Cookie").indexOf("simple_comment_token=") >= 0

// https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cookie "Pairs in the list are separated by a semicolon and a space ('; ')"
export const getCookieToken = (
  headers: { [header: string]: string },
  cookieHeader?: string
) =>
  cookieHeader
    ? cookieHeader
        .split("; ")
        .reduce(
          (auth, pair) =>
            auth
              ? auth
              : pair.startsWith("simple_comment_token")
              ? pair.split("=")[1]
              : auth,
          null
        )
    : getCookieToken(headers, getHeaderValue(headers, "Cookie"))

/** Checks the Authorization header for "Bearer" + token and returns true if found, false otherwise */
export const hasBearerScheme = (
  headers: { [header: string]: string },
  parse?: { scheme: string; credentials: string }
) =>
  parse === undefined
    ? hasHeader(headers, AUTHORIZATION_HEADER)
      ? hasBearerScheme(
          headers,
          parseAuthHeaderValue(getHeaderValue(headers, AUTHORIZATION_HEADER))
        )
      : false
    : parse.scheme.toLowerCase() === BEARER_SCHEME.toLowerCase()

/** decodeAuthHeader expects a string of the form `Basic someBase64String==` and returns its plaintext decode */
const decodeAuthHeader = authHeaderValue =>
  Buffer.from(authHeaderValue.slice(6), "base64").toString()

/** parseAuthHeader expects a string of the form `user:password` and returns an object of the form {user, password} Will fail if the : character is in the user name */
const parseAuthHeader = (
  plainText: string,
  colonIndex?: number
): { user: string; password: string } =>
  colonIndex === undefined
    ? parseAuthHeader(plainText, plainText.indexOf(":"))
    : {
        user: plainText.slice(0, colonIndex),
        password: plainText.slice(colonIndex + 1),
      }

export const getUserIdPassword = eventHeaders =>
  [getAuthHeaderValue, decodeAuthHeader, parseAuthHeader].reduce(
    (acc, func) => func(acc),
    eventHeaders
  )

export const getTokenClaim = (headers: {
  [key: string]: string
}): TokenClaim | null => {
  const isBearer = hasBearerScheme(headers)
  const hasCookie = hasTokenCookie(headers)

  if (!isBearer && !hasCookie) return null

  const token = hasCookie
    ? getCookieToken(headers)
    : getAuthCredentials(getAuthHeaderValue(headers))

  const claim: TokenClaim = jwt.verify(token, process.env.JWT_SECRET) as {
    user: UserId
    exp: number
  }

  // claim.exp comes in seconds, Date().valueOf() comes in milliseconds
  // so multiply claim.exp by 1000
  const isExpired = claim.exp * 1000 <= new Date().valueOf()

  if (isExpired)
    throw new jwt.TokenExpiredError("jwt_expired", new Date(claim.exp * 1000))
  else return claim
}

export const getUserId = (headers: {
  [key: string]: string
}): UserId | null => {
  try {
    const claim = getTokenClaim(headers)
    if (claim) return claim.user
    else return null
  } catch (error) {
    console.error(error)
    return null
  }
}

/**
 * return the path directory after endpoint or null if none
 * /dir1/endpoint/somestring/anotherstring returns somestring
 * /dir1/endpoint/somestring returns somestring
 * /dir1/endpoint returns null
 * /dir1/somestring/anotherstring returns null
 **/
export const getTargetId = (
  path: string,
  endpoint: string,
  dirs?: string[]
): string | null => {
  if (dirs === undefined) return getTargetId(path, endpoint, path.split("/"))

  if (dirs.length <= 1) return null // this means dirs[0] is endpoint or endpoint does not exist

  if (dirs[0] === endpoint) return dirs[1]

  return getTargetId(path, endpoint, dirs.splice(1))
}

type GenericObj = { [key: string]: string | number | boolean | Date }

const decode = (x: string | undefined) =>
  x === undefined ? "" : decodeURIComponent(x)

export const parseQuery = (body: string): GenericObj =>
  body === ""
    ? {}
    : body
        .split("&")
        .map(i => i.split("=") as [string, string])
        .map(([key, value]: [string, string]) => [decode(key), decode(value)])
        .reduce((obj, [key, value]) => ({ ...obj, [key]: value }), {})

/** Remove keys from "obj"  that are not explicitly set in the keys parameter as a way to sanitize user input */
const narrowType = <T>(obj: GenericObj | User, keys: (keyof T)[]) =>
  Object.entries(obj).reduce(
    (narrowType, [key, value]) =>
      keys.includes(key as keyof T)
        ? { ...narrowType, [key]: value }
        : narrowType,
    {}
  ) as T

const newUserKeys: (keyof NewUser)[] = [
  "id",
  "isAdmin",
  "email",
  "isVerified",
  "name",
  "password",
]
export const getNewUserInfo = (body: string): NewUser => {
  const newUser = narrowType<NewUser>(parseQuery(body), newUserKeys)
  return newUser
}
const updatedUserKeys: (keyof UpdateUser)[] = [
  "isAdmin",
  "email",
  "isVerified",
  "name",
]

export const toUpdatedUser = (obj: GenericObj) =>
  narrowType<UpdateUser>(obj, updatedUserKeys) as UpdateUser

export const getUpdatedUserInfo = (body: string): UpdateUser =>
  toUpdatedUser(parseQuery(body))

export const getNewTopicInfo = (body: string): Topic =>
  toTopic(parseQuery(body))

export const toTopic = (obj: GenericObj) =>
  narrowType<Topic>(obj, ["id", "title", "isLocked"]) as Topic

export const getUpdateTopicInfo = (body: string): Topic =>
  narrowType<Topic>(parseQuery(body), ["title", "isLocked"]) as Topic

export const isError = (res: Success | Error): res is Error =>
  res.statusCode >= 400

export const isDiscussion = (c: Comment | Discussion): c is Discussion =>
  (c as Comment).parentId === undefined

export class HeaderList {
  private _headers: { [header: string]: string }
  constructor(headers?: { [header: string]: string }) {
    this._headers = headers
  }
  add = (header, value) => {
    this._headers = { ...this._headers, ...{ [header]: value } }
  }
  get headers() {
    return this._headers
  }
}

// Have a very loose password policy and encourage password complexity on the frontend.
// Checking here only for length and common passwords
export const validatePassword = (password?: string): ValidationResult => {
  if (!password) return { isValid: false, reason: "Password is missing." }
  if (password !== password.trim())
    return {
      isValid: false,
      reason: "Passwords cannot contain leading or trailing spaces",
    }
  if (commonPasswords.includes(password))
    return { isValid: false, reason: `${password} is too easily guessed` }
  if (password.length < 7)
    return {
      isValid: false,
      reason: "Passwords must be longer than 6 characters",
    }
  //  bcrypt will only check the first 72 characters
  //  therefore we truncate using sha-512
  return { isValid: true }
}

export const validateGuestUser = (
  guest: { id: UserId; name: string; email: string },
  authId?: UserId,
  isAdmin = false
): ValidationResult => {
  if (!authId) return { isValid: false, reason: "Authorization ID is missing" }
  const authCheck: ValidationResult =
    isAdmin || guest.id === authId
      ? { isValid: true }
      : {
          isValid: false,
          reason: `Guest id '${guest.id}' does not match authorization id '${authId}'.`,
        }
  const idCheck = validateUserId(guest.id)
  const guestIdCheck: ValidationResult = isGuestId(guest.id)
    ? { isValid: true }
    : {
        isValid: false,
        reason: `Guest user id '${guest.id}' must be in guest id format.`,
      }
  const emailCheck = validateEmail(guest.email)
  const nameCheck = validateDisplayName(guest.name)
  const result = joinValidations([
    authCheck,
    idCheck,
    guestIdCheck,
    emailCheck,
    nameCheck,
  ])
  return result
}

export const validateUser = (
  user: User & { password?: string }
): ValidationResult => {
  // Note: If validation criteria changes, it is possible that current
  // users who do not match the new criteria would be stuck unable
  // to update their user information
  const idCheck = validateUserId(user.id)
  const notGuestIdCheck: ValidationResult = isGuestId(user.id)
    ? { isValid: false, reason: `User id '${user.id}' must not be a guest id.` }
    : { isValid: true }
  const emailCheck = validateEmail(user.email)
  const nameCheck = validateDisplayName(user.name)
  const passwordCheck: ValidationResult = user.hash
    ? { isValid: true }
    : validatePassword(user.password)

  return joinValidations([
    idCheck,
    notGuestIdCheck,
    emailCheck,
    nameCheck,
    passwordCheck,
  ])
}

const commonPasswords = [
  "000000",
  "00000000",
  "101010",
  "10203",
  "102030",
  "1111",
  "111111",
  "1111111",
  "11111111",
  "1111111111",
  "112233",
  "11223344",
  "121212",
  "123",
  "123123",
  "123123123",
  "123321",
  "1234",
  "12341234",
  "12345",
  "123456",
  "123456",
  "1234567",
  "12345678",
  "123456789",
  "123456789",
  "1234567890",
  "12345678910",
  "123456789a",
  "123456a",
  "123456b",
  "12345a",
  "1234qwer",
  "123654",
  "123abc",
  "123qwe",
  "131313",
  "142536",
  "147258",
  "147258369",
  "159357",
  "159753",
  "1q2w3e",
  "1q2w3e4r",
  "1q2w3e4r5t",
  "1qaz2wsx",
  "20100728",
  "222222",
  "25251325",
  "333333",
  "456789",
  "5201314",
  "555555",
  "654321",
  "6655321",
  "666666",
  "686584",
  "777777",
  "7777777",
  "789456",
  "789456123",
  "888888",
  "88888888",
  "987654",
  "987654321",
  "987654321",
  "999999",
  "Bangbang123",
  "Million2",
  "Sample123",
  "a12345",
  "a123456",
  "a123456789",
  "a801016",
  "aaaaaa",
  "aaron431",
  "abc123",
  "abcd1234",
  "alexander",
  "amanda",
  "andrea",
  "andrew",
  "angel1",
  "anhyeuem",
  "anthony",
  "asd123",
  "asdasd",
  "asdf1234",
  "asdfgh",
  "asdfghjkl",
  "ashley",
  "azerty",
  "b123456",
  "babygirl1",
  "bailey",
  "baseball",
  "basketball",
  "batman",
  "blink182",
  "buster",
  "butterfly",
  "charlie",
  "chatbooks",
  "cheese",
  "chocolate",
  "computer",
  "cookie",
  "daniel",
  "default",
  "dragon",
  "evite",
  "family",
  "flower",
  "football",
  "football1",
  "fuckyou",
  "fuckyou1",
  "gabriel",
  "ginger",
  "hannah",
  "hello",
  "hello123",
  "hunter",
  "iloveu",
  "iloveyou",
  "iloveyou1",
  "jacket025",
  "jakcgt333",
  "jennifer",
  "jessica",
  "jesus1",
  "jobandtalent",
  "jordan",
  "jordan23",
  "joshua",
  "justin",
  "killer",
  "letmein",
  "lol123",
  "love",
  "love123",
  "lovely",
  "loveme",
  "madison",
  "maggie",
  "master",
  "matthew",
  "michael",
  "michael1",
  "michelle",
  "monkey",
  "myspace1",
  "naruto",
  "nicole",
  "ohmnamah23",
  "omgpop",
  "party",
  "password",
  "password1",
  "password123",
  "peanut",
  "pepper",
  "picture1",
  "pokemon",
  "princess",
  "princess1",
  "purple",
  "q1w2e3r4",
  "qazwsx",
  "qqww1122",
  "qwe123",
  "qwer1234",
  "qwer123456",
  "qwerty",
  "qwerty1",
  "qwertyuiop",
  "robert",
  "samantha",
  "samsung",
  "senha",
  "shadow",
  "soccer",
  "starwars",
  "summer",
  "sunshine",
  "superman",
  "taylor",
  "tigger",
  "trustno1",
  "unknown",
  "welcome",
  "whatever",
  "x4ivygA51F",
  "yugioh",
  "zing",
  "zxcvbnm",
]