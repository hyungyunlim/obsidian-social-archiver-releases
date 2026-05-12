import { describe, expect, it, vi } from 'vitest';
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
