import { describe, expect, it } from 'vitest';
import { YouTubePlayerController } from '../../../../components/timeline/controllers/YouTubePlayerController';

describe('YouTubePlayerController', () => {
  it('tracks player state from iframe infoDelivery messages', () => {
    const iframe = document.createElement('iframe');
    iframe.src = 'https://www.youtube-nocookie.com/embed/abc123?enablejsapi=1';
    document.body.appendChild(iframe);

    const controller = new YouTubePlayerController(iframe);
    window.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({
        event: 'infoDelivery',
        info: { playerState: 1 },
      }),
      source: iframe.contentWindow,
    }));

    expect(controller.getPlayerState()).toBe(1);
    expect(controller.isPlaybackActive()).toBe(true);
    expect(iframe.dataset.saYoutubePlayerState).toBe('1');
    expect(iframe.dataset.saYoutubePlaying).toBe('true');

    controller.destroy();
  });

  it('ignores messages from other iframes', () => {
    const iframe = document.createElement('iframe');
    iframe.src = 'https://www.youtube-nocookie.com/embed/abc123?enablejsapi=1';
    document.body.appendChild(iframe);

    const otherIframe = document.createElement('iframe');
    otherIframe.src = 'https://www.youtube-nocookie.com/embed/other123?enablejsapi=1';
    document.body.appendChild(otherIframe);

    const controller = new YouTubePlayerController(iframe);
    window.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({
        event: 'infoDelivery',
        info: { playerState: 1 },
      }),
      source: otherIframe.contentWindow,
    }));

    expect(controller.getPlayerState()).toBeNull();
    expect(controller.isPlaybackActive()).toBe(false);
    expect(iframe.dataset.saYoutubePlayerState).toBeUndefined();

    controller.destroy();
  });
});
