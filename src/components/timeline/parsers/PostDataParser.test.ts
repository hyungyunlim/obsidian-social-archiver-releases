import { describe, expect, it, vi } from 'vitest';
import { TFile, type Vault } from 'obsidian';
import { PostDataParser } from './PostDataParser';

describe('PostDataParser - Facebook shared posts inside embedded archives', () => {
  const parser = new PostDataParser({} as any);

  const markdown = `---
platform: post
author: tester
published: 2024-11-11
---

This is a user post.

---

## 📦 Referenced Social Media Posts

### Facebook - bagtaeung.561890

Original post body that should remain visible.

## 🔗 Shared Post

### Facebook - shared.author

Shared post body that should only render once.

**Media:**
![Shared Image](attachments/shared.jpg)

---

**Platform:** Facebook | **Author:** [shared.author](https://facebook.com/shared) | **Published:** 2024-11-10 | **Likes:** 5 | **Comments:** 2 | **Shares:** 1

**Original URL:** https://facebook.com/shared

---

**Platform:** Facebook | **Author:** [박태웅](https://facebook.com/original) | **Published:** 2024-11-11 | **Likes:** 10 | **Comments:** 4 | **Shares:** 2

**Original URL:** https://facebook.com/original

---

**Author:** tester
`;

  it('parses only one embedded archive and keeps quoted post data attached', () => {
    const archives = (parser as any).extractEmbeddedArchives(markdown, [], []);

    expect(archives).toHaveLength(1);
    expect(archives[0].author.name).toBe('박태웅');
    expect(archives[0].author.handle).toBe('bagtaeung.561890');
    expect(archives[0].content.text).toBe('Original post body that should remain visible.');
    expect(archives[0].media?.length ?? 0).toBe(0);
    expect(archives[0].quotedPost?.author.name).toBe('shared.author');
    expect(archives[0].quotedPost?.content.text).toBe('Shared post body that should only render once.');
    expect(archives[0].quotedPost?.media?.[0]?.url).toBe('attachments/shared.jpg');
  });

  it('preserves embedded archive media even when content contains multiple separators', () => {
    const complexMarkdown = `
## 📦 Referenced Social Media Posts

### Facebook - Jin Kyu Kang

첫 번째 문단입니다.

---

두 번째 문단에선 인용을 이어갑니다.

**Media:**
![Image](../../../../attachments/social-archives/facebook/sample-1.webp)
![Image](../../../../attachments/social-archives/facebook/sample-2.webp)

---

**Platform:** Facebook | **Author:** [진규](https://facebook.com/jinkyu) | **Published:** 2025-11-09 17:25 | **Likes:** 98 | **Comments:** 9 | **Shares:** 84

**Original URL:** https://facebook.com/post`;

    const archives = (parser as any).extractEmbeddedArchives(complexMarkdown, [], []);

    expect(archives).toHaveLength(1);
    expect(archives[0].content.text).toContain('두 번째 문단에선');
    expect(archives[0].media?.length).toBe(2);
    expect(archives[0].media?.[0]?.url).toBe('attachments/social-archives/facebook/sample-1.webp');
  });

  it('ignores quoted post sections that live inside the embedded archives section for top-level posts', () => {
    const [mainContentBeforeArchives] = markdown.split(/(?:\n|^)## (?:📦 )?Referenced Social Media Posts/);
    const quotedPost = (parser as any).extractQuotedPost(mainContentBeforeArchives);

    expect(quotedPost).toBeUndefined();
  });
});

describe('PostDataParser - metadata footer', () => {
  const parser = new PostDataParser({} as any);

  it('maps LinkedIn Reactions and Reposts footer labels to engagement metadata', () => {
    const metadata = parser.extractMetadata(
      '**Platform:** LinkedIn | **Published:** 2026-06-12 | **Reactions:** 55 | **Comments:** 12 | **Reposts:** 3'
    );

    expect(metadata).toEqual({ likes: 55, comments: 12, shares: 3 });
  });
});

describe('PostDataParser - archive media notes', () => {
  it('preserves contentType and routes mp4 meeting-note attachments through the audio player path', async () => {
    const markdown = `---
platform: post
author: hyungyunlim
authorUrl: composed://hyungyunlim/0HY5sGucFgSTskp2K87c5
published: 2026-07-02 06:00
originalUrl: composed://hyungyunlim/0HY5sGucFgSTskp2K87c5
hasTranscript: true
contentType: meeting-note
---

Ready to transcribe on this iPhone

---

<!-- sa:media:start id=0HY5sGucFgSTskp2K87c5 -->
![[attachments/social-archives/post/0HY5sGucFgSTskp2K87c5/20260702-@hyungyunlim-0HY5sGucFgSTskp2K87c5-1.mp4]]
<!-- sa:media:end -->

---

## Transcript

[00:00] Speaker 2: 자 이제 미팅을 시작하겠습니다.

[00:03] 박기현 씨 오늘 무슨 2day와 무슨 이슈가 있었나요?
`;

    const vault = {
      cachedRead: vi.fn().mockResolvedValue(markdown),
    } satisfies Pick<Vault, 'cachedRead'>;
    const parser = new PostDataParser(vault as Vault);
    type TestTFileConstructor = new (path: string) => TFile;
    const TestTFile = TFile as TestTFileConstructor;
    const file = new TestTFile('Social Archives/User Post/2026/07/meeting-note.md');

    const post = await parser.parseFile(file);

    expect(post).toBeTruthy();
    expect(post?.contentType).toBe('meeting-note');
    expect(post?.media).toHaveLength(1);
    expect(post?.media[0]?.type).toBe('audio');
    expect(post?.media[0]?.url).toBe(
      'attachments/social-archives/post/0HY5sGucFgSTskp2K87c5/20260702-@hyungyunlim-0HY5sGucFgSTskp2K87c5-1.mp4'
    );
    expect(post?.whisperTranscript?.segments[0]?.text).toBe('Speaker 2: 자 이제 미팅을 시작하겠습니다.');
  });
});

describe('PostDataParser - quoted post media excluded from main post', () => {
  const sharedPostMarkdown = `---
platform: facebook
author: Jinseock Lim
authorUrl: "https://www.facebook.com/noamsaid"
published: 2026-02-10
---

Main post content without images.

---

## 🔗 Shared Post

### Facebook - 조성주

Shared post text.

**Media:**
![Image](../../../../attachments/social-archives/facebook/shared-image.webp)

---

**Platform:** Facebook | **Author:** [조성주](https://facebook.com/sungjucho21) | **Published:** 2026-02-10

**Original URL:** https://facebook.com/shared

---

**Platform:** Facebook | **Author:** [Jinseock Lim](https://facebook.com/noamsaid) | **Published:** 2026-02-10

**Original URL:** https://facebook.com/main
`;

  it('excludes quoted post media from main post media via regex fallback', async () => {
    const vault = {
      cachedRead: vi.fn().mockResolvedValue(sharedPostMarkdown),
    } as any;

    const parser = new PostDataParser(vault);
    const file = {
      basename: 'test-shared-post',
      path: 'Social Archives/Facebook/2026/02/test-shared-post.md',
      stat: { ctime: Date.now() },
    } as any;

    const post = await parser.parseFile(file);
    expect(post).toBeTruthy();
    // Main post should have no media (the image belongs to the quoted post)
    expect(post!.media).toHaveLength(0);
    // Quoted post should have the image
    expect(post!.quotedPost).toBeTruthy();
    expect(post!.quotedPost!.media).toHaveLength(1);
    expect(post!.quotedPost!.media[0]?.url).toContain('shared-image.webp');
  });

  it('excludes quoted post media from main post when using MetadataCache embeds', async () => {
    const vault = {
      cachedRead: vi.fn().mockResolvedValue(sharedPostMarkdown),
    } as any;

    // Calculate the offset of the image embed (inside the Shared Post section)
    const imageEmbedOffset = sharedPostMarkdown.indexOf('![Image](../../../../attachments');

    const app = {
      metadataCache: {
        getFileCache: vi.fn().mockReturnValue({
          frontmatter: {
            platform: 'facebook',
            author: 'Jinseock Lim',
            authorUrl: 'https://www.facebook.com/noamsaid',
            published: '2026-02-10',
          },
          embeds: [
            {
              link: 'shared-image.webp',
              original: '![Image](../../../../attachments/social-archives/facebook/shared-image.webp)',
              position: {
                start: { line: 0, col: 0, offset: imageEmbedOffset },
                end: { line: 0, col: 0, offset: imageEmbedOffset + 80 },
              },
            },
          ],
        }),
        getFirstLinkpathDest: vi.fn().mockReturnValue({
          path: 'attachments/social-archives/facebook/shared-image.webp',
        }),
      },
    } as any;

    const parser = new PostDataParser(vault, app);
    const file = {
      basename: 'test-shared-post',
      path: 'Social Archives/Facebook/2026/02/test-shared-post.md',
      stat: { ctime: Date.now() },
    } as any;

    const post = await parser.parseFile(file);
    expect(post).toBeTruthy();
    // Main post should have no media - the embed is inside the Shared Post section
    expect(post!.media).toHaveLength(0);
    // Quoted post should still have the image
    expect(post!.quotedPost).toBeTruthy();
    expect(post!.quotedPost!.media).toHaveLength(1);
  });
});

describe('PostDataParser - archiveTags display tags', () => {
  it('merges native tags and archiveTags for timeline display', async () => {
    const markdown = `---
platform: facebook
author: Test Author
authorUrl: https://facebook.com/test
originalUrl: https://facebook.com/test/posts/1
published: 2026-05-01
archived: 2026-05-02
tags:
  - local
  - Research
archiveTags:
  - research
  - synced
---

Body text.
`;
    const vault = {
      cachedRead: vi.fn().mockResolvedValue(markdown),
    } as any;
    const parser = new PostDataParser(vault);
    const file = {
      basename: 'archive-tags',
      path: 'Social Archives/Facebook/archive-tags.md',
      stat: { ctime: Date.now() },
    } as any;

    const post = await parser.parseFile(file);

    expect(post?.tags).toEqual(['local', 'Research', 'synced']);
    expect(post?.archiveTags).toEqual(['research', 'synced']);
  });
});

describe('PostDataParser - local-only provenance', () => {
  const makeFile = (basename: string) => ({
    basename,
    path: `Social Archives/Facebook/${basename}.md`,
    stat: { ctime: Date.parse('2026-05-02T00:00:00.000Z') },
  }) as any;

  it('marks notes with local-only import mode', async () => {
    const markdown = `---
platform: facebook
author: Test Author
authorUrl: https://facebook.com/test
originalUrl: https://facebook.com/test/posts/1
published: 2026-05-01
archived: 2026-05-02
social_archiver_import_mode: local-only
social_archiver_import_source: instagram-saved-import
social_archiver_server_archive_id: none
---

Body text.
`;
    const parser = new PostDataParser({ cachedRead: vi.fn().mockResolvedValue(markdown) } as any);

    const post = await parser.parseFile(makeFile('local-only'));

    expect(post?.isLocalOnly).toBe(true);
    expect(post?.metadata.socialArchiverImportMode).toBe('local-only');
    expect(post?.metadata.socialArchiverImportSource).toBe('instagram-saved-import');
    expect(post?.metadata.socialArchiverServerArchiveId).toBe('none');
  });

  it('treats sourceArchiveId as server-backed even when the marker remains', async () => {
    const markdown = `---
platform: facebook
author: Test Author
authorUrl: https://facebook.com/test
originalUrl: https://facebook.com/test/posts/1
published: 2026-05-01
archived: 2026-05-02
sourceArchiveId: arch_123
social_archiver_import_mode: local-only
---

Body text.
`;
    const parser = new PostDataParser({ cachedRead: vi.fn().mockResolvedValue(markdown) } as any);

    const post = await parser.parseFile(makeFile('server-backed'));

    expect(post?.isLocalOnly).toBe(false);
    expect(post?.sourceArchiveId).toBe('arch_123');
  });

  it('projects local-only status into the timeline index entry', async () => {
    const markdown = `---
platform: linkedin
author: Test Author
authorUrl: https://www.linkedin.com/in/test
originalUrl: https://www.linkedin.com/posts/test-1
published: 2026-05-01
archived: 2026-05-02
social_archiver_import_mode: local-only
---

Body text.
`;
    const parser = new PostDataParser({ cachedRead: vi.fn().mockResolvedValue(markdown) } as any);

    const entry = await parser.buildIndexEntry(makeFile('local-index'));

    expect(entry?.isLocalOnly).toBe(true);
  });
});

describe('PostDataParser - Naver raw HTML fallback cleanup', () => {
  it('removes trailing Naver HTML document fallback from raw markdown previews', async () => {
    const markdown = `---
platform: naver
author: Aikon Vero
authorUrl: https://m.blog.naver.com/aikonvero
published: 2026-05-10 17:10
originalUrl: https://m.blog.naver.com/aikonvero/224280828549
title: 카카오는 팔고 &mdash; 네이버는 물러서고
---

# 카카오는 팔고 &mdash; 네이버는 물러서고

첫 문단입니다.

![[naver-1.webp]]

둘째 문단입니다.

---

<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">
<html lang="ko">
<head><style>body { color: red; }</style></head>
<body>blog chrome</body>
</html>
`;

    const vault = {
      cachedRead: vi.fn().mockResolvedValue(markdown),
    } as any;
    const parser = new PostDataParser(vault);
    const file = {
      basename: 'naver-post',
      path: 'Social Archives/Naver/2026/05/naver-post.md',
      stat: { ctime: Date.now() },
    } as any;

    const post = await parser.parseFile(file);

    expect(post).toBeTruthy();
    expect(post!.content.rawMarkdown).toContain('첫 문단입니다.');
    expect(post!.content.rawMarkdown).toContain('둘째 문단입니다.');
    expect(post!.content.rawMarkdown).toContain('![[naver-1.webp]]');
    expect(post!.content.rawMarkdown).not.toContain('<!DOCTYPE');
    expect(post!.content.rawMarkdown).not.toContain('<html');
    expect(post!.content.rawMarkdown).not.toContain('blog chrome');
  });
});

describe('PostDataParser - X article body cleanup', () => {
  it('deduplicates repeated X article sections from existing notes', async () => {
    const markdown = `---
platform: x
author: 전시정보공유해드림
authorUrl: https://x.com/__umoaye__
published: 2026-05-21 19:30
originalUrl: https://x.com/__umoaye__/status/2057408627615613208
title: Everyone, exactly one week from now
isArticle: true
---

# Everyone, exactly one week from now

## 1

First section body.

---

## 2

Second section body.

---

## 1

First section body.

---

## 2

Second section body.

---

![image 1](attachments/social-archives/x/sample.jpg)

---

**Platform:** X (Twitter) | **Author:** [전시정보공유해드림](https://x.com/__umoaye__) | **Published:** 2026-05-21 19:30

**Original URL:** https://x.com/__umoaye__/status/2057408627615613208
`;

    const vault = {
      cachedRead: vi.fn().mockResolvedValue(markdown),
    } as any;
    const parser = new PostDataParser(vault);
    const file = {
      basename: 'x-article',
      path: 'Social Archives/X/2026/05/x-article.md',
      stat: { ctime: Date.now() },
    } as any;

    const post = await parser.parseFile(file);

    expect(post).toBeTruthy();
    expect(post!.content.rawMarkdown?.match(/## 1/g)).toHaveLength(1);
    expect(post!.content.rawMarkdown?.match(/## 2/g)).toHaveLength(1);
    expect(post!.content.rawMarkdown).toContain('First section body.');
    expect(post!.content.rawMarkdown).not.toContain('sample.jpg');
  });
});

describe('PostDataParser - Threads article body cleanup', () => {
  it('parses Threads articles as rawMarkdown for timeline markdown rendering', async () => {
    const markdown = `---
platform: threads
author: terracotta.nj
authorUrl: https://www.threads.com/@terracotta.nj
published: 2026-05-22 09:30
originalUrl: https://www.threads.com/@terracotta.nj/post/ABC123
title: 주변인들의 미국 스타트업 채용을 가끔 도우며 듣는것:
contentType: article
---

# 주변인들의 미국 스타트업 채용을 가끔 도우며 듣는것:

## 1

First Threads section.

---

## 2

Second Threads section.

---

**Platform:** Threads | **Author:** [terracotta.nj](https://www.threads.com/@terracotta.nj) | **Published:** 2026-05-22 09:30

**Original URL:** https://www.threads.com/@terracotta.nj/post/ABC123
`;

    const vault = {
      cachedRead: vi.fn().mockResolvedValue(markdown),
    } as any;
    const parser = new PostDataParser(vault);
    const file = {
      basename: 'threads-article',
      path: 'Social Archives/Threads/2026/05/threads-article.md',
      stat: { ctime: Date.now() },
    } as any;

    const post = await parser.parseFile(file);

    expect(post).toBeTruthy();
    expect(post!.title).toBe('주변인들의 미국 스타트업 채용을 가끔 도우며 듣는것:');
    expect(post!.content.rawMarkdown).toContain('## 1');
    expect(post!.content.rawMarkdown).toContain('First Threads section.');
    expect(post!.content.rawMarkdown).toContain('## 2');
    expect(post!.content.rawMarkdown).not.toContain('# 주변인들의 미국 스타트업 채용을 가끔 도우며 듣는것:');
    expect(post!.content.rawMarkdown).not.toContain('**Platform:**');
  });

  it('unescapes Threads article headings escaped as social text', async () => {
    const markdown = `---
platform: threads
author: terracotta.nj
authorUrl: https://www.threads.com/@terracotta.nj
published: 2026-05-22 09:30
originalUrl: https://www.threads.com/@terracotta.nj/post/ABC123
title: 주변인들의 미국 스타트업 채용을 가끔 도우며 듣는것:
contentType: article
---

\\# 주변인들의 미국 스타트업 채용을 가끔 도우며 듣는것:

\\#\\# 1

First Threads section.

---

\\#\\# 2

Second Threads section.

---

**Platform:** Threads | **Author:** [terracotta.nj](https://www.threads.com/@terracotta.nj) | **Published:** 2026-05-22 09:30
`;

    const vault = {
      cachedRead: vi.fn().mockResolvedValue(markdown),
    } as any;
    const parser = new PostDataParser(vault);
    const file = {
      basename: 'threads-escaped-article',
      path: 'Social Archives/Threads/2026/05/threads-escaped-article.md',
      stat: { ctime: Date.now() },
    } as any;

    const post = await parser.parseFile(file);

    expect(post).toBeTruthy();
    expect(post!.content.rawMarkdown).toContain('## 1');
    expect(post!.content.rawMarkdown).toContain('## 2');
    expect(post!.content.rawMarkdown).not.toContain('\\#\\# 1');
    expect(post!.content.rawMarkdown).not.toContain('\\#\\# 2');
  });
});

describe('PostDataParser - user post titles', () => {
  it('extracts a platform: post title from frontmatter', async () => {
    const markdown = `---
platform: post
author: hyungyunlim
published: 2026-05-19
title: "Timeline title"
---

Body text.
`;

    const vault = {
      cachedRead: vi.fn().mockResolvedValue(markdown),
    } as any;
    const parser = new PostDataParser(vault);
    const file = {
      basename: 'post-title',
      path: 'Social Archives/Post/2026/05/post-title.md',
      stat: { ctime: Date.now() },
    } as any;

    const post = await parser.parseFile(file);

    expect(post?.title).toBe('Timeline title');
    expect(post?.content.text).toBe('Body text.');
  });

  it('extracts a platform: post title from a leading H1 and removes it from body text', async () => {
    const markdown = `---
platform: post
author: hyungyunlim
published: 2026-05-19
---

# H1 timeline title

Body text after title.
`;

    const vault = {
      cachedRead: vi.fn().mockResolvedValue(markdown),
    } as any;
    const parser = new PostDataParser(vault);
    const file = {
      basename: 'post-h1-title',
      path: 'Social Archives/Post/2026/05/post-h1-title.md',
      stat: { ctime: Date.now() },
    } as any;

    const post = await parser.parseFile(file);

    expect(post?.title).toBe('H1 timeline title');
    expect(post?.content.text).toBe('Body text after title.');
  });
});

describe('PostDataParser - extractContentText excludes media-only sections', () => {
  const parser = new PostDataParser({} as any);

  it('excludes multi-image carousel section after separator (Instagram style)', () => {
    const markdown = `---
platform: instagram
author: testuser
published: 2025-11-06
---

Caption text about the post.

---

![image 1](attachments/social-archives/instagram/abc/img-1.jpg)

![image 2](attachments/social-archives/instagram/abc/img-2.jpg)

![image 3](attachments/social-archives/instagram/abc/img-3.jpg)

---

**Platform:** Instagram | **Author:** testuser | **Published:** 2025-11-06

**Original URL:** https://www.instagram.com/p/abc
`;

    const content = parser.extractContentText(markdown);
    expect(content).toBe('Caption text about the post.');
    expect(content).not.toContain('![image');
  });

  it('excludes single image section after separator', () => {
    const markdown = `---
platform: instagram
author: testuser
published: 2025-11-06
---

Single photo caption.

---

![image](attachments/social-archives/instagram/xyz/img-1.jpg)

---

**Platform:** Instagram | **Author:** testuser | **Published:** 2025-11-06
`;

    const content = parser.extractContentText(markdown);
    expect(content).toBe('Single photo caption.');
    expect(content).not.toContain('![image');
  });

  it('excludes media-only section when a trailing separator remains after comment stripping (Reddit style)', () => {
    const markdown = `---
platform: reddit
author: testuser
published: 2026-02-20
---

Reddit body text.

---

![image 1](attachments/social-archives/reddit/post-1.webp)

---

## 💬 Comments

**commenter** · 2026-02-20 03:36 · 1 likes
Nice post.

---

**Platform:** Reddit | **Author:** testuser | **Published:** 2026-02-20
`;

    const content = parser.extractContentText(markdown);
    expect(content).toBe('Reddit body text.');
    expect(content).not.toContain('![image');
  });

  it('preserves horizontal rules within actual post body', () => {
    const markdown = `---
platform: x
author: testuser
published: 2025-11-06
---

First paragraph.

---

Second paragraph after horizontal rule.

---

**Platform:** X | **Author:** testuser | **Published:** 2025-11-06
`;

    const content = parser.extractContentText(markdown);
    expect(content).toContain('First paragraph.');
    expect(content).toContain('Second paragraph after horizontal rule.');
  });

  it('excludes media section wrapped in sentinel region markers (Ship 3 subscription sync)', () => {
    // Real shape written by MarkdownConverter when sourceArchiveId exists:
    // the {{media}} section is wrapped in <!-- sa:media:start/end --> markers.
    const markdown = `---
platform: facebook
author: Sanghyun Park
published: 2026-06-09 10:59
sourceArchiveId: a2B1xENdXk
---

소리 끄고 자막만 보다가 줄 알았음ㅋㅋ

道費였음

---

<!-- sa:media:start id=a2B1xENdXk -->
![image 1](attachments/social-archives/facebook/3929996490464258/20260610-img-1.webp)
<!-- sa:media:end -->

---

**Platform:** Facebook | **Author:** Sanghyun Park | **Published:** 2026-06-09 10:59

**Original URL:** https://www.facebook.com/sanghyun.simon.park/posts/abc
`;

    const content = parser.extractContentText(markdown);
    expect(content).toBe('소리 끄고 자막만 보다가 줄 알았음ㅋㅋ\n\n道費였음');
    expect(content).not.toContain('sa:media');
    expect(content).not.toContain('![image');
  });

  it('excludes sentinel-wrapped media section when comments follow (sync catch-up shape)', () => {
    const markdown = `---
platform: facebook
author: testuser
published: 2026-06-09
sourceArchiveId: abc123
---

Body text.

---

<!-- sa:media:start id=abc123 -->
![image 1](attachments/social-archives/facebook/post/img-1.webp)

![image 2](attachments/social-archives/facebook/post/img-2.webp)
<!-- sa:media:end -->

---

## 💬 Comments

**commenter** · 2026-06-09 12:00 · 3 likes
Great post.

---

**Platform:** Facebook | **Author:** testuser | **Published:** 2026-06-09
`;

    const content = parser.extractContentText(markdown);
    expect(content).toBe('Body text.');
    expect(content).not.toContain('sa:media');
    expect(content).not.toContain('![image');
  });
});

describe('PostDataParser - extractComments', () => {
  const parser = new PostDataParser({} as any);

  it('preserves multi-paragraph Reddit comments before nested replies', () => {
    const markdown = `---
platform: reddit
author: datahoarderprime
published: 2026-05-18
---

Post body.

---

## 💬 Comments

**kepano** · 2026-05-18 12:05 · 1 likes
It's amazing how much heart and soul Zsolt has poured into Excalidraw.

Before I joined Obsidian I was a community member making my own themes and plugins.

The video is pretty long, but I'll try to respond to all the main points.

I'm really happy to see that Zsolt was able to update Excalidraw within a few days.

  ↳ **Valuable_Cow2596** · 2026-05-18 13:31 · 60 likes
  As always, thank you for what you do.

  ↳ **ForgotMyPreviousPass** · 2026-05-18 15:18 · 27 likes
  Just a clarification.

---

**Platform:** Reddit | **Author:** datahoarderprime | **Published:** 2026-05-18
`;

    const comments = parser.extractComments(markdown);

    expect(comments).toHaveLength(1);
    expect(comments[0]?.author.name).toBe('kepano');
    expect(comments[0]?.content).toContain('Before I joined Obsidian');
    expect(comments[0]?.content).toContain("The video is pretty long");
    expect(comments[0]?.content).toContain("I'm really happy");
    expect(comments[0]?.replies).toHaveLength(2);
    expect(comments[0]?.replies?.[0]?.author.name).toBe('Valuable_Cow2596');
  });

  it('preserves multi-paragraph reply content', () => {
    const markdown = `## 💬 Comments

**alice**
Parent.

  ↳ **bob**
  First reply paragraph.

  Second reply paragraph.
`;

    const comments = parser.extractComments(markdown);

    expect(comments[0]?.replies?.[0]?.content).toBe(
      'First reply paragraph.\n\nSecond reply paragraph.'
    );
  });
});

describe('PostDataParser - media deduplication', () => {
  it('removes duplicate media entries when parsing a post file', async () => {
    const duplicateMarkdown = `---
platform: facebook
author: tester
published: 2024-11-11
---

Content body

**Media:**
![Image](attachments/duplicate.jpg)
![Image](attachments/duplicate.jpg)
`;

    const vault = {
      cachedRead: vi.fn().mockResolvedValue(duplicateMarkdown),
      read: vi.fn().mockResolvedValue(duplicateMarkdown)
    } as any;

    const parser = new PostDataParser(vault as any);
    const file = {
      basename: 'test-file',
      path: 'Social Archives/test-file.md',
      stat: { ctime: Date.now() }
    } as any;

    const post = await parser.parseFile(file);
    expect(post?.media).toHaveLength(1);
    expect(post?.media?.[0]?.url).toBe('attachments/duplicate.jpg');
  });
});
