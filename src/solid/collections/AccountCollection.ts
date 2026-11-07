import type * as APITypes from "../../api/types.js";
import type {
  DataCreateAccount,
  WebPushSubscription,
} from "../../api/types.js";
import type { Client } from "../Client.js";
import { MFA, MFATicket } from "../classes/MFA.js";

/**
 * Age group, worked out by the server from the stated year and month of
 * birth. `adult_declared` is the user's own statement, never verified.
 */
export type AgeBand = APITypes.AgeBand;

/**
 * Whether content marked as mature may be opened, and if not, why
 */
export type MatureAccess = APITypes.MatureAccess;

/**
 * Age information, only ever returned to the account owner
 */
export type AccountAge = APITypes.AccountAgeInfo;

/**
 * Utility functions for working with accounts
 */
export class AccountCollection {
  readonly client: Client;

  /**
   * Create generic class collection
   * @param client Client
   */
  constructor(client: Client) {
    this.client = client;
  }

  /**
   * Fetch current account email
   * @returns Email
   */
  async fetchEmail(): Promise<string> {
    return (await this.client.api.get("/auth/account/")).email;
  }

  /**
   * Create a MFA helper
   */
  async mfa(): Promise<MFA> {
    return new MFA(this.client, await this.client.api.get("/auth/mfa/"));
  }

  /**
   * Fetch the age information of the current account
   * @returns Age information, or null from a server without age rules
   */
  async fetchAge(): Promise<AccountAge | null> {
    return (await this.client.api.get("/auth/account/")).age ?? null;
  }

  /**
   * State or correct the age of the current account
   *
   * Lowering is always allowed; raising only once and within the same age
   * group. A stated age is never treated as proof of age.
   * @param birthMonth Year and month of birth, `YYYY-MM`
   * @param currentPassword Required once an age is on record
   * @returns The new age
   */
  async changeAge(
    birthMonth: string,
    currentPassword?: string,
  ): Promise<AccountAge | null> {
    const account = await this.client.api.patch("/auth/account/age", {
      birth_month: birthMonth,
      ...(currentPassword ? { current_password: currentPassword } : {}),
    });
    return account.age ?? null;
  }

  /**
   * Create a new account
   * @param data Account details, with the year and month of birth (`YYYY-MM`)
   */
  create(data: DataCreateAccount & { birth_month: string }): Promise<void> {
    return this.client.api.post("/auth/account/create", data);
  }

  /**
   * Resend email verification
   * @param email Email
   * @param captcha Captcha if enabled
   */
  reverify(email: string, captcha?: string): Promise<void> {
    return this.client.api.post("/auth/account/reverify", { email, captcha });
  }

  /**
   * Send password reset email
   * @param email Email
   * @param captcha Captcha if enabled
   */
  resetPassword(email: string, captcha?: string): Promise<void> {
    return this.client.api.post("/auth/account/reset_password", {
      email,
      captcha,
    });
  }

  /**
   * Verify an account given the code
   * @param code Verification code
   */
  verify(code: string): Promise<unknown> {
    return this.client.api.post(`/auth/account/verify/${code}`);
  }

  /**
   * Confirm account deletion
   * @param token Deletion token
   */
  confirmDelete(token: string): Promise<void> {
    return this.client.api.put("/auth/account/delete", { token });
  }

  /**
   * Confirm password reset
   * @param token Token
   * @param newPassword New password
   * @param removeSessions Whether to remove existing sessions
   */
  confirmPasswordReset(
    token: string,
    newPassword: string,
    removeSessions: boolean,
  ): Promise<void> {
    return this.client.api.patch("/auth/account/reset_password", {
      token,
      password: newPassword,
      remove_sessions: removeSessions,
    });
  }

  /**
   * Change account password
   * @param newPassword New password
   * @param currentPassword Current password
   */
  changePassword(newPassword: string, currentPassword: string): Promise<void> {
    return this.client.api.patch("/auth/account/change/password", {
      password: newPassword,
      current_password: currentPassword,
    });
  }

  /**
   * Change account email
   * @param newEmail New email
   * @param currentPassword Current password
   * @param ticket MFA ticket, mandatory if account has MFA enabled
   */
  changeEmail(
    newEmail: string,
    currentPassword: string,
    ticket?: MFATicket,
  ): Promise<void> {
    ticket?._consume();
    return this.client.api.patch(
      "/auth/account/change/email",
      {
        email: newEmail,
        current_password: currentPassword,
      },
      ticket ? { headers: { "X-MFA-Ticket": ticket.token } } : undefined,
    );
  }

  /**
   * Fetch settings
   * @param keys Keys
   * @returns Settings
   */
  fetchSettings(keys: string[]): Promise<Record<string, [number, string]>> {
    return this.client.api.post("/sync/settings/fetch", { keys }) as Promise<
      Record<string, [number, string]>
    >;
  }

  /**
   * Set settings
   * @param settings Settings, each value a string (usually JSON)
   * @param timestamp Timestamp
   */
  setSettings(
    settings: Record<string, string>,
    timestamp = +new Date(),
  ): Promise<void> {
    return this.client.api.post("/sync/settings/set", settings, {
      query: { timestamp },
    });
  }

  /**
   * Create a new Web Push subscription
   * @param subscription Subscription
   */
  webPushSubscribe(subscription: WebPushSubscription): Promise<void> {
    return this.client.api.post("/push/subscribe", subscription);
  }

  /**
   * Remove existing Web Push subscription
   */
  webPushUnsubscribe(): Promise<void> {
    return this.client.api.post("/push/unsubscribe");
  }
}
