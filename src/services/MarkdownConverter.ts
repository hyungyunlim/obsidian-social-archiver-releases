import type { IService } from './base/IService';
import type { PostData, Platform } from '@/types/post';
import type { YamlFrontmatter } from '@/types/archive';
import { TemplateEngine } from './markdown/template/TemplateEngine';
import { DateNumberFormatter } from './markdown/formatters/DateNumberFormatter';
import { MediaFormatter } from './markdown/formatters/MediaFormatter';
import { TextFormatter } from './markdown/formatters/TextFormatter';
import { TranscriptFormatter } from './markdown/formatters/TranscriptFormatter';
import { CommentFormatter } from './markdown/formatters/CommentFormatter';
import { FactCheckFormatter } from './markdown/formatters/FactCheckFormatter';
import { FrontmatterGenerator } from './markdown/frontmatter/FrontmatterGenerator';
import { MediaPlaceholderGenerator } from './MediaPlaceholderGenerator';
import { RSS_BASED_PLATFORMS, isRssBasedPlatform } from '@/constants/rssPlatforms';
import { getPlatformName } from '@/shared/platforms';
import { encodePathForMarkdownLink } from '@/utils/url';
import type { FrontmatterCustomizationSettings } from '@/types/settings';
import {
  DEFAULT_FRONTMATTER_CUSTOMIZATION_SETTINGS,
  isArchiveOrganizationMode,
  normalizeFrontmatterFieldAliases,
  normalizeFrontmatterPropertyOrder,
} from '@/types/settings';

/**
 * Default markdown templates for each platform
 */
const DEFAULT_TEMPLATES: Record<Platform, string> = {
  facebook: `{{#if comment}}
> **My Note:**
> {{comment}}

---

{{/if}}{{#if content.text}}{{content.text}}

{{/if}}
{{#if metadata.externalLink}}

🔗 **Link:** {{#if metadata.externalLinkTitle}}[{{metadata.externalLinkTitle}}]({{metadata.externalLink}}){{else}}[{{metadata.externalLink}}]({{metadata.externalLink}}){{/if}}
{{/if}}

{{#if media}}

---

{{media}}
{{/if}}

{{#if quotedPost}}

---

{{quotedPost}}
{{/if}}

{{#if comments}}

---

## 💬 Comments

{{comments}}
{{/if}}

{{#if ai}}

---

## 🤖 AI Analysis

**Summary:** {{ai.summary}}

**Sentiment:** {{ai.sentiment}}

**Topics:** {{ai.topics}}

{{#if ai.factCheck}}

### Fact Checks
{{ai.factCheck}}
{{/if}}
{{/if}}

---

**Platform:** Facebook{{#if author.verified}} ✓{{/if}} | **Author:** [{{author.name}}]({{author.url}}) | **Published:** {{metadata.timestamp}}{{#if metadata.likes}} | **Likes:** {{metadata.likes}}{{/if}}{{#if metadata.comments}} | **Comments:** {{metadata.comments}}{{/if}}{{#if metadata.shares}} | **Shares:** {{metadata.shares}}{{/if}}

**Original URL:** {{url}}
`,

  linkedin: `{{#if comment}}
> **My Note:**
> {{comment}}

---

{{/if}}{{content.text}}

{{#if content.hashtagsText}}

{{content.hashtagsText}}
{{/if}}

{{#if media}}

---

{{media}}
{{/if}}

{{#if comments}}

---

## 💬 Comments

{{comments}}
{{/if}}

{{#if ai}}

---

## 🤖 AI Analysis

**Summary:** {{ai.summary}}

**Sentiment:** {{ai.sentiment}}

**Topics:** {{ai.topics}}

{{#if ai.factCheck}}

### Fact Checks
{{ai.factCheck}}
{{/if}}
{{/if}}

---

**Platform:** LinkedIn{{#if author.verified}} ✓{{/if}} | **Author:** [{{author.name}}]({{author.url}}) | **Published:** {{metadata.timestamp}}{{#if metadata.likes}} | **Reactions:** {{metadata.likes}}{{/if}}{{#if metadata.comments}} | **Comments:** {{metadata.comments}}{{/if}}

**Original URL:** {{url}}
`,

  instagram: `{{#if comment}}
> **My Note:**
> {{comment}}

---

{{/if}}{{content.text}}

{{#if media}}

---

{{media}}
{{/if}}

{{#if comments}}

---

## 💬 Comments

{{comments}}
{{/if}}

{{#if ai}}

---

## 🤖 AI Analysis

**Summary:** {{ai.summary}}

**Sentiment:** {{ai.sentiment}}

**Topics:** {{ai.topics}}

{{#if ai.factCheck}}

### Fact Checks
{{ai.factCheck}}
{{/if}}
{{/if}}

---

**Platform:** Instagram{{#if author.verified}} ✓{{/if}} | **Author:** {{authorMention}} | **Published:** {{metadata.timestamp}}{{#if metadata.likes}} | **Likes:** {{metadata.likes}}{{/if}}{{#if metadata.comments}} | **Comments:** {{metadata.comments}}{{/if}}

**Original URL:** {{url}}
`,

  tiktok: `{{#if comment}}
> **My Note:**
> {{comment}}

---

{{/if}}{{content.text}}

{{#if media}}

---

{{media}}
{{/if}}

{{#if comments}}

---

## 💬 Comments

{{comments}}
{{/if}}

{{#if ai}}

---

## 🤖 AI Analysis

**Summary:** {{ai.summary}}

**Sentiment:** {{ai.sentiment}}

**Topics:** {{ai.topics}}

{{#if ai.factCheck}}

### Fact Checks
{{ai.factCheck}}
{{/if}}
{{/if}}

---

**Platform:** TikTok{{#if author.verified}} ✓{{/if}} | **Author:** [{{author.name}}]({{author.url}}) | **Published:** {{metadata.timestamp}}{{#if metadata.views}} | **Views:** {{metadata.views}}{{/if}}{{#if metadata.likes}} | **Likes:** {{metadata.likes}}{{/if}}{{#if metadata.comments}} | **Comments:** {{metadata.comments}}{{/if}}

**Original URL:** {{url}}
`,

  x: `{{#if comment}}
> **My Note:**
> {{comment}}

---

{{/if}}{{content.text}}

{{#if metadata.externalLink}}

🔗 **Link:** {{#if metadata.externalLinkTitle}}[{{metadata.externalLinkTitle}}]({{metadata.externalLink}}){{else}}[{{metadata.externalLink}}]({{metadata.externalLink}}){{/if}}
{{#if metadata.externalLinkDescription}}
> {{metadata.externalLinkDescription}}
{{/if}}
{{/if}}

{{#if media}}

---

{{media}}
{{/if}}

{{#if quotedPost}}

---

{{quotedPost}}
{{/if}}

{{#if comments}}

---

## 💬 Comments

{{comments}}
{{/if}}

{{#if ai}}

---

## 🤖 AI Analysis

**Summary:** {{ai.summary}}

**Sentiment:** {{ai.sentiment}}

**Topics:** {{ai.topics}}

{{#if ai.factCheck}}

### Fact Checks
{{ai.factCheck}}
{{/if}}
{{/if}}

---

**Platform:** X (Twitter){{#if author.verified}} ✓{{/if}} | **Author:** [{{author.name}}]({{author.url}}) | **Published:** {{metadata.timestamp}}{{#if metadata.likes}} | **Likes:** {{metadata.likes}}{{/if}}{{#if metadata.comments}} | **Replies:** {{metadata.comments}}{{/if}}{{#if metadata.shares}} | **Retweets:** {{metadata.shares}}{{/if}}

**Original URL:** {{url}}
`,

  threads: `{{#if comment}}
> **My Note:**
> {{comment}}

---

{{/if}}{{content.text}}

{{#if media}}

---

{{media}}
{{/if}}

{{#if comments}}

---

## 💬 Comments

{{comments}}
{{/if}}

{{#if ai}}

---

## 🤖 AI Analysis

**Summary:** {{ai.summary}}

**Sentiment:** {{ai.sentiment}}

**Topics:** {{ai.topics}}

{{#if ai.factCheck}}

### Fact Checks
{{ai.factCheck}}
{{/if}}
{{/if}}

---

**Platform:** Threads{{#if author.verified}} ✓{{/if}} | **Author:** [{{author.name}}]({{author.url}}) | **Published:** {{metadata.timestamp}}{{#if metadata.likes}} | **Likes:** {{metadata.likes}}{{/if}}{{#if metadata.comments}} | **Replies:** {{metadata.comments}}{{/if}}

**Original URL:** {{url}}
`,

  youtube: `{{#if comment}}
> **My Note:**
> {{comment}}

---

{{/if}}{{#if title}}
# 📺 {{title}}

{{/if}}{{#if media}}
{{media}}

---

{{/if}}{{#if content.text}}
## 📝 Description

{{content.text}}

---

{{/if}}{{#if transcript}}
## 📄 Transcript

{{transcript}}

---

{{/if}}{{#if comments}}
## 💬 Comments

{{comments}}

---

{{/if}}
**Platform:** YouTube{{#if author.verified}} ✓{{/if}} | **Channel:** [{{author.name}}]({{author.url}}) | **Published:** {{metadata.timestamp}}{{#if metadata.views}} | **Views:** {{metadata.views}}{{/if}}{{#if metadata.likes}} | **Likes:** {{metadata.likes}}{{/if}}{{#if metadata.comments}} | **Comments:** {{metadata.comments}}{{/if}}{{#if metadata.duration}} | **Duration:** {{metadata.duration}}{{/if}}

**Original URL:** {{url}}
`,

  reddit: `{{#if comment}}
> **My Note:**
> {{comment}}

---

{{/if}}{{content.text}}

{{#if media}}

---

{{media}}
{{/if}}

{{#if comments}}

---

## 💬 Comments

{{comments}}
{{/if}}

{{#if ai}}

---

## 🤖 AI Analysis

**Summary:** {{ai.summary}}

**Sentiment:** {{ai.sentiment}}

**Topics:** {{ai.topics}}

{{#if ai.factCheck}}

### Fact Checks
{{ai.factCheck}}
{{/if}}
{{/if}}

---

**Platform:** Reddit | **Community:** r/{{content.community.name}} | **Author:** {{author.name}} | **Published:** {{metadata.timestamp}}{{#if metadata.upvotes}} | **Upvotes:** {{metadata.upvotes}}{{/if}}{{#if metadata.comments}} | **Comments:** {{metadata.comments}}{{/if}}

**Original URL:** {{url}}
`,
  pinterest: `{{#if comment}}
> **My Note:**
> {{comment}}

---

{{/if}}{{#if isReblog}}📌 **[{{author.name}}]({{author.url}})** pinned from **[{{quotedPost.author.name}}]({{quotedPost.author.url}})**

---

{{/if}}{{content.text}}

{{#if content.hashtagsText}}

{{content.hashtagsText}}
{{/if}}

{{#if media}}

---

{{media}}
{{/if}}

{{#if ai}}

---

## 🤖 AI Analysis

**Summary:** {{ai.summary}}

**Sentiment:** {{ai.sentiment}}

**Topics:** {{ai.topics}}

{{#if ai.factCheck}}

### Fact Checks
{{ai.factCheck}}
{{/if}}
{{/if}}

---

{{#if isReblog}}**Platform:** Pinterest | **Pinned by:** [{{author.name}}]({{author.url}}) | **Original Creator:** [{{quotedPost.author.name}}]({{quotedPost.author.url}}) | **Published:** {{metadata.timestamp}}{{#if metadata.likes}} | **Likes:** {{metadata.likes}}{{/if}}{{#if metadata.comments}} | **Comments:** {{metadata.comments}}{{/if}}{{#if metadata.shares}} | **Saves:** {{metadata.shares}}{{/if}}{{#if metadata.views}} | **Views:** {{metadata.views}}{{/if}}{{else}}**Platform:** Pinterest | **Author:** [{{author.name}}]({{author.url}}) | **Published:** {{metadata.timestamp}}{{#if metadata.likes}} | **Likes:** {{metadata.likes}}{{/if}}{{#if metadata.comments}} | **Comments:** {{metadata.comments}}{{/if}}{{#if metadata.shares}} | **Saves:** {{metadata.shares}}{{/if}}{{#if metadata.views}} | **Views:** {{metadata.views}}{{/if}}{{/if}}

**Original URL:** {{url}}
`,
  substack: `{{#if comment}}
> **My Note:**
> {{comment}}

---

{{/if}}{{#if title}}# {{title}}

{{/if}}{{content.text}}

{{#if media}}

---

{{media}}
{{/if}}

{{#if metadata.externalLink}}

---

**External Link:** {{#if metadata.externalLinkTitle}}[{{metadata.externalLinkTitle}}]({{metadata.externalLink}}){{else}}[{{metadata.externalLink}}]({{metadata.externalLink}}){{/if}}
{{#if metadata.externalLinkDescription}}
> {{metadata.externalLinkDescription}}
{{/if}}
{{/if}}

{{#if ai}}

---

## 🤖 AI Analysis

**Summary:** {{ai.summary}}

**Sentiment:** {{ai.sentiment}}

**Topics:** {{ai.topics}}

{{#if ai.factCheck}}

### Fact Checks
{{ai.factCheck}}
{{/if}}
{{/if}}

---

**Platform:** Substack{{#if title}} | **Publication:** {{title}}{{/if}} | **Author:** {{author.name}} | **Published:** {{metadata.timestamp}}{{#if metadata.likes}} | **Likes:** {{metadata.likes}}{{/if}}{{#if metadata.comments}} | **Replies:** {{metadata.comments}}{{/if}}{{#if metadata.shares}} | **Restacks:** {{metadata.shares}}{{/if}}

**Original URL:** {{url}}
`,

  tumblr: `{{#if comment}}
> **My Note:**
> {{comment}}

---

{{/if}}{{#if title}}# {{title}}

{{/if}}{{content.text}}

{{#if content.hashtagsText}}

{{content.hashtagsText}}
{{/if}}

{{#if media}}

---

{{media}}
{{/if}}

{{#if metadata.externalLink}}

---

**External Link:** {{#if metadata.externalLinkTitle}}[{{metadata.externalLinkTitle}}]({{metadata.externalLink}}){{else}}[{{metadata.externalLink}}]({{metadata.externalLink}}){{/if}}
{{#if metadata.externalLinkDescription}}
> {{metadata.externalLinkDescription}}
{{/if}}
{{/if}}

{{#if ai}}

---

## 🤖 AI Analysis

**Summary:** {{ai.summary}}

**Sentiment:** {{ai.sentiment}}

**Topics:** {{ai.topics}}

{{#if ai.factCheck}}

### Fact Checks
{{ai.factCheck}}
{{/if}}
{{/if}}

---

**Platform:** Tumblr | **Author:** [{{author.name}}]({{author.url}}) | **Published:** {{metadata.timestamp}}{{#if metadata.likes}} | **Likes:** {{metadata.likes}}{{/if}}{{#if metadata.shares}} | **Reblogs:** {{metadata.shares}}{{/if}}{{#if metadata.comments}} | **Comments:** {{metadata.comments}}{{/if}}

**Original URL:** {{url}}
`,

  mastodon: `{{#if comment}}
> **My Note:**
> {{comment}}

---

{{/if}}{{content.text}}

{{#if media}}

---

{{media}}
{{/if}}

{{#if quotedPost}}

---

{{quotedPost}}
{{/if}}

{{#if ai}}

---

## 🤖 AI Analysis

**Summary:** {{ai.summary}}

**Sentiment:** {{ai.sentiment}}

**Topics:** {{ai.topics}}

{{#if ai.factCheck}}

### Fact Checks
{{ai.factCheck}}
{{/if}}
{{/if}}

---

**Platform:** Mastodon | **Author:** [{{author.name}}]({{author.url}}) | **Published:** {{metadata.timestamp}}{{#if metadata.likes}} | **Favorites:** {{metadata.likes}}{{/if}}{{#if metadata.shares}} | **Boosts:** {{metadata.shares}}{{/if}}{{#if metadata.comments}} | **Quotes:** {{metadata.comments}}{{/if}}

**Original URL:** {{url}}
`,

  bluesky: `{{#if comment}}
> **My Note:**
> {{comment}}

---

{{/if}}{{content.text}}

{{#if media}}

---

{{media}}
{{/if}}

{{#if quotedPost}}

---

{{quotedPost}}
{{/if}}

{{#if ai}}

---

## 🤖 AI Analysis

**Summary:** {{ai.summary}}

**Sentiment:** {{ai.sentiment}}

**Topics:** {{ai.topics}}

{{#if ai.factCheck}}

### Fact Checks
{{ai.factCheck}}
{{/if}}
{{/if}}

---

**Platform:** Bluesky | **Author:** [{{author.name}}]({{author.url}}) | **Published:** {{metadata.timestamp}}{{#if metadata.likes}} | **Likes:** {{metadata.likes}}{{/if}}{{#if metadata.shares}} | **Reposts:** {{metadata.shares}}{{/if}}{{#if metadata.comments}} | **Quotes:** {{metadata.comments}}{{/if}}

**Original URL:** {{url}}
`,
  googlemaps: `{{#if comment}}
> **My Note:**
> {{comment}}

---

{{/if}}# {{title}}{{#if author.verified}} ✓{{/if}}

{{content.text}}

{{#if media}}

---

## Photos

{{media}}
{{/if}}

{{#if comments}}

---

## 💬 Comments

{{comments}}
{{/if}}

{{#if ai}}

---

## AI Analysis

**Summary:** {{ai.summary}}

**Sentiment:** {{ai.sentiment}}

**Topics:** {{ai.topics}}

{{#if ai.factCheck}}

### Fact Checks
{{ai.factCheck}}
{{/if}}
{{/if}}

---

**Platform:** Google Maps{{#if author.verified}} (Verified){{/if}} | **Place:** {{author.name}}{{#if metadata.comments}} | **Reviews:** {{metadata.comments}}{{/if}}{{#if metadata.location}} | **Location:** {{metadata.location}}{{/if}}

**Original URL:** {{url}}
`,

  blog: `{{#if comment}}
> **My Note:**
> {{comment}}

---

{{/if}}{{#if title}}# {{title}}

{{/if}}{{#if content.text}}{{content.text}}

{{/if}}

{{#if media}}

---

{{media}}
{{/if}}

{{#if quotedPost}}

---

{{quotedPost}}
{{/if}}

{{#if comments}}

---

## 💬 Comments

{{comments}}
{{/if}}

{{#if ai}}

---

## AI Analysis

**Summary:** {{ai.summary}}

**Sentiment:** {{ai.sentiment}}

**Topics:** {{ai.topics}}

{{#if ai.factCheck}}

### Fact Checks
{{ai.factCheck}}
{{/if}}
{{/if}}

---

**Platform:** 📝 Blog | **Author:** {{author.name}}{{#if metadata.timestamp}} | **Published:** {{metadata.timestamp}}{{/if}}

**Original URL:** {{url}}
`,

  velog: `{{#if comment}}
> **My Note:**
> {{comment}}

---

{{/if}}{{#if title}}# {{title}}

{{/if}}{{#if content.text}}{{content.text}}

{{/if}}

{{#if media}}

---

{{media}}
{{/if}}

{{#if quotedPost}}

---

{{quotedPost}}
{{/if}}

{{#if comments}}

---

## 💬 Comments

{{comments}}
{{/if}}

{{#if ai}}

---

## AI Analysis

**Summary:** {{ai.summary}}

**Sentiment:** {{ai.sentiment}}

**Topics:** {{ai.topics}}

{{#if ai.factCheck}}

### Fact Checks
{{ai.factCheck}}
{{/if}}
{{/if}}

---

**Platform:** 🌱 Velog | **Author:** {{author.name}}{{#if metadata.timestamp}} | **Published:** {{metadata.timestamp}}{{/if}}

**Original URL:** {{url}}
`,

  medium: `{{#if comment}}
> **My Note:**
> {{comment}}

---

{{/if}}{{#if title}}# {{title}}

{{/if}}{{#if content.text}}{{content.text}}

{{/if}}

{{#if media}}

---

{{media}}
{{/if}}

{{#if quotedPost}}

---

{{quotedPost}}
{{/if}}

{{#if comments}}

---

## 💬 Comments

{{comments}}
{{/if}}

{{#if ai}}

---

## AI Analysis

**Summary:** {{ai.summary}}

**Sentiment:** {{ai.sentiment}}

**Topics:** {{ai.topics}}

{{#if ai.factCheck}}

### Fact Checks
{{ai.factCheck}}
{{/if}}
{{/if}}

---

**Platform:** 📖 Medium | **Author:** {{author.name}}{{#if metadata.timestamp}} | **Published:** {{metadata.timestamp}}{{/if}}

**Original URL:** {{url}}
`,

  naver: `{{#if comment}}
> **My Note:**
> {{comment}}

---

{{/if}}{{#if title}}# {{title}}

{{/if}}{{#if content.text}}{{content.text}}

{{/if}}

{{#if media}}

---

{{media}}
{{/if}}

{{#if quotedPost}}

---

{{quotedPost}}
{{/if}}

{{#if comments}}

---

## 💬 Comments

{{comments}}
{{/if}}

{{#if ai}}

---

## AI Analysis

**Summary:** {{ai.summary}}

**Sentiment:** {{ai.sentiment}}

**Topics:** {{ai.topics}}

{{#if ai.factCheck}}

### Fact Checks
{{ai.factCheck}}
{{/if}}
{{/if}}

---

**Platform:** 🇰🇷 Naver | **Author:** {{author.name}}{{#if metadata.timestamp}} | **Published:** {{metadata.timestamp}}{{/if}}

**Original URL:** {{url}}
`,

  'naver-webtoon': `{{#if comment}}
> **My Note:**
> {{comment}}

---

{{/if}}{{#if series}}## 📖 {{series.title}}{{#if series.episode}} — {{series.episode}}화{{/if}}

{{/if}}{{#if title}}# {{title}}

{{/if}}{{#if seriesGenre}}**Genre:** {{seriesGenre}}
{{/if}}{{#if series.starScore}}**Rating:** ⭐ {{series.starScore}}
{{/if}}{{#if series.ageRating}}**Age Rating:** {{series.ageRating}}
{{/if}}{{#if series.publishDay}}**Publish Day:** {{series.publishDay}}{{#if series.finished}} (Completed){{/if}}
{{/if}}

{{#if content.text}}---

{{content.text}}

{{/if}}

{{#if media}}

---

## 🖼️ Episode Images

{{media}}
{{/if}}

{{#if comments}}

---

## 💬 Comments

{{comments}}
{{/if}}

---

**Platform:** 📖 Naver Webtoon | **Author:** {{author.name}}{{#if series}} | **Series:** [{{series.title}}]({{series.url}}){{#if series.episode}} (Ep. {{series.episode}}/{{series.totalEpisodes}}){{/if}}{{/if}}{{#if metadata.timestamp}} | **Published:** {{metadata.timestamp}}{{/if}}

**Original URL:** {{url}}
`,

  webtoons: `{{#if comment}}
> **My Note:**
> {{comment}}

---

{{/if}}{{#if series}}## 📚 {{series.title}}{{#if series.episode}} — Episode {{series.episode}}{{/if}}

{{/if}}{{#if title}}# {{title}}

{{/if}}{{#if seriesGenre}}**Genre:** {{seriesGenre}}
{{/if}}{{#if metadata.likes}}**Likes:** ♥ {{metadata.likes}}
{{/if}}{{#if series.ageRating}}**Age Rating:** {{series.ageRating}}
{{/if}}{{#if series.publishDay}}**Publish Day:** {{series.publishDay}}{{#if series.finished}} (Completed){{/if}}
{{/if}}

{{#if content.text}}---

{{content.text}}

{{/if}}

{{#if media}}

---

## 🖼️ Episode Images

{{media}}
{{/if}}

{{#if comments}}

---

## 💬 Comments

{{comments}}
{{/if}}

---

**Platform:** 📚 WEBTOON | **Author:** {{author.name}}{{#if series}} | **Series:** [{{series.title}}]({{series.url}}){{#if series.episode}} (Ep. {{series.episode}}/{{series.totalEpisodes}}){{/if}}{{/if}}{{#if metadata.timestamp}} | **Published:** {{metadata.timestamp}}{{/if}}

**Original URL:** {{url}}
`,

  brunch: `{{#if comment}}
> **My Note:**
> {{comment}}

---

{{/if}}{{#if title}}# {{title}}

{{/if}}{{#if metadata.subtitle}}*{{metadata.subtitle}}*

{{/if}}{{#if content.text}}{{content.text}}

{{/if}}

{{#if media}}

---

{{media}}
{{/if}}

{{#if quotedPost}}

---

{{quotedPost}}
{{/if}}

{{#if comments}}

---

## 💬 Comments

{{comments}}
{{/if}}

{{#if ai}}

---

## AI Analysis

**Summary:** {{ai.summary}}

**Sentiment:** {{ai.sentiment}}

**Topics:** {{ai.topics}}

{{#if ai.factCheck}}

### Fact Checks
{{ai.factCheck}}
{{/if}}
{{/if}}

---

**Platform:** 📝 Brunch | **Author:** {{author.name}}{{#if metadata.timestamp}} | **Published:** {{metadata.timestamp}}{{/if}}{{#if series}} | **Series:** {{series.title}}{{#if series.episode}} (Episode {{series.episode}}){{/if}}{{/if}}

**Original URL:** {{url}}
`,

  podcast: `{{#if comment}}
> **My Note:**
> {{comment}}

---

{{/if}}{{#if title}}# {{title}}

{{/if}}{{#if metadata.subtitle}}*{{metadata.subtitle}}*

{{/if}}{{#if content.text}}{{content.text}}

{{/if}}

{{#if media}}

---

{{media}}
{{/if}}

{{#if quotedPost}}

---

{{quotedPost}}
{{/if}}

{{#if comments}}

---

## 💬 Comments

{{comments}}
{{/if}}

{{#if ai}}

---

## 🤖 AI Analysis

**Summary:** {{ai.summary}}

**Sentiment:** {{ai.sentiment}}

**Topics:** {{ai.topics}}

{{#if ai.factCheck}}

### Fact Checks
{{ai.factCheck}}
{{/if}}
{{/if}}

---

**Platform:** 🎙️ Podcast | **Show:** [{{author.name}}]({{author.url}}){{#if metadata.episode}} | **Episode:** {{metadata.episode}}{{/if}}{{#if metadata.season}} (S{{metadata.season}}){{/if}}{{#if metadata.duration}} | **Duration:** {{metadata.duration}}{{/if}}{{#if metadata.timestamp}} | **Published:** {{metadata.timestamp}}{{/if}}

{{#if metadata.hosts}}**Hosts:** {{metadata.hosts}}{{/if}}{{#if metadata.guests}} | **Guests:** {{metadata.guests}}{{/if}}

**Original URL:** {{url}}
`,

  post: `{{#if comment}}
> **My Note:**
> {{comment}}

---

{{/if}}{{content.text}}

{{#if media}}

---

{{media}}
{{/if}}

{{#if embeddedArchives}}

---

## Referenced Social Media Posts

{{embeddedArchives}}
{{/if}}

---

**Author:** {{author.name}} | **Published:** {{metadata.timestamp}}
`,
};

/**
 * Markdown conversion result
 */
export interface MarkdownResult {
  frontmatter: YamlFrontmatter;
  content: string;
  fullDocument: string;
}

/**
 * Options for markdown conversion
 */
export interface ConvertOptions {
  // Reserved for future options
}

interface MarkdownConverterConfig {
  frontmatterSettings?: FrontmatterCustomizationSettings;
}

function cloneFrontmatterSettings(
  settings?: FrontmatterCustomizationSettings
): FrontmatterCustomizationSettings {
  const source = settings ?? DEFAULT_FRONTMATTER_CUSTOMIZATION_SETTINGS;
  const customProperties = Array.isArray(source.customProperties)
    ? source.customProperties.map((property) => ({ ...property }))
    : [];

  return {
    ...source,
    fieldVisibility: { ...source.fieldVisibility },
    customProperties,
    fieldAliases: normalizeFrontmatterFieldAliases(source.fieldAliases),
    propertyOrder: normalizeFrontmatterPropertyOrder(source.propertyOrder, customProperties),
    tagRoot: typeof source.tagRoot === 'string' ? source.tagRoot : DEFAULT_FRONTMATTER_CUSTOMIZATION_SETTINGS.tagRoot,
    tagOrganization: isArchiveOrganizationMode(source.tagOrganization)
      ? source.tagOrganization
      : DEFAULT_FRONTMATTER_CUSTOMIZATION_SETTINGS.tagOrganization,
  };
}

/**
 * MarkdownConverter - Transforms PostData into Markdown format
 *
 * Single Responsibility: Markdown generation orchestration using specialized formatters
 */
export class MarkdownConverter implements IService {
  private templates: Map<Platform, string>;
  private frontmatterSettings: FrontmatterCustomizationSettings;

  // Formatters
  private dateNumberFormatter: DateNumberFormatter;
  private mediaFormatter: MediaFormatter;
  private textFormatter: TextFormatter;
  private transcriptFormatter: TranscriptFormatter;
  private commentFormatter: CommentFormatter;
  private factCheckFormatter: FactCheckFormatter;
  private frontmatterGenerator: FrontmatterGenerator;

  constructor(config?: MarkdownConverterConfig) {
    this.templates = new Map(Object.entries(DEFAULT_TEMPLATES) as [Platform, string][]);
    this.frontmatterSettings = cloneFrontmatterSettings(config?.frontmatterSettings);

    // Initialize formatters
    this.dateNumberFormatter = new DateNumberFormatter();
    this.textFormatter = new TextFormatter();
    this.mediaFormatter = new MediaFormatter(this.dateNumberFormatter);
    this.transcriptFormatter = new TranscriptFormatter();
    this.commentFormatter = new CommentFormatter(this.dateNumberFormatter, this.textFormatter);
    this.factCheckFormatter = new FactCheckFormatter();
    this.frontmatterGenerator = new FrontmatterGenerator(this.dateNumberFormatter, this.textFormatter);
  }

  setFrontmatterSettings(settings: FrontmatterCustomizationSettings): void {
    this.frontmatterSettings = cloneFrontmatterSettings(settings);
  }

  async initialize(): Promise<void> {
    // No async initialization needed
  }

  async dispose(): Promise<void> {
    // No cleanup needed
  }

  /**
   * Check if service is healthy
   */
  isHealthy(): boolean {
    return true;
  }

  /**
   * Set custom template for a platform
   */
  setTemplate(platform: Platform, template: string): void {
    this.templates.set(platform, template);
  }

  /**
   * Set custom date formatter
   */
  setDateFormat(formatter: (date: Date) => string): void {
    this.dateNumberFormatter.setDateFormat(formatter);
  }

  /**
   * Convert PostData to Markdown
   * @param postData - Post data to convert
   * @param customTemplate - Custom template (optional)
   * @param mediaResults - Downloaded media results (optional, if downloadMedia is enabled)
   * @param options - Conversion options (optional)
   */
  async convert(
    postData: PostData,
    customTemplate?: string,
    mediaResults?: import('./MediaHandler').MediaResult[],
    options?: ConvertOptions
  ): Promise<MarkdownResult> {
    // Generate frontmatter with options
    const frontmatter = this.frontmatterGenerator.generateFrontmatter(postData, {
      customization: this.frontmatterSettings,
    });

    // Get template
    const template = customTemplate || this.templates.get(postData.platform) || DEFAULT_TEMPLATES[postData.platform];

    // Prepare template data
    const templateData = this.prepareTemplateData(postData, mediaResults);

    // Process template
    const content = TemplateEngine.process(template, templateData);

    // Generate full document
    const fullDocument = this.frontmatterGenerator.generateFullDocument(frontmatter, content);

    return {
      frontmatter,
      content,
      fullDocument,
    };
  }

  /**
   * Update full document with modified frontmatter
   */
  updateFullDocument(markdown: MarkdownResult): MarkdownResult {
    return {
      ...markdown,
      fullDocument: this.frontmatterGenerator.generateFullDocument(markdown.frontmatter, markdown.content),
    };
  }

  /**
   * Format embedded archives into markdown
   * @param archives - Array of archived PostData to format
   * @returns Formatted markdown string
   */
  private formatEmbeddedArchives(archives: PostData[]): string {
    const sections: string[] = [];

    for (const archive of archives) {
      const pinterestBoardSection = this.formatPinterestBoardEmbedded(archive);
      if (pinterestBoardSection) {
        sections.push(pinterestBoardSection);
        continue;
      }

      const platformName = getPlatformName(archive.platform);
      const authorHandle = archive.author.handle || archive.author.username || archive.author.name;

      // Hidden header (HTML comment) to keep parsing hints without showing a visible title
      let section = `<!-- Embedded: ${platformName} - ${authorHandle} -->\n\n`;

      // User comment (quoted, matching main archives)
      if (archive.comment) {
        section += `> **My Note:**\n`;
        section += `> ${archive.comment}\n\n`;
        section += `---\n\n`;
      }

      // Process hashtags (same logic as main convert function)
      const normalizeHashtagForObsidian = (tag: string) => {
        const clean = tag.startsWith('#') ? tag.slice(1) : tag;
        return `#${clean.replace(/\s+/g, '-')}`;
      };

      const rawHashtagsArray = Array.isArray(archive.content.hashtags) ? archive.content.hashtags : undefined;
      const uniqueHashtags = rawHashtagsArray
        ? Array.from(new Set(rawHashtagsArray.map(tag => tag.trim()).filter(Boolean)))
        : undefined;
      const normalizedHashtags = uniqueHashtags?.map(normalizeHashtagForObsidian);
      const hashtagsText = normalizedHashtags && normalizedHashtags.length > 0
        ? normalizedHashtags.join(' ')
        : undefined;

      // YouTube: Show title and description (PostCardRenderer handles the video player)
      if (archive.platform === 'youtube') {
        if (archive.title) {
          section += `**📺 ${archive.title}**\n\n`;
        }

        // Description (if exists)
        const contentText = archive.content.text.trim();
        if (contentText) {
          section += `**Description:**\n${contentText}\n\n`;
        }

        // Transcript (if formatted entries exist)
        const formattedEntries = archive.transcript?.formatted;
        if (Array.isArray(formattedEntries) && formattedEntries.length > 0) {
          const transcriptBody = this.transcriptFormatter.formatBrightDataTranscript(formattedEntries, archive.videoId);
          if (transcriptBody) {
            section += `**Transcript:**\n${transcriptBody}\n\n`;
          }
        }
      } else {
        // Non-YouTube platforms: original format
        // For Tumblr: remove hashtags from content.text if they're in the hashtags array
        let contentText = archive.content.text.trim();
        if (archive.platform === 'tumblr' && uniqueHashtags && uniqueHashtags.length > 0 && contentText) {
          const hashtagPattern = /#[^\s#]+(?:\s+[^\s#]+)*/g;
          const cleanedText = contentText.replace(hashtagPattern, '').trim();
          contentText = cleanedText || '';
        }

        // Content as plain text (matching main archives)
        if (contentText) {
          section += `${contentText}\n\n`;
        }

        // Hashtags section (if exists)
        if (hashtagsText) {
          section += `${hashtagsText}\n\n`;
        }

        // Media (if exists)
        if (archive.media && archive.media.length > 0) {
          section += `**Media:**\n`;
          for (const media of archive.media) {
            // At this point, media.url should already be updated to local path by ArchiveOrchestrator
            // Convert to relative path for User Post files (Post/YYYY/MM/file.md -> ../../../../attachments/...)
            const relativePath = media.url.startsWith('attachments/')
              ? `../../../../${media.url}`
              : media.url;

            if (media.type === 'image') {
              const altText = media.altText || media.alt || 'Image';
              section += `![${altText}](${encodePathForMarkdownLink(relativePath)})\n`;
            } else if (media.type === 'video') {
              section += `![🎥 Video](${encodePathForMarkdownLink(relativePath)})\n`;
            }
          }
          section += `\n`;
        }
      }

      // Quoted/shared/reblogged post (if exists)
      // NOTE: Include quotedPost in markdown so it appears in the content
      // PostDataParser will extract it from markdown and PostCardRenderer will render it as UI
      if (archive.quotedPost) {
        section += this.formatQuotedPost(archive.quotedPost, archive.isReblog);
        section += `\n`;
      }

      // Metadata - single line format (matching main archives)
      section += `---\n\n`;

      // Author info (platformName already declared above)
      const authorName = archive.author.name;
      const authorUrl = archive.author.url || archive.url;

      // Build metadata line - platform-specific formatting
      let metadataLine = '';

      if (archive.platform === 'reddit') {
        // Reddit-specific metadata format
        const communityName = (archive.content as any).community?.name || 'Unknown';
        metadataLine = `**Platform:** Reddit | **Community:** r/${communityName} | **Author:** ${archive.author.name || 'Unknown'} | **Published:** ${this.dateNumberFormatter.formatDate(archive.metadata.timestamp)}`;
        if ((archive.metadata as any).upvotes !== undefined) {
          metadataLine += ` | **Upvotes:** ${this.dateNumberFormatter.formatNumber((archive.metadata as any).upvotes)}`;
        }
        if (archive.metadata.comments !== undefined) {
          metadataLine += ` | **Comments:** ${this.dateNumberFormatter.formatNumber(archive.metadata.comments)}`;
        }
      } else if (archive.platform === 'youtube') {
        // YouTube-specific metadata format
        metadataLine = `**Platform:** YouTube | **Channel:** [${authorName}](${authorUrl}) | **Published:** ${this.dateNumberFormatter.formatDate(archive.metadata.timestamp)}`;
        if (archive.metadata.views !== undefined) {
          metadataLine += ` | **Views:** ${this.dateNumberFormatter.formatNumber(archive.metadata.views)}`;
        }
        if (archive.metadata.likes !== undefined) {
          metadataLine += ` | **Likes:** ${this.dateNumberFormatter.formatNumber(archive.metadata.likes)}`;
        }
        if (archive.metadata.comments !== undefined) {
          metadataLine += ` | **Comments:** ${this.dateNumberFormatter.formatNumber(archive.metadata.comments)}`;
        }
        if (archive.metadata.duration !== undefined) {
          metadataLine += ` | **Duration:** ${this.dateNumberFormatter.formatDuration(archive.metadata.duration)}`;
        }
      } else {
        // Generic metadata format for other platforms
        metadataLine = `**Platform:** ${platformName} | **Author:** [${authorName}](${authorUrl}) | **Published:** ${this.dateNumberFormatter.formatDate(archive.metadata.timestamp)}`;

        if (archive.metadata.views !== undefined) {
          metadataLine += ` | **Views:** ${this.dateNumberFormatter.formatNumber(archive.metadata.views)}`;
        }
        if (archive.metadata.likes !== undefined) {
          metadataLine += ` | **Likes:** ${this.dateNumberFormatter.formatNumber(archive.metadata.likes)}`;
        }
        if (archive.metadata.comments !== undefined) {
          metadataLine += ` | **Comments:** ${this.dateNumberFormatter.formatNumber(archive.metadata.comments)}`;
        }
        if (archive.metadata.shares !== undefined) {
          metadataLine += ` | **Shares:** ${this.dateNumberFormatter.formatNumber(archive.metadata.shares)}`;
        }
      }

      section += metadataLine + `\n\n`;
      section += `**Original URL:** ${archive.url}\n`;

      // Comments (if exists) - formatted like main archives
      if (archive.comments && archive.comments.length > 0) {
        section += `\n---\n\n`;
        section += `## 💬 Comments\n\n`;
        section += this.commentFormatter.formatComments(archive.comments, archive.platform);
      }

      sections.push(section);
    }

    return sections.join('\n---\n\n');
  }

  /**
   * Format Pinterest board archives (board URL with pin list)
   */
  private formatPinterestBoardEmbedded(archive: PostData): string | null {
    if (archive.platform !== 'pinterest') return null;

    const raw = archive.raw as any;
    const boardData = Array.isArray(raw) ? raw[0] : raw;
    const pins: any[] = Array.isArray(boardData?.pins) ? boardData.pins : [];

    // Require board metadata to avoid mis-formatting single pins
    if (!boardData?.board_name && pins.length === 0) {
      return null;
    }

    const boardName = boardData?.board_name || archive.title || archive.author.name || 'Pinterest Board';
    const boardUrl = boardData?.board_url || archive.url;
    const creatorName = boardData?.creator_name || archive.author.name;
    const creatorUrl = boardData?.creator_url || archive.author.url || archive.url;
    const pinCount = boardData?.pin_count || boardData?.expected_pin_count || pins.length || archive.metadata?.comments;

    let section = `<!-- Embedded: Pinterest Board - ${creatorName} -->\n\n`;
    section += `## 📌 Pinterest Board — [${boardName}](${boardUrl})\n\n`;
    section += `**Owner:** [${creatorName}](${creatorUrl})`;
    if (pinCount) {
      section += ` | **Pins:** ${this.dateNumberFormatter.formatNumber(pinCount)}`;
    }
    section += `\n\n`;

    if (pins.length > 0) {
      section += `Pins:\n`;
      pins.forEach((pin, index) => {
        const title = pin.pin_title || `Pin ${index + 1}`;
        const url = pin.pin_url || '';
        section += `${index + 1}. ${title}\n`;
        if (url) {
          section += `${url}\n`;
        }
        section += `\n`;
      });
    } else if (archive.content?.text?.trim()) {
      // Fallback to text if pin list is missing
      section += `${archive.content.text.trim()}\n\n`;
    }

    // Media (if exists)
    if (archive.media && archive.media.length > 0) {
      section += `**Media:**\n`;
      for (const media of archive.media) {
        const relativePath = media.url.startsWith('attachments/')
          ? `../../../../${media.url}`
          : media.url;

        if (media.type === 'image') {
          const altText = media.altText || media.alt || 'Image';
          section += `![${altText}](${relativePath})\n`;
        } else if (media.type === 'video') {
          section += `![🎥 Video](${relativePath})\n`;
        }
      }
      section += `\n`;
    }

    // Metadata
    section += `---\n\n`;
    const published = archive.metadata?.timestamp
      ? this.dateNumberFormatter.formatDate(archive.metadata.timestamp)
      : '';
    let metadataLine = `**Platform:** Pinterest | **Author:** [${creatorName}](${creatorUrl})`;
    if (published) {
      metadataLine += ` | **Published:** ${published}`;
    }
    section += metadataLine + `\n\n`;
    section += `**Original URL:** ${boardUrl}\n`;

    return section;
  }

  /**
   * Format quoted/shared/reblogged post into markdown
   * @param quotedPost - Quoted post data to format
   * @param isReblog - Whether this is a reblog/repost (vs quote/share)
   * @returns Formatted markdown string
   */
  private formatQuotedPost(
    quotedPost: Omit<PostData, 'quotedPost' | 'embeddedArchives'>,
    isReblog?: boolean,
    expiredMedia?: import('./MediaPlaceholderGenerator').MediaExpiredResult[]
  ): string {
    const platformName = getPlatformName(quotedPost.platform);
    const authorName = quotedPost.author.name;

    // Use different header for reblog vs share
    const headerEmoji = isReblog ? '🔄' : '🔗';
    const headerText = isReblog ? 'Reblogged Post' : 'Shared Post';
    let section = `## ${headerEmoji} ${headerText}\n\n`;
    section += `### ${platformName} - ${authorName}\n\n`;

    // Content as plain text (hashtags are already included in text)
    const contentText = quotedPost.content.text.trim();
    if (contentText) {
      section += `${contentText}\n\n`;
    }

    // External link preview (if exists) - render before media
    if (quotedPost.metadata.externalLink) {
      const linkTitle = quotedPost.metadata.externalLinkTitle || quotedPost.metadata.externalLink;
      section += `🔗 **Link:** [${linkTitle}](${quotedPost.metadata.externalLink})\n`;
      if (quotedPost.metadata.externalLinkDescription) {
        section += `> ${quotedPost.metadata.externalLinkDescription}\n`;
      }
      // Render external link preview image if available (downloaded by ArchiveOrchestrator)
      if (quotedPost.metadata.externalLinkImage) {
        const imagePath = quotedPost.metadata.externalLinkImage;
        const relativePath = imagePath.startsWith('attachments/')
          ? `../../../../${imagePath}`
          : imagePath;
        section += `![Link Preview](${encodePathForMarkdownLink(relativePath)})\n`;
      }
      section += `\n`;
    }

    // Media (if exists) - keep consistent with embedded archive format so parsers build media arrays
    if (quotedPost.media && quotedPost.media.length > 0) {
      section += `**Media:**\n`;
      for (let i = 0; i < quotedPost.media.length; i++) {
        const media = quotedPost.media[i]!;

        // Check if this media item is expired
        const expired = expiredMedia?.find(e => e.originalUrl === media.url);
        if (expired) {
          section += MediaPlaceholderGenerator.generatePlaceholder(expired, i) + '\n';
          continue;
        }

        // Convert to relative path for local attachments
        const relativePath = media.url.startsWith('attachments/')
          ? `../../../../${media.url}`
          : media.url;

        if (media.type === 'image') {
          const altText = media.altText || media.alt || 'Image';
          section += `![${altText}](${encodePathForMarkdownLink(relativePath)})\n`;
        } else if (media.type === 'video') {
          section += `![🎥 Video](${encodePathForMarkdownLink(relativePath)})\n`;
        }
      }
      section += `\n`;
    }

    // Metadata
    section += `---\n\n`;
    const authorUrl = quotedPost.author.url || quotedPost.url;

    let metadataLine = `**Platform:** ${platformName} | **Author:** [${authorName}](${authorUrl}) | **Published:** ${this.dateNumberFormatter.formatDate(quotedPost.metadata.timestamp)}`;

    if (quotedPost.metadata.likes !== undefined) {
      metadataLine += ` | **Likes:** ${this.dateNumberFormatter.formatNumber(quotedPost.metadata.likes)}`;
    }
    if (quotedPost.metadata.comments !== undefined) {
      metadataLine += ` | **Comments:** ${this.dateNumberFormatter.formatNumber(quotedPost.metadata.comments)}`;
    }
    if (quotedPost.metadata.shares !== undefined) {
      metadataLine += ` | **Shares:** ${this.dateNumberFormatter.formatNumber(quotedPost.metadata.shares)}`;
    }

    section += metadataLine + `\n\n`;
    section += `**Original URL:** ${quotedPost.url}\n`;

    return section;
  }

  /**
   * Get platform icon emoji
   * @param platform - Platform name
   * @returns Emoji icon
   */
  private _getPlatformIcon(platform: Platform): string {
    const icons: Record<Platform, string> = {
      facebook: '📘',
      instagram: '📷',
      x: '🐦',
      linkedin: '💼',
      tiktok: '🎵',
      threads: '🧵',
      youtube: '📺',
      reddit: '🤖',
      pinterest: '📌',
      substack: '📰',
      tumblr: '🌀',
      mastodon: '🐘',
      bluesky: '🌌',
      googlemaps: '📍',
      velog: '🌱',
      podcast: '🎙️',
      blog: '📝',
      medium: '📖',
      naver: '🇰🇷',
      'naver-webtoon': '📖',
      webtoons: '📚',
      brunch: '📝',
      post: '📝'
    };
    return icons[platform] || '🔗';
  }

  /**
   * Prepare data for template engine
   * @param postData - Post data
   * @param mediaResults - Downloaded media results (optional)
   */
  private prepareTemplateData(
    postData: PostData,
    mediaResults?: import('./MediaHandler').MediaResult[]
  ): Record<string, any> {
    // Generate author mention for Instagram
    const authorMention = postData.platform === 'instagram' && postData.author.handle
      ? `[@${postData.author.handle}](https://instagram.com/${postData.author.handle})`
      : postData.author.name;

    // Format transcript for YouTube (body only — template provides the ## heading)
    const transcriptEntries = postData.transcript?.formatted;
    const hasFormattedTranscript = Array.isArray(transcriptEntries) && transcriptEntries.length > 0;
    const transcriptBody = hasFormattedTranscript
      ? this.transcriptFormatter.formatBrightDataTranscript(transcriptEntries, postData.videoId)
      : undefined;
    // Include raw transcript above formatted timestamps if available
    const rawTranscript = postData.transcript?.raw?.trim();
    const formattedTranscript = rawTranscript && transcriptBody
      ? `**Full Transcript:**\n\n${rawTranscript}\n\n---\n\n${transcriptBody}`
      : transcriptBody || (rawTranscript ? rawTranscript : undefined);

    // Format media to string BEFORE spreading postData
    const formattedMedia = this.mediaFormatter.formatMedia(
      postData.media, postData.platform, postData.url, mediaResults,
      (postData as any)._expiredMedia
    );

    // Format embedded archives (for platform: 'post' only)
    const formattedEmbeddedArchives = postData.embeddedArchives && postData.embeddedArchives.length > 0
      ? this.formatEmbeddedArchives(postData.embeddedArchives)
      : undefined;

    // Format quoted/shared/reblogged post (for Facebook, X, Threads, Mastodon, Bluesky)
    const formattedQuotedPost = postData.quotedPost
      ? this.formatQuotedPost(postData.quotedPost, postData.isReblog, (postData as any)._expiredMedia)
      : undefined;

    const normalizeHashtagForObsidian = (tag: string) => {
      const clean = tag.startsWith('#') ? tag.slice(1) : tag;
      // Obsidian hashtags cannot include spaces; replace with hyphen for display and link consistency
      return `#${clean.replace(/\s+/g, '-')}`;
    };

    const rawHashtagsArray = Array.isArray(postData.content.hashtags) ? postData.content.hashtags : undefined;
    const uniqueHashtags = rawHashtagsArray
      ? Array.from(new Set(rawHashtagsArray.map(tag => tag.trim()).filter(Boolean)))
      : undefined;
    const normalizedHashtags = uniqueHashtags?.map(normalizeHashtagForObsidian);
    const hashtagsText = normalizedHashtags && normalizedHashtags.length > 0
      ? normalizedHashtags.join(' ')
      : undefined;

    // For Tumblr: remove hashtags from content.text if they're in the hashtags array
    // (hashtags will be displayed separately in the hashtagsText section)
    let contentText = postData.content.text || '';
    if (postData.platform === 'tumblr' && uniqueHashtags && uniqueHashtags.length > 0 && contentText) {
      // Remove hashtags from text (they're displayed separately)
      // Match both plain hashtags (#tag) and markdown link format ([#tag](url))
      uniqueHashtags.forEach(tag => {
        const plainTag = tag.startsWith('#') ? tag : `#${tag}`;
        // Remove markdown link format: [#tag](url)
        const linkPattern = new RegExp(`\\[${plainTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\([^)]+\\)`, 'g');
        contentText = contentText.replace(linkPattern, '');
        // Remove plain hashtag format: #tag
        const plainPattern = new RegExp(`${plainTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'g');
        contentText = contentText.replace(plainPattern, '');
      });
      contentText = contentText.trim();
    }

    let baseText = contentText && contentText.trim().length > 0
      ? (postData.platform === 'instagram'
        ? this.textFormatter.linkifyInstagramMentions(contentText)
        : postData.platform === 'x'
        ? this.textFormatter.linkifyXMentions(contentText)
        : postData.platform === 'youtube' && postData.videoId
        ? this.textFormatter.linkifyYouTubeTimestamps(contentText, postData.videoId)
        : contentText)
      : hashtagsText || '';

    // X Article: append rendered article body (content.html contains Draft.js → Markdown)
    const isXArticle = postData.platform === 'x' && !!postData.content.html;
    if (isXArticle) {
      const articleBody = postData.content.html!;
      baseText = baseText
        ? `${baseText}\n\n---\n\n${articleBody}`
        : articleBody;
    }

    // For RSS-based platforms: replace {{IMAGE_N}} and {{VIDEO_N}} placeholders with actual embeds
    let blogMediaUsedInline = false;
    if (isRssBasedPlatform(postData.platform) && mediaResults && mediaResults.length > 0) {
      // Replace IMAGE placeholders with Obsidian image embeds
      // Include surrounding newlines to ensure proper paragraph separation
      baseText = baseText.replace(/\n*\{\{IMAGE_(\d+)\}\}\n*/g, (_, indexStr) => {
        const index = parseInt(indexStr, 10);
        const mediaResult = mediaResults[index];
        if (mediaResult?.localPath) {
          blogMediaUsedInline = true;
          // Use Obsidian embed syntax with just filename
          const filename = mediaResult.localPath.split('/').pop() || mediaResult.localPath;
          return `\n\n![[${filename}]]\n\n`;
        }
        return '\n\n'; // Keep paragraph break if no media found
      });

      // Replace VIDEO placeholders with Obsidian video embeds
      baseText = baseText.replace(/\n*\{\{VIDEO_(\d+)\}\}\n*/g, (_, indexStr) => {
        const index = parseInt(indexStr, 10);
        const mediaResult = mediaResults[index];
        if (mediaResult?.localPath) {
          blogMediaUsedInline = true;
          // Use Obsidian embed syntax with just filename
          const filename = mediaResult.localPath.split('/').pop() || mediaResult.localPath;
          return `\n\n![[${filename}]]\n\n`;
        }
        return '\n\n'; // Keep paragraph break if no video found
      });

      // Clean up excessive newlines that may result from replacement
      baseText = baseText.replace(/\n{3,}/g, '\n\n');
    }

    // For RSS-based platforms, also check if text already contains inline markdown images
    // (e.g., Naver cafe posts already have ![Image](...) in text, not placeholders)
    if (isRssBasedPlatform(postData.platform) && !blogMediaUsedInline) {
      // Check for markdown image syntax: ![alt](url) or ![](url)
      const hasInlineMarkdownImages = /!\[[^\]]*\]\([^)]+\)/.test(baseText);
      if (hasInlineMarkdownImages) {
        blogMediaUsedInline = true;
      }
    }

    // For RSS-based platforms and X Articles, preserve markdown headings (they come from HTML/Draft.js conversion)
    // For other platforms, escape headings to prevent rendering issues
    const preserveHeadings = isRssBasedPlatform(postData.platform) || isXArticle;
    const sanitizedText = preserveHeadings
      ? this.escapeOrderedListPatterns(baseText)
      : this.escapeOrderedListPatterns(this.escapeLeadingMarkdownHeadings(baseText));

    // For RSS-based platforms with inline images, don't show media section at bottom
    const finalMedia = (isRssBasedPlatform(postData.platform) && blogMediaUsedInline) ? '' : formattedMedia;

    // Format series genre array as comma-separated string (for naver-webtoon template)
    const seriesGenre = postData.series?.genre?.length
      ? postData.series.genre.join(', ')
      : undefined;

    return {
      ...postData,
      authorMention,
      seriesGenre,  // Formatted genre string for naver-webtoon template
      content: {
        ...postData.content,
        text: sanitizedText,
        hashtagsText,
      },
      metadata: {
        ...postData.metadata,
        timestamp: this.dateNumberFormatter.formatDate(postData.metadata.timestamp),
        editedAt: postData.metadata.editedAt ? this.dateNumberFormatter.formatDate(postData.metadata.editedAt) : undefined,
        likes: postData.metadata.likes ? this.dateNumberFormatter.formatNumber(postData.metadata.likes) : undefined,
        comments: postData.metadata.comments ? this.dateNumberFormatter.formatNumber(postData.metadata.comments) : undefined,
        shares: postData.metadata.shares ? this.dateNumberFormatter.formatNumber(postData.metadata.shares) : undefined,
        views: postData.metadata.views ? this.dateNumberFormatter.formatNumber(postData.metadata.views) : undefined,
        duration: postData.metadata.duration ? this.dateNumberFormatter.formatDuration(postData.metadata.duration) : undefined,
        // Podcast-specific metadata
        episode: postData.metadata.episode,
        season: postData.metadata.season,
        subtitle: postData.metadata.subtitle,
        hosts: postData.metadata.hosts?.join(', '),
        guests: postData.metadata.guests?.join(', '),
        explicit: postData.metadata.explicit,
      },
      media: finalMedia,  // Use formatted string, not original array (empty for blog with inline images)
      comments: this.commentFormatter.formatComments(postData.comments, postData.platform),
      transcript: formattedTranscript,  // Formatted transcript for YouTube
      embeddedArchives: formattedEmbeddedArchives,  // Formatted embedded archives
      quotedPost: formattedQuotedPost,  // Formatted quoted/shared post
      ai: postData.ai ? {
        ...postData.ai,
        topics: postData.ai.topics && postData.ai.topics.length > 0
          ? postData.ai.topics.join(', ')
          : undefined,
        factCheck: this.factCheckFormatter.formatFactChecks(postData.ai.factCheck),
      } : undefined,
    };
  }

  /**
   * Extract YouTube video ID from URL
   */
  private _extractYouTubeVideoId(url: string): string | null {
    try {
      const urlObj = new URL(url);

      // Standard youtube.com/watch?v=VIDEO_ID
      if (urlObj.hostname.includes('youtube.com')) {
        const videoId = urlObj.searchParams.get('v');
        if (videoId) return videoId;

        // youtube.com/embed/VIDEO_ID or youtube.com/shorts/VIDEO_ID
        const pathMatch = urlObj.pathname.match(/\/(embed|shorts|live)\/([A-Za-z0-9_-]+)/);
        if (pathMatch) return pathMatch[2] || null;
      }

      // Shortened youtu.be/VIDEO_ID
      if (urlObj.hostname === 'youtu.be') {
        const match = urlObj.pathname.match(/\/([A-Za-z0-9_-]+)/);
        return match ? (match[1] || null) : null;
      }

      return null;
    } catch {
      return null;
    }
  }

  private escapeLeadingMarkdownHeadings(text: string): string {
    if (!text) {
      return text;
    }

    return text.replace(/^([ \t>]*)(#+)(?=\s|$)/gm, (_match, prefix: string, hashes: string) => {
      const escapedHashes = hashes.replace(/#/g, '\\#');
      return `${prefix}${escapedHashes}`;
    });
  }

  /**
   * Escape ordered list patterns in text to prevent markdown parsing
   * "2025. 11. 6" would be parsed as nested ordered lists without escaping
   */
  private escapeOrderedListPatterns(text: string): string {
    if (!text) {
      return text;
    }

    // Escape "number. " at the start of a line (ordered list syntax)
    // Pattern: line start, optional whitespace, number, period, space
    return text.replace(/^(\s*)(\d+)\. /gm, '$1$2\\. ');
  }
}
