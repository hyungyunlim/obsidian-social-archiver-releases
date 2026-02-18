/**
 * TimelineContainerSvelte - Wrapper to mount Svelte Timeline component
 *
 * Bridges Obsidian's TypeScript view system with our Svelte component
 * Provides clean integration and state management
 */

import { mount, unmount } from 'svelte';
import type { App, Vault } from 'obsidian';
import type SocialArchiverPlugin from '../../main';
import Timeline from './Timeline.svelte';

export interface TimelineContainerProps {
  vault: Vault;
  app: App;
  archivePath: string;
  plugin: SocialArchiverPlugin;
}

/**
 * Container class to mount and manage Svelte Timeline component
 */
export class TimelineContainer {
  private containerEl: HTMLElement;
  private app: App;
  private plugin: SocialArchiverPlugin;
  private component: Record<string, unknown> | null = null;
  private unmountFn: (() => void) | null = null;

  constructor(target: HTMLElement, props: TimelineContainerProps) {
    this.containerEl = target;
    this.app = props.app;
    this.plugin = props.plugin;

    // Mount the Svelte Timeline component
    this.mount();
  }

  /**
   * Mount the Svelte Timeline component
   */
  private mount(): void {
    // Clear container
    this.containerEl.empty();

    // Add container class for styling
    this.containerEl.addClass('timeline-svelte-container');

    // Create wrapper div for Svelte component
    const wrapper = this.containerEl.createDiv('timeline-wrapper');

    // Mount Svelte component with props
    const result = mount(Timeline, {
      target: wrapper,
      props: {
        app: this.app,
        settings: this.plugin.settings,
        showComposer: true // Enable PostComposer
      }
    });

    this.component = result;

    // Store unmount function if available
    if (typeof result === 'object' && result && 'unmount' in result) {
      const resultWithUnmount = result as { unmount: () => void };
      this.unmountFn = () => resultWithUnmount.unmount();
    } else {
      // For older Svelte versions, the mount function might return the component directly
      this.unmountFn = () => { void unmount(result); };
    }
  }

  /**
   * Reload the timeline
   * Called when vault files change or settings update
   */
  public async reload(): Promise<void> {
    // Trigger reload in Svelte component if it has a reload method
    if (this.component && typeof this.component.reload === 'function') {
      await (this.component.reload as () => Promise<void>)();
    } else {
      // Otherwise, remount the component
      this.destroy();
      this.mount();
    }
  }

  /**
   * Clean up and destroy the component
   */
  public destroy(): void {
    if (this.unmountFn) {
      this.unmountFn();
      this.unmountFn = null;
    }
    this.component = null;
    this.containerEl.empty();
  }
}

// Export for backwards compatibility
export { TimelineContainer as TimelineContainerLegacy } from './TimelineContainer';