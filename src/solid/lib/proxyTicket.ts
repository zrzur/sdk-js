/** What `POST /auth/session/proxy_ticket` answers */
export type ProxyTicket = { ticket: string; expires_at: number };

/** Seconds before expiry that a new ticket is asked for */
const REFRESH_BEFORE = 5 * 60;
/** Seconds to wait after a failed request (older servers lack the route) */
const RETRY_AFTER = 5 * 60;

/**
 * Keeps a media proxy ticket for the session. Addresses are built while
 * rendering, so reading never waits: it gives what is there and asks for a
 * new ticket in the background when this one is about to end.
 */
export class ProxyTicketKeeper {
  #fetch: () => Promise<ProxyTicket>;
  #onTicket: () => void;
  #now: () => number;
  #ticket?: ProxyTicket;
  #pending = false;
  #retryAt = 0;

  /**
   * @param fetch Ask the server for a ticket
   * @param onTicket Called after every new ticket
   * @param now Current time in seconds
   */
  constructor(
    fetch: () => Promise<ProxyTicket>,
    onTicket: () => void = () => {},
    now: () => number = () => Date.now() / 1000,
  ) {
    this.#fetch = fetch;
    this.#onTicket = onTicket;
    this.#now = now;
  }

  /** The ticket to put in an address, if a valid one is held */
  current(): string | undefined {
    const now = this.#now();
    const expires = this.#ticket?.expires_at ?? 0;
    if (expires - now < REFRESH_BEFORE) this.#refresh(now);
    return expires > now ? this.#ticket?.ticket : undefined;
  }

  #refresh(now: number) {
    if (this.#pending || now < this.#retryAt) return;
    this.#pending = true;
    void Promise.resolve()
      .then(() => this.#fetch())
      .then((ticket) => {
        this.#ticket = ticket;
        this.#pending = false;
        this.#onTicket();
      })
      .catch(() => {
        this.#pending = false;
        this.#retryAt = this.#now() + RETRY_AFTER;
      });
  }
}
