import { describe, it, expect, vi } from 'vitest';
import { resolveRssAuthorUrl } from '../../utils/rssAuthorUrl';

const noDiscovery = vi.fn(async () => null);

describe('resolveRssAuthorUrl', () => {
  it.each([
    ['https://www.tumblr.com/gooseworx', 'https://gooseworx.tumblr.com'],
    ['https://tumblr.com/GooseWorx/825306648796119040', 'https://gooseworx.tumblr.com'],
    ['https://www.tumblr.com/blog/view/staff', 'https://staff.tumblr.com'],
  ])('maps Tumblr %s to its blog subdomain without asking the server', async (input, expected) => {
    noDiscovery.mockClear();
    expect(await resolveRssAuthorUrl(input, noDiscovery)).toBe(expected);
    expect(noDiscovery).not.toHaveBeenCalled();
  });

  it("uses the server-resolved publication for a substack.com/@handle author", async () => {
    const discover = vi.fn(async () => 'https://millennialmasters.substack.com/feed');
    expect(await resolveRssAuthorUrl('https://substack.com/@danielionescu', discover))
      .toBe('https://millennialmasters.substack.com');
    expect(discover).toHaveBeenCalledWith('https://substack.com/@danielionescu');
  });

  it('falls back to the handle subdomain when discovery fails', async () => {
    const failing = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await resolveRssAuthorUrl('https://substack.com/@dirtmentalist', failing))
      .toBe('https://dirtmentalist.substack.com');
    expect(await resolveRssAuthorUrl('https://substack.com/@dirtmentalist', noDiscovery))
      .toBe('https://dirtmentalist.substack.com');
  });

  it.each([
    'https://lifebyjulia.substack.com',
    'https://gooseworx.tumblr.com',
    'https://medium.com/@someone',
    'not a url',
  ])('leaves %s unchanged', async (input) => {
    expect(await resolveRssAuthorUrl(input, noDiscovery)).toBe(input);
  });
});
