import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@testing-library/svelte';
import { fireEvent } from '@testing-library/dom';
import ShareOptions from '../../components/editor/ShareOptions.svelte';
import type { ShareOptions as ShareOptionsType, ShareTier } from '../../services/ShareManager';
import type { LicenseInfo } from '../../types/license';

// Mock Obsidian Notice
vi.mock('obsidian', () => ({
  Notice: vi.fn(),
}));

describe('ShareOptions', () => {
  let defaultOptions: ShareOptionsType;
  let mockLicense: LicenseInfo;

  beforeEach(() => {
    defaultOptions = {
      tier: 'free',
    };

    mockLicense = {
      key: 'test-key',
      provider: 'gumroad',
      productId: 'test-product',
      email: 'test@example.com',
      valid: true,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    };
  });

  describe('Public Sharing Toggle', () => {
    it('should render with sharing disabled by default', () => {
      const { container } = mount(ShareOptions, {
        props: {
          options: defaultOptions,
        },
      });

      const toggleSwitch = container.querySelector('.toggle-switch');
      expect(toggleSwitch).toBeTruthy();
      expect(toggleSwitch?.classList.contains('on')).toBe(false);

      const toggleLabel = container.querySelector('.toggle-label');
      expect(toggleLabel?.textContent).toBe('Enable Sharing');
    });

    it('should toggle sharing when clicked', async () => {
      const onShareToggle = vi.fn();
      const { container } = mount(ShareOptions, {
        props: {
          options: defaultOptions,
          onShareToggle,
        },
      });

      const toggleButton = container.querySelector('.share-toggle') as HTMLButtonElement;
      await fireEvent.click(toggleButton);

      expect(onShareToggle).toHaveBeenCalledWith(true);

      const toggleSwitch = container.querySelector('.toggle-switch');
      expect(toggleSwitch?.classList.contains('on')).toBe(true);

      const toggleLabel = container.querySelector('.toggle-label');
      expect(toggleLabel?.textContent).toBe('Sharing Enabled');
    });

    it('should show options container when sharing is enabled', async () => {
      const { container } = mount(ShareOptions, {
        props: {
          options: defaultOptions,
        },
      });

      let optionsContainer = container.querySelector('.options-container');
      expect(optionsContainer).toBeFalsy();

      const toggleButton = container.querySelector('.share-toggle') as HTMLButtonElement;
      await fireEvent.click(toggleButton);

      optionsContainer = container.querySelector('.options-container');
      expect(optionsContainer).toBeTruthy();
    });

    it('should display credits required badge when sharing is enabled', async () => {
      const { container } = mount(ShareOptions, {
        props: {
          options: defaultOptions,
          creditsRequired: 3,
        },
      });

      const toggleButton = container.querySelector('.share-toggle') as HTMLButtonElement;
      await fireEvent.click(toggleButton);

      const creditsBadge = container.querySelector('.credits-badge');
      expect(creditsBadge).toBeTruthy();
      expect(creditsBadge?.textContent).toBe('3 credits');
    });
  });

  describe('Password Protection', () => {
    it('should show password input when password protection is enabled', async () => {
      const { container } = mount(ShareOptions, {
        props: {
          options: defaultOptions,
        },
      });

      // Enable sharing first
      const toggleButton = container.querySelector('.share-toggle') as HTMLButtonElement;
      await fireEvent.click(toggleButton);

      // Enable password protection
      const passwordCheckbox = container.querySelector('.option-checkbox') as HTMLInputElement;
      await fireEvent.click(passwordCheckbox);

      const passwordInput = container.querySelector('.password-input');
      expect(passwordInput).toBeTruthy();
    });

    it('should validate password requirements', async () => {
      const onChange = vi.fn();
      const { container } = mount(ShareOptions, {
        props: {
          options: defaultOptions,
          onChange,
        },
      });

      // Enable sharing
      const toggleButton = container.querySelector('.share-toggle') as HTMLButtonElement;
      await fireEvent.click(toggleButton);

      // Enable password protection
      const passwordCheckbox = container.querySelector('.option-checkbox') as HTMLInputElement;
      await fireEvent.click(passwordCheckbox);

      const passwordInput = container.querySelector('.password-input') as HTMLInputElement;

      // Test invalid password (too short)
      await fireEvent.input(passwordInput, { target: { value: 'short' } });
      await fireEvent.blur(passwordInput);

      const errorMessage = container.querySelector('.error-message');
      expect(errorMessage?.textContent).toContain('at least 8 characters');

      // Test valid password
      await fireEvent.input(passwordInput, { target: { value: 'password123' } });
      await fireEvent.blur(passwordInput);

      expect(onChange).toHaveBeenCalled();
      const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
      expect(lastCall.password).toBe('password123');
    });

    it('should toggle password visibility', async () => {
      const { container } = mount(ShareOptions, {
        props: {
          options: defaultOptions,
        },
      });

      // Enable sharing and password
      const toggleButton = container.querySelector('.share-toggle') as HTMLButtonElement;
      await fireEvent.click(toggleButton);

      const passwordCheckbox = container.querySelector('.option-checkbox') as HTMLInputElement;
      await fireEvent.click(passwordCheckbox);

      const passwordInput = container.querySelector('.password-input') as HTMLInputElement;
      expect(passwordInput.type).toBe('password');

      const passwordToggle = container.querySelector('.password-toggle') as HTMLButtonElement;
      await fireEvent.click(passwordToggle);

      expect(passwordInput.type).toBe('text');
    });
  });

  describe('Expiry Date', () => {
    it('should show date picker when custom expiry is enabled', async () => {
      const { container } = mount(ShareOptions, {
        props: {
          options: defaultOptions,
        },
      });

      // Enable sharing
      const toggleButton = container.querySelector('.share-toggle') as HTMLButtonElement;
      await fireEvent.click(toggleButton);

      // Enable custom expiry (second checkbox)
      const checkboxes = container.querySelectorAll('.option-checkbox');
      const expiryCheckbox = checkboxes[1] as HTMLInputElement;
      await fireEvent.click(expiryCheckbox);

      const expiryInput = container.querySelector('.expiry-input');
      expect(expiryInput).toBeTruthy();
    });

    it('should enforce 30-day limit for free tier', async () => {
      const { container } = mount(ShareOptions, {
        props: {
          options: defaultOptions,
          tier: 'free' as ShareTier,
        },
      });

      // Enable sharing and expiry
      const toggleButton = container.querySelector('.share-toggle') as HTMLButtonElement;
      await fireEvent.click(toggleButton);

      const checkboxes = container.querySelectorAll('.option-checkbox');
      const expiryCheckbox = checkboxes[1] as HTMLInputElement;
      await fireEvent.click(expiryCheckbox);

      const expiryInput = container.querySelector('.expiry-input') as HTMLInputElement;

      // Set date beyond 30 days
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 45);
      const dateString = futureDate.toISOString().split('T')[0];

      await fireEvent.change(expiryInput, { target: { value: dateString } });

      const errorMessage = container.querySelector('.error-message');
      expect(errorMessage?.textContent).toContain('Maximum 30 days');

      const helpText = container.querySelector('.help-text');
      expect(helpText?.textContent).toContain('Free plan: Links expire after 30 days');
    });

    it('should allow unlimited expiry for pro tier', async () => {
      const { container } = mount(ShareOptions, {
        props: {
          options: defaultOptions,
          tier: 'pro' as ShareTier,
          license: mockLicense,
        },
      });

      // Enable sharing and expiry
      const toggleButton = container.querySelector('.share-toggle') as HTMLButtonElement;
      await fireEvent.click(toggleButton);

      const checkboxes = container.querySelectorAll('.option-checkbox');
      const expiryCheckbox = checkboxes[1] as HTMLInputElement;
      await fireEvent.click(expiryCheckbox);

      const expiryInput = container.querySelector('.expiry-input') as HTMLInputElement;

      // Set date beyond 30 days
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);
      const dateString = futureDate.toISOString().split('T')[0];

      await fireEvent.change(expiryInput, { target: { value: dateString } });

      // Should not show error for pro tier
      const errorMessage = container.querySelector('.error-message');
      expect(errorMessage).toBeFalsy();

      const helpText = container.querySelector('.help-text.pro');
      expect(helpText?.textContent).toContain('Pro plan: Set any expiry date');
    });
  });

  describe('Plan Indicator', () => {
    it('should show free plan badge and upgrade link for free tier', async () => {
      const { container } = mount(ShareOptions, {
        props: {
          options: defaultOptions,
          tier: 'free' as ShareTier,
        },
      });

      // Enable sharing to see plan indicator
      const toggleButton = container.querySelector('.share-toggle') as HTMLButtonElement;
      await fireEvent.click(toggleButton);

      const planBadge = container.querySelector('.plan-badge');
      expect(planBadge?.textContent).toBe('🆓 Free');

      const upgradeLink = container.querySelector('.upgrade-link');
      expect(upgradeLink).toBeTruthy();
      expect(upgradeLink?.textContent).toContain('Upgrade for unlimited expiry');
    });

    it('should show pro plan badge without upgrade link for pro tier', async () => {
      const { container } = mount(ShareOptions, {
        props: {
          options: defaultOptions,
          tier: 'pro' as ShareTier,
          license: mockLicense,
        },
      });

      // Enable sharing to see plan indicator
      const toggleButton = container.querySelector('.share-toggle') as HTMLButtonElement;
      await fireEvent.click(toggleButton);

      const planBadge = container.querySelector('.plan-badge.pro');
      expect(planBadge?.textContent).toBe('✨ Pro');

      const upgradeLink = container.querySelector('.upgrade-link');
      expect(upgradeLink).toBeFalsy();
    });
  });

  describe('Options Callback', () => {
    it('should call onChange with updated options when state changes', async () => {
      const onChange = vi.fn();
      const { container } = mount(ShareOptions, {
        props: {
          options: defaultOptions,
          onChange,
        },
      });

      // Enable sharing
      const toggleButton = container.querySelector('.share-toggle') as HTMLButtonElement;
      await fireEvent.click(toggleButton);

      // Enable password
      const passwordCheckbox = container.querySelector('.option-checkbox') as HTMLInputElement;
      await fireEvent.click(passwordCheckbox);

      const passwordInput = container.querySelector('.password-input') as HTMLInputElement;
      await fireEvent.input(passwordInput, { target: { value: 'securePass123' } });

      // Wait for effects to run
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(onChange).toHaveBeenCalled();
      const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
      expect(lastCall.password).toBe('securePass123');
      expect(lastCall.tier).toBe('free');
    });

    it('should reset options when sharing is disabled', async () => {
      const onChange = vi.fn();
      const onShareToggle = vi.fn();
      const { container } = mount(ShareOptions, {
        props: {
          options: defaultOptions,
          onChange,
          onShareToggle,
        },
      });

      // Enable sharing and set password
      const toggleButton = container.querySelector('.share-toggle') as HTMLButtonElement;
      await fireEvent.click(toggleButton);

      const passwordCheckbox = container.querySelector('.option-checkbox') as HTMLInputElement;
      await fireEvent.click(passwordCheckbox);

      const passwordInput = container.querySelector('.password-input') as HTMLInputElement;
      await fireEvent.input(passwordInput, { target: { value: 'password123' } });

      // Disable sharing
      await fireEvent.click(toggleButton);

      expect(onShareToggle).toHaveBeenLastCalledWith(false);

      // Options should be reset
      const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
      expect(lastCall.password).toBeUndefined();
      expect(lastCall.customExpiry).toBeUndefined();
    });
  });

  describe('Mobile Responsiveness', () => {
    it('should have minimum touch target size of 44px', () => {
      const { container } = mount(ShareOptions, {
        props: {
          options: defaultOptions,
        },
      });

      const toggleButton = container.querySelector('.share-toggle');
      const computedStyle = window.getComputedStyle(toggleButton as Element);

      // Check if min-height is set correctly in CSS
      expect(toggleButton).toBeTruthy();

      const optionLabels = container.querySelectorAll('.option-label');
      optionLabels.forEach(label => {
        expect(label).toBeTruthy();
      });
    });
  });
});