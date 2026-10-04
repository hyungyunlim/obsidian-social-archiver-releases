/**
 * Collections — timeline surface, modals, commands, settings rows and
 * notifications (prd-collections-obsidian-plugin). Key prefix "col.".
 * Wording follows the desktop/mobile apps (desktop-app/src/lib/i18n/resources/{en,ko}).
 */
import type { LocaleText } from '../index';

export const collectionStrings = {
  // General
  'col.title': { en: 'Collections', ko: '컬렉션' },
  'col.tagline': { en: 'Tags are for you. Collections are for sharing.', ko: '태그는 나를 위한 분류, 컬렉션은 보여줄 수 있는 묶음' },
  'col.newCollection': { en: 'New collection', ko: '새 컬렉션' },
  'col.allPosts': { en: 'All posts', ko: '모든 게시물' },
  'col.emptyTitle': { en: 'No collections yet', ko: '아직 컬렉션이 없습니다' },
  'col.emptyHint': { en: 'Group posts and share them with one link.', ko: '게시물을 모아 링크 하나로 공유해 보세요.' },
  'col.emptyCollection': { en: 'Nothing in this collection yet', ko: '이 컬렉션은 아직 비어 있습니다' },
  'col.itemCount': { en: '{count} posts', ko: '게시물 {count}개' },
  'col.signedOut': { en: 'Sign in to Social Archiver to use collections.', ko: '컬렉션을 쓰려면 Social Archiver에 로그인하세요.' },
  'col.notInVault': {
    en: '{count} of your posts in this collection aren’t in this vault.',
    ko: '이 컬렉션에 넣은 내 게시물 중 {count}개는 이 볼트에 없습니다.',
  },
  'col.localOnly': {
    en: 'Upload this note to your account before adding it to a collection.',
    ko: '이 노트를 컬렉션에 넣으려면 먼저 계정에 업로드하세요.',
  },
  'col.notArchive': { en: 'This note isn’t an archived post.', ko: '이 노트는 아카이브한 게시물이 아닙니다.' },
  'col.collaborative': { en: 'Collaborative', ko: '공동 편집' },
  'col.byOwner': { en: 'by @{owner}', ko: '@{owner}' },
  'col.limitReached': { en: 'You can have up to 1,000 collections', ko: '컬렉션은 1,000개까지 만들 수 있습니다' },
  'col.accessLost': { en: 'You no longer have access to this collection', ko: '이 컬렉션에 더 이상 접근할 수 없습니다' },
  'col.offline': { en: 'Connect to the internet to do this', ko: '이 작업을 하려면 인터넷에 연결하세요' },
  'col.failed': { en: 'Something went wrong. Try again.', ko: '문제가 생겼습니다. 다시 시도해 주세요.' },

  // Visibility
  'col.visibility.private': { en: 'Private', ko: '비공개' },
  'col.visibility.unlisted': { en: 'Anyone with the link', ko: '링크가 있는 사람' },
  'col.visibility.public': { en: 'Public', ko: '공개' },
  'col.visibility.privateHint': { en: 'Only you', ko: '나만 볼 수 있습니다' },
  'col.visibility.unlistedHint': { en: 'Not on your profile or in search', ko: '프로필과 검색에 나오지 않습니다' },
  'col.visibility.publicHint': { en: 'Shown on your profile', ko: '내 프로필에 표시됩니다' },

  // Roles
  'col.role.owner': { en: 'Owner', ko: '소유자' },
  'col.role.editor': { en: 'Editor', ko: '편집자' },
  'col.role.viewer': { en: 'Viewer', ko: '보기 전용' },
  'col.role.editorHint': { en: 'Can add and remove posts and rename the collection', ko: '게시물을 넣고 빼고 이름을 바꿀 수 있습니다' },
  'col.role.viewerHint': { en: 'Can view the collection', ko: '컬렉션을 볼 수 있습니다' },

  // Edit modal
  'col.edit.createTitle': { en: 'New collection', ko: '새 컬렉션' },
  'col.edit.editTitle': { en: 'Edit collection', ko: '컬렉션 편집' },
  'col.edit.name': { en: 'Name', ko: '이름' },
  'col.edit.namePlaceholder': { en: 'Collection name', ko: '컬렉션 이름' },
  'col.edit.description': { en: 'Description', ko: '설명' },
  'col.edit.descriptionPlaceholder': { en: 'Optional', ko: '선택 사항' },
  'col.edit.nameTaken': { en: 'A collection with this name already exists', ko: '같은 이름의 컬렉션이 이미 있습니다' },
  'col.edit.nameInvalid': { en: 'Enter a name of up to 60 characters', ko: '이름은 60자까지 입력할 수 있습니다' },
  'col.edit.descriptionInvalid': { en: 'The description can be up to 500 characters', ko: '설명은 500자까지 입력할 수 있습니다' },
  'col.edit.create': { en: 'Create', ko: '만들기' },
  'col.edit.save': { en: 'Save', ko: '저장' },
  'col.edit.cancel': { en: 'Cancel', ko: '취소' },

  // Delete / leave
  'col.delete': { en: 'Delete collection', ko: '컬렉션 삭제' },
  'col.deleteConfirmTitle': { en: 'Delete "{name}"?', ko: '"{name}" 컬렉션을 삭제할까요?' },
  'col.deleteConfirmBody': {
    en: 'Your posts stay in your library. Its share link stops working.',
    ko: '게시물은 보관함에 그대로 남습니다. 공유 링크는 더 이상 열리지 않습니다.',
  },
  'col.deleteConfirmBodyShared': {
    en: 'Members lose access and the posts they added leave the collection. Your posts stay in your library.',
    ko: '멤버는 더 이상 볼 수 없고 멤버가 넣은 게시물도 컬렉션에서 빠집니다. 내 게시물은 보관함에 그대로 남습니다.',
  },
  'col.deleted': { en: 'Collection deleted', ko: '컬렉션을 삭제했습니다' },
  'col.leave': { en: 'Leave collection', ko: '컬렉션 나가기' },
  'col.leaveConfirmTitle': { en: 'Leave "{name}"?', ko: '"{name}" 컬렉션에서 나갈까요?' },
  'col.leaveConfirmBody': {
    en: 'Posts you added stay in the collection. To take one out, delete it from your library.',
    ko: '내가 넣은 게시물은 컬렉션에 남습니다. 빼려면 내 보관함에서 삭제하세요.',
  },
  'col.left': { en: 'You left "{name}"', ko: '"{name}" 컬렉션에서 나갔습니다' },

  // Picker
  'col.picker.title': { en: 'Add to collection', ko: '컬렉션에 추가' },
  'col.picker.search': { en: 'Search or create', ko: '검색하거나 새로 만들기' },
  'col.picker.createNamed': { en: 'Create "{name}"', ko: '"{name}" 만들기' },
  'col.picker.done': { en: 'Done', ko: '완료' },
  'col.picker.partial': { en: 'In some of the selected posts', ko: '선택한 게시물 일부에 들어 있습니다' },
  'col.picker.noneWritable': { en: 'No collections you can add to yet.', ko: '아직 게시물을 넣을 수 있는 컬렉션이 없습니다.' },

  // Notices
  'col.toast.addedOne': { en: 'Added to "{name}"', ko: '"{name}"에 추가했습니다' },
  'col.toast.addedMany': { en: 'Added to {count} collections', ko: '컬렉션 {count}개에 추가했습니다' },
  'col.toast.removed': { en: 'Removed from "{name}"', ko: '"{name}"에서 뺐습니다' },
  'col.toast.updated': { en: 'Collections updated', ko: '컬렉션을 업데이트했습니다' },
  'col.toast.forbidden': { en: 'You can’t add posts to this collection', ko: '이 컬렉션에는 게시물을 넣을 수 없습니다' },
  'col.toast.shareFailed': { en: 'Couldn’t share this collection', ko: '컬렉션을 공유하지 못했습니다' },
  'col.toast.linkCopied': { en: 'Link copied', ko: '링크를 복사했습니다' },

  // Actions
  'col.action.add': { en: 'Add to collection', ko: '컬렉션에 추가' },
  'col.action.remove': { en: 'Remove from collection', ko: '컬렉션에서 빼기' },
  'col.action.copyLink': { en: 'Copy link', ko: '링크 복사' },
  'col.action.shareSettings': { en: 'Share settings', ko: '공유 설정' },
  'col.action.members': { en: 'Members', ko: '멤버' },
  'col.action.edit': { en: 'Edit collection', ko: '컬렉션 편집' },
  'col.action.more': { en: 'Collection actions', ko: '컬렉션 작업' },
  'col.action.createBase': { en: 'Create base from collection', ko: '컬렉션으로 Base 만들기' },

  // Share settings
  'col.share.title': { en: 'Share settings', ko: '공유 설정' },
  'col.share.visibility': { en: 'Who can see it', ko: '공개 범위' },
  'col.share.displayMode': { en: 'What viewers see', ko: '받는 사람이 보는 화면' },
  'col.share.displayModeHintCollection': {
    en: 'What people see first when they open the link. Visitors can still switch views.',
    ko: '링크를 연 사람이 처음 보는 화면입니다. 방문자는 보기 방식을 바꿀 수 있습니다.',
  },
  'col.share.displayModeHintPost': { en: 'What people see first when they open the link.', ko: '링크를 연 사람이 처음 보는 화면입니다.' },
  'col.share.mode.card': { en: 'Post', ko: '게시물' },
  'col.share.mode.reader': { en: 'Reader', ko: '리더' },
  'col.share.mode.timeline': { en: 'Timeline', ko: '타임라인' },
  'col.share.mode.list': { en: 'List', ko: '목록' },
  'col.share.mode.mediaOnly': { en: 'Media', ko: '미디어' },
  'col.share.mode.mosaic': { en: 'Mosaic', ko: '모자이크' },
  'col.share.mode.textOnly': { en: 'Text', ko: '텍스트' },
  'col.share.includeAnnotations': { en: 'Include my notes and highlights', ko: '내 메모와 하이라이트 포함' },
  'col.share.copyLink': { en: 'Copy link', ko: '링크 복사' },
  'col.share.rotateLink': { en: 'Reset link', ko: '링크 재설정' },
  'col.share.rotateConfirmTitle': { en: 'Reset the link?', ko: '링크를 재설정할까요?' },
  'col.share.rotateConfirmBody': { en: 'The current link will stop working.', ko: '지금 링크는 더 이상 열리지 않습니다.' },
  'col.share.stopSharing': { en: 'Stop sharing', ko: '공유 중지' },
  'col.share.stopConfirmBody': { en: 'The link stops working until you share again.', ko: '다시 공유하기 전까지 링크가 열리지 않습니다.' },
  'col.share.hiddenItems': { en: '{count} posts won’t appear on the shared page', ko: '{count}개는 공유 페이지에 보이지 않습니다' },
  'col.share.hiddenItemsHint': {
    en: 'Posts that weren’t public on their original platform are left out.',
    ko: '원래 플랫폼에서 공개가 아니었던 게시물은 빠집니다.',
  },
  'col.share.searchEngineDelay': { en: 'It may take a while to disappear from search engines.', ko: '검색엔진에서 사라지기까지 시간이 걸릴 수 있습니다.' },
  'col.share.fullContentTitle': { en: 'Share this collection?', ko: '이 컬렉션을 공유할까요?' },
  'col.share.fullContentBody': {
    en: 'A shared collection shows its posts in full, including photos and videos. Your Preview share mode applies to single posts only, not to collections. Share only content you have permission to share.',
    ko: '공유한 컬렉션은 사진과 영상을 포함해 게시물 전체 내용을 보여 줍니다. 설정의 미리보기 공유 모드는 게시물 하나를 공유할 때만 적용되고 컬렉션에는 적용되지 않습니다. 공유해도 되는 콘텐츠만 공유하세요.',
  },
  'col.share.fullContentConfirm': { en: 'Share', ko: '공유' },
  'col.share.loadFailed': { en: 'Couldn’t load share settings', ko: '공유 설정을 불러오지 못했습니다' },
  'col.share.updateFailed': { en: 'Couldn’t change share settings', ko: '공유 설정을 바꾸지 못했습니다' },
  'col.share.offline': { en: 'Connect to the internet to change sharing', ko: '공유 설정을 바꾸려면 인터넷에 연결하세요' },
  'col.share.gone': { en: 'This share link no longer exists', ko: '이 공유 링크는 더 이상 없습니다' },

  // Post share menu
  'col.postShare.copyLink': { en: 'Copy share link', ko: '공유 링크 복사' },
  'col.postShare.settings': { en: 'Share settings…', ko: '공유 설정…' },
  'col.postShare.stop': { en: 'Stop sharing', ko: '공유 중지' },

  // Members
  'col.members.title': { en: 'Members', ko: '멤버' },
  'col.members.you': { en: 'You', ko: '나' },
  'col.members.count': { en: '{count} members', ko: '멤버 {count}명' },
  'col.members.changeRole': { en: 'Change role', ko: '역할 변경' },
  'col.members.remove': { en: 'Remove from collection', ko: '내보내기' },
  'col.members.removeConfirmTitle': { en: 'Remove @{username}?', ko: '@{username} 님을 내보낼까요?' },
  'col.members.removeConfirmBody': { en: 'Posts they added stay in the collection.', ko: '이 멤버가 넣은 게시물은 컬렉션에 남습니다.' },
  'col.members.removed': { en: 'Removed @{username}', ko: '@{username} 님을 내보냈습니다' },
  'col.members.roleChanged': { en: 'Changed @{username}’s role', ko: '@{username} 님의 역할을 바꿨습니다' },
  'col.members.empty': { en: 'No members yet. Invite people with a link.', ko: '아직 멤버가 없습니다. 링크로 초대해 보세요.' },
  'col.members.loadFailed': { en: 'Couldn’t load members', ko: '멤버를 불러오지 못했습니다' },
  'col.members.updateFailed': { en: 'Couldn’t update members', ko: '멤버를 변경하지 못했습니다' },
  'col.members.myAnnotations': { en: 'Show my notes and highlights', ko: '내 메모와 하이라이트 공개' },
  'col.members.myAnnotationsHint': {
    en: 'Applies to posts you added. Others see them in this collection and on its shared page.',
    ko: '내가 넣은 게시물에 적용됩니다. 이 컬렉션과 공유 페이지에서 다른 사람에게 보입니다.',
  },
  'col.members.ownerAnnotationsHint': {
    en: 'Members see your notes and highlights when “Include my notes and highlights” is on in Share settings.',
    ko: '공유 설정에서 ‘내 메모와 하이라이트 포함’이 켜져 있으면 멤버에게도 내 메모와 하이라이트가 보입니다.',
  },
  'col.members.offline': { en: 'Connect to the internet to manage members', ko: '멤버를 관리하려면 인터넷에 연결하세요' },

  // Invites
  'col.invites.title': { en: 'Invite links', ko: '초대 링크' },
  'col.invites.create': { en: 'Create invite link', ko: '초대 링크 만들기' },
  'col.invites.role': { en: 'Role', ko: '역할' },
  'col.invites.expiry': { en: 'Expires after', ko: '만료 기간' },
  'col.invites.expiry1d': { en: '1 day', ko: '1일' },
  'col.invites.expiry7d': { en: '7 days', ko: '7일' },
  'col.invites.expiry30d': { en: '30 days', ko: '30일' },
  'col.invites.expiresOn': { en: 'Expires {date}', ko: '{date} 만료' },
  'col.invites.useCount': { en: 'Used {count} times', ko: '{count}회 사용' },
  'col.invites.copied': { en: 'Invite link copied', ko: '초대 링크를 복사했습니다' },
  'col.invites.copy': { en: 'Copy', ko: '복사' },
  'col.invites.revoke': { en: 'Revoke', ko: '취소' },
  'col.invites.revokeConfirmTitle': { en: 'Revoke this link?', ko: '이 링크를 취소할까요?' },
  'col.invites.revokeConfirmBody': {
    en: 'People who haven’t joined yet can’t use it anymore.',
    ko: '아직 참여하지 않은 사람은 이 링크를 더 이상 쓸 수 없습니다.',
  },
  'col.invites.revoked': { en: 'Link revoked', ko: '링크를 취소했습니다' },
  'col.invites.empty': { en: 'No active invite links', ko: '활성 초대 링크가 없습니다' },
  'col.invites.limitReached': { en: 'You can have up to 20 active invite links', ko: '활성 초대 링크는 20개까지 만들 수 있습니다' },
  'col.invites.hint': { en: 'Anyone with the link can join after signing in.', ko: '링크를 받은 사람은 로그인한 뒤 참여할 수 있습니다.' },
  'col.invites.createFailed': { en: 'Couldn’t create the invite link', ko: '초대 링크를 만들지 못했습니다' },

  // Member feed (collaborative)
  'col.feed.othersTitle': { en: 'Everyone’s posts', ko: '모든 멤버의 게시물' },
  'col.feed.addedBy': { en: 'Added by @{username}', ko: '@{username} 님이 추가' },
  'col.feed.hidden': { en: 'Hidden post — not public on its original platform', ko: '원래 플랫폼에서 공개가 아닌 게시물입니다' },
  'col.feed.loadMore': { en: 'Load more', ko: '더 불러오기' },
  'col.feed.offline': { en: 'Connect to the internet to see this collaborative collection', ko: '공동 편집 컬렉션을 보려면 인터넷에 연결하세요' },
  'col.feed.loadFailed': { en: 'Couldn’t load this collection', ko: '컬렉션을 불러오지 못했습니다' },
  'col.feed.openOriginal': { en: 'Open original', ko: '원문 열기' },
  'col.feed.openNote': { en: 'Open note', ko: '노트 열기' },
  'col.feed.removeFailed': { en: 'Couldn’t remove this post from the collection', ko: '컬렉션에서 게시물을 빼지 못했습니다' },

  // Activity notifications
  'col.activity.itemsAddedOne': { en: '@{actor} added a post', ko: '@{actor}님이 게시물을 추가했습니다' },
  'col.activity.itemsAddedMany': { en: '@{actor} added {count} posts', ko: '@{actor}님이 게시물 {count}개를 추가했습니다' },
  'col.activity.itemsAddedOther': { en: '@{actor} and 1 other added {count} posts', ko: '@{actor}님 외 1명이 게시물 {count}개를 추가했습니다' },
  'col.activity.itemsAddedOthers': { en: '@{actor} and {others} others added {count} posts', ko: '@{actor}님 외 {others}명이 게시물 {count}개를 추가했습니다' },
  'col.activity.memberJoined': { en: '@{actor} joined', ko: '@{actor}님이 참여했습니다' },
  'col.activity.memberJoinedOther': { en: '@{actor} and 1 other joined', ko: '@{actor}님 외 1명이 참여했습니다' },
  'col.activity.memberJoinedOthers': { en: '@{actor} and {others} others joined', ko: '@{actor}님 외 {others}명이 참여했습니다' },
  'col.activity.sharedUnlisted': {
    en: '@{actor} shared this collection with anyone who has the link',
    ko: '@{actor}님이 링크가 있는 사람에게 이 컬렉션을 공개했습니다',
  },
  'col.activity.sharedPublic': { en: '@{actor} made this collection public', ko: '@{actor}님이 이 컬렉션을 공개했습니다' },
  'col.activity.open': { en: 'Open', ko: '열기' },

  // Settings
  'col.settings.heading': { en: 'Collections', ko: '컬렉션' },
  'col.settings.mirrorName': { en: 'Write collections to note properties', ko: '컬렉션을 노트 속성에 쓰기' },
  'col.settings.mirrorDesc': {
    en: 'Adds an archiveCollections list to your archive notes so Bases, Dataview and search can use it. Changes you make to the property are not sent back.',
    ko: '아카이브 노트에 archiveCollections 목록을 써서 Bases, Dataview, 검색에서 쓸 수 있게 합니다. 속성을 직접 고쳐도 서버로 보내지 않습니다.',
  },
  'col.settings.activityName': { en: 'Collaborative collection activity', ko: '공동 편집 컬렉션 활동' },
  'col.settings.activityDesc': {
    en: 'When others add posts, join, or share a collaborative collection. Shown here when your phone and the desktop app aren’t getting it.',
    ko: '다른 사람이 게시물을 추가하거나, 참여하거나, 컬렉션을 공개하면 알려줍니다. 휴대폰과 데스크톱 앱이 받지 못할 때 여기에 표시합니다.',
  },
  'col.settings.activityFailed': { en: 'Couldn’t update collaborative collection notifications', ko: '공동 편집 컬렉션 알림 설정을 바꾸지 못했습니다' },

  // Commands
  'col.cmd.addNote': { en: 'Add current note to collection', ko: '현재 노트를 컬렉션에 추가' },
  'col.cmd.removeNote': { en: 'Remove current note from a collection', ko: '현재 노트를 컬렉션에서 빼기' },
  'col.cmd.open': { en: 'Open collection', ko: '컬렉션 열기' },
  'col.cmd.copyLink': { en: 'Copy collection link', ko: '컬렉션 링크 복사' },
  'col.cmd.createBase': { en: 'Create base from collection', ko: '컬렉션으로 Base 만들기' },
  'col.cmd.chooseCollection': { en: 'Choose a collection…', ko: '컬렉션을 고르세요…' },
  'col.cmd.notInAnyCollection': { en: 'This note isn’t in any collection you can edit.', ko: '이 노트는 편집할 수 있는 컬렉션에 들어 있지 않습니다.' },

  // Bases
  'col.base.created': { en: 'Created {path}', ko: '{path}를 만들었습니다' },
  'col.base.enableMirrorTitle': { en: 'Turn on note properties?', ko: '노트 속성 쓰기를 켤까요?' },
  'col.base.enableMirrorBody': {
    en: 'Bases filter on note properties. This turns on “Write collections to note properties”, which adds an archiveCollections list to your archive notes.',
    ko: 'Bases는 노트 속성으로 거릅니다. ‘컬렉션을 노트 속성에 쓰기’를 켜서 아카이브 노트에 archiveCollections 목록을 씁니다.',
  },
  'col.base.enableMirrorConfirm': { en: 'Turn on and create', ko: '켜고 만들기' },
} satisfies Record<string, LocaleText>;
