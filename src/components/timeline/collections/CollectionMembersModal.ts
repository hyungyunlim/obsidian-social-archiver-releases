import { App, Modal, Platform, Setting, setIcon } from 'obsidian';
import { t } from '../../../i18n';
import {
  COLLECTION_MEMBER_LIMITS,
  type CollectionInvite,
  type CollectionMemberRole,
  type CollectionMembersResponse,
  type LocalCollection,
} from '../../../types/collections';
import type { OnlineFailure, OnlineResult } from '../../../services/collections/CollectionService';
import { roleLabel } from './collectionVisuals';

/**
 * Members of a collection (prd-collections-obsidian-plugin §4.2):
 * - owner: invite links (role + expiry, copy, revoke) and the roster (role, remove)
 * - members: the roster, my notes opt-in, and Leave
 * Everything is online; each action reports its own failure.
 */

export interface CollectionMembersOptions {
  collection: LocalCollection;
  username: string | null;
  getMembers: () => Promise<OnlineResult<CollectionMembersResponse>>;
  listInvites: () => Promise<OnlineResult<CollectionInvite[]>>;
  createInvite: (role: CollectionMemberRole, expiresInDays: number) => Promise<OnlineResult<CollectionInvite>>;
  revokeInvite: (token: string) => Promise<OnlineResult<void>>;
  changeRole: (username: string, role: CollectionMemberRole) => Promise<OnlineResult<unknown>>;
  removeMember: (username: string) => Promise<OnlineResult<void>>;
  setMyAnnotations: (include: boolean) => Promise<OnlineResult<boolean>>;
  leave: () => void;
  copy: (url: string, message: string) => Promise<void>;
  confirm: (options: { title: string; message: string; confirmText: string }) => Promise<boolean>;
  notify: (message: string) => void;
  reportFailure: (reason: OnlineFailure, fallback: string) => void;
}

const EXPIRY_DAYS = [1, 7, 30] as const;

export class CollectionMembersModal extends Modal {
  private members: CollectionMembersResponse | null = null;
  private invites: CollectionInvite[] = [];
  private inviteRole: CollectionMemberRole = 'editor';
  private inviteExpiry: number = COLLECTION_MEMBER_LIMITS.inviteDefaultExpiryDays;
  private busy = false;

  constructor(app: App, private readonly options: CollectionMembersOptions) {
    super(app);
  }

  private get isOwner(): boolean {
    return (this.options.collection.role ?? 'owner') === 'owner';
  }

  onOpen(): void {
    this.modalEl.addClass('sa-collection-members');
    if (Platform.isMobile) this.modalEl.addClass('sa-collection-modal-mobile');
    this.setTitle(`${t('col.members.title')} · ${this.options.collection.name}`);
    this.contentEl.createDiv({ cls: 'sa-collection-loading', text: '…' });
    void this.reload();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async reload(): Promise<void> {
    const [members, invites] = await Promise.all([
      this.options.getMembers(),
      this.isOwner ? this.options.listInvites() : Promise.resolve<OnlineResult<CollectionInvite[]>>({ ok: true, value: [] }),
    ]);
    if (!members.ok) {
      this.options.reportFailure(members.reason, t('col.members.loadFailed'));
      this.close();
      return;
    }
    this.members = members.value;
    this.invites = invites.ok ? invites.value : [];
    this.render();
  }

  private render(): void {
    const body = this.contentEl;
    const members = this.members;
    if (!members) return;
    body.empty();

    if (this.isOwner) this.renderInvites(body);

    body.createDiv({ cls: 'sa-collection-section-label', text: t('col.members.count', { count: members.members.length }) });
    const roster = body.createDiv({ cls: 'sa-collection-roster' });
    this.renderRosterRow(roster, members.ownerUsername, 'owner');
    if (members.members.length === 0) {
      roster.createDiv({ cls: 'sa-collection-empty', text: t('col.members.empty') });
    }
    for (const member of members.members) this.renderRosterRow(roster, member.username, member.role);

    if (this.isOwner) {
      body.createDiv({ cls: 'sa-collection-hint', text: t('col.members.ownerAnnotationsHint') });
      return;
    }

    new Setting(body)
      .setName(t('col.members.myAnnotations'))
      .setDesc(t('col.members.myAnnotationsHint'))
      .addToggle((toggle) => {
        toggle.setValue(this.options.collection.includeMyAnnotations === true);
        toggle.setDisabled(this.busy);
        toggle.onChange((include) => void this.runAction(async () => {
          const result = await this.options.setMyAnnotations(include);
          if (!result.ok) {
            this.options.reportFailure(result.reason, t('col.members.updateFailed'));
            return;
          }
          this.options.collection.includeMyAnnotations = result.value;
        }));
      });

    const leaveRow = body.createDiv({ cls: 'sa-collection-modal-footer' });
    const leave = leaveRow.createEl('button', { text: t('col.leave'), cls: 'mod-warning' });
    leave.addEventListener('click', () => {
      this.close();
      this.options.leave();
    });
  }

  private renderRosterRow(parent: HTMLElement, username: string, role: 'owner' | CollectionMemberRole): void {
    const row = parent.createDiv({ cls: 'sa-collection-roster-row' });
    const name = row.createDiv({ cls: 'sa-collection-roster-name' });
    name.createSpan({ text: `@${username}` });
    if (username === this.options.username) name.createSpan({ cls: 'sa-collection-badge', text: t('col.members.you') });

    if (!this.isOwner || role === 'owner') {
      row.createDiv({ cls: 'sa-collection-roster-role', text: roleLabel(role) });
      return;
    }

    const controls = row.createDiv({ cls: 'sa-collection-roster-controls' });
    const select = controls.createEl('select', { cls: 'dropdown', attr: { 'aria-label': `${t('col.members.changeRole')}: @${username}` } });
    for (const option of ['editor', 'viewer'] as const) {
      select.createEl('option', { value: option, text: roleLabel(option) });
    }
    select.value = role;
    select.disabled = this.busy;
    select.addEventListener('change', () => void this.runAction(async () => {
      const next = select.value as CollectionMemberRole;
      const result = await this.options.changeRole(username, next);
      if (!result.ok) {
        this.options.reportFailure(result.reason, t('col.members.updateFailed'));
        select.value = role;
        return;
      }
      this.options.notify(t('col.members.roleChanged', { username }));
      await this.reload();
    }));

    const remove = controls.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': `${t('col.members.remove')}: @${username}` } });
    setIcon(remove, 'user-minus');
    remove.disabled = this.busy;
    remove.addEventListener('click', () => void this.runAction(async () => {
      const confirmed = await this.options.confirm({
        title: t('col.members.removeConfirmTitle', { username }),
        message: t('col.members.removeConfirmBody'),
        confirmText: t('col.members.remove'),
      });
      if (!confirmed) return;
      const result = await this.options.removeMember(username);
      if (!result.ok) {
        this.options.reportFailure(result.reason, t('col.members.updateFailed'));
        return;
      }
      this.options.notify(t('col.members.removed', { username }));
      await this.reload();
    }));
  }

  private renderInvites(body: HTMLElement): void {
    body.createDiv({ cls: 'sa-collection-section-label', text: t('col.invites.title') });
    body.createDiv({ cls: 'sa-collection-hint', text: t('col.invites.hint') });

    new Setting(body)
      .setName(t('col.invites.role'))
      .addDropdown((dropdown) => {
        dropdown.addOption('editor', `${roleLabel('editor')} — ${t('col.role.editorHint')}`);
        dropdown.addOption('viewer', `${roleLabel('viewer')} — ${t('col.role.viewerHint')}`);
        dropdown.setValue(this.inviteRole);
        dropdown.onChange((value) => { this.inviteRole = value as CollectionMemberRole; });
      });
    new Setting(body)
      .setName(t('col.invites.expiry'))
      .addDropdown((dropdown) => {
        dropdown.addOption('1', t('col.invites.expiry1d'));
        dropdown.addOption('7', t('col.invites.expiry7d'));
        dropdown.addOption('30', t('col.invites.expiry30d'));
        dropdown.setValue(String(this.inviteExpiry));
        dropdown.onChange((value) => {
          const days = Number(value);
          this.inviteExpiry = (EXPIRY_DAYS as readonly number[]).includes(days) ? days : COLLECTION_MEMBER_LIMITS.inviteDefaultExpiryDays;
        });
      })
      .addButton((button) => {
        button.setButtonText(t('col.invites.create')).setCta();
        button.setDisabled(this.busy || this.invites.length >= COLLECTION_MEMBER_LIMITS.maxActiveInvitesPerCollection);
        button.onClick(() => void this.runAction(async () => {
          const result = await this.options.createInvite(this.inviteRole, this.inviteExpiry);
          if (!result.ok) {
            this.options.reportFailure(result.reason, result.reason === 'limit' ? t('col.invites.limitReached') : t('col.invites.createFailed'));
            return;
          }
          await this.options.copy(result.value.inviteUrl, t('col.invites.copied'));
          await this.reload();
        }));
      });

    const list = body.createDiv({ cls: 'sa-collection-invites' });
    if (this.invites.length === 0) {
      list.createDiv({ cls: 'sa-collection-empty', text: t('col.invites.empty') });
      return;
    }
    for (const invite of this.invites) {
      const row = list.createDiv({ cls: 'sa-collection-invite-row' });
      const text = row.createDiv({ cls: 'sa-collection-row-text' });
      text.createDiv({ cls: 'sa-collection-row-name', text: roleLabel(invite.role) });
      const expires = new Date(invite.expiresAt).toLocaleDateString();
      text.createDiv({
        cls: 'sa-collection-row-meta',
        text: `${t('col.invites.expiresOn', { date: expires })} · ${t('col.invites.useCount', { count: invite.useCount })}`,
      });
      const copy = row.createEl('button', { text: t('col.invites.copy') });
      copy.addEventListener('click', () => void this.options.copy(invite.inviteUrl, t('col.invites.copied')));
      const revoke = row.createEl('button', { text: t('col.invites.revoke'), cls: 'mod-warning' });
      revoke.disabled = this.busy;
      revoke.addEventListener('click', () => void this.runAction(async () => {
        const confirmed = await this.options.confirm({
          title: t('col.invites.revokeConfirmTitle'),
          message: t('col.invites.revokeConfirmBody'),
          confirmText: t('col.invites.revoke'),
        });
        if (!confirmed) return;
        const result = await this.options.revokeInvite(invite.token);
        if (!result.ok) {
          this.options.reportFailure(result.reason, t('col.members.updateFailed'));
          return;
        }
        this.options.notify(t('col.invites.revoked'));
        await this.reload();
      }));
    }
  }

  private async runAction(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await action();
    } finally {
      this.busy = false;
      if (this.members) this.render();
    }
  }
}
