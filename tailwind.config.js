/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/**/*.{ts,tsx,svelte}',
    './src/**/*.{html,js}'
  ],
  // Safelist dynamic classes used in Timeline
  safelist: [
    // Layout & Sizing
    'w-full', 'h-full', 'w-10', 'h-10', 'w-8', 'h-8', 'w-6', 'h-6', 'w-5', 'h-5', 'w-4', 'h-4', 'w-3', 'h-3',
    'max-w-2xl', 'mx-auto', 'min-w-0',

    // Flexbox & Grid
    'flex', 'flex-col', 'flex-1', 'flex-shrink', 'flex-shrink-0',
    'items-center', 'items-start', 'justify-center',
    'grid', 'grid-cols-1', 'grid-cols-2', 'md:grid-cols-2', 'lg:grid-cols-3',

    // Spacing
    'gap-1', 'gap-1.5', 'gap-2', 'gap-3', 'gap-4', 'gap-6', 'gap-8',
    'p-4', 'px-2', 'px-3', 'px-4', 'py-0.5', 'py-1', 'py-2', 'py-3', 'pt-3',
    'mb-1', 'mb-2', 'mb-3', 'mb-4', 'mb-6', 'mt-1', 'mt-2', 'mt-3', 'mt-4', 'pb-2',
    'pl-14', 'pr-14',

    // Borders & Radius
    'border', 'border-t', 'border-b-2', 'rounded', 'rounded-lg', 'rounded-full',

    // Typography
    'text-5xl', 'text-2xl', 'text-xl', 'text-sm', 'text-xs',
    'font-semibold', 'leading-relaxed', 'uppercase', 'tracking-wide',
    'text-center', 'text-white', 'whitespace-pre-wrap', 'truncate', 'line-clamp-4',

    // Display & Overflow
    'block', 'inline-block', 'overflow-y-auto', 'overflow-hidden', 'min-h-[300px]',

    // Position
    'sticky', 'top-0', 'top-3', 'top-1/2', 'left-2', 'left-3', 'right-2', 'right-3', 'bottom-2',
    'relative', 'absolute', 'inset-0',

    // Transforms
    '-translate-y-1/2',

    // Aspect Ratio
    'aspect-square', 'aspect-video',

    // Object Fit
    'object-cover', 'object-contain',

    // Z-index
    'z-10',

    // Cursor
    'cursor-pointer',

    // Opacity & Background
    'bg-opacity-50', 'bg-opacity-60', 'bg-opacity-70', 'bg-black',

    // Transitions
    'transition-all', 'transition-colors', 'transition-opacity', 'duration-200', 'duration-300',

    // Hover states
    'hover:shadow-lg', 'hover:-translate-y-1', 'hover:opacity-90', 'hover:bg-opacity-70',
  ],
  // Disable preflight to prevent conflicts with Obsidian's native styles
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      // Integrate Obsidian CSS variables for seamless theming
      colors: {
        // Background colors
        'obsidian-bg-primary': 'var(--background-primary)',
        'obsidian-bg-secondary': 'var(--background-secondary)',
        'obsidian-bg-modifier-border': 'var(--background-modifier-border)',
        'obsidian-bg-modifier-hover': 'var(--background-modifier-hover)',

        // Text colors
        'obsidian-text': 'var(--text-normal)',
        'obsidian-text-muted': 'var(--text-muted)',
        'obsidian-text-faint': 'var(--text-faint)',
        'obsidian-text-accent': 'var(--text-accent)',
        'obsidian-text-accent-hover': 'var(--text-accent-hover)',

        // Interactive elements
        'obsidian-interactive': 'var(--interactive-normal)',
        'obsidian-interactive-hover': 'var(--interactive-hover)',
        'obsidian-interactive-accent': 'var(--interactive-accent)',
        'obsidian-interactive-accent-hover': 'var(--interactive-accent-hover)',

        // Status colors
        'obsidian-error': 'var(--text-error)',
        'obsidian-warning': 'var(--text-warning)',
        'obsidian-success': 'var(--text-success)',
      },

      // Mobile-first responsive breakpoints
      screens: {
        'xs': '375px',  // iPhone SE, small phones
        'sm': '640px',  // Large phones
        'md': '768px',  // Tablets
        'lg': '1024px', // Desktop
        'xl': '1280px', // Large desktop
      },

      // Mobile touch target utilities (iOS HIG: 44px minimum)
      spacing: {
        'touch-min': '44px', // Minimum touch target size
      },

      // Custom utilities for Obsidian-specific layouts
      minHeight: {
        'touch-target': '44px',
      },
      minWidth: {
        'touch-target': '44px',
      },
    },
  },
  plugins: [
    // Custom utilities for mobile-first design
    function({ addUtilities }) {
      const mobileUtilities = {
        // Touch target utilities (iOS HIG: 44px minimum)
        '.touch-target': {
          minWidth: '44px',
          minHeight: '44px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        },

        // iOS safe area utilities
        '.safe-area-inset-top': {
          paddingTop: 'env(safe-area-inset-top)',
        },
        '.safe-area-inset-bottom': {
          paddingBottom: 'env(safe-area-inset-bottom)',
        },
        '.safe-area-inset-left': {
          paddingLeft: 'env(safe-area-inset-left)',
        },
        '.safe-area-inset-right': {
          paddingRight: 'env(safe-area-inset-right)',
        },
        '.safe-area-inset': {
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          paddingLeft: 'env(safe-area-inset-left)',
          paddingRight: 'env(safe-area-inset-right)',
        },

        // Mobile modal utilities optimized for Obsidian
        '.mobile-modal': {
          maxHeight: 'calc(100vh - env(safe-area-inset-top) - env(safe-area-inset-bottom))',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch', // Smooth scrolling on iOS
        },

        // Mobile dropdown utilities
        '.mobile-dropdown': {
          maxHeight: '60vh',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
        },

        // Prevent text selection (useful for buttons)
        '.no-select': {
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none', // Disable callout on iOS
        },

        // Active state for touch (visual feedback)
        '.touch-active': {
          transition: 'opacity 0.1s ease',
          '&:active': {
            opacity: '0.7',
          },
        },
      };

      addUtilities(mobileUtilities);
    },
  ],
}
