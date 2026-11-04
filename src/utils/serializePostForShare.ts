import type { Comment, PostData, PostMetadata } from '../types/post';

/**
 * PostData for a share request: values cloned, timestamps as ISO strings,
 * media optionally stripped. Shared by share creation and the AI comment
 * share update (moved out of PostCardRenderer unchanged).
 */
export function serializePostForShare(post: PostData, options: { stripMedia?: boolean } = {}): PostData {
  const stripMedia = options.stripMedia ?? false;
  return {
    ...post,
    author: { ...post.author },
    content: { ...post.content },
    media: stripMedia ? [] : (post.media?.map((media) => ({ ...media })) ?? []),
    metadata: serializePostMetadata(post.metadata),
    comments: cloneComments(post.comments),
    embeddedArchives: post.embeddedArchives?.map((archive) => serializePostForShare(archive)),
    quotedPost: post.quotedPost ? serializePostForShare(post.quotedPost) : undefined,
  };
}

function serializePostMetadata(metadata: PostMetadata): PostMetadata {
  const timestamp = typeof metadata.timestamp === 'string' ? metadata.timestamp : metadata.timestamp.toISOString();
  const editedAt = metadata.editedAt
    ? (typeof metadata.editedAt === 'string' ? metadata.editedAt : metadata.editedAt.toISOString())
    : undefined;
  return { ...metadata, timestamp, editedAt };
}

function cloneComments(comments?: Comment[]): Comment[] | undefined {
  if (!comments) return undefined;
  return comments.map((comment) => ({
    ...comment,
    author: { ...comment.author },
    replies: cloneComments(comment.replies),
  }));
}
