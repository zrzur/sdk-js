import type { Embed, ImageSize, Special } from "../../api/types.js";
import type { Client } from "../Client.js";

import { File } from "./File.js";

/**
 * Message Embed
 */
export abstract class MessageEmbed {
  protected client?: Client;
  readonly type: Embed["type"];

  /**
   * Construct Embed
   * @param client Client
   * @param type Type
   */
  constructor(client?: Client, type: Embed["type"] = "None") {
    this.client = client;
    this.type = type;
  }

  /**
   * Create an Embed from an API Embed
   * @param client Client
   * @param embed Data
   * @returns Embed
   */
  static from(client: Client, embed: Embed): MessageEmbed {
    switch (embed.type) {
      case "Image":
        return new ImageEmbed(client, embed);
      case "Video":
        return new VideoEmbed(client, embed);
      case "Website":
        return new WebsiteEmbed(client, embed);
      case "Text":
        return new TextEmbed(client, embed);
      default:
        return new UnknownEmbed(client);
    }
  }
}

/**
 * Embed of unknown type
 */
export class UnknownEmbed extends MessageEmbed {}

/**
 * Image Embed
 */
export class ImageEmbed extends MessageEmbed {
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly size: ImageSize;

  /**
   * Construct Image Embed
   * @param client Client
   * @param embed Embed
   */
  constructor(client: Client, embed: Omit<Embed & { type: "Image" }, "type">) {
    super(client, "Image");

    this.url = embed.url;
    this.width = embed.width;
    this.height = embed.height;
    this.size = embed.size;
  }

  /**
   * Proxied image URL
   */
  get proxiedURL(): string | undefined {
    return this.client?.proxyFile(this.url);
  }
}

/**
 * Video Embed
 */
export class VideoEmbed extends MessageEmbed {
  readonly url: string;
  readonly width: number;
  readonly height: number;

  /**
   * Construct Video Embed
   * @param client Client
   * @param embed Embed
   */
  constructor(client: Client, embed: Omit<Embed & { type: "Video" }, "type">) {
    super(client, "Video");

    this.url = embed.url;
    this.width = embed.width;
    this.height = embed.height;
  }

  /**
   * Proxied video URL
   */
  get proxiedURL(): string | undefined {
    return this.client?.proxyFile(this.url);
  }
}

/**
 * Website Embed
 */
export class WebsiteEmbed extends MessageEmbed {
  readonly url?: string;
  readonly originalUrl?: string;
  readonly specialContent?: Special;
  readonly title?: string;
  readonly description?: string;
  readonly image?: ImageEmbed;
  readonly video?: VideoEmbed;
  readonly siteName?: string;
  readonly iconUrl?: string;
  readonly colour?: string;

  /**
   * Construct Video Embed
   * @param client Client
   * @param embed Embed
   */
  constructor(
    client: Client,
    embed: Omit<Embed & { type: "Website" }, "type">,
  ) {
    super(client, "Website");

    this.url = embed.url!;
    this.originalUrl = embed.original_url!;
    this.specialContent = embed.special!;
    this.title = embed.title!;
    this.description = embed.description!;
    this.image = embed.image ? new ImageEmbed(client, embed.image) : undefined;
    this.video = embed.video ? new VideoEmbed(client, embed.video) : undefined;
    this.siteName = embed.site_name!;
    this.iconUrl = embed.icon_url!;
    this.colour = embed.colour!;
  }

  /**
   * Proxied icon URL
   */
  get proxiedIconURL(): string | undefined {
    return this.iconUrl ? this.client?.proxyFile(this.iconUrl) : undefined;
  }

  /**
   * If special content is present, generate the embed URL
   */
  get embedURL(): string | undefined {
    switch (this.specialContent?.type) {
      case "YouTube": {
        let timestamp = "";

        if (this.specialContent.timestamp) {
          timestamp = `&start=${this.specialContent.timestamp}`;
        }

        return `https://www.youtube-nocookie.com/embed/${this.specialContent.id}?modestbranding=1${timestamp}`;
      }
      case "Twitch":
        return `https://player.twitch.tv/?${this.specialContent.content_type.toLowerCase()}=${
          this.specialContent.id
        }&parent=${(window ?? {})?.location?.hostname}&autoplay=false`;
      case "Lightspeed":
        return `https://new.lightspeed.tv/embed/${this.specialContent.id}/stream`;
      case "Spotify":
        return `https://open.spotify.com/embed/${this.specialContent.content_type}/${this.specialContent.id}`;
      case "Soundcloud":
        return `https://w.soundcloud.com/player/?url=${encodeURIComponent(
          this.url!,
        )}&color=%23FF7F50&auto_play=false&hide_related=false&show_comments=true&show_user=true&show_reposts=false&show_teaser=true&visual=true`;
      case "Bandcamp": {
        return `https://bandcamp.com/EmbeddedPlayer/${this.specialContent.content_type.toLowerCase()}=${
          this.specialContent.id
        }/size=large/bgcol=181a1b/linkcol=056cc4/tracklist=false/transparent=true/`;
      }
      case "Streamable": {
        return `https://streamable.com/e/${this.specialContent.id}?loop=0`;
      }
      case "Player":
        return playerAddress(this.specialContent.embed_url);
    }
  }
}

/**
 * Hosts whose players a client may load for a "Player" embed. The server
 * builds the address from the link; this list is the client's own check, so
 * a changed or compromised link service cannot put another site in a frame.
 */
export const PLAYER_HOSTS: readonly string[] = [
  "player.vimeo.com",
  "www.dailymotion.com",
  "www.tiktok.com",
  "www.instagram.com",
  "widget.deezer.com",
  "embed.podcasts.apple.com",
  "player.kick.com",
  "www.mixcloud.com",
  "embed.tidal.com",
];

/** The player address when it is https on a listed host, else undefined */
export function playerAddress(address: string | undefined): string | undefined {
  if (!address) return undefined;
  try {
    const url = new URL(address);
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      return undefined;
    return PLAYER_HOSTS.includes(url.hostname) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Text Embed
 */
/**
 * Author line of a text embed
 */
export type TextEmbedAuthor = { name: string; icon_url?: string; url?: string };

/**
 * Name / value pair of a text embed
 */
export type TextEmbedField = { name: string; value: string; inline?: boolean };

/**
 * Footer of a text embed
 */
export type TextEmbedFooter = { text: string; icon_url?: string };

/**
 * Parts of a text embed newer than the API types
 */
type RichTextEmbed = {
  author?: TextEmbedAuthor;
  fields?: TextEmbedField[];
  thumbnail?: ConstructorParameters<typeof File>[1];
  footer?: TextEmbedFooter;
  timestamp?: string;
  image_url?: string | null;
  thumbnail_url?: string | null;
};

export class TextEmbed extends MessageEmbed {
  readonly iconUrl?: string;
  readonly url?: string;
  readonly title?: string;
  readonly description?: string;
  readonly media?: File;
  readonly colour?: string;
  readonly author?: TextEmbedAuthor;
  readonly fields: TextEmbedField[];
  readonly thumbnail?: File;
  readonly footer?: TextEmbedFooter;
  readonly timestamp?: Date;
  readonly imageUrl?: string;
  readonly thumbnailUrl?: string;

  /**
   * Construct Video Embed
   * @param client Client
   * @param embed Embed
   */
  constructor(client: Client, embed: Omit<Embed & { type: "Text" }, "type">) {
    super(client, "Text");

    this.iconUrl = embed.icon_url!;
    this.url = embed.url!;
    this.title = embed.title!;
    this.description = embed.description!;
    this.media = embed.media ? new File(client, embed.media) : undefined;
    this.colour = embed.colour!;

    const rich = embed as RichTextEmbed;
    this.author = rich.author;
    this.fields = rich.fields ?? [];
    this.thumbnail = rich.thumbnail
      ? new File(client, rich.thumbnail)
      : undefined;
    this.footer = rich.footer;
    this.timestamp = rich.timestamp ? new Date(rich.timestamp) : undefined;
    this.imageUrl = rich.image_url ?? undefined;
    this.thumbnailUrl = rich.thumbnail_url ?? undefined;
  }

  /**
   * Large image by web address, through the media proxy
   */
  get proxiedImageURL(): string | undefined {
    return this.imageUrl ? this.client?.proxyFile(this.imageUrl) : undefined;
  }

  /**
   * Small image by web address, through the media proxy
   */
  get proxiedThumbnailURL(): string | undefined {
    return this.thumbnailUrl
      ? this.client?.proxyFile(this.thumbnailUrl)
      : undefined;
  }

  /**
   * Proxied author icon URL
   */
  get proxiedAuthorIconURL(): string | undefined {
    return this.author?.icon_url
      ? this.client?.proxyFile(this.author.icon_url)
      : undefined;
  }

  /**
   * Proxied footer icon URL
   */
  get proxiedFooterIconURL(): string | undefined {
    return this.footer?.icon_url
      ? this.client?.proxyFile(this.footer.icon_url)
      : undefined;
  }

  /**
   * Proxied icon URL
   */
  get proxiedIconURL(): string | undefined {
    return this.iconUrl ? this.client?.proxyFile(this.iconUrl) : undefined;
  }
}
