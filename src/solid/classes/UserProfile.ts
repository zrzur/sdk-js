import type { UserProfile as APIUserProfile } from "../../api/types.js";
import type { Client } from "../Client.js";

import { File } from "./File.js";

/**
 * User Profile Class
 */
export class UserProfile {
  readonly content?: string;
  readonly banner?: File;
  /** Links to other sites, as real addresses */
  readonly links: string[];
  /** Interest ids from the fixed list */
  readonly interests: string[];
  /** An active creator, and this viewer may know */
  readonly creator: boolean;
  /** Sections that show, in order */
  readonly sections?: string[];
  /** Sections that are off. Only ever filled in for the person themselves */
  readonly hiddenSections: string[];

  /**
   * Construct Public Bot
   * @param client Client
   * @param data Data
   */
  constructor(client: Client, data: APIUserProfile) {
    this.content = data.content!;
    this.banner = data.background
      ? new File(client, data.background)
      : undefined;
    this.links = data.links ?? [];
    this.interests = data.interests ?? [];
    this.creator = data.creator ?? false;
    this.sections = data.sections ?? undefined;
    this.hiddenSections = data.hidden_sections ?? [];
  }

  /**
   * URL to the user's banner
   */
  get bannerURL(): string | undefined {
    return this.banner?.createFileURL();
  }

  /**
   * URL to the user's animated banner
   */
  get animatedBannerURL(): string | undefined {
    return this.banner?.createFileURL(true);
  }
}
