<script lang="ts">
/**
 * ErrorBoundary - Error boundary component for Svelte 5
 *
 * Provides error catching and graceful degradation for child components
 * Since Svelte 5 doesn't have built-in error boundaries like React,
 * we implement error handling through state management and try-catch
 *
 * Usage:
 * <ErrorBoundary fallback={CustomFallback} onError={handleError}>
 *   <YourComponent />
 * </ErrorBoundary>
 */

import { onMount } from 'svelte';
import type { Snippet } from 'svelte';

/**
 * Component props
 */
interface ErrorBoundaryProps {
  children: Snippet;
  fallback?: Snippet<[Error]>;
  onError?: (error: Error, errorInfo: { componentStack?: string }) => void;
  resetKeys?: unknown[];
}

let {
  children,
  fallback,
  onError,
  resetKeys = []
}: ErrorBoundaryProps = $props();

/**
 * Error state
 */
let error = $state<Error | null>(null);
let errorInfo = $state<{ componentStack?: string }>({});
let hasError = $derived(error !== null);

/**
 * Reset error state
 */
function resetError(): void {
  error = null;
  errorInfo = {};
}

/**
 * Handle error
 */
function handleError(err: Error, info: { componentStack?: string } = {}): void {
  error = err;
  errorInfo = info;

  // Call user-provided error handler
  if (onError) {
    onError(err, info);
  }

}

/**
 * Global error handler for unhandled promise rejections
 */
function handleUnhandledRejection(event: PromiseRejectionEvent): void {
  handleError(
    event.reason instanceof Error ? event.reason : new Error(String(event.reason)),
    { componentStack: 'Unhandled Promise Rejection' }
  );
}

/**
 * Global error handler for uncaught errors
 */
function handleUncaughtError(event: ErrorEvent): void {
  handleError(event.error || new Error(event.message), {
    componentStack: `${event.filename}:${event.lineno}:${event.colno}`
  });
}

/**
 * Watch reset keys for error reset
 */
$effect(() => {
  // Reset error when reset keys change
  if (resetKeys.length > 0) {
    resetError();
  }
});

onMount(() => {
  // Add global error listeners
  window.addEventListener('unhandledrejection', handleUnhandledRejection);
  window.addEventListener('error', handleUncaughtError);

  return () => {
    window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    window.removeEventListener('error', handleUncaughtError);
  };
});
</script>

{#if hasError}
  {#if fallback}
    {@render fallback(error as Error)}
  {:else}
    <!-- Default fallback UI -->
    <div class="error-boundary-fallback">
      <div class="error-icon">⚠️</div>
      <h3 class="error-title">Something went wrong</h3>
      <p class="error-message">{error?.message}</p>
      <button class="error-retry-button" onclick={resetError}>
        Try Again
      </button>
    </div>
  {/if}
{:else}
  {@render children()}
{/if}

<style>
  .error-boundary-fallback {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    text-align: center;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    min-height: 200px;
  }

  .error-icon {
    font-size: 3rem;
    margin-bottom: 1rem;
  }

  .error-title {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0 0 0.5rem 0;
    color: var(--text-normal);
  }

  .error-message {
    font-size: 0.875rem;
    color: var(--text-muted);
    margin: 0 0 1.5rem 0;
    max-width: 400px;
  }

  .error-retry-button {
    padding: 0.5rem 1.5rem;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s ease;
  }

  .error-retry-button:hover {
    background: var(--interactive-accent-hover);
  }
</style>
