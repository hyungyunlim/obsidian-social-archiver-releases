import type { Platform } from '@/types/post';

/**
 * Normalized author profile data extracted from platform-specific API responses
 */
export interface AuthorProfileData {
  avatarUrl: string | null;
  followers: number | null;
  postsCount: number | null;
  bio: string | null;
  verified: boolean;
}

/**
 * ProfileDataMapper - Extracts and normalizes author profile data from platform-specific API responses
 *
 * Single Responsibility: Platform-specific field mapping to unified AuthorProfileData format
 *
 * Usage:
 * ```typescript
 * const rawData = await brightDataClient.scrape(url);
 * const profileData = ProfileDataMapper.mapPlatformData('x', rawData);
 * ```
 *
 * Field mappings are based on actual BrightData API responses:
 * - X: profile_image_link, followers, posts_count, biography, is_verified/verification_type
 * - TikTok: profile_avatar, profile_followers, is_verified
 * - YouTube: avatar_img_channel, subscribers, verified (bio from profile crawl only)
 * - Instagram: profile_image_link, followers, posts_count, is_verified
 * - Facebook: avatar_image_url, page_followers, page_is_verified
 * - Threads: No avatar/followers data available
 * - Pinterest: followers (no avatar in single post response)
 * - Tumblr: author_avatar
 * - Bluesky: author_avatar
 * - Substack: author_image
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- utility class with only static methods; instantiation not needed
export class ProfileDataMapper {
  /**
   * Map platform-specific API response to normalized AuthorProfileData
   *
   * @param platform - Social media platform
   * @param rawData - Raw API response data (typically from BrightData)
   * @returns Normalized AuthorProfileData with null for unavailable fields
   */
  static mapPlatformData(
    platform: Platform,
    rawData: unknown
  ): AuthorProfileData {
    if (!rawData || typeof rawData !== 'object') {
      return this.emptyProfile();
    }

    const data = rawData as Record<string, unknown>;

    switch (platform) {
      case 'x':
        return this.mapXProfile(data);

      case 'tiktok':
        return this.mapTikTokProfile(data);

      case 'youtube':
        return this.mapYouTubeProfile(data);

      case 'instagram':
        return this.mapInstagramProfile(data);

      case 'facebook':
        return this.mapFacebookProfile(data);

      case 'threads':
        return this.mapThreadsProfile(data);

      case 'pinterest':
        return this.mapPinterestProfile(data);

      case 'tumblr':
        return this.mapTumblrProfile(data);

      case 'bluesky':
        return this.mapBlueskyProfile(data);

      case 'substack':
        return this.mapSubstackProfile(data);

      case 'linkedin':
        return this.mapLinkedInProfile(data);

      case 'reddit':
        return this.mapRedditProfile(data);

      case 'mastodon':
        return this.mapMastodonProfile(data);

      case 'googlemaps':
        return this.mapGoogleMapsProfile(data);

      case 'post':
        // User-created posts don't have platform profile data
        return this.emptyProfile();

      default:
        return this.emptyProfile();
    }
  }

  /**
   * X (Twitter) profile mapping
   * Fields: profile_image_link, followers, posts_count, biography, is_verified/verification_type
   */
  private static mapXProfile(data: Record<string, unknown>): AuthorProfileData {
    // Handle verification - can be boolean is_verified or string verification_type
    let verified = false;
    if (data.is_verified === true) {
      verified = true;
    } else if (typeof data.verification_type === 'string' && data.verification_type !== '') {
      verified = true; // e.g., "blue", "government", etc.
    }

    return {
      avatarUrl: this.extractString(data.profile_image_link),
      followers: this.extractNumber(data.followers),
      postsCount: this.extractNumber(data.posts_count),
      bio: this.extractString(data.biography),
      verified,
    };
  }

  /**
   * TikTok profile mapping
   * Fields: profile_avatar, profile_followers, is_verified
   */
  private static mapTikTokProfile(data: Record<string, unknown>): AuthorProfileData {
    return {
      avatarUrl: this.extractString(data.profile_avatar),
      followers: this.extractNumber(data.profile_followers),
      postsCount: null, // Not provided by TikTok API
      bio: null, // Not consistently provided
      verified: data.is_verified === true,
    };
  }

  /**
   * YouTube profile mapping
   * Video response fields: avatar_img_channel, subscribers, verified
   * Profile crawl fields: profile_image, subscribers, Description (capital D), videos_count
   *
   * Note: 'description' (lowercase) in video response is VIDEO description, not channel bio.
   *       'Description' (capital D) in profile crawl response is channel bio.
   */
  private static mapYouTubeProfile(data: Record<string, unknown>): AuthorProfileData {
    // Avatar: profile_image (profile crawl) or avatar_img_channel (video response)
    const avatarUrl = this.extractString(data.profile_image) ??
                      this.extractString(data.avatar_img_channel);

    // Bio: Description (capital D, from profile crawl) - NOT description (lowercase, video desc)
    const bio = this.extractString(data.Description);

    // Posts count: videos_count (from profile crawl)
    const postsCount = this.extractNumber(data.videos_count);

    return {
      avatarUrl,
      followers: this.extractNumber(data.subscribers),
      postsCount,
      bio,
      verified: data.verified === true,
    };
  }

  /**
   * Instagram profile mapping
   * Fields: profile_image_link, followers, posts_count, is_verified
   */
  private static mapInstagramProfile(data: Record<string, unknown>): AuthorProfileData {
    return {
      avatarUrl: this.extractString(data.profile_image_link),
      followers: this.extractNumber(data.followers),
      postsCount: this.extractNumber(data.posts_count),
      bio: null, // Not provided in post response
      verified: data.is_verified === true,
    };
  }

  /**
   * Facebook profile mapping
   * Fields: avatar_image_url, page_logo (fallback), page_followers, page_likes (fallback), page_is_verified
   * Bio: page_intro + about array (WORK, EDUCATION, CURRENT CITY, HOMETOWN, INFLUENCER CATEGORY)
   */
  private static mapFacebookProfile(data: Record<string, unknown>): AuthorProfileData {
    // Avatar can be in avatar_image_url or page_logo
    const avatarUrl = this.extractString(data.avatar_image_url) ??
                      this.extractString(data.page_logo) ??
                      this.extractString(data.profile_photo);

    // Followers can be in page_followers or page_likes
    const followers = this.extractNumber(data.page_followers) ??
                      this.extractNumber(data.page_likes);

    // Build bio from page_intro and/or about array
    const bio = this.extractFacebookBio(data);

    return {
      avatarUrl,
      followers,
      postsCount: null, // Not provided
      bio,
      verified: data.page_is_verified === true,
    };
  }

  /**
   * Extract Facebook bio from page_intro and about array
   * Same logic as BrightDataService.parseFacebookPost() in workers
   */
  private static extractFacebookBio(data: Record<string, unknown>): string | null {
    let bio = this.extractString(data.page_intro) || '';

    const about = data.about;
    if (Array.isArray(about) && about.length > 0) {
      const aboutParts: string[] = [];
      for (const item of about) {
        if (!item || typeof item !== 'object') continue;
        const itemObj = item as Record<string, unknown>;
        const value = this.extractString(itemObj.value);
        if (!value) continue;

        const type = (typeof itemObj.type === 'string' ? itemObj.type : '').toUpperCase();
        // Include relevant fields
        if (type === 'WORK' || type === 'EDUCATION' || type === 'CURRENT CITY' ||
            type === 'HOMETOWN' || type === 'INFLUENCER CATEGORY') {
          aboutParts.push(value);
        }
      }
      if (aboutParts.length > 0) {
        bio = bio
          ? `${bio}\n\n${aboutParts.join(' · ')}`
          : aboutParts.join(' · ');
      }
    }

    // Clean up Facebook bio - remove generic prefixes
    if (bio) {
      bio = this.cleanFacebookBio(bio);
    }

    return bio || null;
  }

  /**
   * Clean up Facebook bio by removing generic/unhelpful prefixes
   */
  private static cleanFacebookBio(bio: string): string {
    // Remove "Profile · " prefix (case insensitive)
    let cleaned = bio.replace(/^Profile\s*·\s*/i, '');

    // Remove standalone "Blogger · ", "Creator · " etc. at the start if followed by more content
    cleaned = cleaned.replace(/^(Blogger|Creator|Public Figure|Artist|Musician|Writer|Author)\s*·\s*/i, '');

    return cleaned.trim();
  }

  /**
   * Threads profile mapping
   * Note: Threads API doesn't provide avatar or followers in post response
   */
  private static mapThreadsProfile(data: Record<string, unknown>): AuthorProfileData {
    return {
      avatarUrl: null, // Not provided
      followers: null, // Not provided
      postsCount: null, // Not provided
      bio: this.extractString(data.bio),
      verified: false, // Not provided
    };
  }

  /**
   * Pinterest profile mapping
   * Fields: profile_picture, followers/follower_count, boards_num
   */
  private static mapPinterestProfile(data: Record<string, unknown>): AuthorProfileData {
    const followers = this.extractNumber(data.follower_count) ??
                      this.extractNumber(data.followers);

    return {
      avatarUrl: this.extractString(data.profile_picture),
      followers,
      postsCount: this.extractNumber(data.boards_num),
      bio: this.extractString(data.about),
      verified: false, // Pinterest doesn't have verified badges in API
    };
  }

  /**
   * Tumblr profile mapping
   * Fields: author_avatar
   */
  private static mapTumblrProfile(data: Record<string, unknown>): AuthorProfileData {
    return {
      avatarUrl: this.extractString(data.author_avatar),
      followers: null, // Not provided in post response
      postsCount: null, // Not provided
      bio: this.extractString(data.description),
      verified: false, // Tumblr doesn't have verified badges
    };
  }

  /**
   * Bluesky profile mapping
   * Fields: author_avatar
   */
  private static mapBlueskyProfile(data: Record<string, unknown>): AuthorProfileData {
    return {
      avatarUrl: this.extractString(data.author_avatar),
      followers: null, // Not provided in post response
      postsCount: null, // Not provided
      bio: this.extractString(data.description),
      verified: false, // Bluesky doesn't have verified badges in same sense
    };
  }

  /**
   * Substack profile mapping
   * Fields: author_image, author_bio
   */
  private static mapSubstackProfile(data: Record<string, unknown>): AuthorProfileData {
    return {
      avatarUrl: this.extractString(data.author_image),
      followers: null, // Not provided
      postsCount: null, // Not provided
      bio: this.extractString(data.author_bio),
      verified: false, // Substack doesn't have verified badges
    };
  }

  /**
   * LinkedIn profile mapping
   * Note: LinkedIn API response varies; avatar may not be consistently available
   */
  private static mapLinkedInProfile(data: Record<string, unknown>): AuthorProfileData {
    const followers = this.extractNumber(data.page_followers);

    return {
      avatarUrl: this.extractString(data.avatar_image_url),
      followers,
      postsCount: null, // Not provided
      bio: this.extractString(data.about),
      verified: false, // LinkedIn verification not in API
    };
  }

  /**
   * Reddit profile mapping
   * BrightData Reddit Subreddit Posts API fields:
   * - user_posted: author username
   * - community_name: subreddit name (r/xxx)
   * - num_upvotes: upvote count
   * - num_comments: comment count
   * - For subreddit metadata (from profile crawl): members, public_description
   *
   * Note: Individual post responses don't include author avatar/bio.
   *       'description' in post response is POST BODY TEXT, NOT author bio!
   *       Only 'public_description' from subreddit metadata is the subreddit description.
   */
  private static mapRedditProfile(data: Record<string, unknown>): AuthorProfileData {
    // For subreddit profile crawl responses
    const followers = this.extractNumber(data.members) ??
                      this.extractNumber(data.subscribers);

    // ONLY use public_description for subreddit bio
    // Do NOT use 'description' - that's the post body text, not subreddit/user bio
    const bio = this.extractString(data.public_description);

    return {
      avatarUrl: this.extractString(data.community_icon) ??
                 this.extractString(data.icon_img) ??
                 this.extractString(data.author_avatar),
      followers,
      postsCount: null, // Not provided
      bio,
      verified: false, // Reddit doesn't have verified badges in same sense
    };
  }

  /**
   * Mastodon profile mapping
   * Fields: author_avatar
   */
  private static mapMastodonProfile(data: Record<string, unknown>): AuthorProfileData {
    return {
      avatarUrl: this.extractString(data.author_avatar) ??
                 this.extractString(data.profile_avatar),
      followers: this.extractNumber(data.followers_count),
      postsCount: this.extractNumber(data.statuses_count),
      bio: this.extractString(data.note) ?? this.extractString(data.bio),
      verified: false, // Mastodon verification is domain-based, not in API flag
    };
  }

  /**
   * Google Maps profile mapping
   * Fields: main_image (place photo), rating, reviews_count, is_claimed
   */
  private static mapGoogleMapsProfile(data: Record<string, unknown>): AuthorProfileData {
    return {
      avatarUrl: this.extractString(data.main_image),
      followers: null, // Google Maps doesn't have followers
      postsCount: this.extractNumber(data.reviews_count), // Use reviews as "posts"
      bio: this.extractString(data.description) ?? this.extractString(data.about),
      verified: data.is_claimed === true, // Claimed business = verified
    };
  }

  /**
   * Return an empty profile with all null values
   */
  private static emptyProfile(): AuthorProfileData {
    return {
      avatarUrl: null,
      followers: null,
      postsCount: null,
      bio: null,
      verified: false,
    };
  }

  /**
   * Safely extract a string value from unknown data
   */
  private static extractString(value: unknown): string | null {
    if (typeof value === 'string' && value.trim() !== '') {
      return value;
    }
    return null;
  }

  /**
   * Safely extract a number value from unknown data
   * Handles both number and string representations
   */
  private static extractNumber(value: unknown): number | null {
    if (typeof value === 'number' && !isNaN(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = parseInt(value, 10);
      if (!isNaN(parsed)) {
        return parsed;
      }
    }
    return null;
  }
}
